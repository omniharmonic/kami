/**
 * Nightly reconciliation (§7.7): the Σ check, the payout/UID checks, the
 * 14-day proposal flag, the audit chain, and the donor-report block.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { getConfig } from "@/lib/jobs/common";
import { clearBalanceCache } from "@/lib/treasury/reads";
import { makeFakeDeps, RECIPIENT, type FakeDeps } from "@/lib/treasury/__tests__/fakes";
import { seedPayoutChain } from "@/lib/treasury/__tests__/seed";
import { reconcileEntity, runReconcile } from "../index";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-09-06T12:00:00.000Z");

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
  clearBalanceCache();
});
afterEach(async () => {
  await closeTestDb(db);
});

async function donate(entityId: string, net: string) {
  await db.insert(schema.donations).values({ id: `don-${net}-${Math.random()}`, entityId, rail: "usdc_direct", gross: net, fee: "0.00", net, chainTxHash: `0x${"aa".repeat(32)}`, receivedAt: new Date("2026-09-01T00:00:00Z") });
}

describe("reconcile", () => {
  it("is clean when the on-chain balance matches Σ inflows − Σ payouts", async () => {
    const s = await seedPayoutChain(db);
    await donate(s.entity.id, "100.00");
    deps.publicClientFake.usdcBalance = 100_000_000n;
    const [r] = await runReconcile(db, deps);
    expect(r!.ok, JSON.stringify(r!.findings)).toBe(true);
    expect(r!.expected_usdc).toBe("100.00");
    expect(r!.onchain_usdc).toBe("100");
    expect(await getConfig(db, `donor_report_blocked.${s.slug}`)).toBe(false);
    const [rec] = await db.select().from(schema.reconciliations);
    expect(rec!.ok).toBe(true);
  });

  it("detects a Σ mismatch, blocks the donor report and alerts a steward", async () => {
    const s = await seedPayoutChain(db);
    await donate(s.entity.id, "100.00");
    deps.publicClientFake.usdcBalance = 50_000_000n; // 50 USDC on chain, 100 expected
    const [r] = await runReconcile(db, deps);
    expect(r!.ok).toBe(false);
    expect(r!.findings.map((f) => f.kind)).toContain("balance_mismatch");
    expect(await getConfig(db, `donor_report_blocked.${s.slug}`)).toBe(true);
    expect(await getConfig(db, `alerts.reconcile.${s.slug}`)).toBeTruthy();
    expect(deps.notifyFake.sent).toHaveLength(1);
    expect(deps.notifyFake.sent[0]!.subject).toContain("reconciliation");
  });

  it("tolerates a cent of drift", async () => {
    const s = await seedPayoutChain(db);
    await donate(s.entity.id, "100.00");
    deps.publicClientFake.usdcBalance = 100_010_000n; // +0.01
    const [r] = await runReconcile(db, deps);
    expect(r!.findings.map((f) => f.kind)).not.toContain("balance_mismatch");
    expect(s.slug).toBe("boulder-creek");
  });

  it("flags a 14-day-old proposal with one signature", async () => {
    const s = await seedPayoutChain(db);
    await db.insert(schema.safeProposals).values({
      safeTxHash: `0x${"7".repeat(64)}`,
      entityId: s.entity.id,
      submissionId: s.submissionId,
      nonce: 7,
      toAddress: RECIPIENT,
      amountUsdc: "25.00",
      proposedAt: new Date("2026-08-20T12:00:00.000Z"),
      confirmations: 1,
      status: "pending",
    });
    const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, s.entity.id));
    const r = await reconcileEntity(db, deps, entity!);
    const stale = r.findings.find((f) => f.kind === "proposal_stale");
    expect(stale).toBeTruthy();
    expect(stale!.detail).toMatchObject({ safe_tx_hash: `0x${"7".repeat(64)}`, confirmations: 1, age_days: 17 });
    // a flag, not an expiry — the row is untouched
    const [row] = await db.select().from(schema.safeProposals);
    expect(row!.status).toBe("pending");
  });

  it("flags a payout without a mined tx or a BountyCompleted UID", async () => {
    const s = await seedPayoutChain(db);
    await db.insert(schema.payouts).values({ id: "pay-1", submissionId: s.submissionId, rail: "usdc_safe", amountUsdc: "25.00", safeTxHash: `0x${"5".repeat(64)}`, txHash: null, executedAt: NOW });
    deps.publicClientFake.usdcBalance = 0n;
    const [entity] = await db.select().from(schema.entities);
    const r = await reconcileEntity(db, deps, entity!);
    const kinds = r.findings.map((f) => f.kind);
    expect(kinds).toContain("payout_tx_missing");
    expect(kinds).toContain("payout_uid_missing");
    expect(r.ok).toBe(false);
  });

  it("marks evaluation UIDs unverified when EAS_GRAPHQL_URL is unset, and unresolved when EAS does not know them", async () => {
    const s = await seedPayoutChain(db);
    deps.publicClientFake.usdcBalance = 0n;
    const [entity] = await db.select().from(schema.entities);
    const offline = await reconcileEntity(db, deps, entity!);
    expect(offline.findings.find((f) => f.kind === "evaluation_uid_unverified")).toBeTruthy();
    expect(offline.ok).toBe(true); // unverified is not an error

    const online = makeFakeDeps({ now: NOW, env: { EAS_GRAPHQL_URL: "https://base.easscan.org/graphql" } });
    online.publicClientFake.usdcBalance = 0n;
    (online as { fetchImpl: typeof fetch }).fetchImpl = (async () => new Response(JSON.stringify({ data: { attestation: null } }), { status: 200 })) as unknown as typeof fetch;
    const missing = await reconcileEntity(db, online, entity!);
    expect(missing.findings.map((f) => f.kind)).toContain("evaluation_uid_unresolved");
    expect(missing.ok).toBe(false);
    expect(s.slug).toBe("boulder-creek");
  });

  it("reports an unverified balance rather than a wrong one when the RPC is down", async () => {
    await seedPayoutChain(db);
    deps.publicClientFake.rpcDown = true;
    const [entity] = await db.select().from(schema.entities);
    const r = await reconcileEntity(db, deps, entity!);
    expect(r.onchain_usdc).toBeNull();
    expect(r.findings.find((f) => f.kind === "balance_unverified")).toBeTruthy();
    expect(r.ok).toBe(true);
  });

  it("flags a broken event chain", async () => {
    const s = await seedPayoutChain(db);
    const { appendEntityEvent } = await import("@/db/events");
    await appendEntityEvent(db, { entity_id: s.entity.id, actor: "test", kind: "test.event", payload: {}, at: NOW });
    // the table is append-only by trigger, so break the chain by appending a row
    // whose prev_hash points nowhere (what a forged insert would look like).
    await db.insert(schema.entityEvents).values({ entityId: s.entity.id, at: NOW, actor: "forger", kind: "test.forged", payload: {}, prevHash: "f".repeat(64), hash: "e".repeat(64) });
    deps.publicClientFake.usdcBalance = 0n;
    const [entity] = await db.select().from(schema.entities);
    const r = await reconcileEntity(db, deps, entity!);
    expect(r.findings.map((f) => f.kind)).toContain("event_chain_broken");
    expect(r.ok).toBe(false);
  });
});
