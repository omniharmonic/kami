/**
 * EAS schema strings and the derived identifiers, from 02 §8.1. The strings are
 * verbatim; the chain scripts under infra/chain/ register them and this package
 * derives their UIDs locally so the recompute CLI never needs a network call to
 * agree with them.
 */
import {
  type Address,
  type Hex,
  encodePacked,
  keccak256,
  sha256,
  stringToBytes,
  zeroAddress,
} from "viem";
import { canonicalBytes } from "./canonical.js";

/** The five schema strings, verbatim from 02 §8.1 (registered once on Base). */
export const EAS_SCHEMAS = {
  EntityRegistered:
    "bytes32 entityId, string twinEntityURI, address safe, uint256 guardiansHatId",
  BountyPosted:
    "bytes32 entityId, bytes32 bountyHash, string specURI, uint8 verificationTier, uint256 capUSDC",
  BountyCompleted:
    "bytes32 entityId, bytes32 bountyHash, address recipient, uint256 amountUSDC, bytes32 safeTxHash, string evidenceURI",
  ProposalOutcome:
    "bytes32 entityId, bytes32 proposalHash, uint8 outcome, uint256 evaluatorHatId, string evidenceURI, bytes32 twinSnapshotHash",
  ReputationSnapshot:
    "bytes32 entityId, bytes32 rootOfUIDs, string scoresURI, uint64 computedAt",
} as const;

export type EasSchemaName = keyof typeof EAS_SCHEMAS;

/** `outcome ∈ {0 succeeded, 1 partial, 2 failed, 3 unverifiable}` (02 §8.1). */
export const Outcome = {
  succeeded: 0,
  partial: 1,
  failed: 2,
  unverifiable: 3,
} as const;
export type OutcomeCode = (typeof Outcome)[keyof typeof Outcome];
export const OUTCOME_NAMES: Record<OutcomeCode, keyof typeof Outcome> = {
  0: "succeeded",
  1: "partial",
  2: "failed",
  3: "unverifiable",
};

/**
 * `entityId = keccak256(entity slug)` (02 §8.1).
 *
 * Kami entity ids are `entity/<slug>` (CLAUDE.md); the on-chain `entityId`
 * hashes the bare slug. Both forms are accepted here — a leading `entity/` is
 * stripped before hashing — so `entityIdOf("entity/boulder-creek")` and
 * `entityIdOf("boulder-creek")` agree.
 */
export function entityIdOf(slugOrId: string): Hex {
  const slug = slugOrId.startsWith("entity/") ? slugOrId.slice("entity/".length) : slugOrId;
  if (slug.length === 0) throw new TypeError("entityIdOf: empty slug");
  return keccak256(stringToBytes(slug));
}

/**
 * `bountyHash = sha256` of the canonical bounty-spec JSON (02 §8.1): stable key
 * order, no whitespace — see canonical.ts. Any JSON-serializable spec object.
 */
export function bountyHashOf(spec: unknown): Hex {
  return sha256(canonicalBytes(spec));
}

/**
 * The schema UID exactly as EAS's SchemaRegistry derives it:
 *
 *     uid = keccak256(abi.encodePacked(schema, resolver, revocable))
 *
 * (SchemaRegistry.sol `_getUID`). Defaults: resolver = address(0),
 * revocable = true — the registration parameters infra/chain/ uses. Computing
 * it locally lets the recompute CLI filter EAS results by schema without
 * trusting a config value or making a network call.
 */
export function schemaUidFor(
  schema: string,
  resolver: Address = zeroAddress,
  revocable = true,
): Hex {
  return keccak256(
    encodePacked(["string", "address", "bool"], [schema, resolver, revocable]),
  );
}

/** UIDs of the five Kami schemas under the default registration parameters. */
export const EAS_SCHEMA_UIDS: Readonly<Record<EasSchemaName, Hex>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(EAS_SCHEMAS) as EasSchemaName[]).map((name) => [
      name,
      schemaUidFor(EAS_SCHEMAS[name]),
    ]),
  ) as Record<EasSchemaName, Hex>,
);
