/**
 * `tax_forms` and the predicate the payout path calls (T2.16). Two thresholds
 * and they are different numbers: ours (1500, ask early) and the statutory 1099
 * one for tax year 2026 (2000). Nothing here is advice, and the test says so.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, createTestDb, seedUser, type TestDb } from "@/db/test-utils";
import { setConfig } from "@/lib/jobs/common";
import {
  blockPayoutUntilForm,
  collectForm,
  DEFAULT_FORM_THRESHOLD_USD,
  needsForm,
  NOT_ADVICE,
  readForm,
  recordPayoutForTax,
  STATUTORY_1099_THRESHOLD_2026_USD,
  taxStatusFor,
} from "../forms";

let db: TestDb;
const NOW = new Date("2026-09-06T12:00:00.000Z");
const YEAR = 2026;

beforeEach(async () => {
  db = await createTestDb();
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("the two thresholds", () => {
  it("asks at 1500 and cites 2000 as the 2026 statutory figure", () => {
    expect(DEFAULT_FORM_THRESHOLD_USD).toBe(1500);
    expect(STATUTORY_1099_THRESHOLD_2026_USD).toBe(2000);
    expect(NOT_ADVICE).toContain("not tax advice");
  });
});

describe("recordPayoutForTax", () => {
  it("accumulates across payouts in the same year", async () => {
    const u = await seedUser(db, "payee-1");
    expect((await recordPayoutForTax(db, u.id, YEAR, 40)).cumulative_usd).toBe(40);
    expect((await recordPayoutForTax(db, u.id, YEAR, 60.5)).cumulative_usd).toBe(100.5);
    expect((await readForm(db, u.id, YEAR))?.cumulative_usd).toBe(100.5);
    // a different year is a different row
    expect((await recordPayoutForTax(db, u.id, 2027, 10)).cumulative_usd).toBe(10);
  });

  it("reports needs_form once the running total reaches the threshold", async () => {
    const u = await seedUser(db, "payee-2");
    expect((await recordPayoutForTax(db, u.id, YEAR, 1499)).needs_form).toBe(false);
    expect((await recordPayoutForTax(db, u.id, YEAR, 1)).needs_form).toBe(true);
    expect(await needsForm(db, u.id, YEAR)).toBe(true);
  });

  it("refuses a nonsense amount", async () => {
    const u = await seedUser(db, "payee-3");
    await expect(recordPayoutForTax(db, u.id, YEAR, Number.NaN)).rejects.toThrow();
    await expect(recordPayoutForTax(db, u.id, YEAR, -5)).rejects.toThrow();
  });
});

describe("blockPayoutUntilForm — the predicate the signing service calls", () => {
  it("blocks the payout that would cross the threshold, not the one before it", async () => {
    const u = await seedUser(db, "payee-4");
    await recordPayoutForTax(db, u.id, YEAR, 1400);

    const under = await blockPayoutUntilForm(db, u.id, 50, NOW);
    expect(under.blocked).toBe(false);
    expect(under.would_be_usd).toBe(1450);

    const over = await blockPayoutUntilForm(db, u.id, 100, NOW);
    expect(over).toMatchObject({ blocked: true, reason: "form_required", cumulative_usd: 1400, would_be_usd: 1500, threshold_usd: 1500, statutory_threshold_usd: 2000 });
    expect(over.note).toBe(NOT_ADVICE);
  });

  it("is a pure read: it writes nothing", async () => {
    const u = await seedUser(db, "payee-5");
    await blockPayoutUntilForm(db, u.id, 5000, NOW);
    expect(await readForm(db, u.id, YEAR)).toBeNull();
  });

  it("stops blocking once the form is on file", async () => {
    const u = await seedUser(db, "payee-6");
    await recordPayoutForTax(db, u.id, YEAR, 1600);
    expect((await blockPayoutUntilForm(db, u.id, 25, NOW)).blocked).toBe(true);
    await collectForm(db, u.id, "W-9", "steward@example.org", { now: NOW });
    expect((await blockPayoutUntilForm(db, u.id, 25, NOW)).blocked).toBe(false);
    expect(await needsForm(db, u.id, YEAR)).toBe(false);
    expect((await readForm(db, u.id, YEAR))?.cumulative_usd).toBe(1600); // collecting does not reset the total
  });

  it("stands down entirely when a fiscal sponsor is the tax collector (§7.8)", async () => {
    const u = await seedUser(db, "payee-7");
    await recordPayoutForTax(db, u.id, YEAR, 5000);
    await setConfig(db, "tax_collector", "sponsor", NOW);
    expect((await blockPayoutUntilForm(db, u.id, 500, NOW)).blocked).toBe(false);
    expect(await needsForm(db, u.id, YEAR)).toBe(false);
  });

  it("honours a configured threshold", async () => {
    const u = await seedUser(db, "payee-8");
    await setConfig(db, "tax_form_threshold_usd", 600, NOW);
    await recordPayoutForTax(db, u.id, YEAR, 500);
    expect((await blockPayoutUntilForm(db, u.id, 100, NOW)).blocked).toBe(true);
  });
});

describe("taxStatusFor — the read /me renders", () => {
  it("reports a person's own position, with both thresholds and the not-advice note", async () => {
    const u = await seedUser(db, "payee-9");
    const empty = await taxStatusFor(db, u.id, NOW);
    expect(empty).toMatchObject({ tax_year: 2026, cumulative_usd: 0, needs_form: false, collector: "platform", form_kind: null });

    await recordPayoutForTax(db, u.id, YEAR, 1600);
    const after = await taxStatusFor(db, u.id, NOW);
    expect(after).toMatchObject({ cumulative_usd: 1600, needs_form: true, threshold_usd: 1500, statutory_threshold_usd: 2000 });
    expect(after.note).toContain("not tax advice");

    await collectForm(db, u.id, "W-8BEN", "steward@example.org", { now: NOW });
    const collected = await taxStatusFor(db, u.id, NOW);
    expect(collected).toMatchObject({ needs_form: false, form_kind: "W-8BEN" });
    expect(collected.collected_at).toBeTruthy();
  });
});
