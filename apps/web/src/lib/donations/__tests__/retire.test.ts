/**
 * The retire flow's treasury half (PRD §13 #6, plan T2.16). `retireEntity` in
 * `governance/pause.ts` decides; this builds the two guardian actions and
 * executes neither.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listEntityEvents } from "@/db/events";
import { closeTestDb, createTestDb, seedUser, type TestDb } from "@/db/test-utils";
import { retireEntity } from "@/lib/governance/pause";
import { setConfig } from "@/lib/jobs/common";
import { makeFakeDeps, type FakeDeps } from "@/lib/treasury/__tests__/fakes";
import { clearBalanceCache } from "@/lib/treasury/reads";
import { seedPayoutChain } from "@/lib/treasury/__tests__/seed";
import { buildRetireProposals, checkRetireProgress, getRetirePlan, markDelegateRemoved } from "../retire";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-09-06T12:00:00.000Z");
const STEWARD_ADDRESS = "0x4444444444444444444444444444444444444444";

async function seedRetired() {
  const s = await seedPayoutChain(db);
  const guardianB = await seedUser(db, "guardian-b");
  await db.insert(schema.entityRoles).values({ entityId: s.entity.id, userId: guardianB.id, role: "guardian", acceptedAt: new Date("2026-01-01T00:00:00Z") });
  await retireEntity(db, s.entity.id, s.guardian.id, { now: NOW });
  await retireEntity(db, s.entity.id, guardianB.id, { now: NOW });
  await setConfig(db, "steward_withdrawal_address", STEWARD_ADDRESS, NOW);
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, s.entity.id));
  return { ...s, entity: entity! };
}

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
  clearBalanceCache();
  deps.publicClientFake.usdcBalance = 100_000_000n; // 100 USDC in the Safe
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("buildRetireProposals", () => {
  it("builds exactly two guardian actions and executes neither", async () => {
    const s = await seedRetired();
    const r = await buildRetireProposals(db, deps, s.entity.id);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposals).toBe(2);
    expect(r.plan.steps).toHaveLength(2);
    expect(r.plan.steps.map((st) => st.kind)).toEqual(["delegate_removal", "usdc_sweep"]);

    const sweep = r.plan.steps[1]!;
    expect(sweep.kind).toBe("usdc_sweep");
    if (sweep.kind !== "usdc_sweep") return;
    expect(sweep.to).toBe(STEWARD_ADDRESS);
    expect(sweep.amount_usdc).toBe("100.00");
    expect(sweep.status).toBe("pending");
    expect(sweep.tx_hash).toBeNull();

    // proposed, not executed: one pending Safe proposal, zero relayer sends
    const proposals = await db.select().from(schema.safeProposals);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ status: "pending", confirmations: 0, submissionId: null, toAddress: STEWARD_ADDRESS });
    expect(deps.relayerSends).toHaveLength(0);
    expect(deps.apiKitFake.proposed).toHaveLength(1);
    expect(await db.select().from(schema.payouts)).toHaveLength(0);

    const built = (await listEntityEvents(db, s.entity.id)).find((e) => e.kind === "retire.plan_built");
    expect(built?.payload).toMatchObject({ steps: 2, executed: false });
  });

  it("is idempotent: a second call returns the plan already on file and proposes nothing new", async () => {
    const s = await seedRetired();
    await buildRetireProposals(db, deps, s.entity.id);
    const again = await buildRetireProposals(db, deps, s.entity.id);
    expect(again.ok).toBe(true);
    expect(deps.apiKitFake.proposed).toHaveLength(1);
  });

  it("refuses for an entity nobody retired, for an unknown entity, and without a withdrawal address", async () => {
    const s = await seedPayoutChain(db);
    const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, s.entity.id));
    expect(await buildRetireProposals(db, deps, entity!.id)).toMatchObject({ ok: false, code: "not_retired" });
    expect(await buildRetireProposals(db, deps, "entity/nowhere")).toMatchObject({ ok: false, code: "entity_not_found" });

    await retireEntity(db, entity!.id, s.guardian.id, { now: NOW, skip_role_check: true });
    const guardianB = await seedUser(db, "guardian-b");
    await retireEntity(db, entity!.id, guardianB.id, { now: NOW, skip_role_check: true });
    const [retired] = await db.select().from(schema.entities).where(eq(schema.entities.id, entity!.id));
    expect(await buildRetireProposals(db, deps, retired!.id)).toMatchObject({ ok: false, code: "no_withdrawal_address" });
    expect(await db.select().from(schema.safeProposals)).toHaveLength(0);
  });

  it("refuses rather than guessing when the Safe balance cannot be read", async () => {
    const s = await seedRetired();
    deps.publicClientFake.rpcDown = true;
    expect(await buildRetireProposals(db, deps, s.entity.id)).toMatchObject({ ok: false, code: "balance_unknown" });
    expect(await db.select().from(schema.safeProposals)).toHaveLength(0);
  });

  it("builds only the delegate step when the Safe holds no USDC", async () => {
    const s = await seedRetired();
    deps.publicClientFake.usdcBalance = 0n;
    const r = await buildRetireProposals(db, deps, s.entity.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposals).toBe(1);
    expect(deps.apiKitFake.proposed).toHaveLength(0);
  });
});

describe("checkRetireProgress", () => {
  it("archives only once both the delegate removal and the sweep are done", async () => {
    const s = await seedRetired();
    const built = await buildRetireProposals(db, deps, s.entity.id);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const sweep = built.plan.steps[1]!;
    if (sweep.kind !== "usdc_sweep") return;

    const before = await checkRetireProgress(db, deps, s.entity.id);
    expect(before).toMatchObject({ delegate_removed: false, sweep_mined: false, archived_at: null });

    await markDelegateRemoved(db, deps, s.entity.id, s.guardian.id);
    expect(await checkRetireProgress(db, deps, s.entity.id)).toMatchObject({ delegate_removed: true, sweep_mined: false, archived_at: null });

    // the ordinary safe-poll cron executes the sweep once two guardians sign
    await db
      .update(schema.safeProposals)
      .set({ status: "executed", executedTxHash: `0x${"ee".repeat(32)}` })
      .where(eq(schema.safeProposals.safeTxHash, sweep.safe_tx_hash));

    const done = await checkRetireProgress(db, deps, s.entity.id);
    expect(done?.sweep_mined).toBe(true);
    expect(done?.archived_at).toBeTruthy();
    expect((await getRetirePlan(db, s.entity.slug))?.archived_at).toBeTruthy();
    expect((await listEntityEvents(db, s.entity.id)).map((e) => e.kind)).toContain("retire.archived");
  });
});
