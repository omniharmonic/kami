/** Idempotent, metadata-only delivery from a guarded runtime's append-only logs. */
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { claimConfigKey, getConfig } from "./common";
import { recordHeartbeat } from "./gate";

const base = { id: z.string().regex(/^[a-f0-9]{64}$/), slug: z.string().regex(/^[a-z0-9-]{1,64}$/), at: z.iso.datetime({ offset: true }), job: z.enum(["chat", "cron"]) };
const usage = z.object({ ...base, kind: z.literal("usage"), prompt_tokens: z.number().int().min(0).max(2_147_483_647), output_tokens: z.number().int().min(0).max(2_147_483_647), latency_ms: z.number().int().min(0).max(86_400_000).nullable().optional() }).strict();
const guard = z.object({ ...base, kind: z.literal("guard"), action: z.enum(["drop", "crisis", "paused", "budget", "queue_full", "pause", "resume"]), reason: z.enum(["unmatched", "stale", "budget", "queue", "paused", "crisis", "other"]).optional() }).strict();
export const telemetrySchema = z.object({ version: z.literal(1), records: z.array(z.discriminatedUnion("kind", [usage, guard])).max(250) }).strict();
export type Telemetry = z.infer<typeof telemetrySchema>;
export class TelemetryConflict extends Error {}

/** One transaction covers dedup claims, event inserts, and heartbeat metadata. */
export async function recordTelemetry(db: Db, input: Telemetry, now = new Date()) {
  return db.transaction(async tx => {
    const slugs = [...new Set(input.records.map(r => r.slug))];
    const rows = slugs.length ? await tx.select({ slug: schema.entities.slug }).from(schema.entities).where(inArray(schema.entities.slug, slugs)) : [];
    const known = new Set(rows.map(r => r.slug));
    if (slugs.some(slug => !known.has(slug))) throw new TelemetryConflict("unknown_entity");
    const usageRows: Record<string, unknown>[] = [];
    const guardRows: Record<string, unknown>[] = [];
    let duplicates = 0;
    for (const record of input.records) {
      const key = `gate_telemetry.v1.${record.id}`;
      // Canonical fields reject reused IDs while tolerating JSON key-order changes.
      const hash = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
      const claimed = await claimConfigKey(tx, key, { hash }, now);
      if (!claimed) {
        const prior = await getConfig<{ hash: string }>(tx, key);
        if (prior?.hash !== hash) throw new TelemetryConflict("event_id_conflict");
        duplicates++;
        continue;
      }
      if (record.kind === "usage") usageRows.push({ slug: record.slug, at: record.at, job: record.job, prompt_tokens: record.prompt_tokens, output_tokens: record.output_tokens, latency_ms: record.latency_ms });
      else guardRows.push({ slug: record.slug, at: record.at, job: record.job, action: record.action, reason: record.reason ?? "other" });
    }
    const result = await recordHeartbeat(tx, { at: now.toISOString(), usage_events: usageRows, guard_events: guardRows }, now);
    return { ...result, telemetry_version: 1, acknowledged: input.records.map(r => r.id), duplicates };
  });
}
