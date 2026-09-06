/**
 * Evaluations (T2.9, PRD §7.5 anti-gaming). Requires the Evaluator role (+
 * `hatCheck`); evaluator ≠ claimant ≠ proposer is enforced by the DB trigger
 * (migration 0001) and checked here first for a friendly error; a second
 * attestation is required when `cap_usdc > evidence_spec.second_attestation_above_usdc`;
 * 10 % of tier-2 evaluations are sampled for a second-evaluator audit
 * (`evaluations.audit_of`; the sampling is a seeded-RNG-injectable draw);
 * tier 4 → `deferred` with the follow-up stored in `config.tier4_followups`
 * (the schema has no column for it — see the report).
 *
 * `paid` is only ever written by the treasury: on `succeeded` the bounty stays
 * `in_review` and the result says `ready_for_payout: true`.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { Outcome, entityIdOf, type OutcomeCode } from "@kami/reputation";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { parseEvidenceSpec } from "@/lib/evidence/spec";
import { ZERO_HASH, signOffchain, type ProposalOutcomePayload, type SignAttestation } from "./attest";
import { loadBounty, transitionBounty } from "./bounties";
import { CONFIG_DEFAULTS, getConfigNumber, getConfigValue, setConfigValue } from "./config";
import { GovernanceError } from "./errors";
import { hasAcceptedRole, hatCheck } from "./roles";
import { newId, round2, usdc, withTx } from "./tx";

export type OutcomeName = keyof typeof Outcome;
export const OUTCOME_NAMES = Object.keys(Outcome) as OutcomeName[];

export type EvaluateInput = {
  outcome: OutcomeName;
  notes?: string | null;
  twin_snapshot_hash?: string | null;
  /** a sampled audit: a second, independent evaluation of an earlier one */
  audit_of?: string | null;
};

export type EvaluateDeps = {
  now?: Date;
  /** uniform [0,1) draw; injectable for the sampling test */
  rng?: () => number;
  signer?: SignAttestation;
  audit_rate?: number;
};

export type Tier4Split = { deposit_usdc: number; balance_usdc: number; deposit_pct: number; follow_up_due: string };

export type EvaluateResult = {
  evaluation_id: string;
  kind: "first" | "second" | "audit";
  uid: string;
  outcome: OutcomeName;
  ready_for_payout: boolean;
  needs_second_attestation: boolean;
  disagreement: boolean;
  audit_sampled: boolean;
  bounty_status: schema.BountyStatus;
  tier4?: Tier4Split;
};

// --- pure helpers ----------------------------------------------------------

export function sampleAudit(rng: () => number, rate: number): boolean {
  return rng() < rate;
}

