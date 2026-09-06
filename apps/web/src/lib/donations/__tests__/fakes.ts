/**
 * Fakes for the donation rails: no Stripe, no RPC, no Transaction Service.
 * The chain-side fakes are `src/lib/treasury/__tests__/fakes.ts` (reused, not
 * duplicated); only the Stripe slice is new here.
 */
import type { StripeCheckoutSession, StripeEvent, StripeLike } from "../stripe";

export const GOOD_SIGNATURE = "t=1,v1=good";

export class FakeStripe implements StripeLike {
  readonly created: Array<Record<string, unknown>> = [];
  /** payment intent id → expanded charge with a balance transaction */
  readonly balanceTransactions = new Map<string, { fee: number; net: number; currency: string }>();
  nextSessionId = "cs_test_1";
  nextUrl: string | null = "https://checkout.stripe.test/cs_test_1";
  createThrows = false;
  piThrows = false;

  checkout = {
    sessions: {
      create: async (params: Record<string, unknown>): Promise<StripeCheckoutSession> => {
        if (this.createThrows) throw new Error("stripe down");
        this.created.push(params);
        return { id: this.nextSessionId, url: this.nextUrl };
      },
    },
  };

  paymentIntents = {
    retrieve: async (id: string): Promise<Record<string, unknown>> => {
      if (this.piThrows) throw new Error("no such payment intent");
      const bt = this.balanceTransactions.get(id);
      if (!bt) return { id, latest_charge: null };
      return { id, latest_charge: { id: `ch_${id}`, balance_transaction: { id: `txn_${id}`, fee: bt.fee, net: bt.net, currency: bt.currency, amount: bt.fee + bt.net } } };
    },
  };

  webhooks = {
    constructEvent: (payload: string | Buffer, header: string, secret: string): StripeEvent => {
      if (!secret) throw new Error("no secret");
      if (header !== GOOD_SIGNATURE) throw new Error("No signatures found matching the expected signature for payload");
      return JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8")) as StripeEvent;
    },
  };
}

export function checkoutCompletedEvent(args: {
  eventId: string;
  sessionId?: string;
  entityId: string;
  donationId?: string;
  donorUserId?: string | null;
  amountCents?: number;
  paymentIntent?: string | null;
  created?: number;
  paymentStatus?: string;
}): StripeEvent {
  const metadata: Record<string, string> = { entity_id: args.entityId, kami_donation_id: args.donationId ?? "don_test_1" };
  if (args.donorUserId) metadata.donor_user_id = args.donorUserId;
  return {
    id: args.eventId,
    type: "checkout.session.completed",
    created: args.created ?? Math.floor(Date.parse("2026-09-06T12:00:00Z") / 1000),
    data: {
      object: {
        id: args.sessionId ?? "cs_test_1",
        url: null,
        amount_total: args.amountCents ?? 2000,
        currency: "usd",
        payment_status: args.paymentStatus ?? "paid",
        payment_intent: args.paymentIntent === undefined ? "pi_test_1" : args.paymentIntent,
        metadata,
      } satisfies StripeCheckoutSession,
    },
  };
}

export function otherEvent(eventId: string, type = "payment_intent.created"): StripeEvent {
  return { id: eventId, type, created: 1, data: { object: { id: "pi_x" } } };
}
