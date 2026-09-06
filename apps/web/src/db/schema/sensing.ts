/**
 * Sensing — Appendix B `need_snapshots`, `pulses`, `guard_events`, `usage_events`.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { mood } from "./enums";
import { entities } from "./entities";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const needSnapshots = pgTable(
  "need_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    asOf: tz("as_of").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    mood: mood("mood").notNull(),
    staleDriving: boolean("stale_driving").notNull(),
  },
  (t) => [
    unique("need_snapshots_entity_id_as_of_unique").on(t.entityId, t.asOf),
    index("need_snapshots_entity_id_as_of_idx").on(t.entityId, t.asOf.desc()),
  ],
);

export const pulses = pgTable(
  "pulses",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    at: tz("at").notNull().defaultNow(),
    woke: boolean("woke").notNull(),
    snapshotId: bigint("snapshot_id", { mode: "number" }).references(() => needSnapshots.id),
    deltas: jsonb("deltas"),
    text: text("text"),
    guardResult: text("guard_result"),
    tokensPrompt: integer("tokens_prompt"),
    tokensOutput: integer("tokens_output"),
  },
  (t) => [
    check("pulses_guard_result_check", sql`${t.guardResult} in ('pass','dropped','held')`),
    index("pulses_entity_id_at_idx").on(t.entityId, t.at.desc()),
  ],
);

export const guardEvents = pgTable(
  "guard_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    at: tz("at").defaultNow(),
    /** chat|pulse|weekly|quarterly|report */
    context: text("context").notNull(),
    sentence: text("sentence").notNull(),
    unmatched: jsonb("unmatched").notNull(),
    /** dropped|regenerated|held */
    action: text("action").notNull(),
  },
  (t) => [index("guard_events_entity_id_at_idx").on(t.entityId, t.at.desc())],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    at: tz("at").defaultNow(),
    job: text("job").notNull(),
    tokensPrompt: integer("tokens_prompt").notNull(),
    tokensOutput: integer("tokens_output").notNull(),
    latencyMs: integer("latency_ms"),
    model: text("model"),
  },
  (t) => [index("usage_events_entity_id_at_idx").on(t.entityId, t.at.desc())],
);
