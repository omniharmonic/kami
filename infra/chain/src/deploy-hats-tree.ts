/**
 * Hats tree (T2.2): one platform top hat (worn by the deployer), one admin hat
 * per entity under it, and the four role hats per entity:
 * Guardian · Evaluator · Steward · VerifiedContributor.
 *
 * Idempotent: every id is stored in config (`hats.tree.<slug>.<Role>`); a
 * stored id is re-read with `viewHat` and its details string must match.
 *
 * Eligibility/toggle modules: Hats rejects the zero address, so v1 uses the
 * deployer address for both (it can then set wearer status by hand). Replacing
 * them with a Passport-eligibility module is a phase-3 item.
 */
import { HATS_ABI } from "@hatsprotocol/sdk-v1-core";
import type { Address } from "viem";
import type { ChainAddresses } from "./addresses.js";
import { type ConfigStore, writeIfChanged } from "./config.js";
import type { KamiPublicClient, KamiWalletClient } from "./signer.js";

export const ENTITY_ROLES = ["Guardian", "Evaluator", "Steward", "VerifiedContributor"] as const;
export type EntityRole = (typeof ENTITY_ROLES)[number];

/** Max wearers per role hat. Guardians are 2 per Safe plus one spare for rotation. */
export const ROLE_MAX_SUPPLY: Record<EntityRole, number> = {
  Guardian: 3,
  Evaluator: 12,
  Steward: 6,
  VerifiedContributor: 1000,
};

export const PLATFORM_TOP_HAT_DETAILS = "kami:platform:top";
export function entityAdminHatDetails(slug: string): string {
  return `kami:${slug}:admin`;
}
export function roleHatDetails(slug: string, role: EntityRole): string {
  return `kami:${slug}:${role}`;
}

export interface HatsLike {
  mintTopHat(params: { wearer: Address; details: string }): Promise<bigint>;
  createHat(params: { admin: bigint; details: string; maxSupply: number }): Promise<bigint>;
  viewHat(hatId: bigint): Promise<{ details: string; maxSupply: number } | null>;
}

/** Real adapter over viem + the Hats v1 ABI (works on any chain where Hats is deployed at HATS_V1). */
export function hatsFor(chain: ChainAddresses, publicClient: KamiPublicClient, walletClient: KamiWalletClient, deployer: Address): HatsLike {
  const address = chain.hats.address;
  const abi = HATS_ABI as never;
  const account = walletClient.account!;
  return {
    async mintTopHat({ wearer, details }) {
      const { request, result } = await publicClient.simulateContract({
        address, abi, functionName: "mintTopHat", args: [wearer, details, ""], account,
      } as never);
      const hash = await walletClient.writeContract(request as never);
      await publicClient.waitForTransactionReceipt({ hash });
      return BigInt(result as bigint);
    },
    async createHat({ admin, details, maxSupply }) {
      const { request, result } = await publicClient.simulateContract({
        address, abi, functionName: "createHat", args: [admin, details, maxSupply, deployer, deployer, true, ""], account,
      } as never);
      const hash = await walletClient.writeContract(request as never);
      await publicClient.waitForTransactionReceipt({ hash });
      return BigInt(result as bigint);
    },
    async viewHat(hatId) {
      const r = (await publicClient.readContract({ address, abi, functionName: "viewHat", args: [hatId] } as never)) as unknown[];
      const details = r[0] as string;
      if (!details) return null;
      return { details, maxSupply: Number(r[1]) };
    },
  };
}

export interface DeployHatsOptions {
  entitySlug: string;
  hats: HatsLike;
  store: ConfigStore;
  deployer: Address;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface HatsTreeResult {
  platformTopHat: bigint | null;
  entityAdminHat: bigint | null;
  roles: Partial<Record<EntityRole, bigint>>;
  created: string[];
  reused: string[];
}

async function ensureHat(
  key: string,
  expectedDetails: string,
  create: () => Promise<bigint>,
  { hats, store, dryRun, log, result }: { hats: HatsLike; store: ConfigStore; dryRun: boolean; log: (l: string) => void; result: HatsTreeResult },
): Promise<bigint | null> {
  const stored = await store.get(key);
  if (typeof stored === "string" && stored !== "") {
    const id = BigInt(stored);
    const seen = await hats.viewHat(id);
    if (!seen) throw new Error(`${key}: config says hat ${stored} but the chain has no such hat`);
    if (seen.details !== expectedDetails) throw new Error(`${key}: hat ${stored} has details "${seen.details}", expected "${expectedDetails}"`);
    result.reused.push(key);
    log(`${key}: exists ${stored}`);
    return id;
  }
  if (dryRun) {
    log(`${key}: would create "${expectedDetails}"`);
    return null;
  }
  const id = await create();
  await writeIfChanged(store, key, id.toString());
  result.created.push(key);
  log(`${key}: created ${id}`);
  return id;
}

export async function deployHatsTree({ entitySlug, hats, store, deployer, dryRun = false, log = () => {} }: DeployHatsOptions): Promise<HatsTreeResult> {
  const result: HatsTreeResult = { platformTopHat: null, entityAdminHat: null, roles: {}, created: [], reused: [] };
  const ctx = { hats, store, dryRun, log, result };

  result.platformTopHat = await ensureHat(
    "hats.tree.platform.topHat",
    PLATFORM_TOP_HAT_DETAILS,
    () => hats.mintTopHat({ wearer: deployer, details: PLATFORM_TOP_HAT_DETAILS }),
    ctx,
  );
  const top = result.platformTopHat;

  result.entityAdminHat = await ensureHat(
    `hats.tree.${entitySlug}.admin`,
    entityAdminHatDetails(entitySlug),
    () => {
      if (top === null) throw new Error("platform top hat missing");
      return hats.createHat({ admin: top, details: entityAdminHatDetails(entitySlug), maxSupply: 1 });
    },
    ctx,
  );
  const admin = result.entityAdminHat;

  for (const role of ENTITY_ROLES) {
    const id = await ensureHat(
      `hats.tree.${entitySlug}.${role}`,
      roleHatDetails(entitySlug, role),
      () => {
        if (admin === null) throw new Error("entity admin hat missing");
        return hats.createHat({ admin, details: roleHatDetails(entitySlug, role), maxSupply: ROLE_MAX_SUPPLY[role] });
      },
      ctx,
    );
    if (id !== null) result.roles[role] = id;
  }
  return result;
}
