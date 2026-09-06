/**
 * The kill switch (ADR-E12, §5.9, plan T1.11). `entities.paused_at` is the
 * switch; this module flips it, records `pause_events` and the audit chain,
 * and pushes to the gate's admin endpoint so the gate does not wait for its
 * 30 s poll of `/api/gate/pause-set`.
 *
 *   one guardian pauses
 *   two distinct guardians resume — two user ids within 24 h recorded as
 *   `resume_request` rows, or two distinct names in one box-script call
 *   retire = pause + retired_at, same two-guardian rule
 */
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { jobsEnv, type JobsEnv } from "./common";
import type { EntityRow } from "./needs";

export const pauseBodySchema = z.object({
  action: z.enum(["pause", "resume", "retire"]).default("pause"),
  reason: z.string().max(500).optional().default(""),
  at: z.string().optional(),
  /** box scripts: guardian names; one for pause, two distinct for resume/retire */
  guardians: z.array(z.string().min(1).max(120)).max(10).optional().default([]),
});

export type PauseBody = z.infer<typeof pauseBodySchema>;

export type PauseActor = { kind: "user"; user_id: string; label: string } | { kind: "script"; label: string };

export type PauseOutcome = {
  action: PauseBody["action"];
  paused: boolean;
  retired: boolean;
  applied: boolean;
  /** resume/retire only: how many distinct guardians have asked within the window, and how many are needed */
  requests?: { have: number; need: number; window_h: number };
  already?: boolean;
  gate?: { pushed: boolean; status?: number; error?: string };
  reason?: string;
};

export const RESUME_WINDOW_H = 24;
export const RESUME_NEEDED = 2;

type GateOpts = { url?: string | undefined; secret?: string | undefined; fetchImpl?: typeof fetch };

export class PauseError extends Error {
  constructor(
    public status: 400 | 403 | 409,
    message: string,
  ) {
    super(message);
  }
}

function distinctNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = n.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n.trim());
  }
  return out;
}

