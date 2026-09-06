/**
 * The Transaction Service has no webhooks (*verify* #7), so every minute while
 * anything is pending: read confirmations; at ≥ threshold let the relayer
 * execute; on mined → `payouts` row, `BountyCompleted` onchain, bounty `paid`,
 * `entity_events`, recipient notified (architecture §7.3). Below the relayer
 * float nothing executes and `config.alerts.relayer_low` is written. Proposals
 * older than 14 days are *not* expired here — reconciliation flags them and a
 * human decides.
 */
import { and, eq } from "drizzle-orm";
import { getConfirmations, EAS_SCHEMA_UIDS, entityIdOf, type SchemaItem } from "@kami/chain";
import { getAddress, keccak256, parseAbi, parseUnits, stringToBytes, type Address, type Hex } from "viem";
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { deleteConfig, getConfig, setConfig } from "@/lib/jobs/common";
import { attest } from "@/lib/signing/attester";
import { checkRelayerFloat, executeConfirmed, InsufficientConfirmations } from "@/lib/signing/relayer";
import { bytes32 } from "@/lib/signing/validate";
import { treasuryCopy } from "./copy";
import type { TreasuryDeps } from "./deps";
import { emailForUser, stewardEmails } from "./notify";

export const SAFE_THRESHOLD_ABI = parseAbi(["function getThreshold() view returns (uint256)"]);
export const STALE_PROPOSAL_DAYS = 14;
export const DEFAULT_THRESHOLD = 2;

export type PollResult = {
  checked: number;
  executed: Array<{ safe_tx_hash: string; tx_hash: string; payout_id: string; eas_uid: string | null }>;
  skipped: Array<{ safe_tx_hash: string; reason: string; confirmations?: number; required?: number }>;
  errors: Array<{ safe_tx_hash: string; message: string }>;
  relayer: { ok: boolean; balance_eth: string } | null;
};

export async function readThreshold(deps: TreasuryDeps, safeAddress: Address, fallback: number): Promise<number> {
  try {
    const t = (await deps.publicClient().readContract({ address: safeAddress, abi: SAFE_THRESHOLD_ABI, functionName: "getThreshold" })) as bigint;
    const n = Number(t);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
  } catch {
    return fallback;
  }
}

type PendingRow = { proposal: typeof schema.safeProposals.$inferSelect; entity: typeof schema.entities.$inferSelect };

export async function runSafePoll(db: Db, deps: TreasuryDeps, opts: { slug?: string } = {}): Promise<PollResult> {
  const result: PollResult = { checked: 0, executed: [], skipped: [], errors: [], relayer: null };
  const rows: PendingRow[] = await db
    .select({ proposal: schema.safeProposals, entity: schema.entities })
    .from(schema.safeProposals)
    .innerJoin(schema.entities, eq(schema.entities.id, schema.safeProposals.entityId))
    .where(eq(schema.safeProposals.status, "pending"))
    .orderBy(schema.safeProposals.proposedAt);
  const pending = opts.slug ? rows.filter((r) => r.entity.slug === opts.slug) : rows;
  result.checked = pending.length;
  if (pending.length === 0) return result;

  const float = await checkRelayerFloat(deps);
  result.relayer = { ok: float.ok, balance_eth: float.balanceEth };
  if (!float.ok) {
    const prev = await getConfig<{ at: string }>(db, "alerts.relayer_low");
    await setConfig(db, "alerts.relayer_low", { at: deps.now().toISOString(), balance_eth: float.balanceEth, address: float.address, reason: float.reason }, deps.now());
    if (!prev) {
      try {
        const to = await stewardEmails(db, pending[0]!.entity.id);
        await deps.notify.send({ to, subject: treasuryCopy.mail.relayerLowSubject, text: treasuryCopy.mail.relayerLowBody(float.balanceEth, float.address) });
      } catch (err) {
        deps.log(`relayer-low alert failed: ${(err as Error).message}`);
      }
    }
  } else {
    await deleteConfig(db, "alerts.relayer_low");
  }

  for (const row of pending) {
    const hash = row.proposal.safeTxHash as Hex;
    try {
      const c = await getConfirmations({ apiKit: deps.apiKit(), safeTxHash: hash });
      if (c.count !== row.proposal.confirmations) {
        await db.update(schema.safeProposals).set({ confirmations: c.count }).where(eq(schema.safeProposals.safeTxHash, hash));
      }
      if (c.isExecuted && c.tx.transactionHash) {
        // Executed elsewhere (Safe{Wallet}); finalise from the service's record.
        const fin = await finalizeExecuted(db, deps, row, c.tx.transactionHash as Hex, "safe_wallet");
        result.executed.push(fin);
        continue;
      }
      const safeAddress = getAddress(row.entity.safeAddress as Address);
      const threshold = await readThreshold(deps, safeAddress, c.required || DEFAULT_THRESHOLD);
      if (c.count < threshold) {
        const ageDays = row.proposal.proposedAt ? (deps.now().getTime() - row.proposal.proposedAt.getTime()) / 86_400_000 : 0;
        result.skipped.push({ safe_tx_hash: hash, reason: ageDays > STALE_PROPOSAL_DAYS ? "awaiting_signatures_stale" : "awaiting_signatures", confirmations: c.count, required: threshold });
        continue;
      }
      if (!float.ok) {
        result.skipped.push({ safe_tx_hash: hash, reason: "relayer_low", confirmations: c.count, required: threshold });
        continue;
      }
      const ex = await executeConfirmed(deps, hash);
      if (ex.status !== "success") {
        await appendEntityEvent(db, { entity_id: row.entity.id, actor: "relayer", kind: "treasury.execution_reverted", payload: { safe_tx_hash: hash, tx_hash: ex.txHash }, at: deps.now() });
        result.errors.push({ safe_tx_hash: hash, message: `execution reverted in ${ex.txHash}` });
        continue;
      }
      result.executed.push(await finalizeExecuted(db, deps, row, ex.txHash, "relayer"));
    } catch (err) {
      if (err instanceof InsufficientConfirmations) {
        result.skipped.push({ safe_tx_hash: hash, reason: "awaiting_signatures", confirmations: err.count, required: err.required });
      } else {
        result.errors.push({ safe_tx_hash: hash, message: (err as Error).message.slice(0, 200) });
      }
    }
  }
  return result;
}

