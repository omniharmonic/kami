/**
 * Page reads for the governance surfaces. Like `lib/entities.ts`, every read
 * goes through `withDb` and returns an honest empty value when Neon is unset
 * or unreachable (ADR-E14) — a page never blanks because the database is down.
 */
import { cache } from "react";
import { and, desc, eq, gte, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { withDb, type Db } from "@/db/client";
import * as schema from "@/db/schema";
import type { BountyStatus, EntityRoleName } from "@/db/schema";
import { parseEvidenceSpec, type EvidenceSpec } from "@/lib/evidence/spec";
import type { EvidenceSummary } from "@/lib/evidence/summary";
import { CONFIG_DEFAULTS, getConfigNumber, getConfigValue } from "./config";
import { pauseState } from "./pause";
import { entityHasTwoNonFounderGuardians, listPendingInvites } from "./roles";

const PUBLIC_STATES: BountyStatus[] = ["open", "claimed", "in_review", "paid", "deferred", "expired", "withdrawn"];

export type BoardBounty = {
  id: string;
  title: string;
  status: BountyStatus;
  cap_usdc: string;
  verification_tier: number;
  deadline: string | null;
  evidence_spec: EvidenceSpec;
  claims: number;
  eas_uid_posted: string | null;
};

export type BoardProposal = { id: string; title: string; body_md: string; rank: number | null; rank_reason_md: string | null; status: string; created_at: string | null };

export type Board = { bounties: BoardBounty[]; proposals: BoardProposal[] };

export const getBoard = cache(async (entityId: string): Promise<Board> =>
  withDb(async (db) => {
    const rows = await db
      .select()
      .from(schema.bounties)
      .where(and(eq(schema.bounties.entityId, entityId), inArray(schema.bounties.status, PUBLIC_STATES)))
      .orderBy(desc(schema.bounties.createdAt))
      .limit(60);
    const counts = new Map<string, number>();
    if (rows.length) {
      const c = await db
        .select({ bountyId: schema.claims.bountyId, n: sql<number>`count(*)::int` })
        .from(schema.claims)
        .where(and(inArray(schema.claims.bountyId, rows.map((r) => r.id)), isNull(schema.claims.releasedAt)))
        .groupBy(schema.claims.bountyId);
      for (const r of c) if (r.bountyId) counts.set(r.bountyId, r.n);
    }
    const proposals = await db
      .select()
      .from(schema.proposals)
      .where(and(eq(schema.proposals.entityId, entityId), eq(schema.proposals.authorKind, "human")))
      .orderBy(sql`${schema.proposals.rank} asc nulls last`, desc(schema.proposals.createdAt))
      .limit(30);
    return {
      bounties: rows.map((b) => ({
        id: b.id,
        title: b.title,
        status: b.status,
        cap_usdc: b.capUsdc,
        verification_tier: b.verificationTier,
        deadline: b.deadline,
        evidence_spec: parseEvidenceSpec(b.evidenceSpec),
        claims: counts.get(b.id) ?? 0,
        eas_uid_posted: b.easUidPosted,
      })),
      proposals: proposals.map((p) => ({
        id: p.id,
        title: p.title,
        body_md: p.bodyMd,
        rank: p.rank,
        rank_reason_md: p.rankReasonMd,
        status: p.status,
        created_at: p.createdAt?.toISOString() ?? null,
      })),
    };
  }, { bounties: [], proposals: [] }),
);

export type DetailClaim = { id: string; user_id: string | null; name: string; claimed_at: string | null; released_at: string | null; mine: boolean };
export type DetailEvaluation = {
  id: string;
  outcome: string;
  notes_md: string | null;
  evaluator: string;
  evaluator_id: string | null;
  second_attestation_by: string | null;
  eas_uid: string | null;
  attested_at: string | null;
  audit_of: string | null;
  twin_snapshot_hash: string | null;
};
export type DetailSubmission = {
  id: string;
  claim_id: string | null;
  submitted_at: string | null;
  summary: EvidenceSummary | null;
  file_count: number;
  mine: boolean;
  evaluations: DetailEvaluation[];
};

export type BountyDetail = {
  id: string;
  entity_id: string;
  title: string;
  why_md: string;
  deliverable_md: string;
  status: BountyStatus;
  verification_tier: number;
  cap_usdc: string;
  claim_limit: number;
  deadline: string | null;
  evidence_spec: EvidenceSpec;
  twin_refs: string[];
  prediction: { place_id: string; property: string; direction: string; window_end: string } | null;
  spec_sha256: string;
  approved_by_name: string | null;
  approved_at: string | null;
  eas_uid_posted: string | null;
  claims: DetailClaim[];
  submissions: DetailSubmission[];
  my_claim: DetailClaim | null;
  second_attestation_needed: boolean;
};

function displayName(name: string | null, email: string | null): string {
  return name ?? email?.split("@")[0] ?? "someone";
}

export async function getBountyDetail(bountyId: string, viewerId: string | null): Promise<BountyDetail | null> {
  return withDb(async (db) => {
    const [b] = await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId)).limit(1);
    if (!b || !b.entityId) return null;
    const claimRows = await db
      .select({ id: schema.claims.id, userId: schema.claims.userId, claimedAt: schema.claims.claimedAt, releasedAt: schema.claims.releasedAt, name: schema.users.name, email: schema.users.email })
      .from(schema.claims)
      .leftJoin(schema.users, eq(schema.users.id, schema.claims.userId))
      .where(eq(schema.claims.bountyId, bountyId))
      .orderBy(schema.claims.claimedAt);
    const claims: DetailClaim[] = claimRows.map((c) => ({
      id: c.id,
      user_id: c.userId,
      name: displayName(c.name, c.email),
      claimed_at: c.claimedAt?.toISOString() ?? null,
      released_at: c.releasedAt?.toISOString() ?? null,
      mine: Boolean(viewerId && c.userId === viewerId),
    }));
    const claimIds = claims.map((c) => c.id);
    const subs = claimIds.length
      ? await db.select().from(schema.submissions).where(inArray(schema.submissions.claimId, claimIds)).orderBy(desc(schema.submissions.submittedAt))
      : [];
    const subIds = subs.map((s) => s.id);
    const evalRows = subIds.length
      ? await db
          .select({
            id: schema.evaluations.id,
            submissionId: schema.evaluations.submissionId,
            outcome: schema.evaluations.outcome,
            notes: schema.evaluations.notesMd,
            evaluatorId: schema.evaluations.evaluatorId,
            second: schema.evaluations.secondAttestationBy,
            uid: schema.evaluations.easUid,
            attestedAt: schema.evaluations.attestedAt,
            auditOf: schema.evaluations.auditOf,
            twinHash: schema.evaluations.twinSnapshotHash,
            name: schema.users.name,
            email: schema.users.email,
          })
          .from(schema.evaluations)
          .leftJoin(schema.users, eq(schema.users.id, schema.evaluations.evaluatorId))
          .where(inArray(schema.evaluations.submissionId, subIds))
          .orderBy(schema.evaluations.createdAt)
      : [];
    const fileCounts = new Map<string, number>();
    if (subIds.length) {
      const fc = await db
        .select({ submissionId: schema.evidenceFiles.submissionId, n: sql<number>`count(*)::int` })
        .from(schema.evidenceFiles)
        .where(and(inArray(schema.evidenceFiles.submissionId, subIds), isNull(schema.evidenceFiles.deletedAt)))
        .groupBy(schema.evidenceFiles.submissionId);
      for (const r of fc) if (r.submissionId) fileCounts.set(r.submissionId, r.n);
    }
    const [approver] = b.approvedBy
      ? await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, b.approvedBy)).limit(1)
      : [];
    const spec = parseEvidenceSpec(b.evidenceSpec);
    const claimById = new Map(claims.map((c) => [c.id, c]));
    return {
      id: b.id,
      entity_id: b.entityId,
      title: b.title,
      why_md: b.whyMd,
      deliverable_md: b.deliverableMd,
      status: b.status,
      verification_tier: b.verificationTier,
      cap_usdc: b.capUsdc,
      claim_limit: b.claimLimit,
      deadline: b.deadline,
      evidence_spec: spec,
      twin_refs: b.twinRefs,
      prediction: (b.prediction as BountyDetail["prediction"]) ?? null,
      spec_sha256: b.specSha256,
      approved_by_name: approver ? displayName(approver.name, approver.email) : null,
      approved_at: b.approvedAt?.toISOString() ?? null,
      eas_uid_posted: b.easUidPosted,
      claims,
      submissions: subs.map((s) => ({
        id: s.id,
        claim_id: s.claimId,
        submitted_at: s.submittedAt?.toISOString() ?? null,
        summary: (s.evidenceSummary as EvidenceSummary) ?? null,
        file_count: fileCounts.get(s.id) ?? 0,
        mine: Boolean(s.claimId && claimById.get(s.claimId)?.mine),
        evaluations: evalRows
          .filter((e) => e.submissionId === s.id)
          .map((e) => ({
            id: e.id,
            outcome: e.outcome,
            notes_md: e.notes,
            evaluator: displayName(e.name, e.email),
            evaluator_id: e.evaluatorId,
            second_attestation_by: e.second,
            eas_uid: e.uid,
            attested_at: e.attestedAt?.toISOString() ?? null,
            audit_of: e.auditOf,
            twin_snapshot_hash: e.twinHash,
          })),
      })),
      my_claim: claims.find((c) => c.mine && !c.released_at) ?? null,
      second_attestation_needed: Number(b.capUsdc) > spec.second_attestation_above_usdc,
    };
  }, null);
}

