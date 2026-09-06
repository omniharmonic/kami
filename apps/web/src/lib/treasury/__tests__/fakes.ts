/**
 * Fakes for the money layer: no RPC, no Safe Transaction Service, no EAS.
 * Everything that touches a network in `TreasuryDeps` is replaced here, so the
 * tests exercise the real `@kami/chain` helpers (hashes, encodings, the
 * refusal paths) against in-memory state.
 */
import { getAddress, parseUnits, type Address, type Hex } from "viem";
import {
  chainFromId,
  computeSafeTxHash,
  toSafeTransactionData,
  type MetaTransactionData,
  type MultisigTxLike,
  type SafeTransactionData,
} from "@kami/chain";
import { LocalKeyBackend, type KeyBackend } from "@/lib/signing/kms";
import { fakeNotifier } from "@/lib/treasury/notify";
import type { ApiKitWithConfirm, PublicClientLike, TreasuryDeps } from "@/lib/treasury/deps";
import { signingEnvSchema, type SigningEnv } from "@/lib/signing/env";

export const CHAIN_ID = 84532;
export const SAFE: Address = getAddress("0x1111111111111111111111111111111111111111");
export const RECIPIENT: Address = getAddress("0x2222222222222222222222222222222222222222");

export class FakeApiKit implements ApiKitWithConfirm {
  nextNonce = 7;
  readonly txs = new Map<string, MultisigTxLike>();
  readonly proposed: Array<{ safeTxHash: string; senderAddress: string; senderSignature: string; safeTransactionData: SafeTransactionData }> = [];
  readonly confirmed: Array<{ safeTxHash: string; signature: string }> = [];
  /** set to make every call throw (Transaction Service down) */
  down = false;

  async getNextNonce(): Promise<number> {
    return this.nextNonce;
  }
  async proposeTransaction(p: { safeAddress: string; safeTransactionData: SafeTransactionData; safeTxHash: string; senderAddress: string; senderSignature: string }): Promise<void> {
    if (this.down) throw new Error("tx service down");
    this.proposed.push({ safeTxHash: p.safeTxHash, senderAddress: p.senderAddress, senderSignature: p.senderSignature, safeTransactionData: p.safeTransactionData });
    this.txs.set(p.safeTxHash.toLowerCase(), {
      safeTxHash: p.safeTxHash,
      safe: p.safeAddress,
      to: p.safeTransactionData.to,
      value: p.safeTransactionData.value,
      data: p.safeTransactionData.data,
      operation: p.safeTransactionData.operation,
      safeTxGas: p.safeTransactionData.safeTxGas,
      baseGas: p.safeTransactionData.baseGas,
      gasPrice: p.safeTransactionData.gasPrice,
      gasToken: p.safeTransactionData.gasToken,
      refundReceiver: p.safeTransactionData.refundReceiver,
      nonce: p.safeTransactionData.nonce,
      confirmationsRequired: 2,
      confirmations: [],
      isExecuted: false,
      transactionHash: null,
    });
  }
  async getTransaction(safeTxHash: string): Promise<MultisigTxLike> {
    if (this.down) throw new Error("tx service down");
    const t = this.txs.get(safeTxHash.toLowerCase());
    if (!t) throw new Error(`no tx ${safeTxHash}`);
    return t;
  }
  async getPendingTransactions(): Promise<{ results: MultisigTxLike[] }> {
    if (this.down) throw new Error("tx service down");
    return { results: [...this.txs.values()].filter((t) => !t.isExecuted) };
  }
  async getIncomingTransactions(): Promise<{ results: unknown[] }> {
    return { results: [] };
  }
  async confirmTransaction(safeTxHash: string, signature: string): Promise<unknown> {
    if (this.down) throw new Error("tx service down");
    const t = await this.getTransaction(safeTxHash);
    this.confirmed.push({ safeTxHash, signature });
    t.confirmations = [...(t.confirmations ?? []), { owner: `0x${"9".repeat(40)}`, signature }];
    return {};
  }

  /** Seed a pending payout tx with `count` owner signatures, as the service would report it. */
  seedPending(args: { safeAddress?: Address; to: Address; amountUsdc6: bigint; nonce: number; confirmations: number; usdc: Address }): Hex {
    const tx: MetaTransactionData = {
      to: args.usdc,
      value: "0",
      data: `0x${"ab".repeat(36)}` as Hex,
      operation: 0,
    };
    const data = toSafeTransactionData(tx, args.nonce);
    const safeAddress = args.safeAddress ?? SAFE;
    const safeTxHash = computeSafeTxHash({ chainId: CHAIN_ID, safeAddress, tx: data });
    this.txs.set(safeTxHash.toLowerCase(), {
      safeTxHash,
      safe: safeAddress,
      to: data.to,
      value: data.value,
      data: data.data,
      operation: data.operation,
      safeTxGas: data.safeTxGas,
      baseGas: data.baseGas,
      gasPrice: data.gasPrice,
      gasToken: data.gasToken,
      refundReceiver: data.refundReceiver,
      nonce: data.nonce,
      confirmationsRequired: 2,
      confirmations: Array.from({ length: args.confirmations }, (_, i) => ({
        owner: getAddress(`0x${String(i + 1).repeat(40)}`),
        signature: `0x${"11".repeat(65)}`,
      })),
      isExecuted: false,
      transactionHash: null,
    });
    return safeTxHash;
  }
}