/** Small seeded PRNG for deterministic tests (not used for anything secret). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tier4Split(capUsdc: number, depositPct: number = CONFIG_DEFAULTS.tier4_deposit_pct, now = new Date(), months: number = CONFIG_DEFAULTS.tier4_follow_up_months): Tier4Split {
  const deposit = round2((capUsdc * depositPct) / 100);
  const due = new Date(now);
  due.setUTCMonth(due.getUTCMonth() + months);
  return { deposit_usdc: deposit, balance_usdc: round2(capUsdc - deposit), deposit_pct: depositPct, follow_up_due: due.toISOString().slice(0, 10) };
}

export function secondAttestationRequired(capUsdc: number, threshold: number): boolean {
  return capUsdc > threshold;
}

function normaliseHash(h: string | null | undefined): `0x${string}` {
  if (!h) return ZERO_HASH;
  const s = h.startsWith("0x") ? h.slice(2) : h;
  return /^[0-9a-fA-F]{64}$/.test(s) ? (`0x${s.toLowerCase()}` as `0x${string}`) : ZERO_HASH;
}

// --- the evaluation --------------------------------------------------------

type Loaded = {
  submission: typeof schema.submissions.$inferSelect;
  claim: typeof schema.claims.$inferSelect;
  bounty: typeof schema.bounties.$inferSelect;
  entity: typeof schema.entities.$inferSelect;
  proposal: typeof schema.proposals.$inferSelect | null;
};

async function loadContext(tx: DbOrTx, submissionId: string): Promise<Loaded> {
  const [submission] = await tx.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId)).limit(1);
  if (!submission || !submission.claimId) throw new GovernanceError("not_found");
  const [claim] = await tx.select().from(schema.claims).where(eq(schema.claims.id, submission.claimId)).limit(1);
  if (!claim || !claim.bountyId) throw new GovernanceError("not_found");
  const bounty = await loadBounty(tx, claim.bountyId, true);
  const [entity] = await tx.select().from(schema.entities).where(eq(schema.entities.id, bounty.entityId!)).limit(1);
  if (!entity) throw new GovernanceError("not_found");
  const proposal = bounty.proposalId ? ((await tx.select().from(schema.proposals).where(eq(schema.proposals.id, bounty.proposalId)).limit(1))[0] ?? null) : null;
  return { submission, claim, bounty, entity, proposal };
}

async function assertIndependentEvaluator(tx: DbOrTx, ctx: Loaded, evaluatorId: string): Promise<string | null> {
  if (!(await hasAcceptedRole(tx, evaluatorId, ctx.entity.id, "evaluator"))) throw new GovernanceError("forbidden");
  if (!(await hatCheck(tx, ctx.entity.id, evaluatorId, "evaluator"))) throw new GovernanceError("hat_required");
  if (ctx.claim.userId === evaluatorId) throw new GovernanceError("self_evaluation");
  if (ctx.proposal && ctx.proposal.authorKind === "human" && ctx.proposal.authorId === evaluatorId) throw new GovernanceError("proposer_evaluation");
  const [role] = await tx
    .select({ hatId: schema.entityRoles.hatId })
    .from(schema.entityRoles)
    .where(and(eq(schema.entityRoles.entityId, ctx.entity.id), eq(schema.entityRoles.userId, evaluatorId), eq(schema.entityRoles.role, "evaluator")))
    .limit(1);
  return role?.hatId === null || role?.hatId === undefined ? null : String(role.hatId);
}

function buildPayload(ctx: Loaded, evaluatorId: string, hatId: string | null, outcome: OutcomeName, twinHash: string | null | undefined, now: Date): ProposalOutcomePayload {
  return {
    schema: "ProposalOutcome",
    schema_string: "bytes32 entityId, bytes32 proposalHash, uint8 outcome, uint256 evaluatorHatId, string evidenceURI, bytes32 twinSnapshotHash",
    entityId: entityIdOf(ctx.entity.id),
    proposalHash: `0x${ctx.bounty.specSha256}` as `0x${string}`,
    outcome: Outcome[outcome] as OutcomeCode,
    outcome_name: outcome,
    evaluatorHatId: hatId ?? "0",
    evidenceURI: `kami://submission/${ctx.submission.id}`,
    twinSnapshotHash: normaliseHash(twinHash),
    attester: evaluatorId,
    attested_at: now.toISOString(),
  };
}

async function indexAttestation(tx: DbOrTx, ctx: Loaded, uid: string, attester: string, payload: ProposalOutcomePayload, now: Date) {
  await tx
    .insert(schema.attestations)
    .values({ uid, schema: "ProposalOutcome", mode: "offchain", attester, entityId: ctx.entity.id, refUid: ctx.bounty.easUidPosted ?? null, payload, createdAt: now })
    .onConflictDoNothing();
}

type Finalized = { ready_for_payout: boolean; bounty_status: schema.BountyStatus; tier4?: Tier4Split };

/** Apply the outcome's effect on the bounty. `paid` is never written here. */
async function finalizeOutcome(tx: DbOrTx, ctx: Loaded, evaluationId: string, outcome: OutcomeName, actor: string, now: Date): Promise<Finalized> {
  const cap = usdc(ctx.bounty.capUsdc);
  if (outcome === "succeeded" || outcome === "partial") {
    if (ctx.bounty.verificationTier === 4 && outcome === "succeeded") {
      const pct = await getConfigNumber(tx, "tier4_deposit_pct", CONFIG_DEFAULTS.tier4_deposit_pct);
      const months = await getConfigNumber(tx, "tier4_follow_up_months", CONFIG_DEFAULTS.tier4_follow_up_months);
      const split = tier4Split(cap, pct, now, months);
      const followups = await getConfigValue<Record<string, unknown>>(tx, "tier4_followups", {});
      followups[ctx.bounty.id] = { submission_id: ctx.submission.id, evaluation_id: evaluationId, ...split, followed_up_at: null, created_at: now.toISOString() };
      await setConfigValue(tx, "tier4_followups", followups);
      const updated = ctx.bounty.status === "in_review" ? await transitionBounty(tx, ctx.bounty, "deferred", actor, { evaluation_id: evaluationId, ...split }, now) : ctx.bounty;
      return { ready_for_payout: true, bounty_status: updated.status, tier4: split };
    }
    await appendEntityEvent(tx, {
      entity_id: ctx.entity.id,
      actor,
      kind: "payout_ready",
      payload: { bounty_id: ctx.bounty.id, submission_id: ctx.submission.id, evaluation_id: evaluationId, outcome, cap_usdc: cap, partial: outcome === "partial" },
      at: now,
    });
    return { ready_for_payout: true, bounty_status: ctx.bounty.status };
  }
  // failed | unverifiable: release the claim; the bounty reopens unless its deadline passed
  if (ctx.claim.releasedAt === null) await tx.update(schema.claims).set({ releasedAt: now }).where(eq(schema.claims.id, ctx.claim.id));
  await appendEntityEvent(tx, { entity_id: ctx.entity.id, actor, kind: "claim_released", payload: { bounty_id: ctx.bounty.id, claim_id: ctx.claim.id, reason: outcome }, at: now });
  if (ctx.bounty.status !== "in_review") return { ready_for_payout: false, bounty_status: ctx.bounty.status };
  const expired = ctx.bounty.deadline !== null && ctx.bounty.deadline < now.toISOString().slice(0, 10);
  const [others] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.claims)
    .where(and(eq(schema.claims.bountyId, ctx.bounty.id), isNull(schema.claims.releasedAt)));
  const to: schema.BountyStatus = expired ? "expired" : (others?.n ?? 0) > 0 ? "claimed" : "open";
  const updated = await transitionBounty(tx, ctx.bounty, to, actor, { evaluation_id: evaluationId, outcome }, now);
  return { ready_for_payout: false, bounty_status: updated.status };
}

