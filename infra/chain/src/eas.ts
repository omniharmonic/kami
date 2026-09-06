/**
 * EAS helpers for the platform's signing service and the nightly jobs
 * (architecture §8.2, ADR-E06):
 *
 *  - `attestOnchain`            platform attester key → onchain attestation, revocable
 *  - `buildOffchainAttestation` the EIP-712 payload an evaluator's wallet signs client-side
 *  - `verifyOffchain`           pure signature + UID check on such a payload (EOAs)
 *  - `timestampUids`            `EAS.multiTimestamp(uids)` for the nightly batch (*verify* #9)
 *  - `merkleRootOfUids`         from @kami/reputation, the value in `ReputationSnapshot.rootOfUIDs`
 */
import type { EAS as EASType, SchemaItem } from "@ethereum-attestation-service/eas-sdk";
import { EAS, Offchain, OffchainAttestationVersion } from "./eas-sdk.js";
import { type Address, type Hex, isHex, verifyTypedData, zeroAddress } from "viem";
import type { ChainAddresses } from "./addresses.js";
import { EAS_SCHEMA_UIDS, type EasSchemaName, encodeSchemaData, merkleRootOfUids } from "./schemas.js";
import type { ViemAccountSigner } from "./signer.js";

export { merkleRootOfUids };

export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;

/** The EAS contract's EIP-712 domain version; read it from the contract (`eas.getVersion()`) when unsure. *verify* per chain. */
export const DEFAULT_EAS_DOMAIN_VERSION = "1.2.0";

export function easFor(chain: ChainAddresses, signer?: ViemAccountSigner): EASType {
  const eas = new EAS(chain.eas.address);
  return signer ? eas.connect(signer) : eas;
}

export interface AttestOnchainOptions {
  eas: Pick<EASType, "attest">;
  schemaName: EasSchemaName;
  data: SchemaItem[];
  recipient?: Address;
  refUID?: Hex;
  expirationTime?: bigint;
  dryRun?: boolean;
  log?: (line: string) => void;
}

/** Onchain, revocable attestation by the connected attester. Returns the UID (or the would-be request in dry-run). */
export async function attestOnchain({
  eas,
  schemaName,
  data,
  recipient = zeroAddress,
  refUID = ZERO_BYTES32,
  expirationTime = 0n,
  dryRun = false,
  log = () => {},
}: AttestOnchainOptions): Promise<{ uid: Hex | null; request: { schema: Hex; data: Hex; recipient: Address; refUID: Hex } }> {
  const encoded = encodeSchemaData(schemaName, data);
  const request = { schema: EAS_SCHEMA_UIDS[schemaName], data: encoded, recipient, refUID };
  log(`attest ${schemaName} schema=${request.schema} recipient=${recipient} refUID=${refUID} data=${encoded.slice(0, 20)}…`);
  if (dryRun) return { uid: null, request };
  const tx = await eas.attest({
    schema: request.schema,
    data: { recipient, data: encoded, expirationTime, revocable: true, refUID },
  });
  const uid = (await tx.wait()) as Hex;
  return { uid, request };
}

