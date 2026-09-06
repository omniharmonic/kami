/**
 * Safe per entity (architecture §7.1, ADR-E05): owners = creator + guardian A +
 * guardian B, threshold 2, CREATE2 salt derived from the entity slug so the
 * address is known before deployment (the summon flow shows it). The platform's
 * deployer key pays gas and is asserted NOT to be an owner.
 *
 * Delegate registration (`addDelegate`) uses api-kit `addSafeDelegate`, which
 * requires a signature from the delegator — an owner (a guardian) — *verify*
 * docs/verify.md #7. The proposer key it registers can create pending
 * transactions in the Transaction Service and nothing else.
 */
import Safe, { type PredictedSafeProps } from "@safe-global/protocol-kit";
import type SafeApiKit from "@safe-global/api-kit";
import { type Address, type Hex, type WalletClient, getAddress, isAddress, keccak256, stringToBytes } from "viem";
import type { ChainAddresses } from "./addresses.js";
import { type ConfigStore, writeIfChanged } from "./config.js";
import { type ChainAccount, publicClientFor, walletClientFor } from "./signer.js";

export const SAFE_VERSION = "1.4.1" as const;
export const SAFE_THRESHOLD = 2 as const;

/** `keccak256("kami:" + slug)` as the CREATE2 salt nonce (decimal string, as Protocol Kit wants it). */
export function safeSaltNonce(entitySlug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(entitySlug)) throw new Error(`safeSaltNonce: bad entity slug "${entitySlug}"`);
  return BigInt(keccak256(stringToBytes(`kami:${entitySlug}`))).toString();
}

export interface OwnerSet {
  owners: readonly Address[];
  threshold?: number;
  /** the platform's deployer key — must not be an owner */
  deployer: Address;
}

/** Throws unless owners are three distinct addresses, threshold is 2, and the deployer is not among them. */
export function assertOwnersValid({ owners, threshold = SAFE_THRESHOLD, deployer }: OwnerSet): void {
  if (owners.length !== 3) throw new Error(`Safe owners must be exactly [creator, guardianA, guardianB]; got ${owners.length}`);
  for (const o of owners) if (!isAddress(o)) throw new Error(`Safe owner is not an address: ${o}`);
  const norm = owners.map((o) => getAddress(o));
  if (new Set(norm).size !== 3) throw new Error("Safe owners must be distinct");
  if (threshold !== SAFE_THRESHOLD) throw new Error(`Safe threshold must be ${SAFE_THRESHOLD}; got ${threshold}`);
  if (norm.includes(getAddress(deployer))) {
    throw new Error("the platform/deployer key must not be a Safe owner (ADR-E05: the platform is not an owner)");
  }
}

export function predictedSafeConfig({ owners, threshold = SAFE_THRESHOLD, entitySlug }: { owners: readonly Address[]; threshold?: number; entitySlug: string }): PredictedSafeProps {
  return {
    safeAccountConfig: { owners: owners.map((o) => getAddress(o)), threshold },
    safeDeploymentConfig: { saltNonce: safeSaltNonce(entitySlug), safeVersion: SAFE_VERSION, deploymentType: "canonical" },
  };
}

/** The slice of Protocol Kit the scripts use; tests inject a fake. */
export interface SafeLike {
  getAddress(): Promise<string>;
  isSafeDeployed(): Promise<boolean>;
  createSafeDeploymentTransaction(): Promise<{ to: string; value: string; data: string }>;
  getOwners(): Promise<string[]>;
  getThreshold(): Promise<number>;
}
export type SafeInit = (cfg: { provider: string; predictedSafe: PredictedSafeProps }) => Promise<SafeLike>;
export type SafeConnect = (cfg: { provider: string; safeAddress: string }) => Promise<SafeLike>;

const defaultInit: SafeInit = (cfg) => Safe.init(cfg) as unknown as Promise<SafeLike>;
const defaultConnect: SafeConnect = (cfg) => Safe.init(cfg) as unknown as Promise<SafeLike>;

export async function predictSafeAddress({
  chain,
  entitySlug,
  owners,
  threshold = SAFE_THRESHOLD,
  init = defaultInit,
}: {
  chain: ChainAddresses;
  entitySlug: string;
  owners: readonly Address[];
  threshold?: number;
  init?: SafeInit;
}): Promise<Address> {
  const safe = await init({ provider: chain.rpcUrl, predictedSafe: predictedSafeConfig({ owners, threshold, entitySlug }) });
  return getAddress(await safe.getAddress());
}

export interface DeploySafeOptions {
  chain: ChainAddresses;
  entitySlug: string;
  owners: readonly Address[];
  threshold?: number;
  deployer: ChainAccount;
  store: ConfigStore;
  dryRun?: boolean;
  log?: (line: string) => void;
  init?: SafeInit;
  connect?: SafeConnect;
  /** send a raw tx; default: viem wallet client for the deployer */
  send?: (tx: { to: Address; value: bigint; data: Hex }) => Promise<Hex>;
}

