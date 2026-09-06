/**
 * `/me` reads: the contribute-to-training preference and the JSON export
 * (PRD §7.3 "a record I can carry", §13 #7). Kept out of `src/actions/me.ts`
 * because a "use server" module may export only async functions.
 */
import { and, desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { getConfigValue } from "@/lib/governance/config";

/** No `users.contribute_opt_in` column exists (see the report); the preference lives in `config`. */
export const CONTRIBUTE_OPT_IN_KEY = "contribute_opt_in_users";

export async function getContributeOptIn(db: DbOrTx, userId: string): Promise<boolean> {
  const map = await getConfigValue<Record<string, boolean>>(db, CONTRIBUTE_OPT_IN_KEY, {});
  return Boolean(map[userId]);
}

export type MeExport = {
  exported_at: string;
  user: { id: string; email: string; name: string | null; wallet_address: string | null; passport_score: number | null; passport_checked_at: string | null };
  claims: Array<{ bounty_id: string; bounty_title: string; entity: string | null; claimed_at: string | null; released_at: string | null; cap_usdc: string }>;
  submissions: Array<{ id: string; bounty_id: string | null; submitted_at: string | null; evidence_summary: unknown }>;
  attestations: Array<{ uid: string | null; outcome: string; entity: string | null; attested_at: string | null; audit_of: string | null }>;
  reputation: Array<{ run_id: string; entity_id: string; n: string | null; p: string | null; score: string | null; passport_ok: boolean | null; computed_at: string | null; scores_uri: string | null }>;
  evidence_files: Array<{ id: string; sha256: string; deleted_at: string | null }>;
  note: string;
};

/** Everything the platform holds about the signed-in person, as JSON (PRD §7.3 "a record I can carry"). */
export async function buildMeExport(db: DbOrTx, userId: string): Promise<MeExport> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const claims = await db
    .select({
      bountyId: schema.bounties.id,
      title: schema.bounties.title,
      entityId: schema.bounties.entityId,
      cap: schema.bounties.capUsdc,
      claimedAt: schema.claims.claimedAt,
      releasedAt: schema.claims.releasedAt,
    })
    .from(schema.claims)
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .where(eq(schema.claims.userId, userId))
    .orderBy(desc(schema.claims.claimedAt));
  const submissions = await db
    .select({ id: schema.submissions.id, bountyId: schema.claims.bountyId, submittedAt: schema.submissions.submittedAt, summary: schema.submissions.evidenceSummary })
    .from(schema.submissions)
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .where(eq(schema.claims.userId, userId));
  const attestations = await db
    .select({ uid: schema.evaluations.easUid, outcome: schema.evaluations.outcome, entityId: schema.bounties.entityId, attestedAt: schema.evaluations.attestedAt, auditOf: schema.evaluations.auditOf })
    .from(schema.evaluations)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.evaluations.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .where(eq(schema.claims.userId, userId));
  const reputation = await db
    .select({
      runId: schema.reputationScores.runId,
      entityId: schema.reputationScores.entityId,
      n: schema.reputationScores.n,
      p: schema.reputationScores.p,
      score: schema.reputationScores.score,
      passportOk: schema.reputationScores.passportOk,
      computedAt: schema.reputationRuns.computedAt,
      scoresUri: schema.reputationRuns.scoresUri,
    })
    .from(schema.reputationScores)
    .innerJoin(schema.reputationRuns, eq(schema.reputationRuns.id, schema.reputationScores.runId))
    .where(eq(schema.reputationScores.subject, userId))
    .orderBy(desc(schema.reputationRuns.computedAt));
  const files = await db
    .select({ id: schema.evidenceFiles.id, sha256: schema.evidenceFiles.sha256, deletedAt: schema.evidenceFiles.deletedAt })
    .from(schema.evidenceFiles)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.evidenceFiles.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .where(and(eq(schema.claims.userId, userId)));

  return {
    exported_at: new Date().toISOString(),
    user: {
      id: userId,
      email: u?.email ?? "",
      name: u?.name ?? null,
      wallet_address: u?.walletAddress ?? null,
      passport_score: u?.passportScore === null || u?.passportScore === undefined ? null : Number(u.passportScore),
      passport_checked_at: u?.passportCheckedAt?.toISOString() ?? null,
    },
    claims: claims.map((c) => ({
      bounty_id: c.bountyId,
      bounty_title: c.title,
      entity: c.entityId,
      claimed_at: c.claimedAt?.toISOString() ?? null,
      released_at: c.releasedAt?.toISOString() ?? null,
      cap_usdc: c.cap,
    })),
    submissions: submissions.map((s) => ({ id: s.id, bounty_id: s.bountyId, submitted_at: s.submittedAt?.toISOString() ?? null, evidence_summary: s.summary })),
    attestations: attestations.map((a) => ({ uid: a.uid, outcome: a.outcome, entity: a.entityId, attested_at: a.attestedAt?.toISOString() ?? null, audit_of: a.auditOf })),
    reputation: reputation.map((r) => ({
      run_id: r.runId,
      entity_id: r.entityId,
      n: r.n,
      p: r.p,
      score: r.score,
      passport_ok: r.passportOk,
      computed_at: r.computedAt?.toISOString() ?? null,
      scores_uri: r.scoresUri,
    })),
    evidence_files: files.map((f) => ({ id: f.id, sha256: f.sha256, deleted_at: f.deletedAt?.toISOString() ?? null })),
    note: "Reputation is a public function (reputation/v1) over the attestation UIDs listed here; anyone can recompute it. Chats are not included: they are deleted after 90 days and can be deleted now from /me.",
  };
}
