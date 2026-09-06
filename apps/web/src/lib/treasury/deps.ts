/**
 * Everything in the money layer that touches a network, behind one injectable
 * object so tests pass fakes (no RPC, no Transaction Service, no EAS). The
 * real wiring is built lazily on first use and never at import time.
 */
import type { Address, Hex, TransactionReceipt } from "viem";
import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { apiKitFor, chainFromId, easFor, ethersSignerFor, type ApiKitLike, type ChainAddresses } from "@kami/chain";
import type { EAS } from "@ethereum-attestation-service/eas-sdk";
import { accountFor, getKeyBackend, type KeyBackend } from "@/lib/signing/kms";
import { signingEnv, type SigningEnv } from "@/lib/signing/env";
import { logNotifier, resendNotifier, type Notifier } from "./notify";

/** The api-kit surface we use beyond `ApiKitLike`: guardian confirmations. */
export interface ApiKitWithConfirm extends ApiKitLike {
  confirmTransaction(safeTxHash: string, signature: string): Promise<unknown>;
}

/** The viem `PublicClient` slice the routes and crons use. */
export interface PublicClientLike {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
  getBalance(args: { address: Address }): Promise<bigint>;
  getTransactionReceipt(args: { hash: Hex }): Promise<Pick<TransactionReceipt, "status" | "blockNumber" | "transactionHash">>;
  waitForTransactionReceipt(args: { hash: Hex; timeout?: number }): Promise<Pick<TransactionReceipt, "status" | "blockNumber" | "transactionHash">>;
}

/** The EAS SDK slice the attester uses; `lastTxHash` is filled in after `wait()` (*verify* receipt shape). */
export type EasLike = Pick<EAS, "attest" | "multiTimestamp">;

export interface TreasuryDeps {
  env: SigningEnv;
  chain: ChainAddresses;
  backend: () => Promise<KeyBackend>;
  apiKit: () => ApiKitWithConfirm;
  publicClient: () => PublicClientLike;
  /** sends `{to, data}` from the relayer role and returns the tx hash */
  relayerSend: (tx: { to: Address; data: Hex }) => Promise<Hex>;
  /** EAS connected to the attester role */
  eas: () => Promise<EasLike>;
  notify: Notifier;
  fetchImpl: typeof fetch;
  now: () => Date;
  log: (line: string) => void;
}

let cached: TreasuryDeps | null = null;

export function buildTreasuryDeps(env: SigningEnv = signingEnv()): TreasuryDeps {
  const base = chainFromId(env.CHAIN_ID);
  const chain: ChainAddresses = env.RPC_URL_BASE ? { ...base, rpcUrl: env.RPC_URL_BASE } : base;
  let apiKit: ApiKitWithConfirm | null = null;
  let publicClient: PublicClientLike | null = null;
  const backend = () => getKeyBackend(env);
  return {
    env,
    chain,
    backend,
    apiKit: () => (apiKit ??= apiKitFor(chain, env.SAFE_API_KEY) as unknown as ApiKitWithConfirm),
    publicClient: () =>
      (publicClient ??= createPublicClient({ chain: chain.viemChain as Chain, transport: http(chain.rpcUrl) }) as unknown as PublicClientLike),
    relayerSend: async (tx) => {
      const account = await accountFor(await backend(), "relayer");
      const wallet = createWalletClient({ account, chain: chain.viemChain as Chain, transport: http(chain.rpcUrl) });
      return wallet.sendTransaction({ to: tx.to, data: tx.data });
    },
    eas: async () => {
      const account = await accountFor(await backend(), "attester");
      return easFor(chain, ethersSignerFor(account, chain));
    },
    notify: env.RESEND_API_KEY ? resendNotifier(env.RESEND_API_KEY, env.RESEND_FROM ?? "Kami <hello@kami.local>") : logNotifier(),
    fetchImpl: fetch,
    now: () => new Date(),
    log: (line) => console.log(`[treasury] ${line}`),
  };
}

export function getTreasuryDeps(): TreasuryDeps {
  return (cached ??= buildTreasuryDeps());
}

/** Test seam: pass a full fake, or `null` to rebuild from env on next use. */
export function setTreasuryDepsForTests(d: TreasuryDeps | null): void {
  cached = d;
}

/** Relayer float threshold in wei (default 0.01 ETH, architecture §7.4). */
export function relayerMinWei(env: SigningEnv): bigint {
  const eth = Number(env.RELAYER_MIN_ETH ?? "0.01");
  if (!Number.isFinite(eth) || eth < 0) return 10n ** 16n;
  return BigInt(Math.round(eth * 1e6)) * 10n ** 12n;
}