/** EAS offchain attestation v2 typed-data types (from the SDK's OFFCHAIN_ATTESTATION_TYPES). */
export const OFFCHAIN_ATTEST_TYPES = {
  Attest: [
    { name: "version", type: "uint16" },
    { name: "schema", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "time", type: "uint64" },
    { name: "expirationTime", type: "uint64" },
    { name: "revocable", type: "bool" },
    { name: "refUID", type: "bytes32" },
    { name: "data", type: "bytes" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export interface OffchainAttestationPayload {
  domain: { name: "EAS Attestation"; version: string; chainId: number; verifyingContract: Address };
  types: typeof OFFCHAIN_ATTEST_TYPES;
  primaryType: "Attest";
  message: {
    version: number;
    schema: Hex;
    recipient: Address;
    time: bigint;
    expirationTime: bigint;
    revocable: boolean;
    refUID: Hex;
    data: Hex;
    salt: Hex;
  };
  /** the UID EAS assigns this offchain attestation (what `ProposalOutcome` rows store) */
  uid: Hex;
}

export interface BuildOffchainOptions {
  chainId: number;
  easAddress: Address;
  easVersion?: string;
  schemaName: EasSchemaName;
  data: SchemaItem[] | Hex;
  recipient?: Address;
  /** unix seconds */
  time: bigint;
  expirationTime?: bigint;
  refUID?: Hex;
  /** 32 random bytes; required for v2 — supply from crypto.getRandomValues on the client */
  salt: Hex;
}

/** Build the EIP-712 payload the evaluator's wallet signs (viem `signTypedData` shape). Pure. */
export function buildOffchainAttestation({
  chainId,
  easAddress,
  easVersion = DEFAULT_EAS_DOMAIN_VERSION,
  schemaName,
  data,
  recipient = zeroAddress,
  time,
  expirationTime = 0n,
  refUID = ZERO_BYTES32,
  salt,
}: BuildOffchainOptions): OffchainAttestationPayload {
  if (!isHex(salt) || salt.length !== 66) throw new Error("buildOffchainAttestation: salt must be 32 bytes hex");
  const encoded = typeof data === "string" ? data : encodeSchemaData(schemaName, data);
  const schema = EAS_SCHEMA_UIDS[schemaName];
  const version = OffchainAttestationVersion.Version2;
  const uid = Offchain.getOffchainUID(version, schema, recipient, time, expirationTime, true, refUID, encoded, salt) as Hex;
  return {
    domain: { name: "EAS Attestation", version: easVersion, chainId, verifyingContract: easAddress },
    types: OFFCHAIN_ATTEST_TYPES,
    primaryType: "Attest",
    message: { version, schema, recipient, time, expirationTime, revocable: true, refUID, data: encoded, salt },
    uid,
  };
}

/** Recompute the UID and check the signature (EOA attesters; smart-account wallets need an RPC `verifyTypedData`). */
export async function verifyOffchain({
  payload,
  signature,
  attester,
}: {
  payload: OffchainAttestationPayload;
  signature: Hex;
  attester: Address;
}): Promise<{ ok: boolean; reason?: string }> {
  const m = payload.message;
  const uid = Offchain.getOffchainUID(m.version, m.schema, m.recipient, m.time, m.expirationTime, m.revocable, m.refUID, m.data, m.salt);
  if (uid.toLowerCase() !== payload.uid.toLowerCase()) return { ok: false, reason: "uid does not match message" };
  const ok = await verifyTypedData({
    address: attester,
    domain: payload.domain,
    types: payload.types,
    primaryType: payload.primaryType,
    message: payload.message,
    signature,
  });
  return ok ? { ok } : { ok: false, reason: "signature does not recover to attester" };
}

/** Nightly: timestamp every new offchain UID in one tx. Sorted + de-duplicated for a stable calldata. */
export async function timestampUids({
  eas,
  uids,
  dryRun = false,
  log = () => {},
}: {
  eas: Pick<EASType, "multiTimestamp">;
  uids: readonly string[];
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<{ uids: Hex[]; timestamps: bigint[] | null; merkleRoot: Hex }> {
  const sorted = [...new Set(uids.map((u) => u.toLowerCase()))].sort() as Hex[];
  for (const u of sorted) if (!/^0x[0-9a-f]{64}$/.test(u)) throw new Error(`timestampUids: not a bytes32 uid: ${u}`);
  const merkleRoot = merkleRootOfUids(sorted);
  log(`multiTimestamp(${sorted.length} uids) merkleRoot=${merkleRoot}`);
  if (dryRun || sorted.length === 0) return { uids: sorted, timestamps: null, merkleRoot };
  const tx = await eas.multiTimestamp(sorted);
  const timestamps = await tx.wait();
  return { uids: sorted, timestamps, merkleRoot };
}
