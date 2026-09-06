/**
 * The routes this package owns, wired end to end against PGlite and the fakes:
 * `POST /api/donate`, `POST /api/webhooks/stripe` (raw body, Node runtime), and
 * the three crons (`CRON_SECRET` auth, then the job).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setDbForTests } from "@/db/client";
import { closeTestDb, createTestDb, seedEntity, type TestDb } from "@/db/test-utils";
import { setTreasuryDepsForTests } from "@/lib/treasury/deps";
import { clearBalanceCache } from "@/lib/treasury/reads";
import { makeFakeDeps, type FakeDeps } from "@/lib/treasury/__tests__/fakes";
import { setStripeForTests } from "../stripe";
import { checkoutCompletedEvent, FakeStripe, GOOD_SIGNATURE } from "./fakes";
import { POST as donate } from "@/app/api/donate/route";
import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";
import { GET as donorReportCron } from "@/app/api/cron/donor-report/route";
import { GET as passportCron } from "@/app/api/cron/passport/route";
import { GET as tier4Cron } from "@/app/api/cron/tier4-followup/route";

let db: TestDb;
let deps: FakeDeps;
let stripe: FakeStripe;
const NOW = new Date("2026-10-01T06:00:00.000Z");

const get = (path: string, secret?: string) =>
  new Request(`http://localhost:3000${path}`, secret ? { headers: { authorization: `Bearer ${secret}` } } : {});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
  stripe = new FakeStripe();
  setDbForTests(db as never);
  setTreasuryDepsForTests(deps);
  setStripeForTests(stripe);
  clearBalanceCache();
  delete process.env.CRON_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
}, 480_000);
afterEach(async () => {
  setDbForTests(null);
  setTreasuryDepsForTests(null);
  setStripeForTests(undefined);
  delete process.env.CRON_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  await closeTestDb(db);
});

describe("POST /api/donate", () => {
  it("returns a checkout URL for a real entity and a valid amount", async () => {
    const entity = await seedEntity(db);
    const res = await donate(post("/api/donate", { slug: entity.slug, amount_usd: 20 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; donation_id: string };
    expect(body.url).toContain("checkout.stripe.test");
    expect(body.donation_id).toMatch(/^don_/);
    expect(stripe.created[0]!.mode).toBe("payment");
  });

  it("refuses a bad slug, an unknown entity, a bad amount and unparseable JSON", async () => {
    expect((await donate(post("/api/donate", { slug: "Nope!", amount_usd: 5 }))).status).toBe(400);
    expect((await donate(post("/api/donate", { slug: "nowhere", amount_usd: 5 }))).status).toBe(404);
    const entity = await seedEntity(db);
    expect((await donate(post("/api/donate", { slug: entity.slug, amount_usd: "abc" }))).status).toBe(400);
    expect((await donate(post("/api/donate", "not json"))).status).toBe(400);
  });
});

describe("POST /api/webhooks/stripe", () => {
  it("verifies over the raw body and records the donation", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const entity = await seedEntity(db);
    const raw = JSON.stringify(checkoutCompletedEvent({ eventId: "evt_route", entityId: entity.id, donationId: "don_route" }));

    const res = await stripeWebhook(post("/api/webhooks/stripe", raw, { "stripe-signature": GOOD_SIGNATURE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, outcome: "recorded", donation_id: "don_route" });
    expect(await db.select().from(schema.donations).where(eq(schema.donations.id, "don_route"))).toHaveLength(1);
  });

  it("answers 400 on a forged signature and 503 with no secret configured", async () => {
    const entity = await seedEntity(db);
    const raw = JSON.stringify(checkoutCompletedEvent({ eventId: "evt_x", entityId: entity.id }));
    expect((await stripeWebhook(post("/api/webhooks/stripe", raw, { "stripe-signature": GOOD_SIGNATURE }))).status).toBe(503);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    expect((await stripeWebhook(post("/api/webhooks/stripe", raw, { "stripe-signature": "forged" }))).status).toBe(400);
  });
});

describe("the three crons", () => {
  it("refuse without the cron secret when one is set", async () => {
    process.env.CRON_SECRET = "s3cret";
    for (const route of [donorReportCron, passportCron, tier4Cron]) {
      expect((await route(get("/api/cron/x"))).status).toBe(401);
    }
    expect((await passportCron(get("/api/cron/passport", "s3cret"))).status).toBe(200);
  });

  it("donor-report answers 409 and names the blocked entity", async () => {
    const entity = await seedEntity(db);
    await db.insert(schema.config).values({ key: `donor_report_blocked.${entity.slug}`, value: true, updatedAt: NOW });
    const res = await donorReportCron(get("/api/cron/donor-report"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ job: "donor-report", blocked: [entity.slug] });
  });

  it("donor-report sends for a clean entity", async () => {
    const entity = await seedEntity(db);
    const res = await donorReportCron(get("/api/cron/donor-report"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ job: "donor-report", sent: 1, blocked: [] });
    const [row] = await db.select().from(schema.donorReports).where(eq(schema.donorReports.entityId, entity.id));
    expect(row!.sentAt).toBeTruthy();
  });

  it("passport is an honest no-op with no key", async () => {
    const res = await passportCron(get("/api/cron/passport"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ job: "passport", no_api_key: true, refreshed: 0 });
  });

  it("tier4-followup reports nothing due on an empty config", async () => {
    const res = await tier4Cron(get("/api/cron/tier4-followup"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ job: "tier4-followup", due: 0, notified: 0 });
  });
});
