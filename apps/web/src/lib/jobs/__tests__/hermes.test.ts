import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { handleHermesDelivery, parseBountyOutput, signHermes, verifyHermesSignature } from "../hermes";
import { setConfig } from "../common";
import { NOW, seedBoulderCreek } from "./helpers";

const SECRET = "hermes-webhook-secret";
const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => closeTestDb(d)));
});

function headers(body: string, opts: { secret?: string; ts?: string; sig?: string } = {}): Headers {
  const ts = opts.ts ?? String(Math.floor(NOW.getTime() / 1000));
  const sig = opts.sig ?? signHermes(opts.secret ?? SECRET, ts, body);
  return new Headers({ "x-kami-timestamp": ts, "x-kami-signature": `sha256=${sig}` });
}

describe("the Hermes webhook signature", () => {
  const body = JSON.stringify({ id: "d1", job: "pulse" });

  it("accepts a correct HMAC over `<timestamp>.<raw body>`", () => {
    expect(verifyHermesSignature(headers(body), body, SECRET, NOW)).toMatchObject({ ok: true });
  });

  it("rejects a bad signature, a wrong secret and a tampered body", () => {
    expect(verifyHermesSignature(headers(body, { sig: "0".repeat(64) }), body, SECRET, NOW)).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyHermesSignature(headers(body, { secret: "wrong" }), body, SECRET, NOW)).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyHermesSignature(headers(body), `${body} `, SECRET, NOW)).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("rejects missing headers, a bad timestamp and one outside the 5-minute window", () => {
    expect(verifyHermesSignature(new Headers(), body, SECRET, NOW)).toMatchObject({ ok: false, reason: "missing_headers" });
    expect(verifyHermesSignature(headers(body, { ts: "not-a-time" }), body, SECRET, NOW)).toMatchObject({ ok: false, reason: "bad_timestamp" });
    const old = String(Math.floor(NOW.getTime() / 1000) - 3600);
    expect(verifyHermesSignature(headers(body, { ts: old }), body, SECRET, NOW)).toMatchObject({ ok: false, reason: "stale_timestamp" });
  });

  it("refuses everything when no secret is configured", () => {
    expect(verifyHermesSignature(headers(body), body, undefined, NOW)).toMatchObject({ ok: false, reason: "no_secret" });
  });
});

