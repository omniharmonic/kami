/**
 * The propose route produces a pending Safe transaction carrying the
 * platform's proposer signature and nothing else (plan T2.3 "done when").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { setDbForTests } from "@/db/client";
import { listEntityEvents, verifyEventChain } from "@/db/events";
import { POST as propose } from "@/app/api/treasury/propose/route";
import { mintEntityToken } from "@/lib/mcp/tokens";
import { setTreasuryDepsForTests } from "../deps";
import { makeFakeDeps, type FakeDeps } from "./fakes";
import { seedPayoutChain } from "./seed";

let db: TestDb;
let deps: FakeDeps;

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps();
  setDbForTests(db as never);
  setTreasuryDepsForTests(deps);
}, 480_000);
afterEach(async () => {
  setDbForTests(null);
  setTreasuryDepsForTests(null);
  await closeTestDb(db);
});

function post(body: unknown, token?: string) {
  return propose(
    new Request("http://localhost:3000/api/treasury/propose", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/treasury/propose", () => {
  it("inserts safe_proposals with the proposer signature only and never executes", async () => {
    const chainMod = await import("@kami/chain");
    const execSpy = vi.spyOn(chainMod, "executeWithRelayer");
    const s = await seedPayoutChain(db);

    const res = await post({ entity: s.slug, submission_id: s.submissionId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { safe_tx_hash: string; status: string; nonce: number; amount_usdc: string };
    expect(body.status).toBe("proposed");
    expect(body.amount_usdc).toBe("25.00");
    expect(body.nonce).toBe(7);
    expect(body.safe_tx_hash).toMatch(/^0x[0-9a-f]{64}$/);

    // exactly one proposal in the Transaction Service, signed by the proposer
    expect(deps.apiKitFake.proposed).toHaveLength(1);
    const proposed = deps.apiKitFake.proposed[0]!;
    expect(proposed.senderSignature).toMatch(/^0x[0-9a-f]{130}$/);
    const proposerAddr = await (await deps.backend()).getAddress(`proposer:${s.slug}`);
    expect(proposed.senderAddress).toBe(proposerAddr);
    expect(deps.apiKitFake.txs.get(body.safe_tx_hash.toLowerCase())?.confirmations).toEqual([]);

    // nothing executed, nothing relayed
    expect(execSpy).not.toHaveBeenCalled();
    expect(deps.relayerSends).toHaveLength(0);

    const [row] = await db.select().from(schema.safeProposals).where(eq(schema.safeProposals.safeTxHash, body.safe_tx_hash));
    expect(row).toMatchObject({ status: "pending", confirmations: 0, amountUsdc: "25.00", nonce: 7, submissionId: s.submissionId });

    const events = await listEntityEvents(db, s.entity.id);
    expect(events.map((e) => e.kind)).toContain("treasury.proposed");
    expect(await verifyEventChain(db, s.entity.id)).toMatchObject({ ok: true });

    // the guardian was notified
    expect(deps.notifyFake.sent).toHaveLength(1);
    expect(deps.notifyFake.sent[0]!.to).toEqual([`guardian-${s.slug}@example.org`]);
    expect(deps.notifyFake.sent[0]!.text).toContain(`/guardian/proposals/${body.safe_tx_hash}`);
    execSpy.mockRestore();
  });

  it("refuses a paused entity with 423 and writes nothing", async () => {
    const s = await seedPayoutChain(db, { paused: true });
    const res = await post({ entity: s.slug, submission_id: s.submissionId });
    expect(res.status).toBe(423);
    expect(await res.json()).toMatchObject({ reason: "entity_paused" });
    expect(await db.select().from(schema.safeProposals)).toHaveLength(0);
    expect(deps.apiKitFake.proposed).toHaveLength(0);
  });

  it("accepts the entity's own MCP token and refuses another entity's", async () => {
    const s = await seedPayoutChain(db);
    const other = await seedPayoutChain(db, { slug: "other-creek", wallet: "0x3333333333333333333333333333333333333333" });
    const { token } = await mintEntityToken(db, s.slug);
    const { token: otherToken } = await mintEntityToken(db, other.slug);

    expect((await post({ entity: s.slug, submission_id: s.submissionId }, otherToken)).status).toBe(403);
    expect((await post({ entity: s.slug, submission_id: s.submissionId }, "kami_boulder-creek_" + "0".repeat(48))).status).toBe(401);
    expect(await db.select().from(schema.safeProposals)).toHaveLength(0);
    expect((await post({ entity: s.slug, submission_id: s.submissionId }, token)).status).toBe(200);
    expect(await db.select().from(schema.safeProposals)).toHaveLength(1);
  });

  it("rejects a malformed body", async () => {
    expect((await post({ entity: "boulder-creek" })).status).toBe(400);
    expect((await post({ entity: "Not A Slug", submission_id: "x" })).status).toBe(400);
  });
});
