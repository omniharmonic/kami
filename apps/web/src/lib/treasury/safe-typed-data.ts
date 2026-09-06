/**
 * The Safe `SafeTx` EIP-712 payload a guardian signs (Safe ≥ 1.3.0 / 1.4.1
 * domain `{chainId, verifyingContract}`), built server-side from the pending
 * transaction the Transaction Service holds — or rebuilt deterministically from
 * the `safe_proposals` row when the service is unreachable. `safeTxHashManual`
 * derives the same hash by hand (typehashes + abi.encode) so the test can
 * cross-check viem's `hashTypedData` against an independent computation.
 */
import {
  concat,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import {
  SAFE_TX_TYPEHASH,
  buildUsdcTransferTx,
  safeTxTypedData,
  toSafeTransactionData,
  type MultisigTxLike,
  type SafeTransactionData,
} from "@kami/chain";
import { jsonTypedData } from "@/lib/signing/kms";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

/** `keccak256("EIP712Domain(uint256 chainId,address verifyingContract)")` — Safe's domain since 1.3.0. */
export const SAFE_DOMAIN_SEPARATOR_TYPEHASH = keccak256(toBytes("EIP712Domain(uint256 chainId,address verifyingContract)"));

export type SafeTypedData = ReturnType<typeof safeTxTypedData>;

/** From the Transaction Service's multisig-transaction record. */
export function safeTransactionDataFromPending(t: MultisigTxLike): SafeTransactionData {
  return {
    to: getAddress(t.to),
    value: String(t.value),
    data: (t.data ?? "0x") as Hex,
    operation: t.operation,
    safeTxGas: String(t.safeTxGas),
    baseGas: String(t.baseGas),
    gasPrice: String(t.gasPrice),
    gasToken: getAddress(t.gasToken || ZERO),
    refundReceiver: getAddress(t.refundReceiver || ZERO),
    nonce: Number(t.nonce),
  };
}

/** Rebuilt from what we stored: the only tx the agent may ever propose is `USDC.transfer(to, amount)`. */
export function payoutSafeTransactionData(args: { usdc: Address; to: Address; amountUsdc6: bigint; nonce: number }): SafeTransactionData {
  return toSafeTransactionData(buildUsdcTransferTx(args.usdc, args.to, args.amountUsdc6), args.nonce);
}

export function safeTypedDataFor(args: { chainId: number; safeAddress: Address; tx: SafeTransactionData }): SafeTypedData {
  return safeTxTypedData(args);
}

/** Hash viem-side (what `proposeTransaction` stored as `safeTxHash`). */
export function safeTxHashOf(typed: SafeTypedData): Hex {
  return hashTypedData(typed);
}

/** The same hash by hand: keccak256(0x19 0x01 ‖ domainSeparator ‖ structHash). */
export function safeTxHashManual(args: { chainId: number; safeAddress: Address; tx: SafeTransactionData }): Hex {
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [SAFE_DOMAIN_SEPARATOR_TYPEHASH, BigInt(args.chainId), getAddress(args.safeAddress)],
    ),
  );
  const t = args.tx;
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
      ],
      [
        SAFE_TX_TYPEHASH,
        getAddress(t.to),
        BigInt(t.value),
        keccak256(t.data),
        t.operation,
        BigInt(t.safeTxGas),
        BigInt(t.baseGas),
        BigInt(t.gasPrice),
        getAddress(t.gasToken),
        getAddress(t.refundReceiver),
        BigInt(t.nonce),
      ],
    ),
  );
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

/**
 * What the browser hands to `eth_signTypedData_v4` (and what Privy's
 * `signTypedData` takes): JSON with an explicit `EIP712Domain` and decimal
 * strings for every uint.
 */
export function safeTypedDataJson(typed: SafeTypedData): string {
  return JSON.stringify(jsonTypedData(typed as unknown as Parameters<typeof jsonTypedData>[0]));
}

/** Safe{Wallet} deep link for the escape hatch (chain prefixes per safe.global). */
export function safeWalletUrl(chainId: number, safeAddress: Address, safeTxHash?: Hex): string {
  const prefix = chainId === 8453 ? "base" : chainId === 84532 ? "basesep" : `eip155-${chainId}`;
  const safe = `${prefix}:${getAddress(safeAddress)}`;
  return safeTxHash
    ? `https://app.safe.global/transactions/tx?safe=${safe}&id=multisig_${getAddress(safeAddress)}_${safeTxHash}`
    : `https://app.safe.global/transactions/queue?safe=${safe}`;
}
