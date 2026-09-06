/**
 * Data + gate for `/guardian/proposals/[hash]`: the one screen where a
 * guardian sees bounty, evidence, evaluation, attestation, amount, recipient,
 * Safe and nonce, and signs. The gate is a pure function of (user, role) so
 * the test can exercise it without a Next request context.
 */
import { asc, eq } from "drizzle-orm";
import type { Address } from "viem";
import type { Db } from "@/db/events";
import * as schema from "@/db/schema";
import { AuthError, type SessionUser } from "@/lib/session";
import { auth as authCopy } from "@/copy";
import { bytes32 } from "@/lib/signing/validate";
import { loadProposal, typedDataForProposal } from "./confirm";
import type { TreasuryDeps } from "./deps";
import { safeTypedDataJson, safeWalletUrl } from "./safe-typed-data";

/** Throws `AuthError` 401 without a user, 403 without the guardian role (admins pass). */
export async function assertGuardian(
  user: SessionUser | null,
  entityId: string,
  hasRole: (userId: string, entityId: string, role: "guardian") => Promise<boolean>,
): Promise<SessionUser> {
  if (!user) throw new AuthError(401, authCopy.unauthenticated);
  if (user.platform_admin) return user;
  if (!(await hasRole(user.id, entityId, "guardian"))) throw new AuthError(403, authCopy.forbidden);
  return user;
}

export type EvidenceFileView = { id: string; mime: string | null; bytes: number | null; captured_at: string | null; in_app_capture: boolean; url: string | null; sha256: string };

export type ProposalPageView = {
  safe_tx_hash: string;
  status: string;
  nonce: number | null;
  amount_usdc: string | null;
  to: string | null;
  proposed_at: string | null;
  confirmations: number;
  required: number;
  entity: { id: string; slug: string; name: string; archetype: string; safe_address: string | null; chain_id: number };
  bounty: { id: string; title: string; deliverable_md: string; cap_usdc: string; verification_tier: number } | null;
  submission: { id: string; note_md: string | null; evidence_summary: unknown; submitted_at: string | null } | null;
  evidence: EvidenceFileView[];
  evaluation: { id: string; outcome: string; notes_md: string | null; evaluator: string | null; second_attestation_by: string | null; attested_at: string | null } | null;
  outcome_uid: string | null;
  recipient: { handle: string; address: string | null } | null;
  typed_data_json: string | null;
  typed_data_source: "tx_service" | "db" | null;
  safe_wallet_url: string | null;
};

export async function loadProposalView(db: Db, deps: TreasuryDeps, safeTxHash: string): Promise<ProposalPageView | null> {
  const row = await loadProposal(db, safeTxHash);
  if (!row) return null;
  const chainId = row.entity.chainId ?? deps.chain.chainId;

  const [ctx] = row.proposal.submissionId
    ? await db
        .select({ submission: schema.submissions, claim: schema.claims, bounty: schema.bounties, user: schema.users })
        .from(schema.submissions)
        .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
        .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
        .leftJoin(schema.users, eq(schema.users.id, schema.claims.userId))
        .where(eq(schema.submissions.id, row.proposal.submissionId))
        .limit(1)
    : [];

  const files = ctx
    ? await db.select().from(schema.evidenceFiles).where(eq(schema.evidenceFiles.submissionId, ctx.submission.id)).orderBy(asc(schema.evidenceFiles.capturedAt))
    : [];
  const [evaluation] = ctx
    ? await db.select({ e: schema.evaluations, evaluator: schema.users.name }).from(schema.evaluations).leftJoin(schema.users, eq(schema.users.id, schema.evaluations.evaluatorId)).where(eq(schema.evaluations.submissionId, ctx.submission.id)).orderBy(asc(schema.evaluations.createdAt)).limit(1)
    : [];

  let typed: Awaited<ReturnType<typeof typedDataForProposal>> = null;
  if (row.proposal.status === "pending" && row.entity.safeAddress) typed = await typedDataForProposal(deps, row);

  const evidenceBase = deps.env.KAMI_EVIDENCE_BASE_URL?.replace(/\/$/, "");
  const offchainUid = evaluation ? bytes32((evaluation.e.offchainAttestation as { uid?: unknown } | null)?.uid) : null;
  return {
    safe_tx_hash: row.proposal.safeTxHash,
    status: row.proposal.status,
    nonce: row.proposal.nonce,
    amount_usdc: row.proposal.amountUsdc,
    to: row.proposal.toAddress,
    proposed_at: row.proposal.proposedAt?.toISOString() ?? null,
    confirmations: typed?.confirmations ?? row.proposal.confirmations,
    required: typed?.required ?? 2,
    entity: { id: row.entity.id, slug: row.entity.slug, name: row.entity.name, archetype: row.entity.archetype, safe_address: row.entity.safeAddress, chain_id: chainId },
    bounty: ctx ? { id: ctx.bounty.id, title: ctx.bounty.title, deliverable_md: ctx.bounty.deliverableMd, cap_usdc: ctx.bounty.capUsdc, verification_tier: ctx.bounty.verificationTier } : null,
    submission: ctx ? { id: ctx.submission.id, note_md: ctx.submission.noteMd, evidence_summary: ctx.submission.evidenceSummary, submitted_at: ctx.submission.submittedAt?.toISOString() ?? null } : null,
    evidence: files
      .filter((f) => !f.deletedAt)
      .map((f) => ({
        id: f.id,
        mime: f.mime,
        bytes: f.bytes,
        captured_at: f.capturedAt?.toISOString() ?? null,
        in_app_capture: f.inAppCapture,
        url: evidenceBase ? `${evidenceBase}/${f.r2Key}` : null,
        sha256: f.sha256,
      })),
    evaluation: evaluation
      ? { id: evaluation.e.id, outcome: evaluation.e.outcome, notes_md: evaluation.e.notesMd, evaluator: evaluation.evaluator, second_attestation_by: evaluation.e.secondAttestationBy, attested_at: evaluation.e.attestedAt?.toISOString() ?? null }
      : null,
    outcome_uid: evaluation ? (bytes32(evaluation.e.easUid) ?? offchainUid) : null,
    recipient: ctx ? { handle: ctx.user?.name ?? ctx.user?.email.split("@")[0] ?? "someone", address: ctx.user?.walletAddress ?? row.proposal.toAddress } : null,
    typed_data_json: typed ? safeTypedDataJson(typed.typed) : null,
    typed_data_source: typed?.source ?? null,
    safe_wallet_url: row.entity.safeAddress ? safeWalletUrl(chainId, row.entity.safeAddress as Address, row.proposal.safeTxHash as `0x${string}`) : null,
  };
}
