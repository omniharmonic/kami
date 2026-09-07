import { eligibleOutcomeUid } from "@/lib/governance/attest";
/**
 * `validatePayoutProposal` — the checks the signing service runs before the
 * proposer key touches anything (architecture §7.3, plan T2.3). Checks run in
 * the order listed and the first failure is returned as a typed refusal; the
 * route maps `status` to HTTP. Nothing here signs.
 */
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { blockPayoutUntilForm } from "@/lib/tax/forms";
import { getConfig } from "@/lib/jobs/common";

export type RefusalCode =
  | "entity_not_found"
  | "entity_retired"
  | "entity_paused"
  | "safe_missing"
  | "submission_not_found"
  | "evaluation_missing"
  | "evaluation_not_succeeded"
  | "attestation_missing"
  | "amount_invalid"
  | "amount_over_cap"
  | "recipient_wallet_missing"
  | "duplicate_proposal"
  | "monthly_cap_exceeded"
  | "second_attestation_required"
  | "tax_form_required";

export type Refusal = { ok: false; code: RefusalCode; message: string; status: 404 | 409 | 422 | 423 };

export type ValidatedProposal = {
  ok: true;
  entity: { id: string; slug: string; name: string; safeAddress: Address; chainId: number | null };
  bounty: { id: string; title: string; capUsdc: string; verificationTier: number; specSha256: string; easUidPosted: string | null };
  submission: { id: string; claimId: string | null };
  claim: { id: string; userId: string };
  evaluation: { id: string; evaluatorId: string | null; outcome: string; notesMd: string | null; secondAttestationBy: string | null };
  outcomeUid: Hex;
  recipient: { userId: string; address: Address; handle: string; email: string };
  /** two-decimal string, e.g. "25.00" */
  amountUsdc: string;
  /** USDC has 6 decimals */
  amountUsdc6: bigint;
};

export const DEFAULT_MONTHLY_CAP_USDC = 1000;
export const DEFAULT_SECOND_ATTESTATION_MIN_USDC = 100;

function refuse(code: RefusalCode, message: string, status: Refusal["status"] = 409): Refusal {
  return { ok: false, code, message, status };
}

