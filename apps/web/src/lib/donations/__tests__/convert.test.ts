/**
 * The monthly conversion (architecture §6.6, Appendix A.5): sum the card money
 * that has not yet reached the Safe, write exactly one `treasury_transfers`
 * row, and only then let the relayer forward it — and only against a Stripe
 * USDC payout an operator has actually recorded.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listEntityEvents } from "@/db/events";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { makeFakeDeps, type FakeDeps } from "@/lib/treasury/__tests__/fakes";
import { seedPayoutChain } from "@/lib/treasury/__tests__/seed";
import { convertEntity, getOperatorPayout, recordOperatorPayout, unconvertedDonations } from "../convert";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-10-01T09:00:00.000Z");

async function seeded(slug = "boulder-creek") {
  const s = await seedPayoutChain(db, { slug });
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, s.entity.id));
  return { ...s, entity: entity! };
}

async function donate(entityId: string, id: string, net: string, opts: { rail?: "card" | "usdc_direct"; chainTxHash?: string | null; at?: string } = {}) {
  await db.insert(schema.donations).values({
    id,
    entityId,
    rail: opts.rail ?? "card",
    gross: net,
    fee: "0.00",
    net,
    currency: "usd",
    chainTxHash: opts.chainTxHash ?? null,
    receivedAt: new Date(opts.at ?? "2026-09-15T00:00:00Z"),
  });
}

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("convertEntity", () => {
  it("sums only the unconverted card donations and writes exactly one treasury_transfers row", async () => {
    const s = await seeded();
    await donate(s.entity.id, "don_1", "19.12");
    await donate(s.entity.id, "don_2", "48.25");
    await donate(s.entity.id, "don_already", "100.00", { chainTxHash: "0xdeadbeef" }); // already in the Safe
    await donate(s.entity.id, "don_direct", "25.00", { rail: "usdc_direct", chainTxHash: "0xfeed" }); // never converted: it arrived on chain
    await recordOperatorPayout(db, deps, { reference: "po_2026_09", amountUsd: 500, recordedBy: "operator@example.org" });

    const pending = await unconvertedDonations(db, s.entity.id);
    expect(pending.map((p) => p.id).sort()).toEqual(["don_1", "don_2"]);

    const r = await convertEntity(db, deps, s.entity, { operatorPayoutRef: "po_2026_09" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amount_usdc).toBe("67.37"); // 19.12 + 48.25, and nothing else
    expect(r.donations.sort()).toEqual(["don_1", "don_2"]);

    const transfers = await db.select().from(schema.treasuryTransfers);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ kind: "conversion_in", amountUsdc: "67.37", entityId: s.entity.id });
    expect(transfers[0]!.txHash).toBe(r.tx_hash);

    // one relayer send, to USDC, and the two donations now carry the chain tx
    expect(deps.relayerSends).toHaveLength(1);
    expect(deps.relayerSends[0]!.to.toLowerCase()).toBe(deps.chain.usdc.address.toLowerCase());
    const after = await unconvertedDonations(db, s.entity.id);
    expect(after).toHaveLength(0);

    // the operator payout is drawn down, never twice
    expect((await getOperatorPayout(db, "po_2026_09"))?.spent_usd).toBe(67.37);

    const kinds = (await listEntityEvents(db, s.entity.id)).map((e) => e.kind);
    expect(kinds).toContain("treasury.conversion_in");
    expect(kinds).toContain("treasury.conversion_sent");
  });

  it("refuses without a recorded operator payout — the Stripe payout is a human step, not an automated one", async () => {
    const s = await seeded();
    await donate(s.entity.id, "don_1", "19.12");
    const r = await convertEntity(db, deps, s.entity, { operatorPayoutRef: "po_missing" });
    expect(r).toMatchObject({ ok: false, code: "operator_payout_required" });
    expect(await db.select().from(schema.treasuryTransfers)).toHaveLength(0);
    expect(deps.relayerSends).toHaveLength(0);
  });

  it("refuses when the recorded payout does not cover what is owed", async () => {
    const s = await seeded();
    await donate(s.entity.id, "don_1", "500.00");
    await recordOperatorPayout(db, deps, { reference: "po_small", amountUsd: 100, recordedBy: "operator@example.org" });
    expect(await convertEntity(db, deps, s.entity, { operatorPayoutRef: "po_small" })).toMatchObject({ ok: false, code: "operator_payout_too_small" });
    expect(deps.relayerSends).toHaveLength(0);
  });

  it("refuses with nothing to convert, without a Safe, and for a retired entity", async () => {
    const s = await seeded();
    expect(await convertEntity(db, deps, s.entity, { operatorPayoutRef: "x" })).toMatchObject({ ok: false, code: "nothing_to_convert" });

    await donate(s.entity.id, "don_1", "10.00");
    expect(await convertEntity(db, deps, { ...s.entity, safeAddress: null }, { operatorPayoutRef: "x" })).toMatchObject({ ok: false, code: "no_safe" });
    expect(await convertEntity(db, deps, { ...s.entity, retiredAt: NOW }, { operatorPayoutRef: "x" })).toMatchObject({ ok: false, code: "entity_retired" });
  });

  it("dry run writes the ledger row and sends nothing", async () => {
    const s = await seeded();
    await donate(s.entity.id, "don_1", "12.00");
    await recordOperatorPayout(db, deps, { reference: "po_dry", amountUsd: 50, recordedBy: "operator@example.org" });
    const r = await convertEntity(db, deps, s.entity, { operatorPayoutRef: "po_dry", dryRun: true });
    expect(r).toMatchObject({ ok: true, dry_run: true, tx_hash: null });
    expect(deps.relayerSends).toHaveLength(0);
    expect(await db.select().from(schema.treasuryTransfers)).toHaveLength(1);
  });

  it("leaves the conversion row open when the transfer fails, and marks nothing converted", async () => {
    const s = await seeded();
    await donate(s.entity.id, "don_1", "12.00");
    await recordOperatorPayout(db, deps, { reference: "po_fail", amountUsd: 50, recordedBy: "operator@example.org" });
    const broken: FakeDeps = { ...deps, relayerSend: async () => { throw new Error("no gas"); } };

    expect(await convertEntity(db, broken, s.entity, { operatorPayoutRef: "po_fail" })).toMatchObject({ ok: false, code: "transfer_failed" });
    const transfers = await db.select().from(schema.treasuryTransfers);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.txHash).toBeNull();
    expect(await unconvertedDonations(db, s.entity.id)).toHaveLength(1);
  });
});
