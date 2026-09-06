/**
 * Input and output shapes of reputation/v1. zod schemas are the source of
 * truth; the exported types are inferred from them so the recompute CLI can
 * validate untrusted JSON (a downloaded scores file, an offline bundle, an EAS
 * response) with the same definitions the pure function is typed against.
 */
import { z } from "zod";

const hex32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex string")
  .transform((s) => s.toLowerCase() as `0x${string}`);

/** A 32-byte hex string (EAS UID, hash). Normalized to lowercase on parse. */
export const Uid = hex32;
export type Uid = `0x${string}`;

/** ISO-8601 datetime (UTC `Z` or an explicit offset). */
export const IsoDateTime = z.iso.datetime({ offset: true });

export const VerificationTier = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type VerificationTier = z.infer<typeof VerificationTier>;

export const OutcomeCodeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

/**
 * One `ProposalOutcome` attestation as the reputation function sees it — the
 * on-chain fields joined with the `BountyPosted` it references (tier, USD at
 * stake) and the platform's local index (claimant, revocation).
 */
export const OutcomeAttestation = z.object({
  /** EAS attestation UID. */
  uid: Uid,
  /** Kami entity id (`entity/<slug>`), or its bytes32 `entityId` when a slug is unknown. */
  entity_id: z.string().min(1),
  /** `proposalHash` (a bounty's `bountyHash` in practice). */
  proposal_hash: hex32,
  /** The claimant — an address or a platform user id. Opaque to the function. */
  subject: z.string().min(1),
  /** 0 succeeded · 1 partial · 2 failed · 3 unverifiable (02 §8.1). */
  outcome: OutcomeCodeSchema,
  verification_tier: VerificationTier,
  usd_at_stake: z.number().nonnegative().finite(),
  attested_at: IsoDateTime,
  /**
   * Tier-4 only: the UID of the deposit outcome this balance outcome follows
   * up on. Its presence lifts the referenced attestation (and this one) from
   * the 0.6 provisional tier weight to 1.0.
   */
  follow_up_of: Uid.optional(),
  /** Revoked attestations are excluded entirely. */
  revoked: z.boolean(),
});
export type OutcomeAttestation = z.infer<typeof OutcomeAttestation>;

export const Direction = z.union([z.literal("up"), z.literal("down")]);
export type Direction = z.infer<typeof Direction>;

/**
 * A tier-1 bounty's `prediction` (PRD §7.6) together with what
 * `get_reading_history` later showed. `observed_direction: null` means the
 * window has not resolved or the reading history could not establish a
 * direction (stale/absent data) — "absent means unknown, never zero", so such
 * predictions are excluded rather than counted as misses.
 */
export const PredictionRecord = z.object({
  entity: z.string().min(1),
  place_id: z.string().min(1),
  property: z.string().min(1),
  direction: Direction,
  window_end: IsoDateTime,
  observed_direction: Direction.nullable(),
});
export type PredictionRecord = z.infer<typeof PredictionRecord>;

/**
 * One row of `scores`. `entity: null` is the subject's cross-entity row (the
 * n-weighted mean over that subject's entity rows); every other row is a
 * (subject, entity) pair.
 */
export const Score = z.object({
  subject: z.string(),
  entity: z.string().nullable(),
  /** Σ w_i — a real number, used as the Wilson sample size. */
  n: z.number(),
  /** Σ w_i·success_i / n, or null when n = 0. */
  p: z.number().nullable(),
  /** Wilson lower bound (z = 1.96) × 100, or null when the row is "new". */
  score: z.number().nullable(),
  passport_ok: z.boolean(),
  label: z.literal("new").nullable(),
});
export type Score = z.infer<typeof Score>;

export const EntityScore = z.object({
  entity: z.string(),
  /** Resolved tier-1 predictions (window closed and a direction observed). */
  predictions_n: z.number().int().nonnegative(),
  correct_n: z.number().int().nonnegative(),
  /** correct_n / predictions_n, or null when nothing has resolved. */
  accuracy: z.number().nullable(),
});
export type EntityScore = z.infer<typeof EntityScore>;

export const REPUTATION_FUNCTION_ID = "reputation/v1" as const;

export const ReputationFile = z.object({
  function: z.literal(REPUTATION_FUNCTION_ID),
  computed_at: IsoDateTime,
  /** Every attestation UID the run was given (including revoked/unverifiable), sorted. */
  inputs: z.array(Uid),
  scores: z.array(Score),
  entity_scores: z.array(EntityScore),
  /** keccak256 Merkle root over `inputs` — see merkleRootOfUids. */
  root_of_uids: hex32,
});
export type ReputationFile = z.infer<typeof ReputationFile>;

/** Options for computeReputation. */
export interface ComputeOptions {
  /** The instant "now" for decay and prediction windows; the file's `computed_at`. */
  now: Date | string | number;
  /** Human Passport score per subject. Missing subject ⇒ unknown ⇒ `passport_ok: false`. */
  passport?: Map<string, number>;
  /** `config.passport_min`, default 20 (*verify* the current scorer scale — docs/verify.md #10). */
  passport_min?: number;
  predictions?: PredictionRecord[];
}

/** A JSON bundle the recompute CLI can run from without any network. */
export const OfflineBundle = z.object({
  attestations: z.array(OutcomeAttestation),
  predictions: z.array(PredictionRecord).optional(),
  /** subject → Human Passport score. */
  passport: z.record(z.string(), z.number()).optional(),
  passport_min: z.number().optional(),
});
export type OfflineBundle = z.infer<typeof OfflineBundle>;