// --- /guardian -------------------------------------------------------------

export type GuardianEntity = {
  entity_id: string;
  slug: string;
  name: string;
  roles: EntityRoleName[];
  paused_at: string | null;
  retired_at: string | null;
  resume_requests: Array<{ by_user: string; at: string }>;
  retire_requests: Array<{ by_user: string; at: string }>;
  window_hours: number;
  drafts: Array<{
    id: string;
    title: string;
    why_md: string;
    deliverable_md: string;
    status: BountyStatus;
    cap_usdc: string;
    verification_tier: number;
    claim_limit: number;
    deadline: string | null;
    evidence_spec: EvidenceSpec;
    twin_refs: string[];
    prediction: unknown;
    spec_sha256: string;
    created_at: string | null;
  }>;
  invites: Array<{ id: string; email: string | null; expires_at: string | null }>;
  people: Array<{ user_id: string; name: string; role: EntityRoleName }>;
  safe_proposals: Array<{ safe_tx_hash: string; amount_usdc: string | null; confirmations: number; status: string; proposed_at: string | null }>;
  two_non_founder_guardians: boolean;
  approvals_required: number;
  strategies_awaiting: Array<{ id: string; quarter: string; comment_open_until: string | null }>;
};

export async function getGuardianDashboard(userId: string): Promise<GuardianEntity[]> {
  return withDb(async (db) => {
    const roleRows = await db
      .select({ entityId: schema.entityRoles.entityId, role: schema.entityRoles.role, slug: schema.entities.slug, name: schema.entities.name })
      .from(schema.entityRoles)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.entityRoles.entityId))
      .where(and(eq(schema.entityRoles.userId, userId), isNotNull(schema.entityRoles.acceptedAt), isNull(schema.entityRoles.revokedAt)));
    const byEntity = new Map<string, { slug: string; name: string; roles: EntityRoleName[] }>();
    for (const r of roleRows) {
      const cur = byEntity.get(r.entityId) ?? { slug: r.slug, name: r.name, roles: [] };
      if (!cur.roles.includes(r.role)) cur.roles.push(r.role);
      byEntity.set(r.entityId, cur);
    }
    const approvals_required = await getConfigNumber(db, "bounty_approvals_required", CONFIG_DEFAULTS.bounty_approvals_required);
    const out: GuardianEntity[] = [];
    for (const [entityId, meta] of byEntity) {
      const state = await pauseState(db, entityId);
      const drafts = await db
        .select()
        .from(schema.bounties)
        .where(and(eq(schema.bounties.entityId, entityId), inArray(schema.bounties.status, ["drafted", "held_by_guard"])))
        .orderBy(desc(schema.bounties.createdAt));
      const invites = await listPendingInvites(db, entityId);
      const people = await db
        .select({ userId: schema.entityRoles.userId, role: schema.entityRoles.role, name: schema.users.name, email: schema.users.email })
        .from(schema.entityRoles)
        .innerJoin(schema.users, eq(schema.users.id, schema.entityRoles.userId))
        .where(and(eq(schema.entityRoles.entityId, entityId), isNotNull(schema.entityRoles.acceptedAt), isNull(schema.entityRoles.revokedAt)));
      const safe = await db
        .select()
        .from(schema.safeProposals)
        .where(and(eq(schema.safeProposals.entityId, entityId), eq(schema.safeProposals.status, "pending")))
        .orderBy(desc(schema.safeProposals.proposedAt))
        .limit(20);
      const strategies = await db
        .select({ id: schema.strategies.id, quarter: schema.strategies.quarter, until: schema.strategies.commentOpenUntil })
        .from(schema.strategies)
        .where(and(eq(schema.strategies.entityId, entityId), isNull(schema.strategies.ratifiedAt)))
        .orderBy(desc(schema.strategies.createdAt));
      out.push({
        entity_id: entityId,
        slug: meta.slug,
        name: meta.name,
        roles: meta.roles,
        paused_at: state.paused_at?.toISOString() ?? null,
        retired_at: state.retired_at?.toISOString() ?? null,
        resume_requests: state.resume_requests.map((r) => ({ by_user: r.by_user, at: r.at.toISOString() })),
        retire_requests: state.retire_requests.map((r) => ({ by_user: r.by_user, at: r.at.toISOString() })),
        window_hours: state.window_hours,
        drafts: drafts.map((d) => ({
          id: d.id,
          title: d.title,
          why_md: d.whyMd,
          deliverable_md: d.deliverableMd,
          status: d.status,
          cap_usdc: d.capUsdc,
          verification_tier: d.verificationTier,
          claim_limit: d.claimLimit,
          deadline: d.deadline,
          evidence_spec: parseEvidenceSpec(d.evidenceSpec),
          twin_refs: d.twinRefs,
          prediction: d.prediction,
          spec_sha256: d.specSha256,
          created_at: d.createdAt?.toISOString() ?? null,
        })),
        invites: invites.map((i) => ({ id: i.id, email: i.email, expires_at: i.expiresAt?.toISOString() ?? null })),
        people: people.map((p) => ({ user_id: p.userId, name: displayName(p.name, p.email), role: p.role })),
        safe_proposals: safe.map((s) => ({
          safe_tx_hash: s.safeTxHash,
          amount_usdc: s.amountUsdc,
          confirmations: s.confirmations,
          status: s.status,
          proposed_at: s.proposedAt?.toISOString() ?? null,
        })),
        two_non_founder_guardians: await entityHasTwoNonFounderGuardians(db, entityId),
        approvals_required,
        strategies_awaiting: strategies.map((s) => ({ id: s.id, quarter: s.quarter, comment_open_until: s.until?.toISOString() ?? null })),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, []);
}

// --- /me -------------------------------------------------------------------

export type MeClaim = { claim_id: string; bounty_id: string; title: string; slug: string | null; status: BountyStatus; cap_usdc: string; claimed_at: string | null; released_at: string | null; submission_id: string | null };
export type MeAttestation = { uid: string | null; outcome: string; bounty_title: string; slug: string | null; attested_at: string | null; audit_of: string | null; second_attestation_by: string | null };
export type MeReputation = { score: number | null; n: number | null; p: number | null; passport_ok: boolean; entity_id: string; computed_at: string | null; scores_uri: string | null; run_id: string } | null;

export async function getMyClaims(userId: string): Promise<MeClaim[]> {
  return withDb(async (db) => {
    const rows = await db
      .select({
        claimId: schema.claims.id,
        bountyId: schema.bounties.id,
        title: schema.bounties.title,
        slug: schema.entities.slug,
        status: schema.bounties.status,
        cap: schema.bounties.capUsdc,
        claimedAt: schema.claims.claimedAt,
        releasedAt: schema.claims.releasedAt,
        submissionId: schema.submissions.id,
      })
      .from(schema.claims)
      .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
      .leftJoin(schema.entities, eq(schema.entities.id, schema.bounties.entityId))
      .leftJoin(schema.submissions, eq(schema.submissions.claimId, schema.claims.id))
      .where(eq(schema.claims.userId, userId))
      .orderBy(desc(schema.claims.claimedAt))
      .limit(50);
    return rows.map((r) => ({
      claim_id: r.claimId,
      bounty_id: r.bountyId,
      title: r.title,
      slug: r.slug,
      status: r.status,
      cap_usdc: r.cap,
      claimed_at: r.claimedAt?.toISOString() ?? null,
      released_at: r.releasedAt?.toISOString() ?? null,
      submission_id: r.submissionId,
    }));
  }, []);
}

export async function getMyAttestations(userId: string): Promise<MeAttestation[]> {
  return withDb(async (db) => {
    const rows = await db
      .select({
        uid: schema.evaluations.easUid,
        outcome: schema.evaluations.outcome,
        title: schema.bounties.title,
        slug: schema.entities.slug,
        attestedAt: schema.evaluations.attestedAt,
        auditOf: schema.evaluations.auditOf,
        second: schema.evaluations.secondAttestationBy,
      })
      .from(schema.evaluations)
      .innerJoin(schema.submissions, eq(schema.submissions.id, schema.evaluations.submissionId))
      .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
      .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
      .leftJoin(schema.entities, eq(schema.entities.id, schema.bounties.entityId))
      .where(eq(schema.claims.userId, userId))
      .orderBy(desc(schema.evaluations.createdAt))
      .limit(50);
    return rows.map((r) => ({
      uid: r.uid,
      outcome: r.outcome,
      bounty_title: r.title,
      slug: r.slug,
      attested_at: r.attestedAt?.toISOString() ?? null,
      audit_of: r.auditOf,
      second_attestation_by: r.second,
    }));
  }, []);
}

export async function getMyReputation(userId: string): Promise<MeReputation> {
  return withDb(async (db) => {
    const [run] = await db.select().from(schema.reputationRuns).orderBy(desc(schema.reputationRuns.computedAt)).limit(1);
    if (!run) return null;
    const [s] = await db
      .select()
      .from(schema.reputationScores)
      .where(and(eq(schema.reputationScores.runId, run.id), eq(schema.reputationScores.subject, userId)))
      .orderBy(desc(schema.reputationScores.n))
      .limit(1);
    if (!s) return null;
    return {
      score: s.score === null ? null : Number(s.score),
      n: s.n === null ? null : Number(s.n),
      p: s.p === null ? null : Number(s.p),
      passport_ok: Boolean(s.passportOk),
      entity_id: s.entityId,
      computed_at: run.computedAt.toISOString(),
      scores_uri: run.scoresUri,
      run_id: run.id,
    };
  }, null);
}

// --- entity page sections --------------------------------------------------

export type Contributor = { name: string; completions: number };

/** Top contributors by attested, succeeded completions (People section, PRD §6.1 #7). */
export async function getTopContributors(entityId: string, limit = 5): Promise<Contributor[]> {
  return withDb(async (db) => {
    const rows = await db
      .select({ name: schema.users.name, email: schema.users.email, n: sql<number>`count(*)::int` })
      .from(schema.evaluations)
      .innerJoin(schema.submissions, eq(schema.submissions.id, schema.evaluations.submissionId))
      .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
      .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
      .innerJoin(schema.users, eq(schema.users.id, schema.claims.userId))
      .where(and(eq(schema.bounties.entityId, entityId), eq(schema.evaluations.outcome, "succeeded"), isNotNull(schema.evaluations.attestedAt), isNull(schema.evaluations.auditOf)))
      .groupBy(schema.users.name, schema.users.email)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);
    return rows.map((r) => ({ name: displayName(r.name, r.email), completions: r.n }));
  }, []);
}

export async function getPendingSafeProposalCount(entityId: string): Promise<number> {
  return withDb(async (db) => {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.safeProposals)
      .where(and(eq(schema.safeProposals.entityId, entityId), eq(schema.safeProposals.status, "pending")));
    return r?.n ?? 0;
  }, 0);
}

