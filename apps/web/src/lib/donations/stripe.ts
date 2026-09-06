/**
 * Stripe Checkout, one-time only (architecture §6.6, PRD §13 #2).
 *
 * `mode: "payment"`. There is no `subscription` mode anywhere in this package,
 * no saved payment method, no default amount and no urgency: the amount comes
 * from the donor, the session carries the three metadata keys the webhook
 * needs, and nothing recurs.
 *
 * The client is a narrow interface so tests inject a fake; the real `stripe`
 * package is imported lazily so no key is read at module load.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { getConfig } from "@/lib/jobs/common";
import { donationsEnv, originFrom, type DonationsEnv } from "./env";

// ---------------------------------------------------------------------------
// the slice of Stripe this package uses
// ---------------------------------------------------------------------------

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
};

export type StripeBalanceTransaction = { id: string; fee: number; net: number; amount: number; currency: string };

export type StripeEvent = { id: string; type: string; created?: number; data: { object: unknown } };

export interface StripeLike {
  checkout: { sessions: { create(params: Record<string, unknown>): Promise<StripeCheckoutSession> } };
  paymentIntents: { retrieve(id: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> };
  webhooks: { constructEvent(payload: string | Buffer, header: string, secret: string): StripeEvent };
}

let cached: StripeLike | null | undefined;

/** The real client, or `null` when `STRIPE_SECRET_KEY` is unset (dev, CI, a wrapper that is not live yet). */
export async function getStripe(env: DonationsEnv = donationsEnv()): Promise<StripeLike | null> {
  if (cached !== undefined) return cached;
  if (!env.STRIPE_SECRET_KEY) return (cached = null);
  const { default: Stripe } = await import("stripe");
  return (cached = new Stripe(env.STRIPE_SECRET_KEY) as unknown as StripeLike);
}

/** Test seam: inject a fake, or `null` to rebuild from env on next use. */
export function setStripeForTests(s: StripeLike | null | undefined): void {
  cached = s;
}

// ---------------------------------------------------------------------------
// checkout
// ---------------------------------------------------------------------------

export const DEFAULT_MIN_USD = 1;
export const DEFAULT_MAX_USD = 10_000;

export type CheckoutInput = {
  entityId: string;
  slug: string;
  amountUsd: number;
  donorUserId?: string | null;
};

export type CheckoutDeps = {
  stripe: StripeLike | null;
  now?: () => Date;
  env?: DonationsEnv;
  log?: (line: string) => void;
};

export type CheckoutRefusal = {
  ok: false;
  code: "amount_invalid" | "entity_not_found" | "entity_retired" | "entity_paused" | "no_stripe" | "stripe_error";
  message: string;
  status: 400 | 404 | 409 | 422 | 503;
};

export type CheckoutResult = { ok: true; url: string; session_id: string; donation_id: string; amount_usd: number } | CheckoutRefusal;

export function newDonationId(prefix = "don"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function refuse(code: CheckoutRefusal["code"], message: string, status: CheckoutRefusal["status"]): CheckoutRefusal {
  return { ok: false, code, message, status };
}

/**
 * Build a one-time Checkout Session. The row in `donations` is written by the
 * webhook, not here: an abandoned checkout must leave no trace in the ledger,
 * and `kami_donation_id` travels in the metadata so the webhook is idempotent
 * on the donation as well as on the event.
 */
export async function createCheckoutSession(db: DbOrTx, deps: CheckoutDeps, input: CheckoutInput): Promise<CheckoutResult> {
  const env = deps.env ?? donationsEnv();
  const log = deps.log ?? ((l: string) => console.log(`[donations] ${l}`));

  const amount = Math.round(input.amountUsd * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return refuse("amount_invalid", "Enter an amount greater than zero.", 400);
  const min = Number((await getConfig<number>(db, "donation_min_usd")) ?? DEFAULT_MIN_USD);
  const max = Number((await getConfig<number>(db, "donation_max_usd")) ?? DEFAULT_MAX_USD);
  if (amount < min) return refuse("amount_invalid", `The smallest card donation is $${min.toFixed(2)}.`, 400);
  if (amount > max) return refuse("amount_invalid", `The largest card donation this page takes is $${max.toFixed(2)}. Send USDC directly for more, or write to us.`, 400);

  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, input.entityId)).limit(1);
  if (!entity || entity.slug !== input.slug) return refuse("entity_not_found", "There's no kami by that name.", 404);
  if (entity.retiredAt) return refuse("entity_retired", "This kami has been retired; it no longer takes donations.", 409);

  if (!deps.stripe) return refuse("no_stripe", "Card donations are not switched on yet.", 503);

  const donationId = newDonationId();
  const legalName = (await getConfig<string>(db, "legal_entity_name")) ?? null;
  const origin = originFrom(env);
  const metadata: Record<string, string> = {
    entity_id: entity.id,
    entity_slug: entity.slug,
    kami_donation_id: donationId,
  };
  if (input.donorUserId) metadata.donor_user_id = input.donorUserId;

  try {
    const session = await deps.stripe.checkout.sessions.create({
      mode: "payment",
      submit_type: "donate",
      // one-time only: no `subscription`, no saved card, no default amount.
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: `Donation to ${entity.name}`,
              description: legalName
                ? `A one-time gift, received by ${legalName} and converted to USDC into ${entity.name}'s Safe.`
                : `A one-time gift, converted to USDC into ${entity.name}'s Safe. No charitable wrapper is in place yet, so this is not tax-deductible.`,
            },
          },
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/e/${entity.slug}/donate?thanks=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/e/${entity.slug}/donate?cancelled=1`,
    });
    if (!session.url) return refuse("stripe_error", "Stripe did not return a checkout link. Nothing was charged.", 503);
    log(`checkout ${session.id} for ${entity.slug} ${amount.toFixed(2)} USD donation=${donationId}`);
    return { ok: true, url: session.url, session_id: session.id, donation_id: donationId, amount_usd: amount };
  } catch (err) {
    log(`checkout failed for ${entity.slug}: ${(err as Error).message}`);
    return refuse("stripe_error", "Stripe could not open a checkout just now. Nothing was charged.", 503);
  }
}
