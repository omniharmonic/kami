/**
 * `tax_forms`: cumulative USD paid to a person in a tax year, and the W-9/W-8
 * gate in front of the payout that would cross the line (architecture §7.7,
 * plan T2.16).
 *
 * **Not tax advice.** Two numbers matter and they are different numbers:
 *
 *  - `config.tax_form_threshold_usd` — **default 1500** — is *our* threshold:
 *    the point at which we stop and ask for a form, deliberately below the
 *    statutory one so nobody is surprised at the last dollar.
 *  - `STATUTORY_1099_THRESHOLD_2026_USD` — **2000** — is the 1099 reporting
 *    threshold for tax year 2026 (architecture §7.7, from B2 §4.5).
 *
 * Who files depends on `config.tax_collector`: `platform` (we collect and file)
 * or `sponsor` (a fiscal sponsor pays and handles it, and this gate stands
 * down entirely — architecture §7.8, the wrapper is config).
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { getConfig } from "@/lib/jobs/common";

/** Our own ask-early threshold. */
export const DEFAULT_FORM_THRESHOLD_USD = 1500;
/** The statutory 1099 threshold for tax year 2026 (flagged, not advised). */
export const STATUTORY_1099_THRESHOLD_2026_USD = 2000;

export type TaxCollector = "platform" | "sponsor";
export type FormKind = "W-9" | "W-8BEN" | "W-8BEN-E";