export async function deploySafe({
  chain,
  entitySlug,
  owners,
  threshold = SAFE_THRESHOLD,
  deployer,
  store,
  dryRun = false,
  log = () => {},
  init = defaultInit,
  connect = defaultConnect,
  send,
}: DeploySafeOptions): Promise<{ address: Address; action: "exists" | "deployed" | "would-deploy"; txHash?: Hex }> {
  assertOwnersValid({ owners, threshold, deployer: deployer.address });
  const predicted = await init({ provider: chain.rpcUrl, predictedSafe: predictedSafeConfig({ owners, threshold, entitySlug }) });
  const address = getAddress(await predicted.getAddress());
  const key = `safe.${entitySlug}.address`;
  const stored = await store.get(key);
  if (typeof stored === "string" && getAddress(stored) !== address) {
    throw new Error(`${key} is ${stored} in config but the salt for "${entitySlug}" predicts ${address}; refusing`);
  }
  if (await predicted.isSafeDeployed()) {
    log(`safe ${entitySlug}: exists at ${address}`);
    await verifyDeployed(connect, chain, address, owners, threshold, deployer.address);
    if (!dryRun) await writeIfChanged(store, key, address);
    return { address, action: "exists" };
  }
  const tx = await predicted.createSafeDeploymentTransaction();
  log(`safe ${entitySlug}: deploy to ${address} via ${tx.to} (salt ${safeSaltNonce(entitySlug)}, owners ${owners.join(",")}, threshold ${threshold})`);
  if (dryRun) return { address, action: "would-deploy" };
  const sendTx =
    send ??
    (async (t) => {
      const wallet = walletClientFor(chain, deployer);
      const hash = await wallet.sendTransaction({ account: deployer, chain: chain.viemChain, to: t.to, value: t.value, data: t.data });
      await publicClientFor(chain).waitForTransactionReceipt({ hash });
      return hash;
    });
  const txHash = await sendTx({ to: getAddress(tx.to), value: BigInt(tx.value), data: tx.data as Hex });
  await verifyDeployed(connect, chain, address, owners, threshold, deployer.address);
  await writeIfChanged(store, key, address);
  return { address, action: "deployed", txHash };
}

async function verifyDeployed(connect: SafeConnect, chain: ChainAddresses, address: Address, owners: readonly Address[], threshold: number, deployer: Address) {
  const safe = await connect({ provider: chain.rpcUrl, safeAddress: address });
  const onchainOwners = (await safe.getOwners()).map((o) => getAddress(o));
  const expected = owners.map((o) => getAddress(o));
  if (onchainOwners.length !== expected.length || !expected.every((o) => onchainOwners.includes(o))) {
    throw new Error(`Safe ${address} owners ${onchainOwners.join(",")} differ from expected ${expected.join(",")}`);
  }
  if ((await safe.getThreshold()) !== threshold) throw new Error(`Safe ${address} threshold is not ${threshold}`);
  if (onchainOwners.includes(getAddress(deployer))) throw new Error(`Safe ${address}: the deployer is an owner — refusing to use it`);
}

export interface AddDelegateOptions {
  apiKit: Pick<SafeApiKit, "addSafeDelegate" | "getSafeDelegates">;
  safeAddress: Address;
  delegate: Address;
  label: string;
  /** a Safe owner's wallet client — the delegator signs the registration (*verify* #7) */
  guardian: WalletClient;
  entitySlug: string;
  store: ConfigStore;
  dryRun?: boolean;
  log?: (line: string) => void;
}

/** Register the entity's proposer address as a Transaction-Service delegate. Idempotent by delegate list. */
export async function addDelegate({ apiKit, safeAddress, delegate, label, guardian, entitySlug, store, dryRun = false, log = () => {} }: AddDelegateOptions): Promise<{ action: "exists" | "added" | "would-add" }> {
  const delegator = guardian.account?.address;
  if (!delegator) throw new Error("addDelegate: guardian wallet client has no account");
  const existing = await apiKit.getSafeDelegates({ safeAddress, delegateAddress: delegate });
  let action: "exists" | "added" | "would-add";
  if (existing.results.some((d) => getAddress(d.delegate) === getAddress(delegate))) {
    action = "exists";
    log(`delegate ${delegate} already registered for ${safeAddress}`);
  } else if (dryRun) {
    action = "would-add";
    log(`would register delegate ${delegate} (label "${label}") on ${safeAddress}, signed by owner ${delegator}`);
  } else {
    await apiKit.addSafeDelegate({ safeAddress, delegateAddress: delegate, delegatorAddress: delegator, label, signer: guardian as never });
    action = "added";
    log(`registered delegate ${delegate} on ${safeAddress}`);
  }
  if (!dryRun) await writeIfChanged(store, `safe.${entitySlug}.proposer`, getAddress(delegate));
  return { action };
}
