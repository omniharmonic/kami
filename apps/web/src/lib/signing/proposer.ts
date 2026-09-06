/**
 * The proposer role: signs the SafeTx hash so the Transaction Service stores a
 * *pending* transaction (architecture §7.3). It is a delegate, not an owner —
 * nothing here can execute, and `@kami/chain`'s `proposeTransaction` never does.
 */
import type { Address, Hex } from "viem";
import { buildUsdcTransferTx, proposeTransaction, type MetaTransactionData, type SafeTransactionData } from "@kami/chain";
import { accountFor, proposerRole } from "./kms";
import type { TreasuryDeps } from "@/lib/treasury/deps";

export type Proposed = { safeTxHash: Hex; nonce: number; safeTransactionData: SafeTransactionData; proposer: Address };

export async function proposerAddress(deps: TreasuryDeps, slug: string): Promise<Address> {
  return (await deps.backend()).getAddress(proposerRole(slug));
}

/** USDC.transfer(recipient, amount) proposed by `proposer:<slug>`; returns the hash guardians will sign. */
export async function proposeUsdcPayout(
  deps: TreasuryDeps,
  args: { slug: string; safeAddress: Address; recipient: Address; amountUsdc6: bigint; nonce?: number },
): Promise<Proposed> {
  const tx: MetaTransactionData = buildUsdcTransferTx(deps.chain.usdc.address, args.recipient, args.amountUsdc6);
  const proposer = await accountFor(await deps.backend(), proposerRole(args.slug));
  const r = await proposeTransaction({
    apiKit: deps.apiKit(),
    chainId: deps.chain.chainId,
    safeAddress: args.safeAddress,
    tx,
    proposer,
    ...(args.nonce !== undefined ? { nonce: args.nonce } : {}),
    origin: "kami",
    log: deps.log,
  });
  return { ...r, proposer: proposer.address };
}
