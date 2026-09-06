/**
 * Quarterly strategy memos (PRD §7.1, T3.10): 14 days of public comment
 * (comments are `entity_events` of kind `strategy_comment`; no separate
 * table), steward ratification, and the retro bonus pool — a % of the
 * quarter's net donations split among contributors with ≥ 1 succeeded
 * attestation and a Passport score above the minimum, weighted by
 * `@kami/reputation` scores when a run exists.
 */
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { CONFIG_DEFAULTS, getConfigNumber } from "./config";
import { GovernanceError } from "./errors";
import { cleanText } from "./proposals";
import { requireEntityRole } from "./roles";
import { newId, round2, usdc, withTx } from "./tx";

export function commentWindowEnd(createdAt: Date, days: number = CONFIG_DEFAULTS.strategy_comment_days): Date {
  return new Date(createdAt.getTime() + days * 86_400_000);
}

export async function createStrategyMemo(
  db: DbOrTx,
  input: { entity_id: string; quarter: string; memo_md: string; guard_result?: string | null; commons_path?: string | null },
  opts: { actor: string | null; now?: Date } = { actor: null },
) {
  const now = opts.now ?? new Date();
  if (!/^\d{4}-Q[1-4]$/.test(input.quarter)) throw new GovernanceError("invalid_spec", "quarter must look like 2026-Q3");
  return withTx(db, async (tx) => {
    const days = await getConfigNumber(tx, "strategy_comment_days", CONFIG_DEFAULTS.strategy_comment_days);
    const id = newId("strat");
    const [row] = await tx
      .insert(schema.strategies)
      .values({
        id,
        entityId: input.entity_id,
        quarter: input.quarter,
        memoMd: input.memo_md,
        guardResult: input.guard_result ?? null,
        commentOpenUntil: commentWindowEnd(now, days),
        commonsPath: input.commons_path ?? null,
        createdAt: now,
      })
      .returning();
    await appendEntityEvent(tx, { entity_id: input.entity_id, actor: opts.actor, kind: "strategy_drafted", payload: { strategy_id: id, quarter: input.quarter, comment_open_until: row!.commentOpenUntil?.toISOString() }, at: now });
    return row!;
  });
}

export async function commentOnStrategy(db: DbOrTx, strategyId: string, userId: string, text: string, deps: { now?: Date } = {}) {
  const now = deps.now ?? new Date();
  const body = cleanText(text, 2000);
  if (body.length < 2) throw new GovernanceError("invalid_spec", "comment too short");
  const [s] = await db.select().from(schema.strategies).where(eq(schema.strategies.id, strategyId)).limit(1);
  if (!s || !s.entityId) throw new GovernanceError("not_found");
  if (!s.commentOpenUntil || s.commentOpenUntil.getTime() < now.getTime()) throw new GovernanceError("invalid_transition", "comment window closed");
  return appendEntityEvent(db, { entity_id: s.entityId, actor: userId, kind: "strategy_comment", payload: { strategy_id: strategyId, text: body }, at: now });
}

export async function listStrategyComments(db: DbOrTx, strategyId: string) {
  const [s] = await db.select({ entityId: schema.strategies.entityId }).from(schema.strategies).where(eq(schema.strategies.id, strategyId)).limit(1);
  if (!s?.entityId) return [];
  const rows = await db
    .select({ id: schema.entityEvents.id, at: schema.entityEvents.at, actor: schema.entityEvents.actor, payload: schema.entityEvents.payload })
    .from(schema.entityEvents)
    .where(and(eq(schema.entityEvents.entityId, s.entityId), eq(schema.entityEvents.kind, "strategy_comment"), sql`${schema.entityEvents.payload} ->> 'strategy_id' = ${strategyId}`))
    .orderBy(schema.entityEvents.id);
  return rows.map((r) => ({ id: r.id, at: r.at, actor: r.actor, text: String((r.payload as { text?: string }).text ?? "") }));
}

export async function ratifyStrategy(db: DbOrTx, strategyId: string, stewardId: string, deps: { now?: Date } = {}) {
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const [s] = await tx.select().from(schema.strategies).where(eq(schema.strategies.id, strategyId)).limit(1);
    if (!s || !s.entityId) throw new GovernanceError("not_found");
    await requireEntityRole(tx, stewardId, s.entityId, ["steward"]);
    if (s.ratifiedAt) throw new GovernanceError("invalid_transition", "already ratified");
    if (s.commentOpenUntil && s.commentOpenUntil.getTime() > now.getTime()) throw new GovernanceError("comment_window_open", undefined, { until: s.commentOpenUntil.toISOString() });
    const [row] = await tx.update(schema.strategies).set({ ratifiedBy: stewardId, ratifiedAt: now }).where(eq(schema.strategies.id, strategyId)).returning();
    await appendEntityEvent(tx, { entity_id: s.entityId, actor: stewardId, kind: "strategy_ratified", payload: { strategy_id: strategyId, quarter: s.quarter }, at: now });
    return row!;
  });
}