export async function evaluate(db: DbOrTx, submissionId: string, evaluatorId: string, input: EvaluateInput, deps: EvaluateDeps = {}): Promise<EvaluateResult> {
  const now = deps.now ?? new Date();
  if (!OUTCOME_NAMES.includes(input.outcome)) throw new GovernanceError("invalid_spec", "unknown outcome");
  const notes = input.notes ? String(input.notes).slice(0, 4000) : null;
  return withTx(db, async (tx) => {
    const ctx = await loadContext(tx, submissionId);
    if (ctx.entity.retiredAt) throw new GovernanceError("retired");
    const hatId = await assertIndependentEvaluator(tx, ctx, evaluatorId);
    const spec = parseEvidenceSpec(ctx.bounty.evidenceSpec);
    const cap = usdc(ctx.bounty.capUsdc);
    const needsSecond = secondAttestationRequired(cap, spec.second_attestation_above_usdc);
    const payload = buildPayload(ctx, evaluatorId, hatId, input.outcome, input.twin_snapshot_hash, now);
    const signed = await signOffchain(payload, deps.signer);

    // --- an audit of an earlier evaluation
    if (input.audit_of) {
      const [orig] = await tx.select().from(schema.evaluations).where(eq(schema.evaluations.id, input.audit_of)).limit(1);
      if (!orig || orig.submissionId !== submissionId) throw new GovernanceError("not_found");
      if (orig.evaluatorId === evaluatorId || orig.secondAttestationBy === evaluatorId) throw new GovernanceError("already_evaluated", "auditor must be a third evaluator");
      const id = newId("eval");
      await tx.insert(schema.evaluations).values({
        id,
        submissionId,
        evaluatorId,
        outcome: input.outcome,
        notesMd: notes,
        twinSnapshotHash: input.twin_snapshot_hash ?? null,
        offchainAttestation: { payload, uid: signed.uid, signature: signed.signature, audit_of: orig.id },
        easUid: signed.uid,
        attestedAt: now,
        auditOf: orig.id,
        createdAt: now,
      });
      await indexAttestation(tx, ctx, signed.uid, evaluatorId, payload, now);
      const disagreement = orig.outcome !== input.outcome;
      await appendEntityEvent(tx, {
        entity_id: ctx.entity.id,
        actor: evaluatorId,
        kind: disagreement ? "audit_disagreement" : "audit_recorded",
        payload: { bounty_id: ctx.bounty.id, submission_id: submissionId, evaluation_id: id, audit_of: orig.id, outcome: input.outcome, original_outcome: orig.outcome, uid: signed.uid },
        at: now,
      });
      return { evaluation_id: id, kind: "audit", uid: signed.uid, outcome: input.outcome, ready_for_payout: false, needs_second_attestation: false, disagreement, audit_sampled: false, bounty_status: ctx.bounty.status };
    }

    const [existing] = await tx
      .select()
      .from(schema.evaluations)
      .where(and(eq(schema.evaluations.submissionId, submissionId), isNull(schema.evaluations.auditOf)))
      .orderBy(schema.evaluations.createdAt)
      .limit(1);

    // --- the second attestation
    if (existing) {
      if (existing.secondAttestationBy) throw new GovernanceError("already_evaluated");
      if (existing.evaluatorId === evaluatorId) throw new GovernanceError("already_evaluated");
      if (!needsSecond) throw new GovernanceError("already_evaluated");
      const prior = (existing.offchainAttestation ?? {}) as Record<string, unknown>;
      const disagreement = existing.outcome !== input.outcome;
      // the trigger re-checks second_attestation_by ≠ evaluator ≠ claimant ≠ proposer
      await tx
        .update(schema.evaluations)
        .set({
          secondAttestationBy: evaluatorId,
          attestedAt: disagreement ? null : now,
          offchainAttestation: { ...prior, second: { payload, uid: signed.uid, signature: signed.signature, outcome: input.outcome, notes } },
        })
        .where(eq(schema.evaluations.id, existing.id));
      await indexAttestation(tx, ctx, signed.uid, evaluatorId, payload, now);
      if (disagreement) {
        await appendEntityEvent(tx, {
          entity_id: ctx.entity.id,
          actor: evaluatorId,
          kind: "evaluation_disagreement",
          payload: { bounty_id: ctx.bounty.id, submission_id: submissionId, evaluation_id: existing.id, first: existing.outcome, second: input.outcome },
          at: now,
        });
        return { evaluation_id: existing.id, kind: "second", uid: signed.uid, outcome: input.outcome, ready_for_payout: false, needs_second_attestation: false, disagreement: true, audit_sampled: false, bounty_status: ctx.bounty.status };
      }
      await appendEntityEvent(tx, {
        entity_id: ctx.entity.id,
        actor: evaluatorId,
        kind: "evaluation_second_attested",
        payload: { bounty_id: ctx.bounty.id, submission_id: submissionId, evaluation_id: existing.id, outcome: input.outcome, uid: signed.uid },
        at: now,
      });
      const fin = await finalizeOutcome(tx, ctx, existing.id, existing.outcome, evaluatorId, now);
      return { evaluation_id: existing.id, kind: "second", uid: signed.uid, outcome: existing.outcome, needs_second_attestation: false, disagreement: false, audit_sampled: false, ...fin };
    }

    // --- the first evaluation
    const id = newId("eval");
    await tx.insert(schema.evaluations).values({
      id,
      submissionId,
      evaluatorId,
      outcome: input.outcome,
      notesMd: notes,
      twinSnapshotHash: input.twin_snapshot_hash ?? null,
      offchainAttestation: { payload, uid: signed.uid, signature: signed.signature, needs_second_attestation: needsSecond },
      easUid: signed.uid,
      attestedAt: needsSecond ? null : now,
      createdAt: now,
    });
    await indexAttestation(tx, ctx, signed.uid, evaluatorId, payload, now);
    await appendEntityEvent(tx, {
      entity_id: ctx.entity.id,
      actor: evaluatorId,
      kind: "evaluation_recorded",
      payload: { bounty_id: ctx.bounty.id, submission_id: submissionId, evaluation_id: id, outcome: input.outcome, uid: signed.uid, needs_second_attestation: needsSecond },
      at: now,
    });

    let audit_sampled = false;
    if (ctx.bounty.verificationTier === 2) {
      const rate = deps.audit_rate ?? (await getConfigNumber(tx, "audit_rate", CONFIG_DEFAULTS.audit_rate));
      if (sampleAudit(deps.rng ?? Math.random, rate)) {
        audit_sampled = true;
        await appendEntityEvent(tx, { entity_id: ctx.entity.id, actor: null, kind: "audit_sampled", payload: { bounty_id: ctx.bounty.id, submission_id: submissionId, evaluation_id: id, rate }, at: now });
      }
    }

    if (needsSecond) {
      return { evaluation_id: id, kind: "first", uid: signed.uid, outcome: input.outcome, ready_for_payout: false, needs_second_attestation: true, disagreement: false, audit_sampled, bounty_status: ctx.bounty.status };
    }
    const fin = await finalizeOutcome(tx, ctx, id, input.outcome, evaluatorId, now);
    return { evaluation_id: id, kind: "first", uid: signed.uid, outcome: input.outcome, needs_second_attestation: false, disagreement: false, audit_sampled, ...fin };
  });
}

