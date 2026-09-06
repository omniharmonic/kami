/**
 * Postgres enums — architecture Appendix B, verbatim names and values.
 * "stale" is a state, not an error, in every enum here (ADR-E11).
 */
import { pgEnum } from "drizzle-orm/pg-core";

export const archetype = pgEnum("archetype", ["creek", "watershed", "reservoir", "mountain", "bioregion"]);
export const entityRole = pgEnum("entity_role", ["guardian", "evaluator", "steward"]);
export const mood = pgEnum("mood", ["asleep", "content", "concerned", "distressed", "celebrating"]);
export const sourceStatus = pgEnum("source_status", ["ok", "warning", "critical", "unknown"]);
export const needState = pgEnum("need_state", ["live", "stale", "missing", "superseded", "unbanded"]);
export const proposalAuthor = pgEnum("proposal_author", ["agent", "human"]);
export const bountyStatus = pgEnum("bounty_status", [
  "drafted",
  "held_by_guard",
  "open",
  "claimed",
  "in_review",
  "paid",
  "deferred",
  "expired",
  "withdrawn",
]);
export const outcome = pgEnum("outcome", ["succeeded", "partial", "failed", "unverifiable"]);
export const payoutRail = pgEnum("payout_rail", ["usdc_safe", "usdc_roles", "fiat"]);
export const donationRail = pgEnum("donation_rail", ["card", "usdc_direct", "stablecoin_checkout"]);
export const attestationMode = pgEnum("attestation_mode", ["onchain", "offchain"]);
export const reviewState = pgEnum("review_state", ["pending_review", "approved", "rejected"]);

export type Archetype = (typeof archetype.enumValues)[number];
export type EntityRoleName = (typeof entityRole.enumValues)[number];
export type MoodName = (typeof mood.enumValues)[number];
export type BountyStatus = (typeof bountyStatus.enumValues)[number];
