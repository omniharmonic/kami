/**
 * The Hermes gateway client (architecture §5.5): POST
 * `${HERMES_GATEWAY_URL}/p/<slug>/v1/chat/completions` with `stream: true`.
 * The gate answers 423 (paused), 429 with `{people_ahead}` / `Retry-After`
 * (budget or concurrency), or an SSE stream of OpenAI chunks followed by a
 * trailing `event: toolcalls` (§5.4) for the "what I looked at" footer.
 *
 * `HERMES_GATEWAY_URL=fake:` streams a canned guarded reply so dev and e2e
 * work without a GPU; `fake:asleep` simulates the tunnel being down and
 * `fake:busy` an over-budget gate.
 */
import { env } from "@/env";

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

/** One tool call as the gate reports it; the footer shows every field as text. */
export type ToolCallRecord = {
  tool: string;
  place_id: string | null;
  time: string | null;
  source_id: string | null;
  stale: boolean | null;
  source_status?: "ok" | "warning" | "critical" | "unknown";
};

export type ToolcallsEvent = { calls: ToolCallRecord[]; guard_dropped: number };

export type GatewayResult =
  | { kind: "stream"; body: ReadableStream<Uint8Array> }
  | { kind: "paused" }
  | { kind: "over_budget"; people_ahead: number | null; retry_after_s: number | null }
  | { kind: "asleep"; error: string };

export type GatewayRequest = { slug: string; messages: ChatMessage[]; user?: string; signal?: AbortSignal };

export async function chatCompletion(req: GatewayRequest, baseUrl: string = env.HERMES_GATEWAY_URL): Promise<GatewayResult> {
  if (baseUrl.startsWith("fake:")) return fakeGateway(req, baseUrl.slice("fake:".length));
  const url = `${baseUrl.replace(/\/$/, "")}/p/${encodeURIComponent(req.slug)}/v1/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${env.HERMES_API_SERVER_KEY ?? ""}`,
      },
      body: JSON.stringify({ model: req.slug, messages: req.messages, stream: true, user: req.user }),
      signal: req.signal ?? AbortSignal.timeout(60_000),
      cache: "no-store",
    });
  } catch (err) {
    return { kind: "asleep", error: (err as Error).message };
  }
  if (res.status === 423) return { kind: "paused" };
  if (res.status === 429) {
    let people_ahead: number | null = null;
    try {
      const j = (await res.json()) as { people_ahead?: number };
      if (typeof j.people_ahead === "number") people_ahead = j.people_ahead;
    } catch {
      /* no body */
    }
    const ra = res.headers.get("retry-after");
    return { kind: "over_budget", people_ahead, retry_after_s: ra ? Number(ra) || null : null };
  }
  if (!res.ok || !res.body) return { kind: "asleep", error: `upstream ${res.status}` };
  return { kind: "stream", body: res.body };
}

// --- fake mode -------------------------------------------------------------

export const FAKE_REPLY_SENTENCES = [
  "The last flow reading I have from Orodell is 15.4 cubic feet per second, from 2026-09-04 20:15Z. ",
  "The gauge feed has been quiet since then, so I can't feel my gauge right now. ",
  "Gross Reservoir is at 72 % of normal storage as of 2026-09-06 05:00Z.",
];

export const FAKE_TOOLCALLS: ToolcallsEvent = {
  calls: [
    { tool: "get_place_latest", place_id: "place/boulder-creek-near-orodell-co", time: "2026-09-04T20:15:00Z", source_id: "cdss.telemetry", stale: true, source_status: "critical" },
    { tool: "get_place_latest", place_id: "place/gross-reservoir", time: "2026-09-06T05:00:00Z", source_id: "cdss.telemetry", stale: false, source_status: "ok" },
  ],
  guard_dropped: 0,
};

function sseChunk(content: string, id: string, role?: "assistant"): string {
  const delta: Record<string, string> = role ? { role, content } : { content };
  return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
}

function fakeGateway(req: GatewayRequest, mode: string): GatewayResult {
  if (mode === "asleep") return { kind: "asleep", error: "fake tunnel down" };
  if (mode === "busy") return { kind: "over_budget", people_ahead: 3, retry_after_s: 30 };
  if (mode === "paused") return { kind: "paused" };
  const enc = new TextEncoder();
  const id = `fake-${Date.now()}`;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(enc.encode(sseChunk("", id, "assistant")));
      for (const s of FAKE_REPLY_SENTENCES) {
        controller.enqueue(enc.encode(sseChunk(s, id)));
        await new Promise((r) => setTimeout(r, mode === "fast" ? 0 : 40));
      }
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`));
      controller.enqueue(enc.encode(`event: toolcalls\ndata: ${JSON.stringify(FAKE_TOOLCALLS)}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return { kind: "stream", body };
}