// --- /admin ----------------------------------------------------------------

export type AdminEntity = {
  entity_id: string;
  slug: string;
  name: string;
  paused: boolean;
  retired: boolean;
  published_at: string | null;
  consultation_done_at: string | null;
  guard_drop_pct: number | null;
  pulse_skip_pct: number | null;
  tokens_7d: number;
};

export type AdminData = {
  entities: AdminEntity[];
  usage_by_day: Array<{ day: string; tokens: number }>;
  gpu_last_seen_at: string | null;
  sb243_report_due: string | null;
  card_hour_cost: number | null;
  tokens_7d_total: number;
};

export async function getAdminData(days = 14): Promise<AdminData> {
  return withDb(async (db) => {
    const since = new Date(Date.now() - days * 86_400_000);
    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const entities = await db.select().from(schema.entities).orderBy(schema.entities.name);
    const guard = await db
      .select({
        entityId: schema.guardEvents.entityId,
        dropped: sql<number>`count(*) filter (where ${schema.guardEvents.action} = 'dropped')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.guardEvents)
      .groupBy(schema.guardEvents.entityId);
    const pulse = await db
      .select({
        entityId: schema.pulses.entityId,
        skipped: sql<number>`count(*) filter (where ${schema.pulses.woke} = false)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.pulses)
      .groupBy(schema.pulses.entityId);
    const usage7 = await db
      .select({ entityId: schema.usageEvents.entityId, tokens: sql<number>`coalesce(sum(${schema.usageEvents.tokensPrompt} + ${schema.usageEvents.tokensOutput}), 0)::int` })
      .from(schema.usageEvents)
      .where(gte(schema.usageEvents.at, since7))
      .groupBy(schema.usageEvents.entityId);
    const byDay = await db
      .select({ day: sql<string>`to_char(date_trunc('day', ${schema.usageEvents.at}), 'YYYY-MM-DD')`, tokens: sql<number>`coalesce(sum(${schema.usageEvents.tokensPrompt} + ${schema.usageEvents.tokensOutput}), 0)::int` })
      .from(schema.usageEvents)
      .where(gte(schema.usageEvents.at, since))
      .groupBy(sql`date_trunc('day', ${schema.usageEvents.at})`)
      .orderBy(sql`date_trunc('day', ${schema.usageEvents.at}) desc`);

    const guardMap = new Map(guard.map((g) => [g.entityId, g]));
    const pulseMap = new Map(pulse.map((p) => [p.entityId, p]));
    const usageMap = new Map(usage7.map((u) => [u.entityId, u.tokens]));

    const gpuSeen = await getConfigValue<string | null>(db, "gpu_last_seen_at", null);
    const sb243 = await getConfigValue<string | null>(db, "sb243_report_due", null);
    const cardCost = await getConfigValue<number | null>(db, "card_hour_cost", null);

    return {
      entities: entities.map((e) => {
        const g = guardMap.get(e.id);
        const p = pulseMap.get(e.id);
        return {
          entity_id: e.id,
          slug: e.slug,
          name: e.name,
          paused: e.pausedAt !== null,
          retired: e.retiredAt !== null,
          published_at: e.publishedAt?.toISOString() ?? null,
          consultation_done_at: e.consultationDoneAt?.toISOString() ?? null,
          guard_drop_pct: g && g.total > 0 ? (100 * g.dropped) / g.total : null,
          pulse_skip_pct: p && p.total > 0 ? (100 * p.skipped) / p.total : null,
          tokens_7d: usageMap.get(e.id) ?? 0,
        };
      }),
      usage_by_day: byDay.map((d) => ({ day: d.day, tokens: d.tokens })),
      gpu_last_seen_at: typeof gpuSeen === "string" ? gpuSeen : null,
      sb243_report_due: typeof sb243 === "string" ? sb243 : null,
      card_hour_cost: typeof cardCost === "number" ? cardCost : null,
      tokens_7d_total: usage7.reduce((a, b) => a + b.tokens, 0),
    };
  }, { entities: [], usage_by_day: [], gpu_last_seen_at: null, sb243_report_due: null, card_hour_cost: null, tokens_7d_total: 0 });
}

export async function isEvaluatorFor(db: Db, userId: string, entityId: string): Promise<boolean> {
  const rows = await db
    .select({ r: schema.entityRoles.role })
    .from(schema.entityRoles)
    .where(
      and(
        eq(schema.entityRoles.userId, userId),
        eq(schema.entityRoles.entityId, entityId),
        eq(schema.entityRoles.role, "evaluator"),
        isNotNull(schema.entityRoles.acceptedAt),
        isNull(schema.entityRoles.revokedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function viewerIsEvaluator(userId: string | null, entityId: string): Promise<boolean> {
  if (!userId) return false;
  return withDb(async (db) => isEvaluatorFor(db, userId, entityId), false);
}
