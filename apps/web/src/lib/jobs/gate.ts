/**
 * The gate ↔ platform contract (ADR-E12; docs/verify.md #30):
 *
 *   GET  /api/gate/pause-set  → {"paused": [slug…], "as_of"}   polled every 30 s
 *   POST /api/gate/heartbeat  ← {at?, host?, usage_events[], guard_events[]}
 *
 * The heartbeat sets `config.gpu_last_seen_at` (the needs job's `gpu_online`)
 * and drains the gate's JSONL event logs (`apps/gate/src/entity_gate/events.py`)
 * into `usage_events` / `guard_events`. Rows are accepted loosely — the gate
 * writes `prompt_tokens`/`output_tokens` and a free `**fields` bag — and
 * mapped to the Appendix B columns.
 */
import { isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { setConfig } from "./common";

const looseRow = z.object({}).catchall(z.unknown());

export const heartbeatSchema = z.object({
  at: z.string().optional(),
  host: z.string().max(120).optional(),
  gate_version: z.string().max(60).optional(),
  usage_events: z.array(looseRow).max(5000).default([]),
  guard_events: z.array(looseRow).max(5000).default([]),
});

export type HeartbeatBody = z.infer<typeof heartbeatSchema>;

export async function pauseSet(db: DbOrTx, now = new Date()): Promise<{ paused: string[]; as_of: string }> {
  const rows = await db
    .select({ slug: schema.entities.slug })
    .from(schema.entities)
    .where(sql`${schema.entities.pausedAt} is not null or ${schema.entities.retiredAt} is not null`)
    .orderBy(schema.entities.slug);
  return { paused: rows.map((r) => r.slug), as_of: now.toISOString() };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.round(Number(v));
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function when(v: unknown, fallback: Date): Date {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t) : fallback;
}

export async function recordHeartbeat(db: DbOrTx, body: HeartbeatBody, now = new Date()): Promise<{ gpu_last_seen_at: string; inserted: { usage: number; guard: number }; unknown_slugs: string[] }> {
  const seenAt = when(body.at, now);
  await setConfig(db, "gpu_last_seen_at", seenAt.toISOString(), now);
  if (body.host || body.gate_version) await setConfig(db, "gpu_heartbeat", { host: body.host ?? null, gate_version: body.gate_version ?? null, at: seenAt.toISOString() }, now);

  const entities = await db.select({ id: schema.entities.id, slug: schema.entities.slug, profile: schema.entities.hermesProfile }).from(schema.entities).where(isNull(schema.entities.retiredAt));
  const bySlug = new Map<string, string>();
  for (const e of entities) {
    bySlug.set(e.slug, e.id);
    if (e.profile) bySlug.set(e.profile, e.id);
  }
  const unknown = new Set<string>();
  const entityFor = (row: Record<string, unknown>): string | null => {
    const slug = str(row["slug"]) ?? str(row["entity"]) ?? str(row["profile"]);
    if (!slug) return null;
    const id = bySlug.get(slug) ?? bySlug.get(slug.replace(/^entity\//, ""));
    if (!id) unknown.add(slug);
    return id ?? null;
  };

  const usageRows = body.usage_events.map((r) => ({
    entityId: entityFor(r),
    at: when(r["ts"] ?? r["at"], now),
    job: str(r["job"]) ?? "chat",
    tokensPrompt: num(r["prompt_tokens"] ?? r["tokens_prompt"]) ?? 0,
    tokensOutput: num(r["output_tokens"] ?? r["tokens_output"]) ?? 0,
    latencyMs: num(r["latency_ms"]),
    model: str(r["model"]),
  }));
  const guardRows = body.guard_events.map((r) => {
    const { ts, at, slug, entity, profile, job, context, sentence, text, unmatched, violations, action, ...rest } = r;
    void ts;
    void at;
    void slug;
    void entity;
    void profile;
    return {
      entityId: entityFor(r),
      at: when(r["ts"] ?? r["at"], now),
      context: str(context) ?? str(job) ?? "chat",
      sentence: str(sentence) ?? str(text) ?? "",
      unmatched: (unmatched ?? violations ?? rest) as object,
      action: str(action) ?? "unknown",
    };
  });

  if (usageRows.length) await db.insert(schema.usageEvents).values(usageRows);
  if (guardRows.length) await db.insert(schema.guardEvents).values(guardRows);
  return { gpu_last_seen_at: seenAt.toISOString(), inserted: { usage: usageRows.length, guard: guardRows.length }, unknown_slugs: [...unknown].sort() };
}
