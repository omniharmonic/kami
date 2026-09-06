/**
 * Strings for the donor report and its mail. No urgency, no fundraising ask,
 * no "give again" — a report is an account of what happened, not a solicitation
 * (PRD §13 #2). Belongs in `src/copy/index.ts`; that file is another package's.
 */
import type { DonorLine, ReportData } from "./donor-report";

export const reportCopy = {
  railLabel: {
    card: "card",
    usdc_direct: "USDC sent directly",
    stablecoin_checkout: "stablecoin checkout",
  } as Record<string, string>,

  balanceHeading: "Balance",
  balanceUnknown: "The Safe's balance could not be read when this report was built, so it is not stated here. It is not zero; it is unknown.",
  inflowsHeading: "What came in",
  inflowsNone: "No donations arrived this month.",
  inflowsPrivacy: "Donations are shown by rail and in total. Who gave is not published, here or anywhere.",
  payoutsHeading: "What went out",
  payoutsNone: "Nothing was paid out this month.",
  humanSigns: "Every one of these was signed by two guardians before it moved.",
  guardedNote:
    "_The paragraph above is written by this kami. Every number in it was checked against the figures in this report before it was published._",
  templatedNote:
    "_The kami's own paragraph did not pass the fact guard this month, so the paragraph above is the plain template. The numbers are the same either way._",
  asOf: (iso: string) => `Assembled ${iso}. Figures are as of that moment.`,
  noToken: "No token, ever. A donation buys no standing, no vote and no return.",

  blockedRefusal: (name: string) =>
    `The ${name} report is held back: the nightly reconciliation between our ledger and the chain has not come out clean, so we do not yet know the numbers well enough to publish them. A steward has been paged. Nothing was sent and nothing was written.`,

  /** Our own numbers, in a sentence. Used whenever the guard holds. */
  templateParagraph: (d: ReportData): string => {
    const parts: string[] = [];
    parts.push(`In ${d.month_label}, ${d.entity.name} received ${d.inflow_totals.count} donation${d.inflow_totals.count === 1 ? "" : "s"} totalling $${d.inflow_totals.gross_usd}, $${d.inflow_totals.net_usd} of which reached the Safe after fees.`);
    if (d.payouts.length === 0) {
      parts.push("Nothing was paid out this month.");
    } else {
      parts.push(`${d.payouts.length} payout${d.payouts.length === 1 ? "" : "s"} totalling $${d.payout_total_usd} USDC went to people who did work on the ground, each signed by two guardians.`);
    }
    parts.push(d.balance.usdc === null ? "The Safe balance could not be read when this report was built." : `The Safe holds ${d.balance.usdc} USDC.`);
    return parts.join(" ");
  },

  /** What the entity is asked for. One paragraph, no numbers it was not given. */
  prompt: (name: string, monthLabel: string): string =>
    [
      `Write one short paragraph for your donors about ${monthLabel}.`,
      "Use only the numbers in the fact sheet you were just given, and say what they mean for the place you speak for.",
      "Do not ask for money, do not thank anyone twice, do not promise anything, and do not claim that any of this caused an ecological change you cannot measure.",
      "Three or four sentences. Plain words.",
      `You are an AI voice for ${name}, not the place and not a legal person.`,
    ].join(" "),

  mail: {
    donorSubject: (name: string, monthLabel: string) => `${name}: what your donation did in ${monthLabel}`,
    donorBody: (name: string, d: ReportData, donor: DonorLine, paragraph: string, source: "entity" | "template"): string => {
      const l: string[] = [];
      l.push(paragraph.trim());
      l.push("");
      l.push(source === "entity" ? "(Every number above was checked against this report before it was sent.)" : "(This paragraph is the plain template: the kami's own words did not pass the fact guard this month.)");
      l.push("");
      l.push(`You gave ${donor.count} time${donor.count === 1 ? "" : "s"} in ${d.month_label}: $${donor.gross_usd} in total, $${donor.net_usd} of it after fees.`);
      l.push("");
      l.push(d.balance.usdc === null ? "Safe balance: could not be read when this report was built." : `Safe balance: ${d.balance.usdc} USDC.`);
      l.push("");
      if (d.payouts.length === 0) {
        l.push("Nothing was paid out this month.");
      } else {
        l.push("Every payment this month, with its transaction and its attestation:");
        for (const p of d.payouts) {
          l.push(`- $${p.amount} USDC to ${p.recipient_handle}${p.bounty_title ? ` — ${p.bounty_title}` : ""}`);
          l.push(`  transaction ${p.safe_tx_hash ?? "pending"}`);
          l.push(`  attestation ${p.eas_uid ?? "pending"}`);
        }
        l.push("");
        l.push("Two guardians signed each of them. The agent can propose a payment and nothing else.");
      }
      l.push("");
      l.push("No token, ever. A donation buys no standing, no vote and no return.");
      l.push("");
      l.push(`Report assembled ${d.as_of}. To ask for a refund, or to be forgotten, reply to this email.`);
      return l.join("\n");
    },
    blockedSubject: (name: string, monthLabel: string) => `${name}: the ${monthLabel} donor report is held back`,
    blockedBody: (name: string, monthLabel: string) =>
      `The ${monthLabel} donor report for ${name} was not sent.\n\nThe nightly reconciliation is not clean (config.donor_report_blocked is set), so the ledger and the chain disagree and the report's numbers cannot be trusted. Nothing was written and no donor was emailed.\n\nResolve the reconciliation findings, let the nightly job clear the flag, then re-run the report.`,
  },
} as const;
