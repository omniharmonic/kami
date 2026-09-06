import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { setConfig } from "@/lib/jobs/common";
import { validatePayoutProposal } from "../validate";
import { seedPayoutChain } from "@/lib/treasury/__tests__/seed";
import { RECIPIENT } from "@/lib/treasury/__tests__/fakes";

let db: TestDb;
const NOW = new Date("2026-09-06T12:00:00.000Z");

beforeEach(async () => {
  db = await createTestDb();
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("validatePayoutProposal", () => {
  it("accepts a succeeded evaluation with a UID, a wallet and an amount at the cap", async () => {
    const s = await seedPayoutChain(db);
    const v = await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW });
    expect(v.ok, v.ok ? "" : v.code).toBe(true);
    if (!v.ok) return;
    expect(v.amountUsdc).toBe("25.00");
    expect(v.amountUsdc6).toBe(25_000_000n);
    expect(v.recipient.address).toBe(RECIPIENT);
    expect(v.entity.safeAddress).toBeTruthy();
    expect(v.outcomeUid).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("refuses when the entity is paused", async () => {
    const s = await seedPayoutChain(db, { paused: true });
    const v = await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW });
    expect(v).toMatchObject({ ok: false, code: "entity_paused", status: 423 });
  });

  it("refuses when the entity is retired", async () => {
    const s = await seedPayoutChain(db);
    await db.update(schema.entities).set({ retiredAt: NOW }).where(eq(schema.entities.id, s.entity.id));
    const v = await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW });
    expect(v).toMatchObject({ ok: false, code: "entity_retired" });
  });

  it("refuses an unknown entity and an unknown submission", async () => {
    const s = await seedPayoutChain(db);
    expect(await validatePayoutProposal(db, { slug: "nowhere", submissionId: s.submissionId }, { now: NOW })).toMatchObject({ ok: false, code: "entity_not_found", status: 404 });
    expect(await validatePayoutProposal(db, { slug: s.slug, submissionId: "sub-missing" }, { now: NOW })).toMatchObject({ ok: false, code: "submission_not_found", status: 404 });
  });

  it("refuses when there is no Safe yet", async () => {
    const s = await seedPayoutChain(db);
    await db.update(schema.entities).set({ safeAddress: null }).where(eq(schema.entities.id, s.entity.id));
    expect(await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW })).toMatchObject({ ok: false, code: "safe_missing" });
  });

  it("refuses a submission that has not been evaluated", async () => {
    const s = await seedPayoutChain(db);
    await db.delete(schema.evaluations).where(eq(schema.evaluations.id, s.evaluationId));
    expect(await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW })).toMatchObject({ ok: false, code: "evaluation_missing" });
  });

  it("refuses a non-succeeded evaluation", async () => {
    // one database, one entity per outcome (creating a PGlite per case is minutes of migrations)
    const cases = [
      { outcome: "partial" as const, slug: "partial-creek", wallet: `0x${"a".repeat(40)}` },
      { outcome: "failed" as const, slug: "failed-creek", wallet: `0x${"b".repeat(40)}` },
      { outcome: "unverifiable" as const, slug: "unverifiable-creek", wallet: `0x${"c".repeat(40)}` },
    ];
    for (const c of cases) {
      const s = await seedPayoutChain(db, { slug: c.slug, outcome: c.outcome, wallet: c.wallet });
      const v = await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW });
      expect(v, c.outcome).toMatchObject({ ok: false, code: "evaluation_not_succeeded" });
    }
  });

  it("refuses when no ProposalOutcome UID is present, and accepts an offchain uid", async () => {
    const s = await seedPayoutChain(db, { easUid: null });
    expect(await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW })).toMatchObject({ ok: false, code: "attestation_missing" });
    await db.update(schema.evaluations).set({ offchainAttestation: { uid: `0x${"2".repeat(64)}` } }).where(eq(schema.evaluations.id, s.evaluationId));
    const v = await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.outcomeUid).toBe(`0x${"2".repeat(64)}`);
  });

  it("refuses when the claimant has no wallet address", async () => {
    const s = await seedPayoutChain(db, { wallet: null });
    expect(await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW })).toMatchObject({ ok: false, code: "recipient_wallet_missing" });
  });

  it("uses the evaluator's awarded amount and refuses one above the cap", async () => {
    const under = await seedPayoutChain(db, { offchain: { uid: `0x${"3".repeat(64)}`, awarded_usdc: "10.00" } });
    const v = await validatePayoutProposal(db, { slug: under.slug, submissionId: under.submissionId }, { now: NOW });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.amountUsdc).toBe("10.00");

    const over = await seedPayoutChain(db, { slug: "over-cap-creek", wallet: `0x${"d".repeat(40)}`, offchain: { uid: `0x${"3".repeat(64)}`, awarded_usdc: "40.00" } });
    expect(await validatePayoutProposal(db, { slug: over.slug, submissionId: over.submissionId }, { now: NOW })).toMatchObject({ ok: false, code: "amount_over_cap", status: 422 });
  });

  it("refuses a duplicate proposal for the same submission", async () => {
    const s = await seedPayoutChain(db);
    await db.insert(schema.safeProposals).values({
      safeTxHash: `0x${"9".repeat(64)}`,
      entityId: s.entity.id,
      submissionId: s.submissionId,
      nonce: 1,
      toAddress: RECIPIENT,
      amountUsdc: "25.00",
      status: "pending",
      proposedAt: NOW,
    });
    expect(await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW })).toMatchObject({ ok: false, code: "duplicate_proposal" });
  });

  it("refuses over the monthly per-person cap", async () => {
    const s = await seedPayoutChain(db);
    await setConfig(db, "payout_monthly_cap_usdc", 30);
    await db.insert(schema.payouts).values({
      id: "pay-old",
      submissionId: null,
      rail: "usdc_safe",
      amountUsdc: "20.00",
      recipientUserId: s.claimant.id,
      executedAt: new Date("2026-09-02T00:00:00Z"),
    });
    expect(await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW })).toMatchObject({ ok: false, code: "monthly_cap_exceeded" });
  });

  it("requires a second attestation above the configured amount", async () => {
    const s = await seedPayoutChain(db, { capUsdc: "150.00", secondAttestationBy: null });
    expect(await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW })).toMatchObject({ ok: false, code: "second_attestation_required" });
    await db.update(schema.evaluations).set({ secondAttestationBy: s.guardian.id }).where(eq(schema.evaluations.id, s.evaluationId));
    const v = await validatePayoutProposal(db, { slug: s.slug, submissionId: s.submissionId }, { now: NOW });
    expect(v.ok, v.ok ? "" : v.code).toBe(true);
  });
});
