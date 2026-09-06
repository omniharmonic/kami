/**
 * `POST /api/webhooks/stripe` as a function (architecture §6.6, plan T2.10).
 *
 * Order: verify the signature over the *raw* body → claim `event.id` in
 * `config.stripe_events.<id>` (insert-if-absent, so a Stripe retry is a no-op)
 * → handle `checkout.session.completed` → everything else is a logged no-op.
 *
 * The fee is Stripe's own number from the charge's balance transaction when it
 * is available. When it is not, the stated 2.9 % + 30¢ estimate is used and
 * recorded as an estimate in the `donation.recorded` event — a guessed fee is
 * never allowed to look like a measured one (the same rule the readings obey).
 *
 * A session for an entity we do not have is **rejected**, not dropped: the
 * claim is released, `config.alerts.stripe_unknown_entity.<event id>` is
 * written, and the caller answers 422 so it shows up in Stripe's own dashboard.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { claimConfigKey, deleteConfig, getConfig, listConfig, setConfig } from "@/lib/jobs/common";
import { estimateFee, round2 } from "./fees";
import { newDonationId, type StripeCheckoutSession, type StripeEvent, type StripeLike } from "./stripe";

export const STRIPE_EVENT_PREFIX = "stripe_events.";

export type WebhookDeps = {
  stripe: StripeLike | null;
  webhookSecret: string | undefined;
  now?: () => Date;
  log?: (line: string) => void;
};

export type WebhookOk = {
  ok: true;
  status: 200;
  event_id: string;
  type: string;
  outcome: "recorded" | "duplicate" | "ignored";
  donation_id?: string;
  /** where the fee number came from — never guessed silently */
  fee_source?: "balance_transaction" | "estimate";
};

export type WebhookRefusal = {
  ok: false;
  status: 400 | 422 | 503;
  code: "no_signature" | "bad_signature" | "not_configured" | "unknown_entity" | "malformed";
  message: string;
  event_id?: string;
};

export type WebhookResult = WebhookOk | WebhookRefusal;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Stripe's fee for this charge, in dollars, or `null` when the API cannot tell us. */
export async function feeFromBalanceTransaction(
  stripe: StripeLike | null,
  session: StripeCheckoutSession,
  log: (line: string) => void,
): Promise<{ fee_usd: number; net_usd: number; currency: string } | null> {
  if (!stripe) return null;
  const pi = session.payment_intent;
  const piId = typeof pi === "string" ? pi : isRecord(pi) ? String((pi as { id?: string }).id ?? "") : "";
  if (!piId) return null;
  try {
    const full = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge.balance_transaction"] });
    const charge = (full as { latest_charge?: unknown }).latest_charge;
    if (!isRecord(charge)) return null;
    const bt = charge.balance_transaction;
    if (!isRecord(bt) || typeof bt.fee !== "number" || typeof bt.net !== "number") return null;
    return { fee_usd: round2(bt.fee / 100), net_usd: round2(bt.net / 100), currency: String(bt.currency ?? "usd") };
  } catch (err) {
    log(`balance transaction unavailable for ${piId}: ${(err as Error).message}`);
    return null;
  }
}

async function userExists(db: Db, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return u?.id ?? null;
}

export async function handleStripeWebhook(
  db: Db,
  deps: WebhookDeps,
  args: { rawBody: string | Buffer; signature: string | null },
): Promise<WebhookResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((l: string) => console.log(`[stripe] ${l}`));

  if (!deps.webhookSecret || !deps.stripe) {
    return { ok: false, status: 503, code: "not_configured", message: "Stripe webhooks are not configured on this deployment." };
  }
  if (!args.signature) return { ok: false, status: 400, code: "no_signature", message: "Missing Stripe-Signature." };

  let event: StripeEvent;
  try {
    event = deps.stripe.webhooks.constructEvent(args.rawBody, args.signature, deps.webhookSecret);
  } catch (err) {
    log(`signature check failed: ${(err as Error).message}`);
    return { ok: false, status: 400, code: "bad_signature", message: "Signature does not verify over the raw body." };
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    return { ok: false, status: 400, code: "malformed", message: "Event has no id or type." };
  }

  const key = `${STRIPE_EVENT_PREFIX}${event.id}`;
  const claimed = await claimConfigKey(db, key, { type: event.type, seen_at: now().toISOString() }, now());
  if (!claimed) {
    log(`duplicate ${event.type} ${event.id}`);
    return { ok: true, status: 200, event_id: event.id, type: event.type, outcome: "duplicate" };
  }

  try {
    if (event.type !== "checkout.session.completed") {
      log(`no-op for ${event.type} ${event.id}`);
      return { ok: true, status: 200, event_id: event.id, type: event.type, outcome: "ignored" };
    }
    return await recordCheckoutSession(db, deps, event, now, log);
  } catch (err) {
    // Release the claim so Stripe's retry is not swallowed by our own idempotency.
    await deleteConfig(db, key).catch(() => {});
    throw err;
  }
}