export class FakePublicClient implements PublicClientLike {
  usdcBalance = parseUnits("100", 6);
  threshold = 2n;
  ethBalance = 10n ** 17n; // 0.1 ETH
  readonly receipts = new Map<string, { status: "success" | "reverted"; blockNumber: bigint; transactionHash: Hex }>();
  rpcDown = false;

  async readContract(args: { functionName: string }): Promise<unknown> {
    if (this.rpcDown) throw new Error("rpc unavailable");
    if (args.functionName === "balanceOf") return this.usdcBalance;
    if (args.functionName === "getThreshold") return this.threshold;
    throw new Error(`unexpected call ${args.functionName}`);
  }
  async getBalance(): Promise<bigint> {
    if (this.rpcDown) throw new Error("rpc unavailable");
    return this.ethBalance;
  }
  async getTransactionReceipt(args: { hash: Hex }) {
    const r = this.receipts.get(args.hash.toLowerCase());
    if (!r) throw new Error("receipt not found");
    return r;
  }
  async waitForTransactionReceipt(args: { hash: Hex }) {
    const existing = this.receipts.get(args.hash.toLowerCase());
    if (existing) return existing;
    const r = { status: "success" as const, blockNumber: 1n, transactionHash: args.hash };
    this.receipts.set(args.hash.toLowerCase(), r);
    return r;
  }
}

export class FakeEas {
  readonly attested: Array<{ schema: string; data: string; refUID: string }> = [];
  readonly timestamped: string[][] = [];
  uidCounter = 0;
  failAttest = false;

  async attest(req: { schema: string; data: { data: string; refUID: string } }) {
    if (this.failAttest) throw new Error("attest failed");
    this.attested.push({ schema: req.schema, data: req.data.data, refUID: req.data.refUID });
    const uid = `0x${(++this.uidCounter).toString(16).padStart(64, "0")}`;
    return { wait: async () => uid };
  }
  async multiTimestamp(uids: string[]) {
    this.timestamped.push(uids);
    return { wait: async () => uids.map((_, i) => BigInt(1_700_000_000 + i)), receipt: { hash: `0x${"cd".repeat(32)}` } };
  }
}

export type FakeDeps = TreasuryDeps & {
  apiKitFake: FakeApiKit;
  publicClientFake: FakePublicClient;
  easFake: FakeEas;
  notifyFake: ReturnType<typeof fakeNotifier>;
  relayerSends: Array<{ to: Address; data: Hex }>;
  logs: string[];
  setNow: (d: Date) => void;
};

export function makeFakeDeps(overrides: { env?: Partial<SigningEnv>; now?: Date } = {}): FakeDeps {
  const apiKitFake = new FakeApiKit();
  const publicClientFake = new FakePublicClient();
  const easFake = new FakeEas();
  const notifyFake = fakeNotifier();
  const relayerSends: Array<{ to: Address; data: Hex }> = [];
  const logs: string[] = [];
  const backend: KeyBackend = new LocalKeyBackend({ ephemeral: true, env: { NODE_ENV: "test" } as NodeJS.ProcessEnv });
  let now = overrides.now ?? new Date("2026-09-06T12:00:00.000Z");
  const env = signingEnvSchema.parse({ NODE_ENV: "test", ...overrides.env });
  const deps: FakeDeps = {
    env,
    chain: chainFromId(CHAIN_ID),
    backend: async () => backend,
    apiKit: () => apiKitFake,
    publicClient: () => publicClientFake,
    relayerSend: async (tx) => {
      relayerSends.push(tx);
      return `0x${"ee".repeat(32)}` as Hex;
    },
    eas: async () => easFake as unknown as Awaited<ReturnType<TreasuryDeps["eas"]>>,
    notify: notifyFake,
    fetchImpl: (async () => {
      throw new Error("no network in tests");
    }) as unknown as typeof fetch,
    now: () => now,
    log: (l) => logs.push(l),
    apiKitFake,
    publicClientFake,
    easFake,
    notifyFake,
    relayerSends,
    logs,
    setNow: (d) => {
      now = d;
    },
  };
  return deps;
}
