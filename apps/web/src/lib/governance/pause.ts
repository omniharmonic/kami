/**
 * Pause / resume / retire (ADR-E12, PRD §13 #6, T1.11). One guardian (or
 * steward) pauses; two distinct guardians must request within
 * `config.resume_window_hours` (24) to resume; retire takes two guardians too.
 * Writes `pause_events`, `entities.paused_at` / `retired_at`, `entity_events`.
 * The platform API route for pause (another package) shares these functions.
 */
import { and, desc, eq, gt } from "drizzle-orm";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { CONFIG_DEFAULTS, getConfigNumber } from "./config";
import { GovernanceError } from "./errors";
import { requireEntityRole } from "./roles";
import { withTx } from "./tx";

export type PauseAction = "pause" | "resume_request" | "resume" | "retire_request" | "retire";

type Deps = { now?: Date; /** the platform API route authenticates by token, not by role row */ skip_role_check?: boolean };

async function loadEntity(db: DbOrTx, entityId: string) {
  const [e] = await db.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
  if (!e) throw new GovernanceError("not_found");
  return e;
}

async function lastEvent(db: DbOrTx, entityId: string, action: PauseAction) {
  const [r] = await db
    .select()
    .from(schema.pauseEvents)
    .where(and(eq(schema.pauseEvents.entityId, entityId), eq(schema.pauseEvents.action, action)))
    .orderBy(desc(schema.pauseEvents.id))
    .limit(1);
  return r ?? null;
}

/** Distinct requesters of `action` inside the window and after `since`. */
async function requestersWithin(db: DbOrTx, entityId: string, action: PauseAction, since: Date | null, windowStart: Date) {
  const floor = since && since > windowStart ? since : windowStart;
  const rows = await db
    .select({ byUser: schema.pauseEvents.byUser, at: schema.pauseEvents.at })
    .from(schema.pauseEvents)
    .where(and(eq(schema.pauseEvents.entityId, entityId), eq(schema.pauseEvents.action, action), gt(schema.pauseEvents.at, floor)));
  const seen = new Map<string, Date>();
  for (const r of rows) if (r.byUser && !seen.has(r.byUser)) seen.set(r.byUser, r.at ?? floor);
  return [...seen.entries()].map(([by_user, at]) => ({ by_user, at }));
}

export async function pauseEntity(db: DbOrTx, entityId: string, byUserId: string | null, deps: Deps = {}): Promise<{ paused_at: Date; already: boolean }> {
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const e = await loadEntity(tx, entityId);
    if (!deps.skip_role_check && byUserId) await requireEntityRole(tx, byUserId, entityId, ["guardian", "steward"]);
    if (e.pausedAt) return { paused_at: e.pausedAt, already: true };
    await tx.insert(schema.pauseEvents).values({ entityId, byUser: byUserId, action: "pause", at: now });
    await tx.update(schema.entities).set({ pausedAt: now }).where(eq(schema.entities.id, entityId));
    await appendEntityEvent(tx, { entity_id: entityId, actor: byUserId, kind: "paused", payload: { paused_at: now.toISOString() }, at: now });
    return { paused_at: now, already: false };
  });
}

export type ResumeResult = { resumed: boolean; requesters: Array<{ by_user: string; at: Date }>; needed: number; window_hours: number };

