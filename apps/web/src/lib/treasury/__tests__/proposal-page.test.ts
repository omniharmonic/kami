/**
 * The guardian sign screen: the role gate and the view the page renders
 * (bounty, evidence, evaluation, attestation UID, amount, recipient, Safe, nonce).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { AuthError, type SessionUser } from "@/lib/session";
import { assertGuardian, loadProposalView } from "../proposal-page";
import { makeFakeDeps, RECIPIENT, type FakeDeps } from "./fakes";
import { seedPayoutChain } from "./seed";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-09-06T12:00:00.000Z");

const user = (id: string, admin = false): SessionUser => ({ id, email: `${id}@example.org`, name: id, age_gate_ok: true, platform_admin: admin });

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW, env: { KAMI_EVIDENCE_BASE_URL: "https://evidence.example" } });
});
afterEach(async () => {
  await closeTestDb(db);
});

describe("the sign page gate", () => {
  it("requires a session, then the guardian role", async () => {
    const roles = new Map([["guardian-1:entity/x", true]]);
    const hasRole = async (userId: string, entityId: string) => roles.get(`${userId}:${entityId}`) ?? false;

    await expect(assertGuardian(null, "entity/x", hasRole)).rejects.toMatchObject({ status: 401 });
    await expect(assertGuardian(user("stranger"), "entity/x", hasRole)).rejects.toBeInstanceOf(AuthError);
    await expect(assertGuardian(user("stranger"), "entity/x", hasRole)).rejects.toMatchObject({ status: 403 });
    await expect(assertGuardian(user("guardian-1"), "entity/x", hasRole)).resolves.toMatchObject({ id: "guardian-1" });
    // a platform admin passes without a row
    await expect(assertGuardian(user("root", true), "entity/x", hasRole)).resolves.toMatchObject({ id: "root" });
    // an evaluator of the same entity is not a guardian
    await expect(assertGuardian(user("evaluator-1"), "entity/x", hasRole)).rejects.toMatchObject({ status: 403 });
  });
});

describe("loadProposalView", () => {
  it("shows everything a guardian needs on one screen", async () => {
    const s = await seedPayoutChain(db);
    const hash = deps.apiKitFake.seedPending({ to: RECIPIENT, amountUsdc6: 25_000_000n, nonce: 7, confirmations: 1, usdc: deps.chain.usdc.address });
    await db.insert(schema.safeProposals).values({
      safeTxHash: hash,
      entityId: s.entity.id,
      submissionId: s.submissionId,
      nonce: 7,
      toAddress: RECIPIENT,
      amountUsdc: "25.00",
      proposedAt: new Date("2026-09-05T12:00:00Z"),
      confirmations: 1,
      status: "pending",
    });

    const view = (await loadProposalView(db, deps, hash))!;
    expect(view.bounty?.title).toBe("Photograph the gauge");
    expect(view.evidence).toHaveLength(1);
    expect(view.evidence[0]!.url).toBe(`https://evidence.example/evidence/${s.submissionId}/1.jpg`);
    expect(view.evaluation).toMatchObject({ outcome: "succeeded" });
    expect(view.outcome_uid).toBe(`0x${"1".repeat(64)}`);
    expect(view.amount_usdc).toBe("25.00");
    expect(view.recipient).toMatchObject({ handle: `claimant-${s.slug}`, address: RECIPIENT });
    expect(view.entity.safe_address).toBeTruthy();
    expect(view.nonce).toBe(7);
    expect(view.confirmations).toBe(1);
    expect(view.required).toBe(2);
    expect(view.safe_wallet_url).toContain("basesep:");
    const typed = JSON.parse(view.typed_data_json!) as { primaryType: string; message: { nonce: string } };
    expect(typed.primaryType).toBe("SafeTx");
    expect(typed.message.nonce).toBe("7");
  });

  it("is null for an unknown hash", async () => {
    await seedPayoutChain(db);
    expect(await loadProposalView(db, deps, `0x${"6".repeat(64)}`)).toBeNull();
  });
});
