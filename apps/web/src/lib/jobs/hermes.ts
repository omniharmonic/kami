/**
 * `POST /api/webhooks/hermes` — cron deliveries from the Hermes gateway
 * (architecture §6.2). HMAC-SHA256 over `"<timestamp>.<raw body>"` with
 * `HERMES_WEBHOOK_SECRET`; constant-time compare; a 5-minute timestamp
 * window; event-id idempotency via a `config` row claimed before any write.
 *
 * Headers:  X-Kami-Timestamp: <unix seconds | ISO>
 *           X-Kami-Signature: sha256=<hex>      (also accepted: X-Hermes-Signature)
 *           X-Guard: pass | dropped | held      (optional; the body's `kami_guard` wins)
 *
 * Body:     { id, type: "cron.delivery", profile|slug, job, at?, output, kami_guard?, usage? }
 *
 * *verify* (docs/verify.md #1): Hermes v0.21.0's actual delivery format and
 * whether it signs; the format above is the platform's contract for the
 * delivery shim on the box.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import { claimConfigKey, entityBySlug, safeEqual } from "./common";
import { BountyDraftError, normalizeGuard, storeBountyDraft, storeDonorReportNarrative, storePulse, storeStrategy, type GuardResult } from "./drafts";
import { latestSnapshotRow, loadCurrentBinding } from "./needs";

export const HERMES_TIMESTAMP_WINDOW_S = 300;

export function signHermes(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export type SignatureCheck = { ok: true; timestamp: string } | { ok: false; reason: "no_secret" | "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature" };

export function verifyHermesSignature(headers: Headers, rawBody: string, secret: string | undefined, now = new Date()): SignatureCheck {
  if (!secret) return { ok: false, reason: "no_secret" };
  const ts = headers.get("x-kami-timestamp") ?? headers.get("x-hermes-timestamp");
  const sigHeader = headers.get("x-kami-signature") ?? headers.get("x-hermes-signature");
  if (!ts || !sigHeader) return { ok: false, reason: "missing_headers" };
  const t = /^\d+$/.test(ts.trim()) ? Number(ts.trim()) * 1000 : Date.parse(ts);
  if (!Number.isFinite(t)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(now.getTime() - t) > HERMES_TIMESTAMP_WINDOW_S * 1000) return { ok: false, reason: "stale_timestamp" };
  const given = sigHeader.trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = signHermes(secret, ts.trim(), rawBody);
  if (!/^[0-9a-f]{64}$/.test(given) || !safeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  return { ok: true, timestamp: ts.trim() };
}

export const HERMES_JOBS = ["weekly-bounties", "quarterly-strategy", "daily-reflection", "donor-report", "pulse"] as const;

export const deliverySchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().default("cron.delivery"),
  profile: z.string().min(1).max(80).optional(),
  slug: z.string().min(1).max(80).optional(),
  entity: z.string().optional(),
  job: z.string().min(1).max(80),
  at: z.string().optional(),
  output: z.unknown().optional(),
  text: z.string().optional(),
  kami_guard: z.unknown().optional(),
  guard: z.unknown().optional(),
  snapshot_id: z.number().int().optional().nullable(),
  usage: z.object({ prompt_tokens: z.number().optional(), output_tokens: z.number().optional() }).partial().optional(),
});

export type HermesDelivery = z.infer<typeof deliverySchema>;

export type DeliveryOutcome =
  | { ok: true; replay: true; id: string }
  | { ok: true; replay: false; id: string; job: string; stored: Record<string, unknown> }
  | { ok: false; status: 400 | 404 | 410 | 422 | 423; reason: string; details?: unknown };

function guardFrom(delivery: HermesDelivery, header: string | null): GuardResult | null {
  const body = delivery.kami_guard ?? delivery.guard;
  const fromBody = typeof body === "object" && body !== null ? normalizeGuard((body as { result?: unknown }).result) : normalizeGuard(body);
  return fromBody ?? normalizeGuard(header);
}

function outputText(delivery: HermesDelivery): string | null {
  if (typeof delivery.text === "string" && delivery.text.trim()) return delivery.text.trim();
  const o = delivery.output;
  if (typeof o === "string") return o.trim() || null;
  if (o && typeof o === "object" && typeof (o as { text?: unknown }).text === "string") return ((o as { text: string }).text).trim() || null;
  return null;
}

/** JSON array, `{bounties: [...]}`, a single object, or JSONL lines — whatever the model produced. */
export function parseBountyOutput(output: unknown): unknown[] {
  if (Array.isArray(output)) return output;
  if (output && typeof output === "object") {
    const b = (output as { bounties?: unknown }).bounties;
    if (Array.isArray(b)) return b;
    return [output];
  }
  if (typeof output !== "string") return [];
  const text = output.trim();
  if (!text) return [];
  try {
    return parseBountyOutput(JSON.parse(text));
  } catch {
    /* fall through to JSONL and fenced blocks */
  }
  const out: unknown[] = [];
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!.trim());
  const candidates = fenced.length ? fenced : text.split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  for (const c of candidates) {
    try {
      out.push(...parseBountyOutput(JSON.parse(c)));
    } catch {
      /* skip the line the model garbled */
    }
  }
  return out;
}

