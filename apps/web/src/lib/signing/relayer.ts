/**
 * The relayer role pays gas and nothing else (architecture §7.3–7.4). It can
 * only broadcast `execTransaction` calldata that already carries ≥ threshold
 * owner signatures — `executeWithRelayer` in `@kami/chain` refuses otherwise.
 * ETH float: below `RELAYER_MIN_ETH` (0.01) execution is skipped and
 * `config.alerts.relayer_low` is written by the poller.
 */
import { formatEther, type Address, type Hex } from "viem";
import { executeWithRelayer, InsufficientConfirmations } from "@kami/chain";
import type { TreasuryDeps } from "@/lib/treasury/deps";
import { relayerMinWei } from "@/lib/treasury/deps";

export { InsufficientConfirmations };

export async function relayerAddress(deps: TreasuryDeps): Promise<Address> {
  return (await deps.backend()).getAddress("relayer");
}

export type FloatCheck = { ok: boolean; address: Address; balanceWei: bigint | null; balanceEth: string; minWei: bigint; reason?: "rpc_unavailable" | "below_float" };

export async function checkRelayerFloat(deps: TreasuryDeps): Promise<FloatCheck> {
  const address = await relayerAddress(deps);
  const minWei = relayerMinWei(deps.env);
  try {
    const balanceWei = await deps.publicClient().getBalance({ address });
    const ok = balanceWei >= minWei;
    return { ok, address, balanceWei, balanceEth: formatEther(balanceWei), minWei, ...(ok ? {} : { reason: "below_float" as const }) };
  } catch {
    return { ok: false, address, balanceWei: null, balanceEth: "unknown", minWei, reason: "rpc_unavailable" };
  }
}

/** Execute a fully-confirmed Safe tx and wait for the receipt. Throws `InsufficientConfirmations` below threshold. */
export async function executeConfirmed(deps: TreasuryDeps, safeTxHash: Hex): Promise<{ txHash: Hex; count: number; required: number; status: "success" | "reverted" }> {
  const r = await executeWithRelayer({ apiKit: deps.apiKit(), safeTxHash, relayerSend: deps.relayerSend, log: deps.log });
  if (!r.txHash) throw new Error("relayer returned no tx hash");
  const receipt = await deps.publicClient().waitForTransactionReceipt({ hash: r.txHash, timeout: 120_000 });
  return { txHash: r.txHash, count: r.count, required: r.required, status: receipt.status === "success" ? "success" : "reverted" };
}
