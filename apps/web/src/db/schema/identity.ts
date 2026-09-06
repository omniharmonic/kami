/**
 * Identity — Appendix B `users`, `steward_orgs`, `entity_roles`, `guardian_invites`,
 * plus the three tables Better Auth owns (`session`, `account`, `verification`).
 *
 * Notes on deviations from the DDL sketch:
 * - `citext` is not available on every Neon plan without the extension, so `email`
 *   is `text` with a lowercase CHECK; the app lowercases before writing.
 * - Better Auth 1.7 requires `email_verified`, `image`, `updated_at` on the user
 *   model; they are added to `users` (the sketch only says "Better Auth owns:
 *   session, account, verification").
 * - TS keys are camelCase for the Better-Auth-owned models (the drizzle adapter
 *   maps by TS key); SQL column names follow the DDL.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { entityRole } from "./enums";
import { entities } from "./entities";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    privyDid: text("privy_did").unique(),
    walletAddress: text("wallet_address").unique(),
    passportScore: numeric("passport_score"),
    passportCheckedAt: tz("passport_checked_at"),
    platformAdmin: boolean("platform_admin").notNull().default(false),
    ageGateOk: boolean("age_gate_ok").notNull().default(false),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [check("users_email_lower", sql`${t.email} = lower(${t.email})`)],
);

// --- Better Auth owned ------------------------------------------------------

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: tz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    idToken: text("id_token"),
    // Magic links only: no password is ever written here (T1.2). Better Auth's
    // credential provider is not enabled, so this column stays null forever.
    password: text("password"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// --- Kami ------------------------------------------------------------------

export const stewardOrgs = pgTable("steward_orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  legalNote: text("legal_note"),
  createdAt: tz("created_at").defaultNow(),
});

export const entityRoles = pgTable(
  "entity_roles",
  {
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: entityRole("role").notNull(),
    hatId: numeric("hat_id"),
    invitedAt: tz("invited_at").defaultNow(),
    acceptedAt: tz("accepted_at"),
    revokedAt: tz("revoked_at"),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.userId, t.role] })],
);

export const guardianInvites = pgTable(
  "guardian_invites",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    email: text("email"),
    tokenHash: text("token_hash"),
    expiresAt: tz("expires_at"),
    acceptedUserId: text("accepted_user_id").references(() => users.id),
  },
  (t) => [check("guardian_invites_email_lower", sql`${t.email} is null or ${t.email} = lower(${t.email})`)],
);
