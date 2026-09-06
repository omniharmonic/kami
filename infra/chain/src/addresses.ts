/**
 * Chain table for @kami/chain. Base Sepolia (84532) is the default; Base
 * mainnet (8453) is opt-in via `CHAIN_ID=8453` (architecture §7, §12.1).
 *
 * Every address below that is not derived from an installed package table is
 * flagged `verify` — docs/verify.md #7, #8, #9, #18. Confirm each against the
 * source named in `source` before the first mainnet run.
 */
import type { Address } from "viem";
import { base, baseSepolia } from "viem/chains";

export const BASE_SEPOLIA_ID = 84532 as const;
export const BASE_ID = 8453 as const;
export type SupportedChainId = typeof BASE_SEPOLIA_ID | typeof BASE_ID;

export interface VerifiedAddress {
  address: Address;
  /** false until a human ticks the row in docs/verify.md */
  verified: boolean;
  /** where to confirm it */
  source: string;
}

export interface ChainAddresses {
  chainId: SupportedChainId;
  name: string;
  rpcUrl: string;
  viemChain: typeof base | typeof baseSepolia;
  /** Safe Transaction Service short name for @safe-global/api-kit (`chainId` lookup) */
  txServiceShortName: string;
  usdc: VerifiedAddress;
  eas: VerifiedAddress;
  schemaRegistry: VerifiedAddress;
  hats: VerifiedAddress;
  rolesModifierMastercopy: VerifiedAddress;
  moduleProxyFactory: VerifiedAddress;
  /** Safe Allowance module (PRD §7.5 "simpler first step"); absent where not deployed */
  allowanceModule?: VerifiedAddress;
}

// The two EAS predeploys are OP-stack canonical addresses and match the
// `@ethereum-attestation-service/eas-contracts` 1.7.1 `deployments/base*` files
// installed in this workspace — the only entries here backed by a package table.
const EAS_PREDEPLOY: Address = "0x4200000000000000000000000000000000000021";
const SCHEMA_REGISTRY_PREDEPLOY: Address = "0x4200000000000000000000000000000000000020";
const EAS_SOURCE =
  "node_modules/@ethereum-attestation-service/eas-contracts/deployments/{base,base-sepolia}/*.json; https://docs.attest.org/docs/quick--start/contracts";

// Hats Protocol v1 is deployed at the same CREATE2 address on every supported
// chain (`HATS_V1` in @hatsprotocol/sdk-v1-core 0.12.4). Whether Base Sepolia
// (84532) is among them is *verify* — the SDK's own chain table does not list it.
const HATS_V1: Address = "0x3bc1A0Ad72417f2d411118085256fC53CBdDd137";
const HATS_SOURCE =
  "@hatsprotocol/sdk-v1-core HATS_V1 constant; https://docs.hatsprotocol.xyz/for-developers/hats-protocol-overview/deployments (verify 84532)";

// Zodiac Roles Modifier v2 — mastercopy (v2.1) and the Zodiac ModuleProxyFactory,
// both deployed via the singleton factory so the address is chain-independent
// where deployed at all. *verify* on Base and Base Sepolia (docs/verify.md #8).
const ROLES_V2_MASTERCOPY: Address = "0x9646fDAD06d3e24444381f44362a3B0eB343D337";
const MODULE_PROXY_FACTORY: Address = "0x000000000000aDdB49795b0f9bA5BC298cDda236";
const ROLES_SOURCE =
  "https://github.com/gnosisguild/zodiac-modifier-roles/tree/main/packages/evm (deployments); https://github.com/gnosisguild/zodiac/blob/master/src/factory/constants.ts";

export const CHAINS: Record<SupportedChainId, ChainAddresses> = {
  [BASE_SEPOLIA_ID]: {
    chainId: BASE_SEPOLIA_ID,
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    viemChain: baseSepolia,
    txServiceShortName: "basesep",
    usdc: {
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      verified: false, // verify: https://developers.circle.com/stablecoins/usdc-contract-addresses
      source: "Circle USDC contract addresses (testnet)",
    },
    eas: { address: EAS_PREDEPLOY, verified: false, source: EAS_SOURCE },
    schemaRegistry: { address: SCHEMA_REGISTRY_PREDEPLOY, verified: false, source: EAS_SOURCE },
    hats: { address: HATS_V1, verified: false, source: HATS_SOURCE },
    rolesModifierMastercopy: { address: ROLES_V2_MASTERCOPY, verified: false, source: ROLES_SOURCE },
    moduleProxyFactory: { address: MODULE_PROXY_FACTORY, verified: false, source: ROLES_SOURCE },
    // @safe-global/safe-modules-deployments 3.0.9 lists no Allowance module on 84532.
  },
  [BASE_ID]: {
    chainId: BASE_ID,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    viemChain: base,
    txServiceShortName: "base",
    usdc: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      verified: false, // verify: docs/verify.md #18
      source: "Circle USDC contract addresses (mainnet); architecture §7",
    },
    eas: { address: EAS_PREDEPLOY, verified: false, source: EAS_SOURCE },
    schemaRegistry: { address: SCHEMA_REGISTRY_PREDEPLOY, verified: false, source: EAS_SOURCE },
    hats: { address: HATS_V1, verified: false, source: HATS_SOURCE },
    rolesModifierMastercopy: { address: ROLES_V2_MASTERCOPY, verified: false, source: ROLES_SOURCE },
    moduleProxyFactory: { address: MODULE_PROXY_FACTORY, verified: false, source: ROLES_SOURCE },
    allowanceModule: {
      address: "0xAA46724893dedD72658219405185Fb0Fc91e091C",
      verified: false,
      source: "@safe-global/safe-modules-deployments 3.0.9 allowance-module v0.1.1 (8453)",
    },
  },
};

export function chainFromId(id: number | string | undefined): ChainAddresses {
  const n = Number(id ?? BASE_SEPOLIA_ID);
  if (n === BASE_SEPOLIA_ID || n === BASE_ID) return CHAINS[n];
  throw new Error(`@kami/chain: unsupported CHAIN_ID ${String(id)} (use 84532 or 8453)`);
}

/** Resolve the chain from `CHAIN_ID` / `RPC_URL` env. Mainnet is opt-in. */
export function chainFromEnv(env: NodeJS.ProcessEnv = process.env): ChainAddresses {
  const c = chainFromId(env.CHAIN_ID);
  return env.RPC_URL ? { ...c, rpcUrl: env.RPC_URL } : c;
}

/** Every address that still carries `verified: false`, for the runbook and the CLI banner. */
export function unverifiedAddresses(c: ChainAddresses): Array<{ key: string; address: Address; source: string }> {
  const out: Array<{ key: string; address: Address; source: string }> = [];
  for (const [key, v] of Object.entries(c)) {
    if (v && typeof v === "object" && "verified" in v && v.verified === false) {
      out.push({ key, address: (v as VerifiedAddress).address, source: (v as VerifiedAddress).source });
    }
  }
  return out;
}