export async function handleHermesDelivery(db: DbOrTx, raw: unknown, opts: { guardHeader?: string | null; now?: Date } = {}): Promise<DeliveryOutcome> {
  const now = opts.now ?? new Date();
  const parsed = deliverySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, reason: "bad_delivery", details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const d = parsed.data;
  if (d.type !== "cron.delivery") return { ok: false, status: 400, reason: `unsupported type ${d.type}` };
  const slug = (d.slug ?? d.profile ?? d.entity ?? "").replace(/^entity\//, "");
  // A preview has no production memory or publication rights. Never strip
  // its suffix and turn a staging delivery into a real being's update.
  if ([d.slug, d.profile, d.entity].some((value) => value?.endsWith("-staging"))) {
    return { ok: false, status: 422, reason: "staging_delivery" };
  }
  const entity = await entityBySlug(db, slug);
  if (!entity) return { ok: false, status: 404, reason: `unknown entity ${slug}` };
  if (entity.retiredAt) return { ok: false, status: 410, reason: "retired" };
  if (entity.pausedAt) return { ok: false, status: 423, reason: "paused" };

  const claimed = await claimConfigKey(db, `hermes_events.${d.id}`, { job: d.job, slug, at: now.toISOString() }, now);
  if (!claimed) return { ok: true, replay: true, id: d.id };

  const guard = guardFrom(d, opts.guardHeader ?? null);
  const actor = `hermes:${d.job}`;
  const text = outputText(d);
  const tokens = { prompt: d.usage?.prompt_tokens, output: d.usage?.output_tokens };

  switch (d.job) {
    case "daily-reflection":
    case "pulse": {
      const snapshotId = d.snapshot_id ?? (await latestSnapshotRow(db, entity.id))?.id ?? null;
      const p = await storePulse(db, entity, { kind: d.job === "pulse" ? "pulse" : "reflection", snapshot_id: snapshotId, text: guard === "dropped" ? null : text, guard_result: guard, actor, now, tokens });
      return { ok: true, replay: false, id: d.id, job: d.job, stored: { pulse_id: p.id, guard_result: guard } };
    }
    case "quarterly-strategy": {
      if (!text) return { ok: false, status: 422, reason: "empty strategy" };
      const s = await storeStrategy(db, entity, { memo_md: text, guard_result: guard, actor, now });
      return { ok: true, replay: false, id: d.id, job: d.job, stored: { ...s, guard_result: guard } };
    }
    case "donor-report": {
      if (!text) return { ok: false, status: 422, reason: "empty donor report" };
      const r = await storeDonorReportNarrative(db, entity, { narrative_md: text, guard_result: guard, actor, now, delivery_id: d.id });
      return { ok: true, replay: false, id: d.id, job: d.job, stored: { ...r, guard_result: guard } };
    }
    case "weekly-bounties": {
      const specs = parseBountyOutput(d.output ?? d.text);
      const bindingLoaded = await loadCurrentBinding(db, entity);
      const binding = "error" in bindingLoaded ? null : bindingLoaded;
      const drafted: Array<{ id: string; status: string }> = [];
      const rejected: Array<{ index: number; code: string; message: string }> = [];
      for (const [i, spec] of specs.entries()) {
        try {
          const r = await storeBountyDraft(db, entity, binding, spec, { guard_result: guard, actor, now });
          drafted.push({ id: r.id, status: r.status });
        } catch (err) {
          const e = err instanceof BountyDraftError ? { code: err.code, message: err.message } : { code: "error", message: (err as Error).message };
          rejected.push({ index: i, ...e });
        }
      }
      if (rejected.length) {
        await appendEntityEvent(db, { entity_id: entity.id, actor, kind: "bounty.draft_rejected", payload: { delivery_id: d.id, rejected }, at: now });
      }
      return { ok: true, replay: false, id: d.id, job: d.job, stored: { drafted, rejected, specs: specs.length, guard_result: guard } };
    }
    default:
      return { ok: false, status: 422, reason: `unknown job ${d.job}` };
  }
}
