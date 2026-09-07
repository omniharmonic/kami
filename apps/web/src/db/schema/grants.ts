/** Grant rounds organize existing proposals; they neither reserve nor pay funds. */
import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { entities } from "./entities";
import { users } from "./identity";
import { proposals } from "./governance";
const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const grantRounds = pgTable("grant_rounds", {
    id: text("id").primaryKey(), entityId: text("entity_id").notNull().references(() => entities.id),
    title: text("title").notNull(), purposeMd: text("purpose_md").notNull(), budgetUsdc: numeric("budget_usdc", { precision: 12, scale: 2 }).notNull(),
    status: text("status").$type<"draft" | "open" | "closed">().notNull().default("draft"),
    applicationDeadline: tz("application_deadline").notNull(), createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: tz("created_at").notNull().defaultNow(), openedAt: tz("opened_at"), closedAt: tz("closed_at"),
}, t => [check("grant_rounds_status_check", sql `${t.status} in ('draft','open','closed')`), check("grant_rounds_budget_positive", sql `${t.budgetUsdc} > 0`), index("grant_rounds_entity_status_idx").on(t.entityId, t.status)]);
export const grantApplications = pgTable("grant_applications", {
    roundId: text("round_id").notNull().references(() => grantRounds.id), proposalId: text("proposal_id").notNull().references(() => proposals.id),
    submittedBy: text("submitted_by").notNull().references(() => users.id), submittedAt: tz("submitted_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.roundId, t.proposalId] })]);
