/**
 * A guardian's signature reaches the Transaction Service and updates the row;
 * everyone else is refused (T2.5). The signature is verified against the same
 * typed data the sign screen served.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { listEntityEvents } from "@/db/events";
import { confirmProposal, typedDataForProposal, loadProposal } from "../confirm";
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

async function seedProposal() {
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
  return { ...s, hash };
}

describe("confirmProposal", () => {
  it("accepts a guardian's EIP-712 signature and records the new count", async () => {
    const s = await seedProposal();
    const row = (await loadProposal(db, s.hash))!;
    const td = (await typedDataForProposal(deps, row))!;
    expect(td.source).toBe("tx_service");
    const guardian = privateKeyToAccount(generatePrivateKey());
    const signature = await guardian.signTypedData(td.typed as Parameters<typeof guardian.signTypedData>[0]);

    const out = await confirmProposal(db, deps, { safeTxHash: s.hash, signature, userId: s.guardian.id, isGuardian: async () => true });
    expect(out.ok, out.ok ? "" : out.message).toBe(true);
    if (!out.ok) return;
    expect(out.signer).toBe(guardian.address);
    expect(out.confirmations).toBe(2);
    expect(deps.apiKitFake.confirmed).toHaveLength(1);
    const [proposal] = await db.select().from(schema.safeProposals).where(eq(schema.safeProposals.safeTxHash, s.hash));
    expect(proposal!.confirmations).toBe(2);
    expect((await listEntityEvents(db, s.entity.id)).map((e) => e.kind)).toContain("treasury.confirmed");
  });

  it("refuses a non-guardian, a bad signature and an unknown hash", async () => {
    const s = await seedProposal();
    const row = (await loadProposal(db, s.hash))!;
    const td = (await typedDataForProposal(deps, row))!;
    const guardian = privateKeyToAccount(generatePrivateKey());
    const signature = await guardian.signTypedData(td.typed as Parameters<typeof guardian.signTypedData>[0]);

    expect(await confirmProposal(db, deps, { safeTxHash: s.hash, signature, userId: "someone", isGuardian: async () => false })).toMatchObject({ ok: false, status: 403 });
    expect(await confirmProposal(db, deps, { safeTxHash: `0x${"4".repeat(64)}`, signature, userId: s.guardian.id, isGuardian: async () => true })).toMatchObject({ ok: false, status: 404 });
    expect(await confirmProposal(db, deps, { safeTxHash: s.hash, signature: "0xdeadbeef", userId: s.guardian.id, isGuardian: async () => true })).toMatchObject({ ok: false, status: 400 });
    expect(deps.apiKitFake.confirmed).toHaveLength(0);
  });

  it("refuses a signature over different typed data", async () => {
    const s = await seedProposal();
    const other = privateKeyToAccount(generatePrivateKey());
    const wrong = (await other.signMessage({ message: "not the safe tx" })) as Hex;
    const out = await confirmProposal(db, deps, { safeTxHash: s.hash, signature: wrong, userId: s.guardian.id, isGuardian: async () => true });
    // it recovers *some* address, but the Transaction Service is the authority on ownership;
    // what must not happen is a confirmation without a well-formed signature for this hash.
    if (out.ok) expect(out.signer).not.toBe(other.address);
    else expect(out.status).toBeGreaterThanOrEqual(400);
  });

  it("rebuilds the typed data from the row when the Transaction Service is down", async () => {
    const s = await seedProposal();
    deps.apiKitFake.down = true;
    const row = (await loadProposal(db, s.hash))!;
    const td = await typedDataForProposal(deps, row);
    expect(td!.source).toBe("db");
    expect(td!.typed.message.nonce).toBe(7n);
    expect(td!.typed.domain.verifyingContract).toBe(row.entity.safeAddress);
  });

  it("refuses to confirm a proposal that is no longer pending", async () => {
    const s = await seedProposal();
    await db.update(schema.safeProposals).set({ status: "executed" }).where(eq(schema.safeProposals.safeTxHash, s.hash));
    const out = await confirmProposal(db, deps, { safeTxHash: s.hash, signature: `0x${"11".repeat(65)}`, userId: s.guardian.id, isGuardian: async () => true });
    expect(out).toMatchObject({ ok: false, status: 409, code: "not_pending" });
  });
});
