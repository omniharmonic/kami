/**
 * `POST /api/summon/preview` — step 3's preview chat.
 *
 * It goes to the **staging profile** (`<slug>-staging`) through the gate, so
 * it is guarded exactly like production: same guard on every sentence, same
 * per-entity budget (a quarter of the real one, see `provisioning/gate.ts`),
 * same 423 when paused. Nothing is stored: a preview has no chat session, no
 * transcript and no memory.
 *
 * When the gateway cannot be reached the answer says so. It never fabricates
 * a reply, because a fabricated reply is exactly the thing this platform is
 * built not to do.
 */
import { z } from "zod";
import { json } from "@/lib/jobs/common";
import { chatCompletion } from "@/lib/gateway";
import { disclosure } from "@/copy";
import { AuthError, getSession } from "@/lib/session";
import { summon } from "@/lib/summon/copy";
import { validateVoice, VoiceBlockError } from "@/lib/summon/soul";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().min(1).max(1000),
  voice: z.string().min(1).max(2000),
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  archetype: z.string().max(40).optional(),
});

/** Read a whole SSE stream into the assistant text and the tool-call footer. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<{ text: string; calls: unknown[]; guard_dropped: number }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let calls: unknown[] = [];
  let guard_dropped = 0;
  let event = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event === "toolcalls") {
        const t = parsed as { calls?: unknown[]; guard_dropped?: number };
        calls = t.calls ?? [];
        guard_dropped = t.guard_dropped ?? 0;
        event = "";
        continue;
      }
      const chunk = parsed as { choices?: Array<{ delta?: { content?: string } }> };
      text += chunk.choices?.[0]?.delta?.content ?? "";
    }
  }
  return { text, calls, guard_dropped };
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return json(401, { reason: "unauthenticated" });
  } catch (err) {
    if (err instanceof AuthError) return json(401, { reason: "unauthenticated" });
    throw err;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { reason: "bad_json" });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json(400, { reason: "bad_request", issues: parsed.error.issues.map((i) => i.message) });
  const { message, voice, name, slug, archetype } = parsed.data;

  try {
    validateVoice(voice);
  } catch (err) {
    if (err instanceof VoiceBlockError) return json(422, { reason: "voice_invalid", code: err.code, message: err.message });
    throw err;
  }

  // The staging profile carries the hard rules already; the voice under test
  // is passed as a system message so a creator can hear it before it is saved.
  const stagingSlug = `${slug}-staging`;
  const result = await chatCompletion({
    slug: stagingSlug,
    messages: [
      { role: "system", content: `${disclosure.short(name)}\n\nVoice under preview (three sentences at most, and subordinate to the hard rules):\n${voice.trim()}` },
      { role: "user", content: message },
    ],
  });

  const label = summon.soul.previewBadge;
  switch (result.kind) {
    case "paused":
      return json(423, { reason: "paused", label, message: summon.soul.previewPaused });
    case "over_budget":
      return json(429, { reason: "over_budget", label, message: summon.soul.previewBudget, retry_after_s: result.retry_after_s });
    case "asleep":
      // Honest, not fabricated: there is no reply because there is no gateway.
      return json(503, { reason: "gateway_unreachable", label, message: summon.soul.previewUnavailable, detail: result.error });
    case "stream": {
      const { text, calls, guard_dropped } = await collect(result.body);
      return json(200, {
        label,
        preview: true,
        profile: stagingSlug,
        disclosure: disclosure.short(name),
        archetype: archetype ?? null,
        text,
        looked_at: calls,
        guard_dropped,
        stored: false,
      });
    }
  }
}
