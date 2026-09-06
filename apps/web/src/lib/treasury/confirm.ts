/**
 * A guardian's EIP-712 signature over the SafeTx hash → the Transaction
 * Service (`confirmTransaction`) → `safe_proposals.confirmations`. The service
 * itself rejects non-owner signatures; we only check the signature is a
 * well-formed EIP-712 signature for this hash and record who signed.
 */
import { eq } from "drizzle-orm";
import { getConfirmations } from "@kami/chain";
import { isHex, recoverTypedDataAddress, type Address, type Hex } from "viem";
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import type { TreasuryDeps } from "./deps";
import { payoutSafeTransactionData, safeTransactionDataFromPending, safeTypedDataFor } from "./safe-typed-data";

export type ConfirmResult =
  | { ok: true; safe_tx_hash: Hex; signer: Address; confirmations: number; required: number }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422 | 502; code: string; message: string };

export async function loadProposal(db: Db, safeTxHash: string) {
  const [row] = await db
    .select({ proposal: schema.safeProposals, entity: schema.entities })
    .from(schema.safeProposals)
    .innerJoin(schema.entities, eq(schema.entities.id, schema.safeProposals.entityId))
    .where(eq(schema.safeProposals.safeTxHash, safeTxHash))
    .limit(1);
  return row ?? null;
}

/** Typed data for a pending proposal: from the Tx Service when reachable, else rebuilt from the row. */
export async function typedDataForProposal(deps: TreasuryDeps, row: NonNullable<Awaited<ReturnType<typeof loadProposal>>>) {
  const safeAddress = row.entity.safeAddress as Address;
  const chainId = row.entity.chainId ?? deps.chain.chainId;
  let source: "tx_service" | "db" = "db";
  let tx = null as ReturnType<typeof payoutSafeTransactionData> | null;
  let confirmations = row.proposal.confirmations;
  let required = 2;
  try {
    const c = await getConfirmations({ apiKit: deps.apiKit(), safeTxHash: row.proposal.safeTxHash as Hex });
    tx = safeTransactionDataFromPending(c.tx);
    confirmations = c.count;
    required = c.required;
    source = "tx_service";
  } catch {
    if (row.proposal.toAddress && row.proposal.amountUsdc && row.proposal.nonce !== null) {
      const { parseUnits } = await import("viem");
      tx = payoutSafeTransactionData({
        usdc: deps.chain.usdc.address,
        to: row.proposal.toAddress as Address,
        amountUsdc6: parseUnits(row.proposal.amountUsdc, 6),
        nonce: row.proposal.nonce,
      });
    }
  }
  if (!tx) return null;
  return { typed: safeTypedDataFor({ chainId, safeAddress, tx }), confirmations, required, source, chainId, safeAddress };
}

export async function confirmProposal(
  db: Db,
  deps: TreasuryDeps,
  input: { safeTxHash: string; signature: string; userId: string; isGuardian: (entityId: string) => Promise<boolean> },
): Promise<ConfirmResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.safeTxHash)) return { ok: false, status: 400, code: "bad_hash", message: "safe_tx_hash must be bytes32" };
  if (!isHex(input.signature) || input.signature.length !== 132) return { ok: false, status: 400, code: "bad_signature", message: "signature must be 65 bytes hex" };
  const row = await loadProposal(db, input.safeTxHash);
  if (!row) return { ok: false, status: 404, code: "not_found", message: "no such proposal" };
  if (!(await input.isGuardian(row.entity.id))) return { ok: false, status: 403, code: "forbidden", message: "guardians only" };
  if (row.proposal.status !== "pending") return { ok: false, status: 409, code: "not_pending", message: `proposal is ${row.proposal.status}` };

  const td = await typedDataForProposal(deps, row);
  if (!td) return { ok: false, status: 502, code: "tx_service_unavailable", message: "cannot rebuild the SafeTx to verify the signature" };
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({ ...td.typed, signature: input.signature as Hex });
  } catch {
    return { ok: false, status: 422, code: "bad_signature", message: "signature does not recover for this SafeTx" };
  }

  try {
    await deps.apiKit().confirmTransaction(input.safeTxHash, input.signature);
  } catch (err) {
    return { ok: false, status: 502, code: "tx_service_rejected", message: (err as Error).message.slice(0, 200) };
  }

  let confirmations = td.confirmations + 1;
  let required = td.required;
  try {
    const c = await getConfirmations({ apiKit: deps.apiKit(), safeTxHash: input.safeTxHash as Hex });
    confirmations = c.count;
    required = c.required;
  } catch {
    /* keep the optimistic count */
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.safeProposals).set({ confirmations }).where(eq(schema.safeProposals.safeTxHash, input.safeTxHash));
    await appendEntityEvent(tx, {
      entity_id: row.entity.id,
      actor: input.userId,
      kind: "treasury.confirmed",
      payload: { safe_tx_hash: input.safeTxHash, signer, confirmations, required },
      at: deps.now(),
    });
  });

  return { ok: true, safe_tx_hash: input.safeTxHash as Hex, signer, confirmations, required };
}
