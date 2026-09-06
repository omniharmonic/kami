/**
 * The poller executes at threshold and refuses below it (plan T2.5), records
 * the payout, attests `BountyCompleted`, marks the bounty paid and notifies the
 * recipient; below the relayer float nothing executes at all.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { getConfig } from "@/lib/jobs/common";
import { listEntityEvents, verifyEventChain } from "@/db/events";
import { runSafePoll } from "../safe-poll";
import { makeFakeDeps, RECIPIENT, type FakeDeps } from "./fakes";
import { seedPayoutChain } from "./seed";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-09-06T12:00:00.000Z");

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
});
afterEach(async () => {
  await closeTestDb(db);
});

async function seedProposal(confirmations: number, proposedAt = new Date("2026-09-05T12:00:00.000Z")) {
  const s = await seedPayoutChain(db);
  const hash = deps.apiKitFake.seedPending({ to: RECIPIENT, amountUsdc6: 25_000_000n, nonce: 7, confirmations, usdc: deps.chain.usdc.address });
  await db.insert(schema.safeProposals).values({
    safeTxHash: hash,
    entityId: s.entity.id,
    submissionId: s.submissionId,
    nonce: 7,
    toAddress: RECIPIENT,
    amountUsdc: "25.00",
    proposedAt,
    confirmations,
    status: "pending",
  });
  return { ...s, hash };
}

describe("safe-poll", () => {
  it("refuses to execute at one confirmation", async () => {
    const s = await seedProposal(1);
    const out = await runSafePoll(db, deps);
    expect(out.executed).toHaveLength(0);
    expect(out.skipped[0]).toMatchObject({ safe_tx_hash: s.hash, reason: "awaiting_signatures", confirmations: 1, required: 2 });
    expect(deps.relayerSends).toHaveLength(0);
    expect(deps.easFake.attested).toHaveLength(0);
    const [row] = await db.select().from(schema.safeProposals).where(eq(schema.safeProposals.safeTxHash, s.hash));
    expect(row!.status).toBe("pending");
    expect(await db.select().from(schema.payouts)).toHaveLength(0);
  });

  it("executes at two confirmations, records the payout and attests BountyCompleted", async () => {
    const s = await seedProposal(2);
    const out = await runSafePoll(db, deps);
    expect(out.errors).toEqual([]);
    expect(out.executed).toHaveLength(1);
    expect(deps.relayerSends).toHaveLength(1);
    expect(deps.relayerSends[0]!.data.startsWith("0x6a761202")).toBe(true); // execTransaction selector

    const [proposal] = await db.select().from(schema.safeProposals).where(eq(schema.safeProposals.safeTxHash, s.hash));
    expect(proposal).toMatchObject({ status: "executed" });
    expect(proposal!.executedTxHash).toMatch(/^0x[0-9a-f]{64}$/);

    const [payout] = await db.select().from(schema.payouts);
    expect(payout).toMatchObject({ rail: "usdc_safe", amountUsdc: "25.00", usdValueAtPayment: "25.00", safeTxHash: s.hash, recipientAddress: RECIPIENT, recipientUserId: s.claimant.id });
    expect(payout!.easUidCompleted).toMatch(/^0x[0-9a-f]{64}$/);

    expect(deps.easFake.attested).toHaveLength(1);
    const [att] = await db.select().from(schema.attestations);
    expect(att).toMatchObject({ schema: "BountyCompleted", mode: "onchain" });

    const [bounty] = await db.select().from(schema.bounties).where(eq(schema.bounties.id, s.bountyId));
    expect(bounty!.status).toBe("paid");

    const kinds = (await listEntityEvents(db, s.entity.id)).map((e) => e.kind);
    expect(kinds).toContain("treasury.executed");
    expect(kinds).toContain("attestation.bounty_completed");
    expect(await verifyEventChain(db, s.entity.id)).toMatchObject({ ok: true });

    expect(deps.notifyFake.sent.some((m) => m.to.includes(`claimant-${s.slug}@example.org`))).toBe(true);
  });

  it("skips execution and raises an alert when the relayer float is low", async () => {
    const s = await seedProposal(2);
    deps.publicClientFake.ethBalance = 10n ** 15n; // 0.001 ETH
    const out = await runSafePoll(db, deps);
    expect(out.executed).toHaveLength(0);
    expect(out.skipped[0]).toMatchObject({ safe_tx_hash: s.hash, reason: "relayer_low" });
    expect(deps.relayerSends).toHaveLength(0);
    expect(await getConfig(db, "alerts.relayer_low")).toMatchObject({ balance_eth: "0.001" });
  });

  it("does not expire a 14-day-old proposal — it stays pending and is only flagged", async () => {
    const s = await seedProposal(1, new Date("2026-08-20T12:00:00.000Z"));
    const out = await runSafePoll(db, deps);
    expect(out.skipped[0]).toMatchObject({ reason: "awaiting_signatures_stale" });
    const [row] = await db.select().from(schema.safeProposals).where(eq(schema.safeProposals.safeTxHash, s.hash));
    expect(row!.status).toBe("pending");
  });
});