export function taxYearOf(d: Date): number {
  return d.getUTCFullYear();
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function formThreshold(db: DbOrTx): Promise<number> {
  const v = await getConfig<number | string>(db, "tax_form_threshold_usd");
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FORM_THRESHOLD_USD;
}

export async function taxCollector(db: DbOrTx): Promise<TaxCollector> {
  const v = await getConfig<string>(db, "tax_collector");
  return v === "sponsor" ? "sponsor" : "platform";
}

export type TaxFormRow = {
  user_id: string;
  tax_year: number;
  cumulative_usd: number;
  form_kind: string | null;
  collected_by: string | null;
  collected_at: string | null;
};

export async function readForm(db: DbOrTx, userId: string, year: number): Promise<TaxFormRow | null> {
  const [row] = await db
    .select()
    .from(schema.taxForms)
    .where(and(eq(schema.taxForms.userId, userId), eq(schema.taxForms.taxYear, year)))
    .limit(1);
  if (!row) return null;
  return {
    user_id: row.userId,
    tax_year: row.taxYear,
    cumulative_usd: Number(row.cumulativeUsd ?? 0),
    form_kind: row.formKind,
    collected_by: row.collectedBy,
    collected_at: row.collectedAt?.toISOString() ?? null,
  };
}

/**
 * Add a settled payout to the person's running total for the year. Called once
 * per payout, after it is mined — never on a proposal.
 */
export async function recordPayoutForTax(
  db: Db,
  userId: string,
  year: number,
  usd: number,
): Promise<{ cumulative_usd: number; threshold_usd: number; needs_form: boolean; collected: boolean }> {
  const amount = round2(usd);
  if (!Number.isFinite(amount) || amount < 0) throw new TypeError(`recordPayoutForTax: bad amount ${usd}`);
  await db
    .insert(schema.taxForms)
    .values({ userId, taxYear: year, cumulativeUsd: amount.toFixed(2) })
    .onConflictDoUpdate({
      target: [schema.taxForms.userId, schema.taxForms.taxYear],
      set: { cumulativeUsd: sql`${schema.taxForms.cumulativeUsd} + ${amount.toFixed(2)}` },
    });
  const row = await readForm(db, userId, year);
  const threshold = await formThreshold(db);
  const cumulative = row?.cumulative_usd ?? amount;
  return {
    cumulative_usd: cumulative,
    threshold_usd: threshold,
    needs_form: cumulative >= threshold && !row?.collected_at,
    collected: Boolean(row?.collected_at),
  };
}

/** True when this person is at or over the threshold for `year` and has filed nothing. */
export async function needsForm(db: DbOrTx, userId: string, year: number): Promise<boolean> {
  if ((await taxCollector(db)) === "sponsor") return false;
  const row = await readForm(db, userId, year);
  if (!row) return false;
  if (row.collected_at) return false;
  return row.cumulative_usd >= (await formThreshold(db));
}

export type PayoutBlock = {
  blocked: boolean;
  reason: "form_required" | null;
  cumulative_usd: number;
  /** cumulative + the payout being considered */
  would_be_usd: number;
  threshold_usd: number;
  statutory_threshold_usd: number;
  collector: TaxCollector;
  form_kind: string | null;
  /** never advice — the copy the UI shows */
  note: string;
};

export const NOT_ADVICE =
  "We ask for a W-9 (or W-8 if you are outside the US) once payouts reach this level. The 1099 reporting threshold for tax year 2026 is $2,000; we ask earlier so nothing is a surprise. This is a description of our process, not tax advice.";

/**
 * **The predicate the signing service calls before it proposes a payout.**
 *
 * Pure read; it writes nothing and refuses nothing on its own. `blocked` is
 * true when this payout would take the person to or past the threshold and no
 * form is on file. Under a fiscal sponsor (`config.tax_collector = "sponsor"`)
 * it is never blocked — the sponsor files.
 */
export async function blockPayoutUntilForm(
  db: DbOrTx,
  userId: string,
  amountUsd: number,
  now: Date = new Date(),
): Promise<PayoutBlock> {
  const year = taxYearOf(now);
  const collector = await taxCollector(db);
  const threshold = await formThreshold(db);
  const row = await readForm(db, userId, year);
  const cumulative = row?.cumulative_usd ?? 0;
  const wouldBe = round2(cumulative + (Number.isFinite(amountUsd) ? amountUsd : 0));
  const blocked = collector === "platform" && !row?.collected_at && wouldBe >= threshold;
  return {
    blocked,
    reason: blocked ? "form_required" : null,
    cumulative_usd: cumulative,
    would_be_usd: wouldBe,
    threshold_usd: threshold,
    statutory_threshold_usd: STATUTORY_1099_THRESHOLD_2026_USD,
    collector,
    form_kind: row?.form_kind ?? null,
    note: NOT_ADVICE,
  };
}

/** A steward records that a form was received. The document itself never enters this database. */
export async function collectForm(
  db: Db,
  userId: string,
  kind: FormKind,
  collectedBy: string,
  opts: { year?: number; now?: Date } = {},
): Promise<TaxFormRow> {
  const now = opts.now ?? new Date();
  const year = opts.year ?? taxYearOf(now);
  await db
    .insert(schema.taxForms)
    .values({ userId, taxYear: year, cumulativeUsd: "0", formKind: kind, collectedBy, collectedAt: now })
    .onConflictDoUpdate({
      target: [schema.taxForms.userId, schema.taxForms.taxYear],
      set: { formKind: kind, collectedBy, collectedAt: now },
    });
  const row = await readForm(db, userId, year);
  if (!row) throw new Error(`collectForm: row for ${userId}/${year} vanished`);
  return row;
}

export type TaxStatus = {
  user_id: string;
  tax_year: number;
  cumulative_usd: number;
  threshold_usd: number;
  statutory_threshold_usd: number;
  collector: TaxCollector;
  needs_form: boolean;
  form_kind: string | null;
  collected_at: string | null;
  note: string;
};

/**
 * Everything `/me` needs to show a person their own position. `/me` belongs to
 * the governance package; this is the read it should call (see the report).
 */
export async function taxStatusFor(db: DbOrTx, userId: string, now: Date = new Date()): Promise<TaxStatus> {
  const year = taxYearOf(now);
  const row = await readForm(db, userId, year);
  const threshold = await formThreshold(db);
  const collector = await taxCollector(db);
  const cumulative = row?.cumulative_usd ?? 0;
  return {
    user_id: userId,
    tax_year: year,
    cumulative_usd: cumulative,
    threshold_usd: threshold,
    statutory_threshold_usd: STATUTORY_1099_THRESHOLD_2026_USD,
    collector,
    needs_form: collector === "platform" && !row?.collected_at && cumulative >= threshold,
    form_kind: row?.form_kind ?? null,
    collected_at: row?.collected_at ?? null,
    note: NOT_ADVICE,
  };
}
