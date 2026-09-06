/**
 * Entities — Appendix B `entities`, `entity_bindings`, `souls`.
 * `entities.id` is `entity/<slug>` (docs/naming.md); the CHECK enforces it.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { archetype, reviewState } from "./enums";
import { stewardOrgs, users } from "./identity";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const entities = pgTable(
  "entities",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    archetype: archetype("archetype").notNull(),
    stewardOrgId: text("steward_org_id").references(() => stewardOrgs.id),
    bindingVersion: integer("binding_version"),
    soulVersion: integer("soul_version"),
    safeAddress: text("safe_address"),
    chainId: integer("chain_id"),
    proposerAddress: text("proposer_address"),
    guardiansHatId: numeric("guardians_hat_id"),
    hermesProfile: text("hermes_profile").unique(),
    riveConfig: jsonb("rive_config").notNull().default(sql`'{}'::jsonb`),
    cosmetics: jsonb("cosmetics").notNull().default(sql`'{}'::jsonb`),
    consultationMd: text("consultation_md"),
    consultationDoneAt: tz("consultation_done_at"),
    pausedAt: tz("paused_at"),
    retiredAt: tz("retired_at"),
    easUidRegistered: text("eas_uid_registered"),
    createdBy: text("created_by").references((): AnyPgColumn => users.id),
    createdAt: tz("created_at").defaultNow(),
  },
  (t) => [
    check("entities_id_format", sql`${t.id} ~ '^entity/[a-z0-9-]+$'`),
    index("entities_archetype_idx").on(t.archetype).where(sql`${t.retiredAt} is null`),
  ],
);

export const entityBindings = pgTable(
  "entity_bindings",
  {
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    bindingVersion: integer("binding_version").notNull(),
    binding: jsonb("binding").notNull(),
    sha256: text("sha256").notNull(),
    review: reviewState("review").notNull().default("pending_review"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewedAt: tz("reviewed_at"),
    createdAt: tz("created_at").defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.bindingVersion] })],
);

export const souls = pgTable(
  "souls",
  {
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    soulVersion: integer("soul_version").notNull(),
    hardRulesVersion: text("hard_rules_version").notNull(),
    voiceMd: text("voice_md").notNull(),
    editedBy: text("edited_by").references(() => users.id),
    createdAt: tz("created_at").defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.soulVersion] })],
);
