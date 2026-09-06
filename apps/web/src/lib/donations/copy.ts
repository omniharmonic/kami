/**
 * Every string on the donation page. This is the file PRD §13 #2 is about:
 * no urgency, no theatre, no dark pattern, no recurring default, no
 * pre-selected amount, no countdown, no goal bar, no "the creek needs you".
 *
 * The rules, as code rather than as good intentions:
 *  - `treasury.moneyCannotDo` from `src/copy/index.ts` is reused verbatim, so
 *    the promise on the entity page and the promise at the point of payment
 *    cannot drift apart.
 *  - The fee is stated as a number before the button (`fees.ts` is the source).
 *  - The direct-USDC route is given the same weight as the card, not a footnote.
 *  - The legal wrapper is named from `config.legal_entity_name`; when there is
 *    none the page says so and says donations are not tax-deductible.
 *  - `src/lib/donations/__tests__/copy.test.tsx` renders the page and asserts
 *    the forbidden list, the fee number and the "cannot do" items.
 *
 * CLAUDE.md wants one copy module per app. These belong in `src/copy/index.ts`
 * and live here only because that file is another package's; the orchestrator
 * can move them across unchanged (see the report).
 */
import { treasury } from "@/copy";
import { FEE_TABLE, feeExample, feeText } from "./fees";

export const donateCopy = {
  title: (name: string) => `Give to ${name}`,
  eyebrow: "Donation",
  intro: (name: string) =>
    `${name} is an AI voice for a place. Money given here pays people for small, verifiable work on the ground, and two human guardians sign every payment.`,

  amount: {
    heading: "How much",
    label: "Amount in US dollars",
    // Suggestions, never a selection: no `defaultValue`, no `checked`, no preset button is pre-pressed.
    suggestions: [10, 25, 50, 100],
    suggestionsNote: "Suggestions, not a default. Nothing is chosen for you; type any amount instead.",
    placeholder: "0.00",
    oneTime: "One-time. There is no recurring option and no saved card: if you want to give again, you come back and decide again.",
    submit: "Continue to payment",
    submitting: "Opening Stripe…",
    minMax: (min: number, max: number) => `Between $${min.toFixed(2)} and $${max.toFixed(2)} by card. Send USDC directly for anything larger.`,
    invalid: "Enter an amount greater than zero.",
    failed: "The payment page could not be opened. Nothing was charged.",
  },

  fees: {
    heading: "What it costs to give",
    card: `Card: ${feeText("card")} to Stripe. ${feeExample("card", 20)}`,
    stablecoin: `Stripe stablecoin checkout, where offered: ${feeText("stablecoin_checkout")}.`,
    direct: `USDC straight to the Safe: ${feeText("usdc_direct")}. You pay Base gas, which is a fraction of a cent and never reaches us.`,
    platform: "Kami takes nothing on top. The platform does not hold your dollars at any point; Stripe converts and the USDC lands in this kami's Safe.",
    verify: "These rates are Stripe's published figures and are checked against the account before the first live donation.",
  },

  can: {
    heading: "What this money can do",
    items: treasury.moneyCanDo,
  },
  cannot: {
    heading: "What this money cannot do",
    items: treasury.moneyCannotDo,
  },

  humanSigns: {
    heading: "A person signs every payment",
    body: "The agent can propose a payment and nothing else. Two guardians — named people, listed on this kami's page — sign each one from their own wallets. No payment has ever moved out of a Kami Safe on an agent's signature, and the software cannot produce one.",
  },

  direct: {
    heading: "Or send USDC yourself",
    body: "This is the same donation by another road, not a lesser one. Send USDC on the network below straight to the Safe. It arrives without an intermediary and without a fee.",
    address: "Safe address",
    network: "Network",
    token: "Token",
    qrAlt: (name: string) => `QR code of ${name}'s Safe address`,
    noSafe: "This kami has no Safe yet, so it cannot receive USDC directly. Card donations are also switched off until it does.",
    claimHeading: "Sending from your own wallet?",
    claimBody:
      "Direct donations are anonymous by default. If you would like yours in your record and in your monthly report, sign a short message from the sending wallet afterwards; we check the signature against the address the money came from.",
    verifyNote: "Incoming transfers are read from the Safe Transaction Service; a transfer can take a few minutes to appear.",
  },

  wrapper: {
    heading: "Who receives the money",
    named: (legal: string) =>
      `${legal} is the merchant of record for card donations and converts them to USDC. Ask them for a receipt; whether your gift is tax-deductible depends on their status, and this page is not tax advice.`,
    none:
      "There is no charitable wrapper in place yet. Card donations are therefore **not tax-deductible**, and no one here will tell you otherwise. This page is not tax advice.",
  },

  report: {
    heading: "What you get back",
    body: "Within 31 days of the month's end you get an account of the month: the balance, every payment with its transaction hash and its attestation, and one paragraph from the kami whose every number is checked against the readings it came from. Donors of record all get it — that coverage is measured, not asserted.",
    noToken: "No token, ever. Nothing here has a price, and a gift buys no standing, no vote and no return.",
    refund: "There are no refunds — this is an experiment, and a gift to it is a gift, not a purchase. What you get instead is an account of every payout. If a donation was a genuine mistake, or you want to be forgotten, write to us.",
  },

  thanks: {
    heading: "Thank you.",
    body: (name: string) => `Your donation to ${name} was received. It appears in the next monthly report with everything it paid for.`,
  },
  cancelled: {
    heading: "Nothing was charged.",
    body: "You left the payment page. You can pick a different amount, send USDC directly, or simply read on.",
  },

  disclosureNote: "An AI voice for a place, built on public sensor readings. Not the place, not a legal person.",
} as const;

/** The fee sentence the page must contain, as one string (asserted by the test). */
export function feeSentence(): string {
  return donateCopy.fees.card;
}

export { FEE_TABLE };
