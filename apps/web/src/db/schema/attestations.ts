/**
 * Attestations and reputation — Appendix B `attestations`, `reputation_runs`,
 * `reputation_scores`. The reputation function itself lives in `@kami/reputation`.
 */
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { attestationMode } from "./enums";
import { entities } from "./entities";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const attestations = pgTable(
  "attestations",
  {
    uid: text("uid").primaryKey(),
    schema: text("schema").notNull(),
    mode: attestationMode("mode").notNull(),
    attester: text("attester").notNull(),
    entityId: text("entity_id").references(() => entities.id),
    refUid: text("ref_uid"),
    payload: jsonb("payload").notNull(),
    createdAt: tz("created_at").defaultNow(),
    timestampedTx: text("timestamped_tx"),
    timestampedAt: tz("timestamped_at"),
    revokedAt: tz("revoked_at"),
  },
  (t) => [index("attestations_entity_id_schema_idx").on(t.entityId, t.schema)],
);

export const reputationRuns = pgTable("reputation_runs", {
  id: text("id").primaryKey(),
  functionVersion: text("function_version").notNull(),
  computedAt: tz("computed_at").notNull(),
  uids: text("uids").array().notNull(),
  rootOfUids: text("root_of_uids").notNull(),
  scoresUri: text("scores_uri").notNull(),
  easUidSnapshot: text("eas_uid_snapshot"),
});

export const reputationScores = pgTable(
  "reputation_scores",
  {
    runId: text("run_id")
      .notNull()
      .references(() => reputationRuns.id),
    subject: text("subject").notNull(),
    // Part of the primary key, so NOT NULL in practice; the DDL sketch leaves it
    // nullable but Postgres forces NOT NULL on PK columns.
    entityId: text("entity_id").notNull(),
    n: numeric("n"),
    p: numeric("p"),
    score: numeric("score"),
    passportOk: boolean("passport_ok"),
  },
  (t) => [primaryKey({ columns: [t.runId, t.subject, t.entityId] })],
);
