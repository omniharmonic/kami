/**
 * The fee table, as data with its sources (PRD §7.5, architecture §6.6). It is
 * data and not prose so the donation page can state the number *before* the
 * button and a test can assert the page and the ledger agree.
 *
 * Every rate here is *verify* until someone reads it off the live Stripe
 * dashboard for the wrapper's jurisdiction (docs/verify.md #13). The estimate
 * is only ever used when Stripe's own balance transaction is unavailable, and
 * the estimate is flagged as an estimate wherever it is recorded.
 */

export type FeeRail = "card" | "stablecoin_checkout" | "usdc_direct";

export type FeeRow = {
  rail: FeeRail;
  /** what a donor sees */
  label: string;
  /** percentage points taken off the gross, e.g. 2.9 */
  percent: number;
  /** flat cents-on-the-transaction component, in dollars, e.g. 0.30 */
  fixed_usd: number;
  /** where the number comes from */
  source: string;
  /** false until docs/verify.md #13 is ticked */
  verified: boolean;
};

export const FEE_TABLE: Record<FeeRail, FeeRow> = {
  card: {
    rail: "card",
    label: "card (Stripe Checkout)",
    percent: 2.9,
    fixed_usd: 0.3,
    source: "PRD §7.5 / architecture §6.6, from B2 §4.4 (US card present-less pricing) — *verify* against the wrapper's live Stripe pricing",
    verified: false,
  },
  stablecoin_checkout: {
    rail: "stablecoin_checkout",
    label: "stablecoin checkout (Stripe)",
    percent: 1.5,
    fixed_usd: 0,
    source: "PRD §7.5 stablecoin checkout 1.5 % — *verify* availability and rate (docs/verify.md #13)",
    verified: false,
  },
  usdc_direct: {
    rail: "usdc_direct",
    label: "USDC straight to the Safe",
    percent: 0,
    fixed_usd: 0,
    source: "no intermediary; the sender pays Base gas, which never reaches this platform",
    verified: true,
  },
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type FeeEstimate = {
  gross_usd: number;
  fee_usd: number;
  net_usd: number;
  /** `estimate` means the rate table was used because Stripe told us nothing. */
  basis: "estimate";
  rail: FeeRail;
};

/** The stated rate applied to a gross amount. Never used when Stripe reports the real fee. */
export function estimateFee(rail: FeeRail, grossUsd: number): FeeEstimate {
  const row = FEE_TABLE[rail];
  const gross = round2(grossUsd);
  const fee = Math.min(gross, round2((gross * row.percent) / 100 + row.fixed_usd));
  return { gross_usd: gross, fee_usd: fee, net_usd: round2(gross - fee), basis: "estimate", rail };
}

/** "2.9% + 30¢" / "1.5%" / "no platform fee" — the string the donation page shows. */
export function feeText(rail: FeeRail): string {
  const row = FEE_TABLE[rail];
  if (row.percent === 0 && row.fixed_usd === 0) return "no platform fee";
  const cents = Math.round(row.fixed_usd * 100);
  const pct = `${row.percent}%`;
  return cents > 0 ? `${pct} + ${cents}¢` : pct;
}

/** "$20.00 → Stripe takes $0.88 → $19.12 reaches the Safe" for a concrete amount. */
export function feeExample(rail: FeeRail, grossUsd: number): string {
  const e = estimateFee(rail, grossUsd);
  if (e.fee_usd === 0) return `$${e.gross_usd.toFixed(2)} arrives whole; nothing is deducted here.`;
  return `$${e.gross_usd.toFixed(2)} → ${feeText(rail)} = $${e.fee_usd.toFixed(2)} → $${e.net_usd.toFixed(2)} reaches the Safe.`;
}
