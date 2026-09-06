import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, seedEntity, seedUser, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { verifyEventChain } from "@/db/events";
import { applyPause, PauseError, resumeRequesters } from "../pause";
import { pauseSet, recordHeartbeat } from "../gate";
import { gpuOnline, getConfig } from "../common";

// Each case builds a fresh PGlite database and runs every migration; on a box
// running several suites at once that can outlast the shared 60 s default.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });


const NOW = new Date("2026-09-06T06:00:00Z");
const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => closeTestDb(d)));
});

async function fresh(slug = "boulder-creek") {
  const db = await createTestDb();
  dbs.push(db);
  await seedEntity(db, { slug, name: "Boulder Creek" });
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.slug, slug));
  await seedUser(db, "guardian-a");
  await seedUser(db, "guardian-b");
  return { db, entity: entity! };
}

async function reload(db: TestDb, id: string) {
  const [row] = await db.select().from(schema.entities).where(eq(schema.entities.id, id));
  return row!;
}

describe("pause / resume (ADR-E12)", () => {
  it("one guardian pauses; one cannot resume; two distinct guardians can", async () => {
    const { db, entity } = await fresh("pause-creek");
    const a = { kind: "user" as const, user_id: "guardian-a", label: "Ada" };
    const b = { kind: "user" as const, user_id: "guardian-b", label: "Grace" };

    const paused = await applyPause(db, entity, { action: "pause", reason: "drill", guardians: [] }, a, { now: NOW, gate: {} });
    expect(paused).toMatchObject({ applied: true, paused: true });
    expect((await reload(db, entity.id)).pausedAt).not.toBeNull();

    // one guardian asking to resume is recorded but does not resume
    const one = await applyPause(db, await reload(db, entity.id), { action: "resume", reason: "", guardians: [] }, a, { now: new Date(NOW.getTime() + 60_000), gate: {} });
    expect(one).toMatchObject({ applied: false, paused: true, requests: { have: 1, need: 2 } });
    expect((await reload(db, entity.id)).pausedAt).not.toBeNull();

    // the same guardian asking twice is still one distinct guardian
    const again = await applyPause(db, await reload(db, entity.id), { action: "resume", reason: "", guardians: [] }, a, { now: new Date(NOW.getTime() + 120_000), gate: {} });
    expect(again).toMatchObject({ applied: false, requests: { have: 1, need: 2 } });

    // a second, distinct guardian resumes
    const two = await applyPause(db, await reload(db, entity.id), { action: "resume", reason: "", guardians: [] }, b, { now: new Date(NOW.getTime() + 180_000), gate: {} });
    expect(two).toMatchObject({ applied: true, paused: false, requests: { have: 2, need: 2 } });
    expect((await reload(db, entity.id)).pausedAt).toBeNull();

    const events = await db.select().from(schema.pauseEvents).where(eq(schema.pauseEvents.entityId, entity.id));
    expect(events.map((e) => e.action).sort()).toEqual(["pause", "resume", "resume_request", "resume_request", "resume_request"]);
    expect(await verifyEventChain(db, entity.id)).toMatchObject({ ok: true });
  });

  it("a script must name two distinct guardians to resume", async () => {
    const { db, entity } = await fresh("script-creek");
    const script = { kind: "script" as const, label: "script:platform-admin" };
    await applyPause(db, entity, { action: "pause", reason: "box", guardians: ["ada"] }, script, { now: NOW, gate: {} });
    expect((await reload(db, entity.id)).pausedAt).not.toBeNull();
    await expect(applyPause(db, await reload(db, entity.id), { action: "resume", reason: "", guardians: ["ada", "ADA"] }, script, { now: NOW, gate: {} })).rejects.toBeInstanceOf(PauseError);
    const ok = await applyPause(db, await reload(db, entity.id), { action: "resume", reason: "", guardians: ["ada", "grace"] }, script, { now: NOW, gate: {} });
    expect(ok.applied).toBe(true);
  });

  it("pushes to the gate's admin endpoint when GATE_ADMIN_URL is set", async () => {
    const { db, entity } = await fresh("gate-creek");
    const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const out = await applyPause(db, entity, { action: "pause", reason: "drill", guardians: [] }, { kind: "user", user_id: "guardian-a", label: "Ada" }, {
      now: NOW,
      gate: { url: "http://127.0.0.1:8001", secret: "s3cret", fetchImpl },
    });
    expect(out.gate).toMatchObject({ pushed: true, status: 200 });
    expect(calls[0]!.url).toBe("http://127.0.0.1:8001/admin/pause/gate-creek");
    expect(calls[0]!.headers["X-Gate-Admin"]).toBe("s3cret");
    expect(calls[0]!.body).toMatchObject({ action: "pause", reason: "drill", guardians: ["Ada"] });
  });

  it("survives the gate being unreachable — the flag is still set", async () => {
    const { db, entity } = await fresh("offline-creek");
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const out = await applyPause(db, entity, { action: "pause", reason: "", guardians: [] }, { kind: "script", label: "script" }, { now: NOW, gate: { url: "http://127.0.0.1:8001", secret: "s", fetchImpl } });
    expect(out.applied).toBe(true);
    expect(out.gate).toMatchObject({ pushed: false });
    expect((await reload(db, entity.id)).pausedAt).not.toBeNull();
  });

  it("retire needs two guardians too and leaves the record", async () => {
    const { db, entity } = await fresh("retire-creek");
    const a = { kind: "user" as const, user_id: "guardian-a", label: "Ada" };
    const b = { kind: "user" as const, user_id: "guardian-b", label: "Grace" };
    await applyPause(db, entity, { action: "pause", reason: "", guardians: [] }, a, { now: NOW, gate: {} });
    const first = await applyPause(db, await reload(db, entity.id), { action: "retire", reason: "", guardians: [] }, a, { now: NOW, gate: {} });
    expect(first.applied).toBe(false);
    const second = await applyPause(db, await reload(db, entity.id), { action: "retire", reason: "", guardians: [] }, b, { now: NOW, gate: {} });
    expect(second).toMatchObject({ applied: true, retired: true });
    expect((await reload(db, entity.id)).retiredAt).not.toBeNull();
  });

  it("resume requests older than 24 h do not count", async () => {
    const { db, entity } = await fresh("stale-request-creek");
    const a = { kind: "user" as const, user_id: "guardian-a", label: "Ada" };
    await applyPause(db, entity, { action: "pause", reason: "", guardians: [] }, a, { now: NOW, gate: {} });
    const paused = await reload(db, entity.id);
    await db.insert(schema.pauseEvents).values({ entityId: entity.id, at: new Date(NOW.getTime() - 48 * 3600_000), byUser: "guardian-b", action: "resume_request" });
    expect(await resumeRequesters(db, paused, NOW)).toEqual([]);
  });
});