// --- retro bonus pool ------------------------------------------------------

export function retroPool(quarterDonationsNet: number, pct: number = CONFIG_DEFAULTS.retro_pct): number {
  if (!Number.isFinite(quarterDonationsNet) || quarterDonationsNet <= 0) return 0;
  return round2((quarterDonationsNet * pct) / 100);
}

export type RetroContributor = { subject: string; succeeded_count: number; passport_ok: boolean; score: number | null };
export type RetroShare = { subject: string; weight: number; share_usdc: number };

/** Eligible = ≥ 1 succeeded attestation + Passport ok. Weight = reputation score when a run exists (min 1), else equal. Cents sum exactly to the pool. */
export function retroSplit(pool: number, contributors: RetroContributor[]): RetroShare[] {
  const eligible = contributors.filter((c) => c.succeeded_count >= 1 && c.passport_ok);
  if (eligible.length === 0 || pool <= 0) return [];
  const anyScore = eligible.some((c) => c.score !== null);
  const weights = eligible.map((c) => (anyScore ? Math.max(1, c.score ?? 0) : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const cents = Math.round(pool * 100);
  const raw = weights.map((w) => (cents * w) / total);
  const floor = raw.map((r) => Math.floor(r));
  let remainder = cents - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - floor[i]! })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floor[i]! += 1;
    remainder--;
  }
  return eligible.map((c, i) => ({ subject: c.subject, weight: weights[i]!, share_usdc: floor[i]! / 100 })).sort((a, b) => b.share_usdc - a.share_usdc || a.subject.localeCompare(b.subject));
}

export function quarterRange(quarter: string): { from: Date; to: Date } {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) throw new GovernanceError("invalid_spec", "quarter must look like 2026-Q3");
  const y = Number(m[1]);
  const q = Number(m[2]);
  return { from: new Date(Date.UTC(y, (q - 1) * 3, 1)), to: new Date(Date.UTC(y, q * 3, 1)) };
}

/** Assemble the round from the DB: net donations in the quarter, succeeded outcomes, Passport, latest reputation run. */
export async function computeRetroRound(db: DbOrTx, entityId: string, quarter: string, opts: { pct?: number; record?: boolean; actor?: string | null; now?: Date } = {}) {
  const { from, to } = quarterRange(quarter);
  const pct = opts.pct ?? (await getConfigNumber(db, "retro_pct", CONFIG_DEFAULTS.retro_pct));
  const passportMin = await getConfigNumber(db, "passport_min", CONFIG_DEFAULTS.passport_min);
  const [d] = await db
    .select({ net: sql<string>`coalesce(sum(${schema.donations.net}), 0)` })
    .from(schema.donations)
    .where(and(eq(schema.donations.entityId, entityId), gte(schema.donations.receivedAt, from), lt(schema.donations.receivedAt, to)));
  const pool = retroPool(usdc(d?.net), pct);

  const rows = await db
    .select({ userId: schema.claims.userId, n: sql<number>`count(*)::int`, passport: schema.users.passportScore })
    .from(schema.evaluations)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.evaluations.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .innerJoin(schema.users, eq(schema.users.id, schema.claims.userId))
    .where(
      and(
        eq(schema.bounties.entityId, entityId),
        eq(schema.evaluations.outcome, "succeeded"),
        sql`${schema.evaluations.auditOf} is null`,
        sql`${schema.evaluations.attestedAt} is not null`,
        gte(schema.evaluations.attestedAt, from),
        lt(schema.evaluations.attestedAt, to),
      ),
    )
    .groupBy(schema.claims.userId, schema.users.passportScore);

  const [run] = await db.select().from(schema.reputationRuns).orderBy(desc(schema.reputationRuns.computedAt)).limit(1);
  const subjects = rows.map((r) => r.userId!).filter(Boolean);
  const scores = new Map<string, number | null>();
  if (run && subjects.length) {
    const sc = await db
      .select({ subject: schema.reputationScores.subject, score: schema.reputationScores.score })
      .from(schema.reputationScores)
      .where(and(eq(schema.reputationScores.runId, run.id), eq(schema.reputationScores.entityId, entityId), inArray(schema.reputationScores.subject, subjects)));
    for (const s of sc) scores.set(s.subject, s.score === null ? null : Number(s.score));
  }
  const contributors: RetroContributor[] = rows.map((r) => ({
    subject: r.userId!,
    succeeded_count: r.n,
    passport_ok: r.passport !== null && Number(r.passport) >= passportMin,
    score: run ? (scores.get(r.userId!) ?? null) : null,
  }));
  const shares = retroSplit(pool, contributors);
  if (opts.record) {
    await appendEntityEvent(db, {
      entity_id: entityId,
      actor: opts.actor ?? null,
      kind: "retro_round_computed",
      payload: { quarter, pct, pool_usdc: pool, run_id: run?.id ?? null, shares },
      at: opts.now ?? new Date(),
    });
  }
  return { quarter, pct, pool_usdc: pool, run_id: run?.id ?? null, contributors, shares };
}
