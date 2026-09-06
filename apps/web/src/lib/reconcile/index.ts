/**
 * Nightly reconciliation per entity (architecture §7.7, plan T2.12):
 *   Σ chain-settled donations − Σ payouts  vs  on-chain USDC balance (±0.01)
 *   every payout has a mined tx and a BountyCompleted UID
 *   every evaluations.eas_uid resolves on EAS (GraphQL, *verify*; offline ⇒ `unverified`)
 *   Safe proposals > 14 d without threshold are flagged (a human expires them)
 *   the entity_events hash chain verifies
 * Writes `reconciliations {ok, findings}`; on a hard mismatch sets
 * `config.alerts.reconcile.<slug>` and `config.donor_report_blocked.<slug>`
 * and alerts a steward. The donor report (another package) must read that flag.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { formatUnits, type Hex } from "viem";
import type { Db } from "@/db/events";
import { appendEntityEvent, verifyEventChain } from "@/db/events";
import * as schema from "@/db/schema";
import { activeEntities, deleteConfig, setConfig } from "@/lib/jobs/common";
import { treasuryCopy } from "@/lib/treasury/copy";
import type { TreasuryDeps } from "@/lib/treasury/deps";
import { stewardEmails } from "@/lib/treasury/notify";
import { readSafeBalance } from "@/lib/treasury/reads";
import { STALE_PROPOSAL_DAYS } from "@/lib/treasury/safe-poll";

export const BALANCE_TOLERANCE_USDC = 0.01;

export type FindingKind =
  | "no_safe"
  | "balance_mismatch"
  | "balance_unverified"
  | "payout_tx_missing"
  | "payout_tx_unverified"
  | "payout_uid_missing"
  | "evaluation_uid_unresolved"
  | "evaluation_uid_unverified"
  | "proposal_stale"
  | "event_chain_broken";

export type Finding = { kind: FindingKind; severity: "error" | "warning" | "unverified"; detail: Record<string, unknown> };

export type ReconcileResult = {
  entity: string;
  ok: boolean;
  findings: Finding[];
  expected_usdc: string | null;
  onchain_usdc: string | null;
  reconciliation_id: number | null;
};

/** `attestation(where:{id})` on the EAS GraphQL API (*verify* endpoint/shape for Base, docs/verify.md #9). */
export async function easAttestationExists(deps: TreasuryDeps, uid: string): Promise<boolean | null> {
  const url = deps.env.EAS_GRAPHQL_URL;
  if (!url) return null;
  try {
    const r = await deps.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "query($id:String!){ attestation(where:{id:$id}){ id revoked } }", variables: { id: uid } }),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { data?: { attestation?: { id: string; revoked?: boolean } | null } };
    return Boolean(body.data?.attestation?.id);
  } catch {
    return null;
  }
}

