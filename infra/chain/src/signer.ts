/**
 * Signing abstraction. Scripts take a viem `LocalAccount`; in dev it comes from
 * `--key-env <VAR>` (a raw private key in an env var, never logged), in
 * production the signing service supplies an account built with viem's
 * `toAccount({address, signMessage, signTransaction, signTypedData})` over a
 * KMS — nothing here ever reads a key from disk or the box (architecture §7.2, §10.2).
 *
 * The EAS SDK 2.x is ethers-based, so `ethersSignerFor` wraps the same account
 * in an ethers `AbstractSigner`; no second key material is ever involved.
 */
import {
  type Address,
  type Chain,
  type Hex,
  type HttpTransport,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AbstractSigner,
  JsonRpcProvider,
  type Provider,
  type Transaction as EthersTransaction,
  type TransactionRequest,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";
import type { ChainAddresses } from "./addresses.js";

export type ChainAccount = LocalAccount;

/** `process.env[keyEnv]` → account. The key never appears in an error message. */
export function accountFromEnv(keyEnv: string, env: NodeJS.ProcessEnv = process.env): ChainAccount {
  const raw = env[keyEnv];
  if (!raw) throw new Error(`@kami/chain: env var ${keyEnv} is not set (pass --key-env <VAR>)`);
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`@kami/chain: env var ${keyEnv} is not a 32-byte hex private key`);
  return privateKeyToAccount(key);
}

// The OP-stack chain objects carry formatters that blow up viem's inferred client
// types (TS7056); the scripts never parse deposit transactions, so clients are typed
// over the generic `Chain`.
export type KamiPublicClient = PublicClient<HttpTransport, Chain>;
export type KamiWalletClient = WalletClient<HttpTransport, Chain, LocalAccount>;

export function publicClientFor(chain: ChainAddresses): KamiPublicClient {
  return createPublicClient({ chain: chain.viemChain as Chain, transport: http(chain.rpcUrl) });
}

export function walletClientFor(chain: ChainAddresses, account: ChainAccount): KamiWalletClient {
  return createWalletClient({ account, chain: chain.viemChain as Chain, transport: http(chain.rpcUrl) });
}

/** ethers signer over a viem account, for the EAS SDK. */
export class ViemAccountSigner extends AbstractSigner {
  constructor(
    readonly account: ChainAccount,
    provider?: Provider | null,
  ) {
    super(provider ?? null);
  }
  async getAddress(): Promise<string> {
    return this.account.address;
  }
  connect(provider: Provider | null): ViemAccountSigner {
    return new ViemAccountSigner(this.account, provider);
  }
  async signTransaction(tx: TransactionRequest | EthersTransaction): Promise<string> {
    const t = tx as EthersTransaction;
    const to = t.to ? (t.to as Address) : undefined;
    const common = {
      chainId: Number(t.chainId),
      to,
      nonce: t.nonce ?? undefined,
      gas: t.gasLimit != null ? BigInt(t.gasLimit) : undefined,
      data: (t.data ?? "0x") as Hex,
      value: t.value != null ? BigInt(t.value) : 0n,
    };
    if (t.type === 0 || (t.gasPrice != null && t.maxFeePerGas == null)) {
      return this.account.signTransaction({ ...common, type: "legacy", gasPrice: BigInt(t.gasPrice ?? 0n) });
    }
    return this.account.signTransaction({
      ...common,
      type: "eip1559",
      maxFeePerGas: t.maxFeePerGas != null ? BigInt(t.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: t.maxPriorityFeePerGas != null ? BigInt(t.maxPriorityFeePerGas) : undefined,
    });
  }
  async signMessage(message: string | Uint8Array): Promise<string> {
    return this.account.signMessage({ message: typeof message === "string" ? message : { raw: message } });
  }
  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    const primaryType = Object.keys(types).find((k) => k !== "EIP712Domain") ?? Object.keys(types)[0]!;
    const params = {
      domain: {
        name: domain.name ?? undefined,
        version: domain.version ?? undefined,
        chainId: domain.chainId != null ? Number(domain.chainId) : undefined,
        verifyingContract: (domain.verifyingContract as Address | undefined) ?? undefined,
      },
      types,
      primaryType,
      message: value,
    } as unknown as Parameters<LocalAccount["signTypedData"]>[0];
    return this.account.signTypedData(params);
  }
}

export function ethersSignerFor(account: ChainAccount, chain: ChainAddresses): ViemAccountSigner {
  return new ViemAccountSigner(account, new JsonRpcProvider(chain.rpcUrl, chain.chainId, { staticNetwork: true }));
}

export function ethersProviderFor(chain: ChainAddresses): JsonRpcProvider {
  return new JsonRpcProvider(chain.rpcUrl, chain.chainId, { staticNetwork: true });
}
