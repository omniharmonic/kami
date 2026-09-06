/**
 * Records — Appendix B `chat_sessions`, `chat_messages`, `commons_notes`,
 * `entity_events` (append-only, hash-chained; see `../events.ts` and migration
 * 0002), `pause_events`, `summon_drafts`, `config`.
 *
 * Deviation: `chat_sessions.ip_hash` (salted, daily-rotating hash of the client
 * IP) is added so the 60/day/IP limit (architecture §5.5) survives a cold start.
 */
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { entities } from "./entities";
import { users } from "./identity";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    userId: text("user_id").references(() => users.id),
    anonKey: text("anon_key"),
    ipHash: text("ip_hash"),
    startedAt: tz("started_at").defaultNow(),
    contributeOptIn: boolean("contribute_opt_in").notNull().default(false),
    turns: integer("turns").default(0),
  },
  (t) => [
    index("chat_sessions_anon_key_idx").on(t.anonKey),
    index("chat_sessions_ip_hash_idx").on(t.ipHash),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: text("session_id").references(() => chatSessions.id),
    at: tz("at").defaultNow(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolcalls: jsonb("toolcalls"),
    guardDropped: integer("guard_dropped").default(0),
    reminder: boolean("reminder").default(false),
  },
  /** 90-day deletion job */
  (t) => [index("chat_messages_at_idx").on(t.at), index("chat_messages_session_id_idx").on(t.sessionId)],
);

export const commonsNotes = pgTable("commons_notes", {
  path: text("path").primaryKey(),
  vault: text("vault").notNull(),
  entityId: text("entity_id").references(() => entities.id),
  kind: text("kind").notNull(),
  updatedAtSeen: tz("updated_at_seen"),
  contentSha256: text("content_sha256"),
  lastSyncedAt: tz("last_synced_at"),
});

/** app role: INSERT and SELECT only (migration 0002) */
export const entityEvents = pgTable(
  "entity_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    at: tz("at").defaultNow(),
    actor: text("actor"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
  },
  (t) => [index("entity_events_entity_id_id_idx").on(t.entityId, t.id)],
);

export const pauseEvents = pgTable("pause_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entityId: text("entity_id").references(() => entities.id),
  at: tz("at").defaultNow(),
  byUser: text("by_user").references(() => users.id),
  /** pause|resume_request|resume|retire */
  action: text("action").notNull(),
});

export const summonDrafts = pgTable("summon_drafts", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  step: integer("step"),
  data: jsonb("data"),
  updatedAt: tz("updated_at"),
});

export const config = pgTable("config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: tz("updated_at").defaultNow(),
});