export async function reconcileEntity(db: Db, deps: TreasuryDeps, entity: typeof schema.entities.$inferSelect): Promise<ReconcileResult> {
  const findings: Finding[] = [];
  const now = deps.now();

  // --- balance --------------------------------------------------------------
  let expected: number | null = null;
  let onchain: string | null = null;
  const [inflow] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.donations.net}), 0)` })
    .from(schema.donations)
    .where(and(eq(schema.donations.entityId, entity.id), isNotNull(schema.donations.chainTxHash)));
  const payoutRows = await db
    .select({ payout: schema.payouts })
    .from(schema.payouts)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.payouts.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .where(and(eq(schema.bounties.entityId, entity.id), inArray(schema.payouts.rail, ["usdc_safe", "usdc_roles"])));
  const outflow = payoutRows.reduce((s, r) => s + Number(r.payout.amountUsdc), 0);
  expected = Number(inflow?.total ?? 0) - outflow;

  if (!entity.safeAddress) {
    findings.push({ kind: "no_safe", severity: "warning", detail: { expected_usdc: expected.toFixed(2) } });
  } else {
    const bal = await readSafeBalance(deps, entity.safeAddress);
    if (bal.balance_usdc === null) {
      findings.push({ kind: "balance_unverified", severity: "unverified", detail: { reason: bal.reason, expected_usdc: expected.toFixed(2) } });
    } else {
      onchain = bal.balance_usdc;
      const diff = Number(bal.balance_usdc) - expected;
      if (Math.abs(diff) > BALANCE_TOLERANCE_USDC) {
        findings.push({ kind: "balance_mismatch", severity: "error", detail: { expected_usdc: expected.toFixed(2), onchain_usdc: bal.balance_usdc, diff_usdc: diff.toFixed(6) } });
      }
    }
  }

  // --- payouts: mined tx + BountyCompleted UID ------------------------------
  for (const { payout } of payoutRows) {
    if (!payout.txHash) {
      findings.push({ kind: "payout_tx_missing", severity: "error", detail: { payout_id: payout.id, safe_tx_hash: payout.safeTxHash } });
    } else {
      try {
        const rc = await deps.publicClient().getTransactionReceipt({ hash: payout.txHash as Hex });
        if (!rc || rc.status !== "success") findings.push({ kind: "payout_tx_missing", severity: "error", detail: { payout_id: payout.id, tx_hash: payout.txHash, status: rc?.status ?? "missing" } });
      } catch (err) {
        findings.push({ kind: "payout_tx_unverified", severity: "unverified", detail: { payout_id: payout.id, tx_hash: payout.txHash, error: (err as Error).message.slice(0, 120) } });
      }
    }
    if (!payout.easUidCompleted) findings.push({ kind: "payout_uid_missing", severity: "error", detail: { payout_id: payout.id, safe_tx_hash: payout.safeTxHash } });
  }

  // --- evaluations.eas_uid resolves on EAS ----------------------------------
  const evals = await db
    .select({ id: schema.evaluations.id, uid: schema.evaluations.easUid })
    .from(schema.evaluations)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.evaluations.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .where(and(eq(schema.bounties.entityId, entity.id), isNotNull(schema.evaluations.easUid)));
  for (const e of evals) {
    const exists = await easAttestationExists(deps, e.uid!);
    if (exists === null) findings.push({ kind: "evaluation_uid_unverified", severity: "unverified", detail: { evaluation_id: e.id, uid: e.uid } });
    else if (!exists) findings.push({ kind: "evaluation_uid_unresolved", severity: "error", detail: { evaluation_id: e.id, uid: e.uid } });
  }

  // --- stale proposals -------------------------------------------------------
  const pending = await db
    .select()
    .from(schema.safeProposals)
    .where(and(eq(schema.safeProposals.entityId, entity.id), eq(schema.safeProposals.status, "pending")));
  for (const p of pending) {
    const ageDays = p.proposedAt ? (now.getTime() - p.proposedAt.getTime()) / 86_400_000 : 0;
    if (ageDays > STALE_PROPOSAL_DAYS && p.confirmations < 2) {
      findings.push({ kind: "proposal_stale", severity: "warning", detail: { safe_tx_hash: p.safeTxHash, age_days: Math.floor(ageDays), confirmations: p.confirmations, nonce: p.nonce, amount_usdc: p.amountUsdc } });
    }
  }

  // --- audit chain -----------------------------------------------------------
  const chain = await verifyEventChain(db, entity.id);
  if (!chain.ok) findings.push({ kind: "event_chain_broken", severity: "error", detail: { broken_at: chain.broken_at, reason: chain.reason } });

  const ok = findings.every((f) => f.severity !== "error");
  const [rec] = await db
    .insert(schema.reconciliations)
    .values({ entityId: entity.id, at: now, ok, findings: { findings, expected_usdc: expected?.toFixed(2) ?? null, onchain_usdc: onchain, checked_at: now.toISOString() } })
    .returning({ id: schema.reconciliations.id });

  if (ok) {
    await setConfig(db, `donor_report_blocked.${entity.slug}`, false, now);
    await deleteConfig(db, `alerts.reconcile.${entity.slug}`);
  } else {
    await setConfig(db, `alerts.reconcile.${entity.slug}`, { at: now.toISOString(), reconciliation_id: rec?.id ?? null, findings: findings.filter((f) => f.severity === "error") }, now);
    await setConfig(db, `donor_report_blocked.${entity.slug}`, true, now);
    try {
      const to = await stewardEmails(db, entity.id);
      const summary = findings.map((f) => `- ${f.kind} (${f.severity}): ${JSON.stringify(f.detail)}`).join("\n");
      await deps.notify.send({ to, subject: treasuryCopy.mail.reconcileSubject(entity.name), text: treasuryCopy.mail.reconcileBody(entity.name, summary) });
    } catch (err) {
      deps.log(`steward alert failed for ${entity.slug}: ${(err as Error).message}`);
    }
  }
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: "reconcile",
    kind: "reconciliation.run",
    payload: { ok, findings: findings.length, errors: findings.filter((f) => f.severity === "error").length, reconciliation_id: rec?.id ?? null },
    at: now,
  });

  return { entity: entity.slug, ok, findings, expected_usdc: expected?.toFixed(2) ?? null, onchain_usdc: onchain, reconciliation_id: rec?.id ?? null };
}

export async function runReconcile(db: Db, deps: TreasuryDeps, opts: { slug?: string } = {}): Promise<ReconcileResult[]> {
  const entities = await activeEntities(db, opts.slug);
  const out: ReconcileResult[] = [];
  for (const e of entities) out.push(await reconcileEntity(db, deps, e));
  return out;
}

export function usdcFromRaw(raw: bigint): string {
  return formatUnits(raw, 6);
}
