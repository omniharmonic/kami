/**
 * `GET /api/treasury/<slug>/balance` and `/pending` — the two reads the
 * keyless treasury MCP makes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { BALANCE_TTL_MS, clearBalanceCache, listPendingProposals, readSafeBalance } from "../reads";
import { makeFakeDeps, RECIPIENT, SAFE, type FakeDeps } from "./fakes";
import { seedPayoutChain } from "./seed";

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

describe("balance", () => {
  it("reads USDC balanceOf and caches it for 60 s", async () => {
    const first = await readSafeBalance(deps, SAFE);
    expect(first).toMatchObject({ balance_usdc: "100", cached: false, chain_id: 84532 });
    deps.publicClientFake.usdcBalance = 1n;
    expect(await readSafeBalance(deps, SAFE)).toMatchObject({ balance_usdc: "100", cached: true });
    deps.setNow(new Date(NOW.getTime() + BALANCE_TTL_MS + 1));
    expect(await readSafeBalance(deps, SAFE)).toMatchObject({ balance_usdc: "0.000001", cached: false });
  });

  it("answers null with a reason when the RPC is down or there is no Safe", async () => {
    deps.publicClientFake.rpcDown = true;
    expect(await readSafeBalance(deps, SAFE)).toMatchObject({ balance_usdc: null, reason: "rpc_unavailable" });
    expect(await readSafeBalance(deps, null)).toMatchObject({ balance_usdc: null, reason: "no_safe" });
  });
});

describe("pending", () => {
  it("lists pending proposals with live confirmation counts, falling back to the row", async () => {
    const s = await seedPayoutChain(db);
    const hash = deps.apiKitFake.seedPending({ to: RECIPIENT, amountUsdc6: 25_000_000n, nonce: 7, confirmations: 1, usdc: deps.chain.usdc.address });
    await db.insert(schema.safeProposals).values([
      { safeTxHash: hash, entityId: s.entity.id, submissionId: s.submissionId, nonce: 7, toAddress: RECIPIENT, amountUsdc: "25.00", proposedAt: new Date("2026-08-20T12:00:00Z"), confirmations: 0, status: "pending" },
      { safeTxHash: `0x${"8".repeat(64)}`, entityId: s.entity.id, nonce: 8, toAddress: RECIPIENT, amountUsdc: "5.00", proposedAt: NOW, confirmations: 0, status: "executed" },
    ]);

    const live = await listPendingProposals(db, deps, s.entity.id);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ safe_tx_hash: hash, confirmations: 1, required: 2, source: "tx_service", age_days: 17, amount_usdc: "25.00" });

    deps.apiKitFake.down = true;
    const offline = await listPendingProposals(db, deps, s.entity.id);
    expect(offline[0]).toMatchObject({ confirmations: 0, required: null, source: "db" });
  });
});