async function pushGate(slug: string, action: "pause" | "resume", body: unknown, gate: GateOpts): Promise<PauseOutcome["gate"]> {
  if (!gate.url || !gate.secret) return { pushed: false };
  const f = gate.fetchImpl ?? fetch;
  try {
    const res = await f(`${gate.url.replace(/\/$/, "")}/admin/${action}/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "X-Gate-Admin": gate.secret, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    return { pushed: true, status: res.status };
  } catch (err) {
    return { pushed: false, error: (err as Error).message };
  }
}

/** Distinct guardian user ids that asked to resume since the pause (and within 24 h). */
export async function resumeRequesters(db: DbOrTx, entity: EntityRow, now: Date): Promise<string[]> {
  const since = new Date(Math.max(now.getTime() - RESUME_WINDOW_H * 3600_000, entity.pausedAt?.getTime() ?? 0));
  const rows = await db
    .select({ by: schema.pauseEvents.byUser })
    .from(schema.pauseEvents)
    .where(and(eq(schema.pauseEvents.entityId, entity.id), eq(schema.pauseEvents.action, "resume_request"), gte(schema.pauseEvents.at, since), isNotNull(schema.pauseEvents.byUser)));
  return [...new Set(rows.map((r) => r.by!).filter(Boolean))];
}

export async function applyPause(
  db: DbOrTx,
  entity: EntityRow,
  body: PauseBody,
  actor: PauseActor,
  opts: { now?: Date; gate?: GateOpts; env?: JobsEnv } = {},
): Promise<PauseOutcome> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? jobsEnv();
  const gate: GateOpts = opts.gate ?? { url: env.GATE_ADMIN_URL, secret: env.GATE_ADMIN_SECRET };
  const userId = actor.kind === "user" ? actor.user_id : null;
  const names = distinctNames(actor.kind === "script" ? body.guardians : [actor.label, ...body.guardians]);
  const gateBody = { guardians: names, reason: body.reason, at: now.toISOString(), action: body.action };

  if (body.action === "pause") {
    if (entity.pausedAt) return { action: "pause", paused: true, retired: entity.retiredAt !== null, applied: false, already: true };
    await db.transaction(async (tx) => {
      await tx.update(schema.entities).set({ pausedAt: now }).where(eq(schema.entities.id, entity.id));
      await tx.insert(schema.pauseEvents).values({ entityId: entity.id, at: now, byUser: userId, action: "pause" });
      await appendEntityEvent(tx, { entity_id: entity.id, actor: actor.label, kind: "paused", payload: { by: names, reason: body.reason, via: actor.kind }, at: now });
    });
    return { action: "pause", paused: true, retired: entity.retiredAt !== null, applied: true, gate: await pushGate(entity.slug, "pause", gateBody, gate) };
  }

  // resume | retire — the two-guardian rule
  if (body.action === "resume" && !entity.pausedAt) return { action: "resume", paused: false, retired: entity.retiredAt !== null, applied: false, already: true };
  if (body.action === "retire" && entity.retiredAt) return { action: "retire", paused: true, retired: true, applied: false, already: true };

  let have: number;
  let requesters: string[];
  if (actor.kind === "user") {
    await db.insert(schema.pauseEvents).values({ entityId: entity.id, at: now, byUser: actor.user_id, action: body.action === "retire" ? "retire_request" : "resume_request" });
    if (body.action === "retire") {
      const since = new Date(now.getTime() - RESUME_WINDOW_H * 3600_000);
      const rows = await db
        .select({ by: schema.pauseEvents.byUser })
        .from(schema.pauseEvents)
        .where(and(eq(schema.pauseEvents.entityId, entity.id), eq(schema.pauseEvents.action, "retire_request"), gte(schema.pauseEvents.at, since), isNotNull(schema.pauseEvents.byUser)));
      requesters = [...new Set(rows.map((r) => r.by!))];
    } else {
      requesters = await resumeRequesters(db, entity, now);
    }
    have = requesters.length;
  } else {
    if (names.length < RESUME_NEEDED) throw new PauseError(400, `${body.action} requires ${RESUME_NEEDED} distinct guardian names`);
    requesters = names;
    have = names.length;
  }

  if (have < RESUME_NEEDED) {
    await appendEntityEvent(db, { entity_id: entity.id, actor: actor.label, kind: `${body.action}.requested`, payload: { have, need: RESUME_NEEDED, reason: body.reason }, at: now });
    return { action: body.action, paused: true, retired: entity.retiredAt !== null, applied: false, requests: { have, need: RESUME_NEEDED, window_h: RESUME_WINDOW_H } };
  }

  if (body.action === "retire") {
    await db.transaction(async (tx) => {
      await tx.update(schema.entities).set({ pausedAt: entity.pausedAt ?? now, retiredAt: now }).where(eq(schema.entities.id, entity.id));
      await tx.insert(schema.pauseEvents).values({ entityId: entity.id, at: now, byUser: userId, action: "retire" });
      await appendEntityEvent(tx, { entity_id: entity.id, actor: actor.label, kind: "retired", payload: { by: requesters, reason: body.reason, via: actor.kind }, at: now });
    });
    return { action: "retire", paused: true, retired: true, applied: true, requests: { have, need: RESUME_NEEDED, window_h: RESUME_WINDOW_H }, gate: await pushGate(entity.slug, "pause", gateBody, gate) };
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.entities).set({ pausedAt: null }).where(eq(schema.entities.id, entity.id));
    await tx.insert(schema.pauseEvents).values({ entityId: entity.id, at: now, byUser: userId, action: "resume" });
    await appendEntityEvent(tx, { entity_id: entity.id, actor: actor.label, kind: "resumed", payload: { by: requesters, reason: body.reason, via: actor.kind }, at: now });
  });
  return { action: "resume", paused: false, retired: false, applied: true, requests: { have, need: RESUME_NEEDED, window_h: RESUME_WINDOW_H }, gate: await pushGate(entity.slug, "resume", gateBody, gate) };
}
