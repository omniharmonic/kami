/**
 * Offchain EAS attestation signing surface (arch §6.5, §8.2).
 *
 * Phase 2 signs `ProposalOutcome` with the evaluator's Privy embedded wallet
 * (EIP-712) — *verify* docs/verify.md #11. Until then `signOffchain` returns a
 * deterministic placeholder UID `pending:<sha256(canonical payload)>` and a
 * null signature, so rows and the `attestations` index carry a stable
 * reference the nightly job can later replace with the real UID.
 */
import { createHash } from "node:crypto";
import { canonicalJson, EAS_SCHEMAS, Outcome, type OutcomeCode } from "@kami/reputation";

export type ProposalOutcomePayload = {
  schema: "ProposalOutcome";
  schema_string: string;
  entityId: `0x${string}`;
  proposalHash: `0x${string}`;
  outcome: OutcomeCode;
  outcome_name: keyof typeof Outcome;
  evaluatorHatId: string;
  evidenceURI: string;
  twinSnapshotHash: `0x${string}`;
  /** platform user id of the signer; the wallet address replaces it in phase 2 */
  attester: string;
  attested_at: string;
};

export type SignedAttestation = { uid: string; signature: string | null; signed_by: string | null };

export interface SignAttestation {
  signOffchain(payload: ProposalOutcomePayload): Promise<SignedAttestation>;
}

export const ZERO_HASH = `0x${"0".repeat(64)}` as const;

export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/** Stub signer: no key, no Privy. Marked *verify*; replaced by the Privy EIP-712 flow. */
export const stubSigner: SignAttestation = {
  async signOffchain(payload) {
    return { uid: `pending:${payloadHash(payload)}`, signature: null, signed_by: null };
  },
};

export function proposalOutcomeSchemaString(): string {
  return EAS_SCHEMAS.ProposalOutcome;
}

export async function signOffchain(payload: ProposalOutcomePayload, signer: SignAttestation = stubSigner): Promise<SignedAttestation> {
  return signer.signOffchain(payload);
}