describe("the gate contract", () => {
  it("pause-set answers {paused: [slug…]} and reflects paused_at", async () => {
    const { db, entity } = await fresh("set-creek");
    await seedEntity(db, { slug: "other-creek", name: "Other" });
    expect((await pauseSet(db, NOW)).paused).toEqual([]);
    await applyPause(db, entity, { action: "pause", reason: "", guardians: [] }, { kind: "script", label: "s" }, { now: NOW, gate: {} });
    const set = await pauseSet(db, NOW);
    expect(set.paused).toEqual(["set-creek"]);
    expect(set.as_of).toBe(NOW.toISOString());
    // a retired entity is in the set too
    await db.update(schema.entities).set({ retiredAt: NOW }).where(eq(schema.entities.slug, "other-creek"));
    expect((await pauseSet(db, NOW)).paused).toEqual(["other-creek", "set-creek"]);
  });

  it("the heartbeat sets gpu_last_seen_at and drains the gate's JSONL rows", async () => {
    const { db, entity } = await fresh("hb-creek");
    const out = await recordHeartbeat(
      db,
      {
        at: NOW.toISOString(),
        host: "box-1",
        usage_events: [
          { ts: NOW.toISOString(), slug: "hb-creek", job: "chat", prompt_tokens: 120, output_tokens: 45, latency_ms: 812.4, model: "qwen3.5-9b" },
          { ts: NOW.toISOString(), slug: "unknown-creek", job: "pulse", prompt_tokens: 10, output_tokens: 0 },
        ],
        guard_events: [{ ts: NOW.toISOString(), slug: "hb-creek", job: "chat", action: "drop", sentence: "the creek is 40 cfs", unmatched: { numbers: ["40"] } }],
      },
      NOW,
    );
    expect(out).toMatchObject({ gpu_last_seen_at: NOW.toISOString(), inserted: { usage: 2, guard: 1 }, unknown_slugs: ["unknown-creek"] });
    expect(await getConfig(db, "gpu_last_seen_at")).toBe(NOW.toISOString());
    expect(await gpuOnline(db, new Date(NOW.getTime() + 5 * 60_000))).toBe(true);
    expect(await gpuOnline(db, new Date(NOW.getTime() + 20 * 60_000))).toBe(false);

    const usage = await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.entityId, entity.id));
    expect(usage[0]).toMatchObject({ job: "chat", tokensPrompt: 120, tokensOutput: 45, latencyMs: 812, model: "qwen3.5-9b" });
    const guard = await db.select().from(schema.guardEvents).where(eq(schema.guardEvents.entityId, entity.id));
    expect(guard[0]).toMatchObject({ context: "chat", action: "drop", sentence: "the creek is 40 cfs" });
    // an unknown slug still lands (entity_id null) rather than being dropped
    const all = await db.select().from(schema.usageEvents);
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.entityId === null)).toBeTruthy();
  });
});