/** bountyHash for `BountyCompleted`: the spec sha256 when it is a bytes32, else a keccak of the id (logged). */
export function bountyHashFor(bounty: { id: string; specSha256: string }, log: (l: string) => void = () => {}): Hex {
  const h = bytes32(bounty.specSha256);
  if (h) return h;
  log(`bounty ${bounty.id} spec_sha256 is not bytes32; using keccak256(id)`);
  return keccak256(stringToBytes(bounty.id));
}

async function finalizeExecuted(db: Db, deps: TreasuryDeps, row: PendingRow, txHash: Hex, via: "relayer" | "safe_wallet") {
  const hash = row.proposal.safeTxHash as Hex;
  const now = deps.now();
  const [ctx] = row.proposal.submissionId
    ? await db
        .select({ submission: schema.submissions, claim: schema.claims, bounty: schema.bounties })
        .from(schema.submissions)
        .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
        .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
        .where(eq(schema.submissions.id, row.proposal.submissionId))
        .limit(1)
    : [];
  const payoutId = `pay_${hash.slice(2, 26)}`;
  const amount = row.proposal.amountUsdc ?? "0.00";

  await db.transaction(async (tx) => {
    await tx.update(schema.safeProposals).set({ status: "executed", executedTxHash: txHash }).where(and(eq(schema.safeProposals.safeTxHash, hash), eq(schema.safeProposals.status, "pending")));
    await tx
      .insert(schema.payouts)
      .values({
        id: payoutId,
        submissionId: row.proposal.submissionId,
        rail: "usdc_safe",
        amountUsdc: amount,
        usdValueAtPayment: amount,
        safeTxHash: hash,
        txHash,
        executedAt: now,
        recipientAddress: row.proposal.toAddress,
        recipientUserId: ctx?.claim.userId ?? null,
      })
      .onConflictDoNothing();
    if (ctx) await tx.update(schema.bounties).set({ status: "paid" }).where(eq(schema.bounties.id, ctx.bounty.id));
    await appendEntityEvent(tx, {
      entity_id: row.entity.id,
      actor: via,
      kind: "treasury.executed",
      payload: { safe_tx_hash: hash, tx_hash: txHash, payout_id: payoutId, amount_usdc: amount, to: row.proposal.toAddress, bounty_id: ctx?.bounty.id ?? null },
      at: now,
    });
  });

  let easUid: Hex | null = null;
  if (ctx && row.proposal.toAddress) {
    try {
      const data: SchemaItem[] = [
        { name: "entityId", value: entityIdOf(row.entity.slug), type: "bytes32" },
        { name: "bountyHash", value: bountyHashFor(ctx.bounty, deps.log), type: "bytes32" },
        { name: "recipient", value: getAddress(row.proposal.toAddress), type: "address" },
        { name: "amountUSDC", value: parseUnits(amount, 6), type: "uint256" },
        { name: "safeTxHash", value: hash, type: "bytes32" },
        { name: "evidenceURI", value: `kami:submission/${ctx.submission.id}`, type: "string" },
      ];
      const refUID = bytes32(ctx.bounty.easUidPosted) ?? undefined;
      const a = await attest(deps, { schemaName: "BountyCompleted", data, ...(refUID ? { refUID } : {}), recipient: getAddress(row.proposal.toAddress) });
      easUid = a.uid;
      const attester = await (await deps.backend()).getAddress("attester");
      await db.transaction(async (tx) => {
        await tx
          .insert(schema.attestations)
          .values({
            uid: a.uid,
            schema: "BountyCompleted",
            mode: "onchain",
            attester,
            entityId: row.entity.id,
            refUid: refUID ?? null,
            payload: { schema_uid: EAS_SCHEMA_UIDS.BountyCompleted, safe_tx_hash: hash, tx_hash: txHash, amount_usdc: amount, recipient: row.proposal.toAddress, bounty_id: ctx.bounty.id, submission_id: ctx.submission.id },
            createdAt: now,
          })
          .onConflictDoNothing();
        await tx.update(schema.payouts).set({ easUidCompleted: a.uid }).where(eq(schema.payouts.id, payoutId));
        await appendEntityEvent(tx, { entity_id: row.entity.id, actor: "attester", kind: "attestation.bounty_completed", payload: { uid: a.uid, payout_id: payoutId, safe_tx_hash: hash }, at: now });
      });
    } catch (err) {
      deps.log(`BountyCompleted attestation failed for ${hash}: ${(err as Error).message} (reconciliation will flag payout_uid_missing)`);
    }
  }

  if (ctx?.claim.userId) {
    try {
      const email = await emailForUser(db, ctx.claim.userId);
      if (email) {
        await deps.notify.send({
          to: [email],
          subject: treasuryCopy.mail.paidSubject(row.entity.name, amount),
          text: treasuryCopy.mail.paidBody(row.entity.name, amount, ctx.bounty.title, txHash, easUid ?? "pending"),
        });
      }
    } catch (err) {
      deps.log(`recipient notification failed for ${hash}: ${(err as Error).message}`);
    }
  }
  return { safe_tx_hash: hash, tx_hash: txHash, payout_id: payoutId, eas_uid: easUid };
}
