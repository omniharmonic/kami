/**
 * Safe transaction helpers for the signing service (architecture §7.3):
 *
 *   buildUsdcTransferTx   → the one MetaTransaction the agent may ever propose
 *   proposeTransaction    → proposer (delegate) signs the SafeTx hash, api-kit stores it
 *   getConfirmations      → how many owners have signed vs the threshold
 *   executeWithRelayer    → REFUSES below threshold; otherwise the relayer pays gas
 *   listPendingTransactions / listIncomingTransfers (*verify* #7: endpoint shape)
 *
 * The Transaction Service at api.safe.global requires an API key (api-kit 5):
 * pass `SAFE_API_KEY` (env) — https://developer.safe.global.
 */
import SafeApiKit from "@safe-global/api-kit";
import {
  type Address,
  type Hex,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  keccak256,
  parseAbi,
  toBytes,
} from "viem";
import type { ChainAddresses } from "./addresses.js";
import type { ChainAccount } from "./signer.js";

export const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const SAFE_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function enableModule(address module)",
  "function nonce() view returns (uint256)",
]);

export enum OperationType {
  Call = 0,
  DelegateCall = 1,
}

export interface MetaTransactionData {
  to: Address;
  value: string;
  data: Hex;
  operation?: OperationType;
}

export interface SafeTransactionData extends MetaTransactionData {
  operation: OperationType;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: number;
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";

export function buildUsdcTransferTx(usdc: Address, to: Address, amountUsdc6: bigint): MetaTransactionData {
  if (amountUsdc6 <= 0n) throw new Error("buildUsdcTransferTx: amount must be positive (USDC has 6 decimals)");
  return {
    to: getAddress(usdc),
    value: "0",
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [getAddress(to), amountUsdc6] }),
    operation: OperationType.Call,
  };
}

export function toSafeTransactionData(tx: MetaTransactionData, nonce: number): SafeTransactionData {
  return {
    to: getAddress(tx.to),
    value: tx.value,
    data: tx.data,
    operation: tx.operation ?? OperationType.Call,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ZERO,
    refundReceiver: ZERO,
    nonce,
  };
}

/** Safe's `SafeTx` EIP-712 struct (Safe ≥ 1.3.0 domain: chainId + verifyingContract). */
export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const SAFE_TX_TYPEHASH = keccak256(
  toBytes("SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"),
);

export function safeTxTypedData({ chainId, safeAddress, tx }: { chainId: number; safeAddress: Address; tx: SafeTransactionData }) {
  return {
    domain: { chainId, verifyingContract: getAddress(safeAddress) },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx" as const,
    message: {
      to: getAddress(tx.to),
      value: BigInt(tx.value),
      data: tx.data,
      operation: tx.operation,
      safeTxGas: BigInt(tx.safeTxGas),
      baseGas: BigInt(tx.baseGas),
      gasPrice: BigInt(tx.gasPrice),
      gasToken: getAddress(tx.gasToken),
      refundReceiver: getAddress(tx.refundReceiver),
      nonce: BigInt(tx.nonce),
    },
  };
}

export function computeSafeTxHash(args: { chainId: number; safeAddress: Address; tx: SafeTransactionData }): Hex {
  return hashTypedData(safeTxTypedData(args));
}

/** api-kit surface the helpers touch (so tests can fake it). */
export interface ConfirmationLike {
  owner: string;
  signature: string;
}
export interface MultisigTxLike {
  safeTxHash: string;
  safe: string;
  to: string;
  value: string;
  data?: string | null;
  operation: number;
  safeTxGas: number | string;
  baseGas: number | string;
  gasPrice: string;
  gasToken: string;
  refundReceiver?: string | null;
  nonce: number | string;
  confirmationsRequired: number;
  confirmations?: ConfirmationLike[];
  isExecuted: boolean;
  transactionHash?: string | null;
}
export interface ApiKitLike {
  getNextNonce(safeAddress: string): Promise<string | number>;
  proposeTransaction(p: { safeAddress: string; safeTransactionData: SafeTransactionData; safeTxHash: string; senderAddress: string; senderSignature: string; origin?: string }): Promise<void>;
  getTransaction(safeTxHash: string): Promise<MultisigTxLike>;
  getPendingTransactions(safeAddress: string): Promise<{ results: MultisigTxLike[] }>;
  getIncomingTransactions(safeAddress: string): Promise<{ results: unknown[] }>;
}

export function apiKitFor(chain: ChainAddresses, apiKey: string | undefined = process.env.SAFE_API_KEY): SafeApiKit {
  return new SafeApiKit({ chainId: BigInt(chain.chainId), ...(apiKey ? { apiKey } : {}) });
}