/** numeric(12,2) comes back as a string; normalise to exactly two decimals. */
export function usdc2(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function bytes32(v: unknown): Hex | null {
  if (typeof v !== "string") return null;
  const h = v.startsWith("0x") ? v : `0x${v}`;
  return /^0x[0-9a-fA-F]{64}$/.test(h) ? (h.toLowerCase() as Hex) : null;
}

function monthBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function validatePayoutProposal(
  db: DbOrTx,
  input: { slug: string; submissionId: string },
  opts: { now?: Date } = {},
): Promise<Refusal | ValidatedProposal> {
  const now = opts.now ?? new Date();

  // 1. entity: exists, not retired, not paused, has a Safe
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.slug, input.slug)).limit(1);
  if (!entity) return refuse("entity_not_found", `no entity ${input.slug}`, 404);
  if (entity.retiredAt) return refuse("entity_retired", `${entity.slug} is retired; nothing moves`, 423);
  if (entity.pausedAt) return refuse("entity_paused", `${entity.slug} is paused by its guardians`, 423);
  if (!entity.safeAddress || !isAddress(entity.safeAddress)) return refuse("safe_missing", `${entity.slug} has no Safe yet`, 409);

  // 2. submission → claim → bounty, and it belongs to this entity
  const [sub] = await db
    .select({
      submission: schema.submissions,
      claim: schema.claims,
      bounty: schema.bounties,
    })
    .from(schema.submissions)
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .where(eq(schema.submissions.id, input.submissionId))
    .limit(1);
  if (!sub || sub.bounty.entityId !== entity.id) return refuse("submission_not_found", `no submission ${input.submissionId} for ${entity.slug}`, 404);
  if (!sub.claim.userId) return refuse("submission_not_found", `submission ${input.submissionId} has no claimant`, 404);

  // 3. the primary (non-audit) evaluation says succeeded
  const [evaluation] = await db
    .select()
    .from(schema.evaluations)
    .where(and(eq(schema.evaluations.submissionId, sub.submission.id), isNull(schema.evaluations.auditOf)))
    .orderBy(desc(schema.evaluations.createdAt))
    .limit(1);
  if (!evaluation) return refuse("evaluation_missing", `submission ${sub.submission.id} has not been evaluated`);
  if (evaluation.outcome !== "succeeded") return refuse("evaluation_not_succeeded", `evaluation outcome is ${evaluation.outcome}, not succeeded`);

  // 4. a ProposalOutcome UID (onchain uid or the offchain payload's uid)
  const offchain = (evaluation.offchainAttestation ?? null) as { uid?: unknown; awarded_usdc?: unknown } | null;
  const outcomeUid = eligibleOutcomeUid(evaluation.easUid, offchain);
  if (!outcomeUid) return refuse("attestation_missing", `evaluation ${evaluation.id} has no signed or chain-indexed ProposalOutcome attestation UID`);

  // 5. amount: the evaluator's awarded amount when present, else the cap; never above the cap
  const cap = usdc2(sub.bounty.capUsdc);
  const awarded = offchain && offchain.awarded_usdc !== undefined && offchain.awarded_usdc !== null ? usdc2(offchain.awarded_usdc as string | number) : null;
  const amount = awarded ?? cap;
  if (!cap || !amount || Number(amount) <= 0) return refuse("amount_invalid", `amount must be positive (cap ${cap ?? "?"}, awarded ${awarded ?? "—"})`, 422);
  if (Number(amount) > Number(cap)) return refuse("amount_over_cap", `awarded ${amount} exceeds the bounty cap ${cap}`, 422);
  const amountUsdc6 = parseUnits(amount, 6);

  // 6. recipient = the claimant's wallet
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, sub.claim.userId)).limit(1);
  if (!user) return refuse("recipient_wallet_missing", `claimant ${sub.claim.userId} does not exist`);
  if (!user.walletAddress || !isAddress(user.walletAddress)) return refuse("recipient_wallet_missing", `claimant has no wallet address on file`);
  const recipient: Address = getAddress(user.walletAddress);

  // 7. no other live proposal for this submission
  const dup = await db
    .select({ hash: schema.safeProposals.safeTxHash, status: schema.safeProposals.status })
    .from(schema.safeProposals)
    .where(and(eq(schema.safeProposals.submissionId, sub.submission.id), ne(schema.safeProposals.status, "rejected")))
    .limit(1);
  if (dup[0]) return refuse("duplicate_proposal", `submission already has proposal ${dup[0].hash} (${dup[0].status})`);

  // 8. monthly per-person cap: executed payouts this month + pending proposals for the same claimant
  const monthlyCap = Number((await getConfig<number>(db, "payout_monthly_cap_usdc")) ?? DEFAULT_MONTHLY_CAP_USDC);
  const { start, end } = monthBounds(now);
  const [paid] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.payouts.amountUsdc}), 0)` })
    .from(schema.payouts)
    .where(and(eq(schema.payouts.recipientUserId, user.id), gte(schema.payouts.executedAt, start), lt(schema.payouts.executedAt, end)));
  const [pending] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.safeProposals.amountUsdc}), 0)` })
    .from(schema.safeProposals)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.safeProposals.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .where(and(eq(schema.claims.userId, user.id), inArray(schema.safeProposals.status, ["pending"])));
  const already = Number(paid?.total ?? 0) + Number(pending?.total ?? 0);
  if (already + Number(amount) > monthlyCap) {
    return refuse("monthly_cap_exceeded", `claimant would exceed the monthly cap (${monthlyCap} USDC): ${already.toFixed(2)} + ${amount}`);
  }

  // 9. second attestation when the amount is large enough
  const secondMin = Number((await getConfig<number>(db, "second_attestation_min_usdc")) ?? DEFAULT_SECOND_ATTESTATION_MIN_USDC);
  if (Number(amount) >= secondMin) {
    if (!evaluation.secondAttestationBy || evaluation.secondAttestationBy === evaluation.evaluatorId) {
      return refuse("second_attestation_required", `payouts of ${secondMin} USDC or more need a second evaluator's attestation`);
    }
  }

  // 10. a tax form when this payout would carry the recipient past the threshold.
  //     A pure read; stands down entirely when config.tax_collector is "sponsor",
  //     because the sponsor collects instead. Flag, not advice.
  const tax = await blockPayoutUntilForm(db, user.id, Number(amount), now);
  if (tax.blocked) {
    return refuse(
      "tax_form_required",
      `a W-9/W-8 is needed first: this payout would take the recipient to $${tax.would_be_usd.toFixed(2)}, past the $${tax.threshold_usd.toFixed(2)} threshold`,
    );
  }

  return {
    ok: true,
    entity: { id: entity.id, slug: entity.slug, name: entity.name, safeAddress: getAddress(entity.safeAddress), chainId: entity.chainId },
    bounty: {
      id: sub.bounty.id,
      title: sub.bounty.title,
      capUsdc: cap,
      verificationTier: sub.bounty.verificationTier,
      specSha256: sub.bounty.specSha256,
      easUidPosted: sub.bounty.easUidPosted,
    },
    submission: { id: sub.submission.id, claimId: sub.submission.claimId },
    claim: { id: sub.claim.id, userId: sub.claim.userId },
    evaluation: {
      id: evaluation.id,
      evaluatorId: evaluation.evaluatorId,
      outcome: evaluation.outcome,
      notesMd: evaluation.notesMd,
      secondAttestationBy: evaluation.secondAttestationBy,
    },
    outcomeUid,
    recipient: { userId: user.id, address: recipient, handle: user.name ?? user.email.split("@")[0] ?? "someone", email: user.email },
    amountUsdc: amount,
    amountUsdc6,
  };
}
