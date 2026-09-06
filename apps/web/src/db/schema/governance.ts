/**
 * Governance — Appendix B `strategies`, `proposals`, `bounties`, `claims`,
 * `submissions`, `evidence_files`, `evaluations`.
 * The evaluator ≠ claimant ≠ proposer rule is enforced by a trigger
 * (migration 0003) as well as in the app.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { bountyStatus, outcome, proposalAuthor } from "./enums";
import { entities } from "./entities";
import { users } from "./identity";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const strategies = pgTable(
  "strategies",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    quarter: text("quarter").notNull(),
    memoMd: text("memo_md").notNull(),
    guardResult: text("guard_result"),
    commentOpenUntil: tz("comment_open_until"),
    ratifiedBy: text("ratified_by").references(() => users.id),
    ratifiedAt: tz("ratified_at"),
    commonsPath: text("commons_path"),
    createdAt: tz("created_at").defaultNow(),
  },
  (t) => [unique("strategies_entity_id_quarter_unique").on(t.entityId, t.quarter)],
);

export const proposals = pgTable("proposals", {
  id: text("id").primaryKey(),
  entityId: text("entity_id").references(() => entities.id),
  authorKind: proposalAuthor("author_kind").notNull(),
  authorId: text("author_id"),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  status: text("status").notNull().default("open"),
  rank: integer("rank"),
  rankReasonMd: text("rank_reason_md"),
  strategyId: text("strategy_id").references(() => strategies.id),
  createdAt: tz("created_at").defaultNow(),
});

export const bounties = pgTable(
  "bounties",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    proposalId: text("proposal_id").references(() => proposals.id),
    strategyId: text("strategy_id").references(() => strategies.id),
    title: text("title").notNull(),
    whyMd: text("why_md").notNull(),
    deliverableMd: text("deliverable_md").notNull(),
    verificationTier: smallint("verification_tier").notNull(),
    evidenceSpec: jsonb("evidence_spec").notNull(),
    capUsdc: numeric("cap_usdc", { precision: 12, scale: 2 }).notNull(),
    claimLimit: integer("claim_limit").notNull().default(1),
    deadline: date("deadline", { mode: "string" }),
    evaluatorHatId: numeric("evaluator_hat_id"),
    twinRefs: text("twin_refs").array().notNull(),
    prediction: jsonb("prediction"),
    status: bountyStatus("status").notNull().default("drafted"),
    specSha256: text("spec_sha256").notNull(),
    approvedBy: text("approved_by").references(() => users.id),
    approvedAt: tz("approved_at"),
    easUidPosted: text("eas_uid_posted"),
    commonsPath: text("commons_path"),
    createdAt: tz("created_at").defaultNow(),
  },
  (t) => [
    check("bounties_verification_tier_check", sql`${t.verificationTier} between 1 and 4`),
    index("bounties_entity_id_status_idx").on(t.entityId, t.status),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey(),
    bountyId: text("bounty_id").references(() => bounties.id),
    userId: text("user_id").references(() => users.id),
    claimedAt: tz("claimed_at").defaultNow(),
    releasedAt: tz("released_at"),
  },
  (t) => [unique("claims_bounty_id_user_id_unique").on(t.bountyId, t.userId)],
);

export const submissions = pgTable("submissions", {
  id: text("id").primaryKey(),
  claimId: text("claim_id").references(() => claims.id),
  submittedAt: tz("submitted_at").defaultNow(),
  noteMd: text("note_md"),
  /** the only form the model ever sees */
  evidenceSummary: jsonb("evidence_summary").notNull(),
});

export const evidenceFiles = pgTable("evidence_files", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").references(() => submissions.id),
  r2Key: text("r2_key").notNull(),
  sha256: text("sha256").notNull(),
  mime: text("mime"),
  bytes: integer("bytes"),
  exif: jsonb("exif"),
  gpsLon: numeric("gps_lon"),
  gpsLat: numeric("gps_lat"),
  capturedAt: tz("captured_at"),
  inAppCapture: boolean("in_app_capture").notNull(),
  licenceAcceptedAt: tz("licence_accepted_at").notNull(),
  deletedAt: tz("deleted_at"),
});

export const evaluations = pgTable("evaluations", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").references(() => submissions.id),
  evaluatorId: text("evaluator_id").references(() => users.id),
  outcome: outcome("outcome").notNull(),
  notesMd: text("notes_md"),
  twinSnapshotHash: text("twin_snapshot_hash"),
  secondAttestationBy: text("second_attestation_by").references(() => users.id),
  offchainAttestation: jsonb("offchain_attestation"),
  easUid: text("eas_uid"),
  attestedAt: tz("attested_at"),
  auditOf: text("audit_of").references((): AnyPgColumn => evaluations.id),
  createdAt: tz("created_at").defaultNow(),
});
