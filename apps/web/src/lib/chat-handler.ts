/**
 * The chat route's logic, with its I/O behind `ChatDeps` so tests can run it
 * against fakes. `POST /e/[slug]/chat` (Node runtime, streaming; §5.5):
 *   session + rate limit → paused check (423) → gateway → relay SSE,
 *   pass through the trailing `event: toolcalls`, emit `event: reminder`
 *   when turns % reminder_every_turns === 0 (counted here, never by the
 *   model — ADR-E13), persist `chat_messages`.
 */
import { z } from "zod";
import { chat as copy, disclosure, states } from "@/copy";
import { type ChatMessage, type GatewayResult, type ToolcallsEvent } from "./gateway";
import type { LimitResult } from "./ratelimit";

export const DEFAULT_REMINDER_EVERY = 12;

export type ChatEntity = { id: string; slug: string; name: string; archetype: string; paused: boolean };

export type ChatSessionRef = { id: string; turns: number };

export type ChatDeps = {
  getEntity(slug: string): Promise<ChatEntity | null>;
  /** find or create the session for this anon key (or user) on this entity; `turns` is the count so far */
  getOrCreateSession(input: { entityId: string; anonKey: string | null; userId: string | null; ipHash: string }): Promise<ChatSessionRef>;
  checkLimits(input: { sessionId: string; ipHash: string }): Promise<LimitResult>;
  reminderEvery(): Promise<number>;
  gateway(input: { slug: string; messages: ChatMessage[]; user: string; signal?: AbortSignal }): Promise<GatewayResult>;
  /** called once per turn, after the stream ends */
  persistTurn(input: {
    sessionId: string;
    turn: number;
    user: string;
    assistant: string;
    toolcalls: ToolcallsEvent | null;
    guard_dropped: number;
    reminder: boolean;
    state: "ok" | "asleep";
  }): Promise<void>;
};

export const chatBodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

export type ChatRequestContext = {
  slug: string;
  body: unknown;
  anonKey: string | null;
  userId: string | null;
  ipHash: string;
  signal?: AbortSignal;
};

const enc = new TextEncoder();

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

function sseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  // `no-transform` is load-bearing, not decoration: Next's own `compression`
  // middleware gzips `text/event-stream` otherwise, which buffers the whole
  // reply and destroys sentence-by-sentence release — measured as every frame
  // arriving within 12 ms at the end instead of 40 ms apart. `x-accel-buffering`
  // does the same job for nginx-style proxies.
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...extra,
  };
}

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function handleChat(deps: ChatDeps, ctx: ChatRequestContext): Promise<Response> {
  const parsed = chatBodySchema.safeParse(ctx.body);
  if (!parsed.success) return json(400, { reason: "bad_request", issues: parsed.error.issues.map((i) => i.message) });
  const messages = parsed.data.messages;
  const last = messages[messages.length - 1]!;
  if (last.role !== "user") return json(400, { reason: "bad_request", message: "last message must be from the user" });

  const entity = await deps.getEntity(ctx.slug);
  if (!entity) return json(404, { reason: "not_found" });
  if (entity.paused) return json(423, { reason: "paused", message: copy.paused }, { "x-kami-state": "paused" });

  const session = await deps.getOrCreateSession({ entityId: entity.id, anonKey: ctx.anonKey, userId: ctx.userId, ipHash: ctx.ipHash });
  const limit = await deps.checkLimits({ sessionId: session.id, ipHash: ctx.ipHash });
  if (!limit.ok) {
    return json(
      429,
      { reason: "rate_limited", scope: limit.reason, retry_after: limit.retry_after_s, message: limit.reason === "ip_day" ? copy.rateLimitedDay : copy.rateLimited },
      { "retry-after": String(limit.retry_after_s) },
    );
  }

  const turn = session.turns + 1;
  const every = Math.max(1, await deps.reminderEvery());
  const reminderDue = turn % every === 0;
  const reminderText = disclosure.reminder(entity.name);

  const upstream = await deps.gateway({ slug: entity.slug, messages, user: session.id, ...(ctx.signal ? { signal: ctx.signal } : {}) });

  if (upstream.kind === "paused") return json(423, { reason: "paused", message: copy.paused }, { "x-kami-state": "paused" });
  if (upstream.kind === "over_budget") {
    return json(
      429,
      { reason: "over_budget", people_ahead: upstream.people_ahead, retry_after: upstream.retry_after_s, message: upstream.people_ahead ? states.peopleAhead(upstream.people_ahead) : states.overBudget },
      { "retry-after": String(upstream.retry_after_s ?? 60), "x-kami-state": "over_budget" },
    );
  }
  if (upstream.kind === "asleep") {
    // Tunnel error: stream the asleep line as a system message, mark the response.
    const text = sseEvent("system", { text: copy.asleep, state: "asleep" }) + (reminderDue ? sseEvent("reminder", { text: reminderText, turn }) : "") + "data: [DONE]\n\n";
    await safePersist(deps, { sessionId: session.id, turn, user: last.content, assistant: "", toolcalls: null, guard_dropped: 0, reminder: reminderDue, state: "asleep" });
    return new Response(text, { status: 200, headers: sseHeaders({ "x-kami-state": "asleep", "x-kami-turn": String(turn) }) });
  }

  // Relay the upstream SSE, watching for content deltas and the trailing toolcalls event.
  let buffer = "";
  // A decoder owns partial UTF-8 bytes: sharing it between requests corrupts
  // concurrent replies whenever a character spans transport chunks.
  const dec = new TextDecoder();
  let assistant = "";
  let toolcalls: ToolcallsEvent | null = null;
  let doneSeen = false;

  const handleFrame = (frame: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    const data = dataLines.join("\n");
    if (event === "toolcalls") {
      try {
        const j = JSON.parse(data) as Partial<ToolcallsEvent>;
        toolcalls = { calls: Array.isArray(j.calls) ? j.calls : [], guard_dropped: typeof j.guard_dropped === "number" ? j.guard_dropped : 0 };
      } catch {
        toolcalls = { calls: [], guard_dropped: 0 };
      }
      return;
    }
    if (event === "message") {
      if (data === "[DONE]") {
        doneSeen = true;
        return;
      }
      try {
        const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const c = j.choices?.[0]?.delta?.content;
        if (typeof c === "string") assistant += c;
      } catch {
        /* non-JSON data line; relay unchanged */
      }
    }
  };

  const emitFrame = (frame: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    const wasDone = doneSeen;
    handleFrame(frame);
    if (doneSeen && !wasDone && reminderDue) {
      controller.enqueue(enc.encode(sseEvent("reminder", { text: reminderText, turn })));
    }
    controller.enqueue(enc.encode(frame + "\n\n"));
  };

  const relay = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += dec.decode(chunk, { stream: true });
      let separator: RegExpExecArray | null;
      // Both LF and CRLF are valid SSE line endings, including when split
      // across chunks. Normalize frames for the browser's LF parser.
      while ((separator = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const frame = buffer.slice(0, separator.index).replace(/\r\n/g, "\n");
        buffer = buffer.slice(separator.index + separator[0].length);
        emitFrame(frame, controller);
      }
    },
    async flush(controller) {
      buffer += dec.decode();
      if (buffer.trim()) {
        emitFrame(buffer.replace(/\r\n/g, "\n"), controller);
        buffer = "";
      }
      if (!doneSeen) {
        if (reminderDue) controller.enqueue(enc.encode(sseEvent("reminder", { text: reminderText, turn })));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      }
      await safePersist(deps, {
        sessionId: session.id,
        turn,
        user: last.content,
        assistant,
        toolcalls,
        guard_dropped: toolcalls?.guard_dropped ?? 0,
        reminder: reminderDue,
        state: "ok",
      });
    },
  });

  return new Response(upstream.body.pipeThrough(relay), { status: 200, headers: sseHeaders({ "x-kami-state": "ok", "x-kami-turn": String(turn) }) });
}

async function safePersist(deps: ChatDeps, input: Parameters<ChatDeps["persistTurn"]>[0]): Promise<void> {
  try {
    await deps.persistTurn(input);
  } catch (err) {
    console.warn("[chat] persist failed:", (err as Error).message);
  }
}