async function recordCheckoutSession(
  db: Db,
  deps: WebhookDeps,
  event: StripeEvent,
  now: () => Date,
  log: (line: string) => void,
): Promise<WebhookResult> {
  const session = event.data.object as StripeCheckoutSession;
  const at = event.created ? new Date(event.created * 1000) : now();

  if (session.payment_status && session.payment_status !== "paid") {
    log(`session ${session.id} is ${session.payment_status}, not paid — nothing recorded`);
    return { ok: true, status: 200, event_id: event.id, type: event.type, outcome: "ignored" };
  }

  const meta = session.metadata ?? {};
  const entityId = meta.entity_id ?? "";
  const [entity] = entityId ? await db.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1) : [];
  if (!entity) {
    await deleteConfig(db, `${STRIPE_EVENT_PREFIX}${event.id}`).catch(() => {});
    await setConfig(
      db,
      `alerts.stripe_unknown_entity.${event.id}`,
      { at: now().toISOString(), session_id: session.id, entity_id: entityId || null, amount_total: session.amount_total ?? null },
      now(),
    );
    log(`REJECTED ${event.id}: session ${session.id} names entity ${entityId || "(none)"} which does not exist`);
    return {
      ok: false,
      status: 422,
      code: "unknown_entity",
      message: `No entity ${entityId || "(none)"}; the charge is recorded by Stripe but not by us. A steward must reconcile it by hand.`,
      event_id: event.id,
    };
  }

  const grossUsd = round2((session.amount_total ?? 0) / 100);
  const real = await feeFromBalanceTransaction(deps.stripe, session, log);
  const estimated = estimateFee("card", grossUsd);
  const fee = real ? real.fee_usd : estimated.fee_usd;
  const net = real ? real.net_usd : estimated.net_usd;
  const currency = (real?.currency ?? session.currency ?? "usd").toLowerCase();
  const feeSource: "balance_transaction" | "estimate" = real ? "balance_transaction" : "estimate";

  const donationId = meta.kami_donation_id || newDonationId();
  const donorUserId = await userExists(db, meta.donor_user_id ?? null);

  const inserted = await db
    .insert(schema.donations)
    .values({
      id: donationId,
      entityId: entity.id,
      donorUserId,
      rail: "card",
      gross: grossUsd.toFixed(2),
      fee: fee.toFixed(2),
      net: net.toFixed(2),
      currency,
      stripeSessionId: session.id,
      receivedAt: at,
    })
    .onConflictDoNothing()
    .returning({ id: schema.donations.id });

  if (inserted.length === 0) {
    log(`donation for session ${session.id} already recorded`);
    return { ok: true, status: 200, event_id: event.id, type: event.type, outcome: "duplicate", donation_id: donationId };
  }

  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: "stripe",
    kind: "donation.recorded",
    payload: {
      donation_id: donationId,
      rail: "card",
      gross_usd: grossUsd.toFixed(2),
      fee_usd: fee.toFixed(2),
      net_usd: net.toFixed(2),
      currency,
      // `donations` has no column for this (schema gap): the flag lives here.
      fee_source: feeSource,
      fee_estimated: feeSource === "estimate",
      stripe_session_id: session.id,
      stripe_event_id: event.id,
      donor_known: Boolean(donorUserId),
    },
    at,
  });

  log(`recorded ${donationId} for ${entity.slug}: gross ${grossUsd.toFixed(2)} fee ${fee.toFixed(2)} (${feeSource}) net ${net.toFixed(2)}`);
  return { ok: true, status: 200, event_id: event.id, type: event.type, outcome: "recorded", donation_id: donationId, fee_source: feeSource };
}

/**
 * Housekeeping for the idempotency keys (architecture §11 data retention): they
 * only have to outlive Stripe's retry window. Called by the monthly report job.
 */
export async function pruneStripeEvents(db: Db, olderThan: Date): Promise<number> {
  const rows = await listConfig(db, STRIPE_EVENT_PREFIX);
  let removed = 0;
  for (const r of rows) {
    const seen = isRecord(r.value) && typeof r.value.seen_at === "string" ? Date.parse(r.value.seen_at) : Date.parse(r.updated_at ?? "");
    if (Number.isFinite(seen) && seen < olderThan.getTime()) {
      await deleteConfig(db, r.key);
      removed += 1;
    }
  }
  return removed;
}

/** Did we already see this Stripe event? (tests and the admin screen) */
export async function stripeEventSeen(db: Db, eventId: string): Promise<boolean> {
  return (await getConfig(db, `${STRIPE_EVENT_PREFIX}${eventId}`)) !== undefined;
}
