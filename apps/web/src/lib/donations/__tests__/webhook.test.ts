/**
 * The Stripe webhook: signature over the raw body, idempotency by `event.id`,
 * the fee's provenance, and the refusal for a session naming an entity we do
 * not have (T2.10, X.1 "Stripe idempotency").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listEntityEvents } from "@/db/events";
import { closeTestDb, createTestDb, seedEntity, seedUser, type TestDb } from "@/db/test-utils";
import { getConfig } from "@/lib/jobs/common";
import { handleStripeWebhook, STRIPE_EVENT_PREFIX, stripeEventSeen } from "../webhook";
import { createCheckoutSession } from "../stripe";
import { checkoutCompletedEvent, FakeStripe, GOOD_SIGNATURE, otherEvent } from "./fakes";

let db: TestDb;
let stripe: FakeStripe;
const NOW = new Date("2026-09-06T12:00:00.000Z");
const SECRET = "whsec_test";

function deps(overrides: Partial<{ webhookSecret: string | undefined }> = {}) {
  const logs: string[] = [];
  return {
    d: { stripe: stripe as unknown as FakeStripe, webhookSecret: SECRET, now: () => NOW, log: (l: string) => logs.push(l), ...overrides },
    logs,
  };
}

beforeEach(async () => {
  db = await createTestDb();
  stripe = new FakeStripe();
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("handleStripeWebhook", () => {
  it("is idempotent by event.id: the same event twice writes one donation row", async () => {
    const entity = await seedEntity(db);
    const event = checkoutCompletedEvent({ eventId: "evt_1", entityId: entity.id, donationId: "don_a" });
    const raw = JSON.stringify(event);
    const { d } = deps();

    const first = await handleStripeWebhook(db, d, { rawBody: raw, signature: GOOD_SIGNATURE });
    const second = await handleStripeWebhook(db, d, { rawBody: raw, signature: GOOD_SIGNATURE });

    expect(first).toMatchObject({ ok: true, outcome: "recorded", donation_id: "don_a" });
    expect(second).toMatchObject({ ok: true, outcome: "duplicate" });
    const rows = await db.select().from(schema.donations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "don_a", rail: "card", entityId: entity.id });
    expect(await stripeEventSeen(db, "evt_1")).toBe(true);
    expect(await getConfig(db, `${STRIPE_EVENT_PREFIX}evt_1`)).toBeTruthy();
  });

  it("records Stripe's own fee from the balance transaction when it is available", async () => {
    const entity = await seedEntity(db);
    stripe.balanceTransactions.set("pi_test_1", { fee: 91, net: 1909, currency: "usd" });
    const event = checkoutCompletedEvent({ eventId: "evt_bt", entityId: entity.id, donationId: "don_bt", amountCents: 2000 });
    const { d } = deps();

    const r = await handleStripeWebhook(db, d, { rawBody: JSON.stringify(event), signature: GOOD_SIGNATURE });
    expect(r).toMatchObject({ ok: true, fee_source: "balance_transaction" });

    const [row] = await db.select().from(schema.donations).where(eq(schema.donations.id, "don_bt"));
    expect(row!.gross).toBe("20.00");
    expect(row!.fee).toBe("0.91");
    expect(row!.net).toBe("19.09");

    const events = await listEntityEvents(db, entity.id);
    const recorded = events.find((e) => e.kind === "donation.recorded");
    expect(recorded?.payload).toMatchObject({ fee_source: "balance_transaction", fee_estimated: false });
  });

  it("falls back to the stated 2.9% + 30¢ estimate and flags it as an estimate", async () => {
    const entity = await seedEntity(db);
    stripe.piThrows = true; // Stripe cannot tell us the real fee
    const event = checkoutCompletedEvent({ eventId: "evt_est", entityId: entity.id, donationId: "don_est", amountCents: 2000 });
    const { d } = deps();

    const r = await handleStripeWebhook(db, d, { rawBody: JSON.stringify(event), signature: GOOD_SIGNATURE });
    expect(r).toMatchObject({ ok: true, fee_source: "estimate" });

    const [row] = await db.select().from(schema.donations).where(eq(schema.donations.id, "don_est"));
    // 20.00 × 2.9% + 0.30 = 0.88
    expect(row!.fee).toBe("0.88");
    expect(row!.net).toBe("19.12");

    const events = await listEntityEvents(db, entity.id);
    const recorded = events.find((e) => e.kind === "donation.recorded");
    expect(recorded?.payload).toMatchObject({ fee_source: "estimate", fee_estimated: true });
  });

  it("rejects a completed session for an unknown entity instead of dropping it", async () => {
    const event = checkoutCompletedEvent({ eventId: "evt_ghost", entityId: "entity/nowhere", donationId: "don_ghost" });
    const { d, logs } = deps();

    const r = await handleStripeWebhook(db, d, { rawBody: JSON.stringify(event), signature: GOOD_SIGNATURE });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("unknown_entity");
    expect(r.status).toBe(422);
    expect(await db.select().from(schema.donations)).toHaveLength(0);
    // an alert is written and the claim is released so Stripe's retry is not swallowed
    expect(await getConfig(db, "alerts.stripe_unknown_entity.evt_ghost")).toBeTruthy();
    expect(await stripeEventSeen(db, "evt_ghost")).toBe(false);
    expect(logs.join("\n")).toContain("REJECTED");
  });

  it("refuses a bad signature and an unsigned request without touching the ledger", async () => {
    const entity = await seedEntity(db);
    const raw = JSON.stringify(checkoutCompletedEvent({ eventId: "evt_bad", entityId: entity.id }));
    const { d } = deps();

    expect(await handleStripeWebhook(db, d, { rawBody: raw, signature: "t=1,v1=forged" })).toMatchObject({ ok: false, code: "bad_signature", status: 400 });
    expect(await handleStripeWebhook(db, d, { rawBody: raw, signature: null })).toMatchObject({ ok: false, code: "no_signature" });
    expect(await db.select().from(schema.donations)).toHaveLength(0);
  });

  it("answers 503 when no webhook secret is configured", async () => {
    const { d } = deps({ webhookSecret: undefined });
    expect(await handleStripeWebhook(db, d, { rawBody: "{}", signature: GOOD_SIGNATURE })).toMatchObject({ ok: false, code: "not_configured", status: 503 });
  });

  it("ignores other event types with a logged no-op", async () => {
    const { d, logs } = deps();
    const r = await handleStripeWebhook(db, d, { rawBody: JSON.stringify(otherEvent("evt_other")), signature: GOOD_SIGNATURE });
    expect(r).toMatchObject({ ok: true, outcome: "ignored", type: "payment_intent.created" });
    expect(logs.join("\n")).toContain("no-op for payment_intent.created");
    expect(await db.select().from(schema.donations)).toHaveLength(0);
  });

  it("attributes a donation to a signed-in donor and ignores an unknown user id", async () => {
    const entity = await seedEntity(db);
    const donor = await seedUser(db, "donor-1");
    const { d } = deps();

    await handleStripeWebhook(db, d, {
      rawBody: JSON.stringify(checkoutCompletedEvent({ eventId: "evt_u1", sessionId: "cs_1", entityId: entity.id, donationId: "don_u1", donorUserId: donor.id })),
      signature: GOOD_SIGNATURE,
    });
    await handleStripeWebhook(db, d, {
      rawBody: JSON.stringify(checkoutCompletedEvent({ eventId: "evt_u2", sessionId: "cs_2", entityId: entity.id, donationId: "don_u2", donorUserId: "who-dis" })),
      signature: GOOD_SIGNATURE,
    });

    const [known] = await db.select().from(schema.donations).where(eq(schema.donations.id, "don_u1"));
    const [unknown] = await db.select().from(schema.donations).where(eq(schema.donations.id, "don_u2"));
    expect(known!.donorUserId).toBe(donor.id);
    expect(unknown!.donorUserId).toBeNull();
  });
});

describe("createCheckoutSession", () => {
  it("creates a one-time payment session with no recurring anything and the three metadata keys", async () => {
    const entity = await seedEntity(db);
    const r = await createCheckoutSession(db, { stripe, env: {}, log: () => {} }, { entityId: entity.id, slug: entity.slug, amountUsd: 20 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const params = stripe.created[0]!;
    expect(params.mode).toBe("payment");
    expect(params).not.toHaveProperty("subscription_data");
    expect(JSON.stringify(params)).not.toMatch(/recurring|subscription/i);
    expect(params.metadata).toMatchObject({ entity_id: entity.id, entity_slug: entity.slug, kami_donation_id: r.donation_id });
    // and no donations row until the webhook says the money arrived
    expect(await db.select().from(schema.donations)).toHaveLength(0);
  });

  it("refuses a zero or out-of-range amount, and a slug that does not match the entity", async () => {
    const entity = await seedEntity(db);
    const d = { stripe, env: {}, log: () => {} };
    expect(await createCheckoutSession(db, d, { entityId: entity.id, slug: entity.slug, amountUsd: 0 })).toMatchObject({ ok: false, code: "amount_invalid" });
    expect(await createCheckoutSession(db, d, { entityId: entity.id, slug: entity.slug, amountUsd: 1_000_000 })).toMatchObject({ ok: false, code: "amount_invalid" });
    expect(await createCheckoutSession(db, d, { entityId: entity.id, slug: "somewhere-else", amountUsd: 20 })).toMatchObject({ ok: false, code: "entity_not_found" });
  });

  it("refuses when Stripe is not configured, rather than pretending", async () => {
    const entity = await seedEntity(db);
    const r = await createCheckoutSession(db, { stripe: null, env: {}, log: () => {} }, { entityId: entity.id, slug: entity.slug, amountUsd: 20 });
    expect(r).toMatchObject({ ok: false, code: "no_stripe", status: 503 });
  });
});
