import { describe, expect, it } from "vitest";
import { handleChat, type ChatDeps } from "../chat-handler";
import { chatCompletion, FAKE_TOOLCALLS } from "../gateway";
import { createMemoryLimiter, checkChatLimits } from "../ratelimit";
import { disclosure } from "@/copy";

function makeDeps(over: Partial<ChatDeps> & { paused?: boolean; turns?: number } = {}) {
  const persisted: Array<Parameters<ChatDeps["persistTurn"]>[0]> = [];
  let turns = over.turns ?? 0;
  const limiter = createMemoryLimiter();
  const deps: ChatDeps = {
    getEntity: async (slug) => (slug === "boulder-creek" ? { id: "entity/boulder-creek", slug, name: "Boulder Creek", archetype: "creek", paused: over.paused ?? false } : null),
    getOrCreateSession: async () => ({ id: "s1", turns }),
    checkLimits: async ({ sessionId, ipHash }) => checkChatLimits({ sessionId, ipHash, db: null }, limiter),
    reminderEvery: async () => 12,
    gateway: async ({ slug, messages, user }) => chatCompletion({ slug, messages, user }, "fake:fast"),
    persistTurn: async (t) => {
      persisted.push(t);
      turns = t.turn;
    },
    ...over,
  };
  return { deps, persisted };
}

const ctx = (body: unknown, slug = "boulder-creek") => ({ slug, body, anonKey: "anon1", userId: null, ipHash: "iphash" });
const ask = (q = "how is the flow?") => ({ messages: [{ role: "user", content: q }] });

async function readAll(res: Response): Promise<string> {
  return new Response(res.body).text();
}

function frames(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((f) => {
      let event = "message";
      const data: string[] = [];
      for (const l of f.split("\n")) {
        if (l.startsWith("event:")) event = l.slice(6).trim();
        else if (l.startsWith("data:")) data.push(l.slice(5).trimStart());
      }
      return { event, data: data.join("\n") };
    });
}

describe("chat route handler", () => {
  it("returns 423 {reason: paused} when entities.paused_at is set", async () => {
    const { deps } = makeDeps({ paused: true });
    const res = await handleChat(deps, ctx(ask()));
    expect(res.status).toBe(423);
    expect(await res.json()).toMatchObject({ reason: "paused" });
    expect(res.headers.get("x-kami-state")).toBe("paused");
  });

  it("returns 404 for an unknown slug and 400 for a bad body", async () => {
    const { deps } = makeDeps();
    expect((await handleChat(deps, ctx(ask(), "nope"))).status).toBe(404);
    expect((await handleChat(deps, ctx({ messages: [] }))).status).toBe(400);
  });

  it("relays the fake gateway stream with the trailing toolcalls event and persists the turn", async () => {
    const { deps, persisted } = makeDeps();
    const res = await handleChat(deps, ctx(ask()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-kami-turn")).toBe("1");
    const text = await readAll(res);
    const fs = frames(text);
    const tool = fs.find((f) => f.event === "toolcalls")!;
    expect(tool).toBeTruthy();
    const tc = JSON.parse(tool.data);
    expect(tc).toEqual(FAKE_TOOLCALLS);
    // footer data shape: place id, time, source, stale on every call
    for (const c of tc.calls) {
      expect(c).toEqual(expect.objectContaining({ place_id: expect.any(String), time: expect.any(String), source_id: expect.any(String), stale: expect.any(Boolean) }));
    }
    expect(fs.some((f) => f.event === "reminder")).toBe(false);
    expect(fs[fs.length - 1]!.data).toBe("[DONE]");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.assistant).toContain("15.4 cubic feet per second");
    expect(persisted[0]!.toolcalls).toEqual(FAKE_TOOLCALLS);
    expect(persisted[0]!.reminder).toBe(false);
  });

  it("emits event: reminder at turn 12 (counted by the web app), before [DONE]", async () => {
    const { deps, persisted } = makeDeps({ turns: 11 });
    const res = await handleChat(deps, ctx(ask()));
    expect(res.headers.get("x-kami-turn")).toBe("12");
    const fs = frames(await readAll(res));
    const idxReminder = fs.findIndex((f) => f.event === "reminder");
    const idxDone = fs.findIndex((f) => f.data === "[DONE]");
    expect(idxReminder).toBeGreaterThan(-1);
    expect(idxReminder).toBeLessThan(idxDone);
    expect(JSON.parse(fs[idxReminder]!.data)).toMatchObject({ text: disclosure.reminder("Boulder Creek"), turn: 12 });
    expect(persisted[0]!.reminder).toBe(true);
  });

  it("emits a reminder every N turns across a session with the fake gateway", async () => {
    // lift the 20/hour limit for this test; the limiter has its own test below
    const { deps } = makeDeps({ checkLimits: async () => ({ ok: true }) });
    const reminders: number[] = [];
    for (let i = 1; i <= 24; i++) {
      const fs = frames(await readAll(await handleChat(deps, ctx(ask(`turn ${i}`)))));
      if (fs.some((f) => f.event === "reminder")) reminders.push(i);
    }
    expect(reminders).toEqual([12, 24]);
  });

  it("relays an over-budget gate as 429 with people_ahead", async () => {
    const { deps } = makeDeps({ gateway: async () => ({ kind: "over_budget", people_ahead: 3, retry_after_s: 30 }) });
    const res = await handleChat(deps, ctx(ask()));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toMatchObject({ reason: "over_budget", people_ahead: 3 });
  });

  it("streams the asleep line as a system message with X-Kami-State: asleep on a tunnel error", async () => {
    const { deps, persisted } = makeDeps({ gateway: async ({ slug, messages, user }) => chatCompletion({ slug, messages, user }, "fake:asleep") });
    const res = await handleChat(deps, ctx(ask()));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-kami-state")).toBe("asleep");
    const fs = frames(await readAll(res));
    expect(fs[0]!.event).toBe("system");
    expect(JSON.parse(fs[0]!.data).text).toContain("I'm asleep — my thinking machine is off");
    expect(persisted[0]!.state).toBe("asleep");
  });

  it("applies the 20 turns/session/hour limit", async () => {
    const { deps } = makeDeps();
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) last = await handleChat(deps, ctx(ask()));
    expect(last!.status).toBe(429);
    expect(await last!.json()).toMatchObject({ reason: "rate_limited", scope: "session_hour" });
  });
});