/** Proposer signs the SafeTx hash (EIP-712) and the Transaction Service stores it as pending. Nothing is executed. */
export async function proposeTransaction({
  apiKit,
  chainId,
  safeAddress,
  tx,
  proposer,
  nonce,
  origin = "kami",
  dryRun = false,
  log = () => {},
}: {
  apiKit: Pick<ApiKitLike, "getNextNonce" | "proposeTransaction">;
  chainId: number;
  safeAddress: Address;
  tx: MetaTransactionData;
  proposer: ChainAccount;
  nonce?: number;
  origin?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<{ safeTxHash: Hex; nonce: number; safeTransactionData: SafeTransactionData }> {
  const n = nonce ?? Number(await apiKit.getNextNonce(safeAddress));
  const safeTransactionData = toSafeTransactionData(tx, n);
  const typed = safeTxTypedData({ chainId, safeAddress, tx: safeTransactionData });
  const safeTxHash = hashTypedData(typed);
  log(`propose safeTxHash=${safeTxHash} nonce=${n} to=${tx.to} data=${tx.data.slice(0, 10)}… by ${proposer.address}`);
  if (dryRun) return { safeTxHash, nonce: n, safeTransactionData };
  const senderSignature = await proposer.signTypedData(typed);
  await apiKit.proposeTransaction({ safeAddress, safeTransactionData, safeTxHash, senderAddress: proposer.address, senderSignature, origin });
  return { safeTxHash, nonce: n, safeTransactionData };
}

export async function getConfirmations({ apiKit, safeTxHash }: { apiKit: Pick<ApiKitLike, "getTransaction">; safeTxHash: Hex }) {
  const t = await apiKit.getTransaction(safeTxHash);
  const confirmations = (t.confirmations ?? []).map((c) => ({ owner: getAddress(c.owner), signature: c.signature as Hex }));
  return { count: confirmations.length, required: t.confirmationsRequired, confirmations, isExecuted: t.isExecuted, tx: t };
}

/** Owner signatures concatenated in ascending owner-address order, as `execTransaction` requires. */
export function packSignatures(confirmations: readonly { owner: Address; signature: Hex }[]): Hex {
  const sorted = [...confirmations].sort((a, b) => (a.owner.toLowerCase() < b.owner.toLowerCase() ? -1 : 1));
  return `0x${sorted.map((c) => c.signature.slice(2)).join("")}`;
}

export function encodeExecTransaction(t: MultisigTxLike, signatures: Hex): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [
      getAddress(t.to),
      BigInt(t.value),
      (t.data ?? "0x") as Hex,
      t.operation,
      BigInt(t.safeTxGas),
      BigInt(t.baseGas),
      BigInt(t.gasPrice),
      getAddress(t.gasToken || ZERO),
      getAddress(t.refundReceiver || ZERO),
      signatures,
    ],
  });
}

export class InsufficientConfirmations extends Error {
  constructor(readonly count: number, readonly required: number) {
    super(`refusing to execute: ${count} of ${required} required confirmations`);
  }
}

/**
 * Relayer execution. Refuses unless the Transaction Service shows
 * confirmations ≥ threshold; the relayer only pays gas and cannot add a signature.
 */
export async function executeWithRelayer({
  apiKit,
  safeTxHash,
  relayerSend,
  dryRun = false,
  log = () => {},
}: {
  apiKit: Pick<ApiKitLike, "getTransaction">;
  safeTxHash: Hex;
  /** sends `{to: safe, data: execTransaction(...)}` from the relayer key and returns the tx hash */
  relayerSend: (tx: { to: Address; data: Hex }) => Promise<Hex>;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<{ txHash: Hex | null; count: number; required: number }> {
  const { count, required, confirmations, isExecuted, tx } = await getConfirmations({ apiKit, safeTxHash });
  if (isExecuted) throw new Error(`safeTx ${safeTxHash} is already executed (${tx.transactionHash ?? "?"})`);
  if (count < required) throw new InsufficientConfirmations(count, required);
  const data = encodeExecTransaction(tx, packSignatures(confirmations));
  log(`execTransaction on ${tx.safe} for ${safeTxHash} with ${count}/${required} signatures`);
  if (dryRun) return { txHash: null, count, required };
  const txHash = await relayerSend({ to: getAddress(tx.safe), data });
  return { txHash, count, required };
}

export async function listPendingTransactions({ apiKit, safeAddress }: { apiKit: Pick<ApiKitLike, "getPendingTransactions">; safeAddress: Address }) {
  const r = await apiKit.getPendingTransactions(safeAddress);
  return r.results.map((t) => ({
    safeTxHash: t.safeTxHash as Hex,
    to: getAddress(t.to),
    value: t.value,
    data: (t.data ?? "0x") as Hex,
    nonce: Number(t.nonce),
    confirmations: (t.confirmations ?? []).length,
    required: t.confirmationsRequired,
  }));
}

/** Incoming ERC-20/ETH transfers as the Transaction Service reports them (*verify* #7: `/incoming-transfers/`). */
export async function listIncomingTransfers({ apiKit, safeAddress }: { apiKit: Pick<ApiKitLike, "getIncomingTransactions">; safeAddress: Address }) {
  const r = await apiKit.getIncomingTransactions(safeAddress);
  return r.results;
}