/** Evaluations sampled for audit that have no `audit_of` row yet. */
export async function pendingAudits(db: DbOrTx, entityId: string) {
  const sampled = await db
    .select({ payload: schema.entityEvents.payload, at: schema.entityEvents.at })
    .from(schema.entityEvents)
    .where(and(eq(schema.entityEvents.entityId, entityId), eq(schema.entityEvents.kind, "audit_sampled")));
  const out: Array<{ evaluation_id: string; submission_id: string; bounty_id: string; sampled_at: Date | null }> = [];
  for (const s of sampled) {
    const p = s.payload as { evaluation_id: string; submission_id: string; bounty_id: string };
    const [done] = await db.select({ id: schema.evaluations.id }).from(schema.evaluations).where(eq(schema.evaluations.auditOf, p.evaluation_id)).limit(1);
    if (!done) out.push({ evaluation_id: p.evaluation_id, submission_id: p.submission_id, bounty_id: p.bounty_id, sampled_at: s.at });
  }
  return out;
}

/**
 * Tier-4 follow-up (6–12 months later): a second ProposalOutcome referencing
 * the deposit outcome. Records the evaluation, marks the follow-up done in
 * `config.tier4_followups`, and reports whether the balance may be paid
 * (`deferred → paid` is the treasury's transition).
 */
