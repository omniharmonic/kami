/**
 * Money — Appendix B `safe_proposals`, `payouts`, `donations`, `treasury_transfers`,
 * `tax_forms`, `donor_reports`, `reconciliations`.
 */
import {
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { donationRail, payoutRail } from "./enums";
import { entities } from "./entities";
import { submissions } from "./governance";
import { users } from "./identity";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const usdc = (name: string) => numeric(name, { precision: 12, scale: 2 });

export const safeProposals = pgTable("safe_proposals", {
  safeTxHash: text("safe_tx_hash").primaryKey(),
  entityId: text("entity_id").references(() => entities.id),
  submissionId: text("submission_id").references(() => submissions.id),
  nonce: integer("nonce"),
  toAddress: text("to_address"),
  amountUsdc: usdc("amount_usdc"),
  proposedAt: tz("proposed_at").defaultNow(),
  confirmations: integer("confirmations").notNull().default(0),
  executedTxHash: text("executed_tx_hash"),
  /** pending|executed|rejected|expired */
  status: text("status").notNull().default("pending"),
});

export const payouts = pgTable("payouts", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").references(() => submissions.id),
  rail: payoutRail("rail").notNull(),
  amountUsdc: usdc("amount_usdc").notNull(),
  usdValueAtPayment: usdc("usd_value_at_payment"),
  safeTxHash: text("safe_tx_hash"),
  txHash: text("tx_hash"),
  executedAt: tz("executed_at"),
  easUidCompleted: text("eas_uid_completed"),
  recipientAddress: text("recipient_address"),
  recipientUserId: text("recipient_user_id").references(() => users.id),
});

export const donations = pgTable("donations", {
  id: text("id").primaryKey(),
  entityId: text("entity_id").references(() => entities.id),
  donorUserId: text("donor_user_id").references(() => users.id),
  rail: donationRail("rail").notNull(),
  gross: usdc("gross"),
  fee: usdc("fee"),
  net: usdc("net"),
  currency: text("currency"),
  stripeSessionId: text("stripe_session_id").unique(),
  chainTxHash: text("chain_tx_hash"),
  receivedAt: tz("received_at").defaultNow(),
  reportedIn: text("reported_in"),
});

export const treasuryTransfers = pgTable("treasury_transfers", {
  id: text("id").primaryKey(),
  entityId: text("entity_id").references(() => entities.id),
  amountUsdc: usdc("amount_usdc"),
  txHash: text("tx_hash"),
  /** conversion_in|safe_out_retire|… */
  kind: text("kind").notNull(),
  at: tz("at").defaultNow(),
});

export const taxForms = pgTable(
  "tax_forms",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    taxYear: integer("tax_year").notNull(),
    cumulativeUsd: usdc("cumulative_usd").notNull().default("0"),
    formKind: text("form_kind"),
    collectedBy: text("collected_by"),
    collectedAt: tz("collected_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.taxYear] })],
);

export const donorReports = pgTable(
  "donor_reports",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    month: date("month", { mode: "string" }).notNull(),
    data: jsonb("data").notNull(),
    narrativeMd: text("narrative_md"),
    guardResult: text("guard_result"),
    publicMd: text("public_md"),
    commonsPath: text("commons_path"),
    sentAt: tz("sent_at"),
    donorsNotified: integer("donors_notified"),
    donorsTotal: integer("donors_total"),
  },
  (t) => [unique("donor_reports_entity_id_month_unique").on(t.entityId, t.month)],
);

export const reconciliations = pgTable("reconciliations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entityId: text("entity_id").references(() => entities.id),
  at: tz("at").defaultNow(),
  ok: boolean("ok").notNull(),
  findings: jsonb("findings").notNull(),
});