export async function requestResume(db: DbOrTx, entityId: string, byUserId: string, deps: Deps = {}): Promise<ResumeResult> {
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const e = await loadEntity(tx, entityId);
    if (!deps.skip_role_check) await requireEntityRole(tx, byUserId, entityId, ["guardian"]);
    if (!e.pausedAt) throw new GovernanceError("not_paused");
    if (e.retiredAt) throw new GovernanceError("retired");
    const hours = await getConfigNumber(tx, "resume_window_hours", CONFIG_DEFAULTS.resume_window_hours);
    const windowStart = new Date(now.getTime() - hours * 3_600_000);
    const existing = await requestersWithin(tx, entityId, "resume_request", e.pausedAt, windowStart);
    if (existing.some((r) => r.by_user === byUserId)) throw new GovernanceError("already_requested");
    await tx.insert(schema.pauseEvents).values({ entityId, byUser: byUserId, action: "resume_request", at: now });
    await appendEntityEvent(tx, { entity_id: entityId, actor: byUserId, kind: "resume_requested", payload: { requests: existing.length + 1 }, at: now });
    const requesters = [...existing, { by_user: byUserId, at: now }];
    if (requesters.length >= 2) {
      await tx.insert(schema.pauseEvents).values({ entityId, byUser: byUserId, action: "resume", at: now });
      await tx.update(schema.entities).set({ pausedAt: null }).where(eq(schema.entities.id, entityId));
      await appendEntityEvent(tx, { entity_id: entityId, actor: byUserId, kind: "resumed", payload: { by: requesters.map((r) => r.by_user) }, at: now });
      return { resumed: true, requesters, needed: 2, window_hours: hours };
    }
    return { resumed: false, requesters, needed: 2, window_hours: hours };
  });
}

export type RetireResult = { retired: boolean; requesters: Array<{ by_user: string; at: Date }> };

/**
 * Two guardians retire: pause + `retired_at` + events. Delegate removal and the
 * Safe withdrawal to the steward wrapper are treasury work — a
 * `retire_requested` event carries the ask.
 */
export async function retireEntity(db: DbOrTx, entityId: string, byUserId: string, deps: Deps = {}): Promise<RetireResult> {
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const e = await loadEntity(tx, entityId);
    if (!deps.skip_role_check) await requireEntityRole(tx, byUserId, entityId, ["guardian"]);
    if (e.retiredAt) return { retired: true, requesters: [] };
    const hours = await getConfigNumber(tx, "resume_window_hours", CONFIG_DEFAULTS.resume_window_hours);
    const windowStart = new Date(now.getTime() - hours * 3_600_000);
    const existing = await requestersWithin(tx, entityId, "retire_request", null, windowStart);
    if (existing.some((r) => r.by_user === byUserId)) throw new GovernanceError("already_requested");
    await tx.insert(schema.pauseEvents).values({ entityId, byUser: byUserId, action: "retire_request", at: now });
    await appendEntityEvent(tx, {
      entity_id: entityId,
      actor: byUserId,
      kind: "retire_requested",
      payload: { requests: existing.length + 1, treasury_todo: ["remove proposer delegate", "withdraw Safe to steward wrapper (guardian-only)"] },
      at: now,
    });
    const requesters = [...existing, { by_user: byUserId, at: now }];
    if (requesters.length < 2) return { retired: false, requesters };
    if (!e.pausedAt) {
      await tx.insert(schema.pauseEvents).values({ entityId, byUser: byUserId, action: "pause", at: now });
      await appendEntityEvent(tx, { entity_id: entityId, actor: byUserId, kind: "paused", payload: { paused_at: now.toISOString(), reason: "retire" }, at: now });
    }
    await tx.insert(schema.pauseEvents).values({ entityId, byUser: byUserId, action: "retire", at: now });
    await tx.update(schema.entities).set({ pausedAt: e.pausedAt ?? now, retiredAt: now }).where(eq(schema.entities.id, entityId));
    await appendEntityEvent(tx, { entity_id: entityId, actor: byUserId, kind: "retired", payload: { retired_at: now.toISOString(), by: requesters.map((r) => r.by_user) }, at: now });
    return { retired: true, requesters };
  });
}

export async function pauseState(db: DbOrTx, entityId: string, now = new Date()) {
  const e = await loadEntity(db, entityId);
  const hours = await getConfigNumber(db, "resume_window_hours", CONFIG_DEFAULTS.resume_window_hours);
  const windowStart = new Date(now.getTime() - hours * 3_600_000);
  const resume_requests = e.pausedAt ? await requestersWithin(db, entityId, "resume_request", e.pausedAt, windowStart) : [];
  const retire_requests = e.retiredAt ? [] : await requestersWithin(db, entityId, "retire_request", null, windowStart);
  const last_pause = await lastEvent(db, entityId, "pause");
  return { paused_at: e.pausedAt, retired_at: e.retiredAt, resume_requests, retire_requests, last_pause_at: last_pause?.at ?? null, window_hours: hours };
}
