/**
 * The daily tier-4 follow-up sweep (PRD §7.2). It notifies and records; it
 * never evaluates and never pays.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listEntityEvents } from "@/db/events";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { getConfig, setConfig } from "@/lib/jobs/common";
import { makeFakeDeps, type FakeDeps } from "@/lib/treasury/__tests__/fakes";
import { seedPayoutChain } from "@/lib/treasury/__tests__/seed";
import { runTier4FollowUps, TIER4_KEY, type Tier4Entry } from "../tier4";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2027-03-10T09:00:00.000Z");

async function seedFollowUp(over: Partial<Tier4Entry> = {}) {
  const s = await seedPayoutChain(db);
  await db.update(schema.bounties).set({ verificationTier: 4, status: "deferred" }).where(eq(schema.bounties.id, s.bountyId));
  const entry: Tier4Entry = {
    submission_id: s.submissionId,
    evaluation_id: s.evaluationId,
    deposit_usdc: 12.5,
    balance_usdc: 12.5,
    follow_up_due: "2027-02-04",
    followed_up_at: null,
    ...over,
  };
  await setConfig(db, TIER4_KEY, { [s.bountyId]: entry }, NOW);
  return s;
}

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("runTier4FollowUps", () => {
  it("notifies the evaluator and records a tier4_followup_due event when the date has passed", async () => {
    const s = await seedFollowUp();
    const r = await runTier4FollowUps(db, deps);

    expect(r.due).toHaveLength(1);
    expect(r.notified).toBe(1);
    expect(r.due[0]).toMatchObject({ bounty_id: s.bountyId, balance_usdc: 12.5, days_overdue: 34 });
    expect(deps.notifyFake.sent[0]!.to).toEqual([`evaluator-${s.slug}@example.org`]);
    expect(deps.notifyFake.sent[0]!.text).toContain("$12.50 USDC");

    const events = (await listEntityEvents(db, s.entity.id)).filter((e) => e.kind === "tier4_followup_due");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ bounty_id: s.bountyId, balance_usdc: "12.50", notified: true });

    // nothing was paid and no proposal was made
    expect(await db.select().from(schema.payouts)).toHaveLength(0);
    expect(await db.select().from(schema.safeProposals)).toHaveLength(0);
  });

  it("leaves a follow-up that is not yet due alone", async () => {
    await seedFollowUp({ follow_up_due: "2027-09-01" });
    const r = await runTier4FollowUps(db, deps);
    expect(r.due).toHaveLength(0);
    expect(deps.notifyFake.sent).toHaveLength(0);
  });

  it("ignores one that has already been followed up", async () => {
    await seedFollowUp({ followed_up_at: "2027-02-10T00:00:00Z" });
    expect((await runTier4FollowUps(db, deps)).due).toHaveLength(0);
  });

  it("does not nag: a second run inside a week is skipped", async () => {
    await seedFollowUp();
    await runTier4FollowUps(db, deps);
    const second = await runTier4FollowUps(db, deps);
    expect(second.skipped).toBe(1);
    expect(second.notified).toBe(0);
    expect(deps.notifyFake.sent).toHaveLength(1);

    const entries = (await getConfig<Record<string, Tier4Entry>>(db, TIER4_KEY))!;
    expect(Object.values(entries)[0]!.followup_notified_at).toBe(NOW.toISOString());
  });

  it("re-notifies once a week has passed", async () => {
    await seedFollowUp();
    await runTier4FollowUps(db, deps);
    deps.setNow(new Date(NOW.getTime() + 8 * 86_400_000));
    expect((await runTier4FollowUps(db, deps)).notified).toBe(1);
    expect(deps.notifyFake.sent).toHaveLength(2);
  });

  it("skips a retired entity", async () => {
    const s = await seedFollowUp();
    await db.update(schema.entities).set({ retiredAt: NOW }).where(eq(schema.entities.id, s.entity.id));
    expect((await runTier4FollowUps(db, deps)).due).toHaveLength(0);
  });
});