export async function recordTier4FollowUp(db: DbOrTx, bountyId: string, evaluatorId: string, input: EvaluateInput, deps: EvaluateDeps = {}) {
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const followups = await getConfigValue<Record<string, { submission_id: string; evaluation_id: string; balance_usdc: number; followed_up_at: string | null }>>(tx, "tier4_followups", {});
    const fu = followups[bountyId];
    if (!fu) throw new GovernanceError("not_found", "no tier-4 follow-up recorded");
    if (fu.followed_up_at) throw new GovernanceError("already_evaluated");
    const ctx = await loadContext(tx, fu.submission_id);
    const hatId = await assertIndependentEvaluator(tx, ctx, evaluatorId);
    const [first] = await tx.select().from(schema.evaluations).where(eq(schema.evaluations.id, fu.evaluation_id)).limit(1);
    const payload = buildPayload(ctx, evaluatorId, hatId, input.outcome, input.twin_snapshot_hash, now);
    const signed = await signOffchain(payload, deps.signer);
    const id = newId("eval");
    await tx.insert(schema.evaluations).values({
      id,
      submissionId: fu.submission_id,
      evaluatorId,
      outcome: input.outcome,
      notesMd: input.notes ?? null,
      twinSnapshotHash: input.twin_snapshot_hash ?? null,
      offchainAttestation: { payload, uid: signed.uid, signature: signed.signature, follow_up_of: first?.easUid ?? fu.evaluation_id },
      easUid: signed.uid,
      attestedAt: now,
      auditOf: fu.evaluation_id,
      createdAt: now,
    });
    await indexAttestation(tx, ctx, signed.uid, evaluatorId, payload, now);
    followups[bountyId] = { ...fu, followed_up_at: now.toISOString() } as typeof fu;
    await setConfigValue(tx, "tier4_followups", followups);
    const balance_ready = input.outcome === "succeeded" || input.outcome === "partial";
    await appendEntityEvent(tx, {
      entity_id: ctx.entity.id,
      actor: evaluatorId,
      kind: "tier4_follow_up_recorded",
      payload: { bounty_id: bountyId, evaluation_id: id, follow_up_of: fu.evaluation_id, outcome: input.outcome, balance_usdc: fu.balance_usdc, balance_ready, uid: signed.uid },
      at: now,
    });
    return { evaluation_id: id, uid: signed.uid, balance_ready, balance_usdc: fu.balance_usdc };
  });
}
