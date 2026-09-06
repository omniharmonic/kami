/**
 * Claims (T2.8, PRD §7.5 anti-gaming): bounty open, `claim_limit`, the
 * per-person monthly cap across all entities, and the Passport gate above
 * `config.passport_gate_usd`. The Passport refresh is another package's; only
 * the stored `users.passport_score` is checked here.
 */
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { assertEntityActive, loadBounty, transitionBounty } from "./bounties";
import { CONFIG_DEFAULTS, getConfigNumber } from "./config";
import { GovernanceError } from "./errors";
import { hasAcceptedRole, isPlatformAdmin } from "./roles";
import { newId, round2, usdc, withTx } from "./tx";

export function monthBounds(now: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

export async function activeClaimCount(db: DbOrTx, bountyId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.claims)
    .where(and(eq(schema.claims.bountyId, bountyId), isNull(schema.claims.releasedAt)));
  return r?.n ?? 0;
}

/** USDC the person has committed this calendar month across every entity: caps of active claims + payouts executed. */
export async function monthlyCommittedUsdc(db: DbOrTx, userId: string, now = new Date()): Promise<number> {
  const { from, to } = monthBounds(now);
  const [c] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.bounties.capUsdc}), 0)` })
    .from(schema.claims)
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .where(and(eq(schema.claims.userId, userId), isNull(schema.claims.releasedAt), gte(schema.claims.claimedAt, from), lt(schema.claims.claimedAt, to)));
  const [p] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.payouts.amountUsdc}), 0)` })
    .from(schema.payouts)
    .where(and(eq(schema.payouts.recipientUserId, userId), gte(schema.payouts.executedAt, from), lt(schema.payouts.executedAt, to)));
  return round2(usdc(c?.total) + usdc(p?.total));
}

export type ClaimResult = { claim: typeof schema.claims.$inferSelect; bounty_status: schema.BountyStatus };

export async function claimBounty(db: DbOrTx, bountyId: string, userId: string, deps: { now?: Date } = {}): Promise<ClaimResult> {
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const bounty = await loadBounty(tx, bountyId, true);
    await assertEntityActive(tx, bounty.entityId!);
    if (bounty.status !== "open" && bounty.status !== "claimed") throw new GovernanceError("invalid_transition", `${bounty.status} → claimed`);
    if (bounty.deadline && bounty.deadline < now.toISOString().slice(0, 10)) throw new GovernanceError("invalid_transition", "deadline passed");

    const [mine] = await tx
      .select({ id: schema.claims.id, releasedAt: schema.claims.releasedAt })
      .from(schema.claims)
      .where(and(eq(schema.claims.bountyId, bountyId), eq(schema.claims.userId, userId)))
      .limit(1);
    if (mine && !mine.releasedAt) throw new GovernanceError("already_claimed");

    const active = await activeClaimCount(tx, bountyId);
    if (active >= bounty.claimLimit) throw new GovernanceError("claim_limit");

    const cap = usdc(bounty.capUsdc);
    const gate = await getConfigNumber(tx, "passport_gate_usd", CONFIG_DEFAULTS.passport_gate_usd);
    if (cap > gate) {
      const [u] = await tx.select({ score: schema.users.passportScore }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      const min = await getConfigNumber(tx, "passport_min", CONFIG_DEFAULTS.passport_min);
      const score = u?.score === null || u?.score === undefined ? null : Number(u.score);
      if (score === null || !Number.isFinite(score) || score < min) throw new GovernanceError("passport_required", undefined, { score, min, gate });
    }

    const monthlyCap = await getConfigNumber(tx, "per_person_monthly_cap_usdc", CONFIG_DEFAULTS.per_person_monthly_cap_usdc);
    const committed = await monthlyCommittedUsdc(tx, userId, now);
    if (committed + cap > monthlyCap) throw new GovernanceError("monthly_cap", undefined, { committed, cap, monthly_cap: monthlyCap });

    let claim: typeof schema.claims.$inferSelect;
    if (mine) {
      // re-claim after a release: the unique (bounty, user) row is reused
      [claim] = (await tx.update(schema.claims).set({ claimedAt: now, releasedAt: null }).where(eq(schema.claims.id, mine.id)).returning()) as [typeof schema.claims.$inferSelect];
    } else {
      [claim] = (await tx.insert(schema.claims).values({ id: newId("claim"), bountyId, userId, claimedAt: now }).returning()) as [typeof schema.claims.$inferSelect];
    }
    let status: schema.BountyStatus = bounty.status;
    if (bounty.status === "open") status = (await transitionBounty(tx, bounty, "claimed", userId, { claim_id: claim.id }, now)).status;
    else await appendEntityEvent(tx, { entity_id: bounty.entityId!, actor: userId, kind: "bounty_claim_added", payload: { bounty_id: bountyId, claim_id: claim.id, active: active + 1 }, at: now });
    return { claim, bounty_status: status };
  });
}

export async function releaseClaim(db: DbOrTx, claimId: string, byUserId: string, deps: { now?: Date; reason?: string } = {}): Promise<{ bounty_status: schema.BountyStatus }> {
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const [claim] = await tx.select().from(schema.claims).where(eq(schema.claims.id, claimId)).limit(1);
    if (!claim || !claim.bountyId) throw new GovernanceError("not_found");
    const bounty = await loadBounty(tx, claim.bountyId, true);
    const allowed = claim.userId === byUserId || (await isPlatformAdmin(tx, byUserId)) || (await hasAcceptedRole(tx, byUserId, bounty.entityId!, "guardian")) || (await hasAcceptedRole(tx, byUserId, bounty.entityId!, "steward"));
    if (!allowed) throw new GovernanceError("forbidden");
    if (claim.releasedAt) return { bounty_status: bounty.status };
    await tx.update(schema.claims).set({ releasedAt: now }).where(eq(schema.claims.id, claimId));
    await appendEntityEvent(tx, { entity_id: bounty.entityId!, actor: byUserId, kind: "claim_released", payload: { bounty_id: bounty.id, claim_id: claimId, reason: deps.reason ?? null }, at: now });
    const remaining = await activeClaimCount(tx, bounty.id);
    if (remaining === 0 && bounty.status === "claimed") {
      const updated = await transitionBounty(tx, bounty, "open", byUserId, { reason: "claim_released" }, now);
      return { bounty_status: updated.status };
    }
    return { bounty_status: bounty.status };
  });
}

export async function activeClaimFor(db: DbOrTx, bountyId: string, userId: string) {
  const [c] = await db
    .select()
    .from(schema.claims)
    .where(and(eq(schema.claims.bountyId, bountyId), eq(schema.claims.userId, userId), isNull(schema.claims.releasedAt)))
    .limit(1);
  return c ?? null;
}