describe("cron deliveries", () => {
  it("stores a pulse and is idempotent on a replay of the same event id", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "hermes-creek" });
    dbs.push(db);
    const [snap] = await db
      .insert(schema.needSnapshots)
      .values({ entityId: entity.id, asOf: NOW, snapshot: { entity_id: entity.id }, snapshotHash: "h1", mood: "content", staleDriving: false })
      .returning();
    const delivery = { id: "evt_1", type: "cron.delivery", profile: "hermes-creek", job: "pulse", snapshot_id: snap!.id, output: { text: "Flow at Orodell is 15.4 cfs, measured 2026-09-04 20:15Z." }, kami_guard: "pass" };

    const first = await handleHermesDelivery(db, delivery, { now: NOW });
    expect(first).toMatchObject({ ok: true, replay: false, job: "pulse" });
    const replay = await handleHermesDelivery(db, delivery, { now: NOW });
    expect(replay).toMatchObject({ ok: true, replay: true });

    const pulses = await db.select().from(schema.pulses).where(eq(schema.pulses.entityId, entity.id));
    expect(pulses).toHaveLength(1);
    expect(pulses[0]).toMatchObject({ woke: true, guardResult: "pass", snapshotId: snap!.id });
    expect(pulses[0]!.text).toContain("15.4 cfs");
  });

  it("drops the text of a delivery the guard dropped, and keeps the row", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "dropped-creek" });
    dbs.push(db);
    const out = await handleHermesDelivery(db, { id: "evt_drop", job: "daily-reflection", slug: "dropped-creek", output: "40 cfs and rising" }, { guardHeader: "dropped", now: NOW });
    expect(out).toMatchObject({ ok: true, replay: false });
    const [pulse] = await db.select().from(schema.pulses).where(eq(schema.pulses.entityId, entity.id));
    expect(pulse!.text).toBeNull();
    expect(pulse!.guardResult).toBe("dropped");
  });

  it("stores a quarterly memo and a donor-report paragraph", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "memo-creek" });
    dbs.push(db);
    await handleHermesDelivery(db, { id: "evt_memo", job: "quarterly-strategy", slug: "memo-creek", output: "Three things I am trying to change…" }, { now: NOW });
    const [strategy] = await db.select().from(schema.strategies).where(eq(schema.strategies.entityId, entity.id));
    expect(strategy).toMatchObject({ quarter: "2026-Q3", memoMd: "Three things I am trying to change…", ratifiedAt: null });

    await handleHermesDelivery(db, { id: "evt_report", job: "donor-report", slug: "memo-creek", output: "This month, $120 went out…", kami_guard: { result: "pass" } }, { now: NOW });
    const [report] = await db.select().from(schema.donorReports).where(eq(schema.donorReports.entityId, entity.id));
    expect(report).toMatchObject({ month: "2026-08-01", guardResult: "pass" });
    expect(report!.narrativeMd).toContain("$120");
    expect(report!.publicMd).toBeNull();
  });

  it("stores weekly bounty drafts, holds the guard-held ones, and reports the rejected", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "bounty-creek" });
    dbs.push(db);
    const good = {
      title: "Photograph the three diversion structures",
      why: "Flow at Orodell is 15.4 cfs (2026-09-04T20:15Z, cdss.telemetry).",
      deliverable: "Before/after photos of each structure, geotagged, 48 h apart",
      verification_tier: 2,
      evidence_spec: { min_photos: 6, exif_required: true, gps_within_m: 50, capture: "in_app" },
      cap_usdc: 40,
      claim_limit: 1,
      deadline: "2026-09-21",
      twin_refs: ["place/boulder-creek-near-orodell-co", "watershed/huc10-1019000504"],
      prediction: null,
    };
    const badTier1 = { ...good, title: "Tier one, no prediction", verification_tier: 1, prediction: null };
    const out = await handleHermesDelivery(db, { id: "evt_b", job: "weekly-bounties", slug: "bounty-creek", output: { bounties: [good, badTier1] }, kami_guard: "held" }, { now: NOW });
    expect(out).toMatchObject({ ok: true, replay: false, job: "weekly-bounties" });
    const stored = (out as { stored: { drafted: Array<{ status: string }>; rejected: Array<{ code: string }> } }).stored;
    expect(stored.drafted).toHaveLength(1);
    expect(stored.drafted[0]!.status).toBe("held_by_guard");
    expect(stored.rejected[0]!.code).toBe("invalid_spec");

    const rows = await db.select().from(schema.bounties).where(eq(schema.bounties.entityId, entity.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "held_by_guard", verificationTier: 2, capUsdc: "40.00", claimLimit: 1 });
    expect(rows[0]!.specSha256).toMatch(/^[0-9a-f]{64}$/);
    const events = await db.select().from(schema.entityEvents).where(eq(schema.entityEvents.entityId, entity.id));
    expect(events.map((e) => e.kind)).toContain("bounty.draft_rejected");
  });

  it("refuses an unknown entity, an unknown job and a malformed delivery", async () => {
    const { db } = await seedBoulderCreek({ slug: "known-creek" });
    dbs.push(db);
    expect(await handleHermesDelivery(db, { id: "e1", job: "pulse", slug: "nope" }, { now: NOW })).toMatchObject({ ok: false, status: 404 });
    expect(await handleHermesDelivery(db, { id: "e2", job: "mystery", slug: "known-creek" }, { now: NOW })).toMatchObject({ ok: false, status: 422 });
    expect(await handleHermesDelivery(db, { job: "pulse" }, { now: NOW })).toMatchObject({ ok: false, status: 400 });
    // the idempotency key of a refused-before-claim delivery is not burned
    expect(await setConfig(db, "noop", 1)).toBeUndefined();
  });

  it("parses bounty output as an array, an object, JSONL or a fenced block", () => {
    expect(parseBountyOutput([{ a: 1 }])).toHaveLength(1);
    expect(parseBountyOutput({ bounties: [{ a: 1 }, { b: 2 }] })).toHaveLength(2);
    expect(parseBountyOutput('{"a":1}\n{"b":2}\n')).toHaveLength(2);
    expect(parseBountyOutput('here you go:\n```json\n{"a":1}\n```\n')).toHaveLength(1);
    expect(parseBountyOutput("no json at all")).toEqual([]);
  });
});
