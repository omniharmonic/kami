/**
 * The monthly donor report (G6, T2.11). The properties under test:
 *
 *  - it **refuses** when `config.donor_report_blocked.<slug>` is set, writes
 *    nothing, and pages a steward;
 *  - it sends when reconciliation is clean;
 *  - `X-Guard: held` swaps the entity's paragraph for the template, and which
 *    one was used is recorded;
 *  - `public_md` carries no donor identity;
 *  - coverage is 100 % of donors of record;
 *  - `sent_at` is stamped only after the mail actually goes out.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { parseUnits } from "viem";
import * as schema from "@/db/schema";
import { listEntityEvents } from "@/db/events";
import { closeTestDb, createTestDb, seedUser, type TestDb } from "@/db/test-utils";
import { setConfig } from "@/lib/jobs/common";
import { reconcileEntity } from "@/lib/reconcile";
import { makeFakeDeps, type FakeDeps } from "@/lib/treasury/__tests__/fakes";
import { clearBalanceCache } from "@/lib/treasury/reads";
import { seedPayoutChain } from "@/lib/treasury/__tests__/seed";
import { assembleReport, buildFactSheet, coverage, donorsOfRecord, isBlocked, monthBounds, previousMonth, renderPublicMd, sendDonorReport } from "../donor-report";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-10-01T06:00:00.000Z");
const MONTH = "2026-09-01";

async function seeded() {
  const s = await seedPayoutChain(db);
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, s.entity.id));
  return { ...s, entity: entity! };
}

async function seedMonth(entityId: string) {
  const alice = await seedUser(db, "alice", "alice@example.org");
  const bob = await seedUser(db, "bob", "bob@example.org");
  await db.insert(schema.donations).values([
    { id: "don_alice_1", entityId, donorUserId: alice.id, rail: "card", gross: "20.00", fee: "0.88", net: "19.12", currency: "usd", stripeSessionId: "cs_a1", receivedAt: new Date("2026-09-04T10:00:00Z"), chainTxHash: "0xaaa" },
    { id: "don_alice_2", entityId, donorUserId: alice.id, rail: "card", gross: "10.00", fee: "0.59", net: "9.41", currency: "usd", stripeSessionId: "cs_a2", receivedAt: new Date("2026-09-14T10:00:00Z"), chainTxHash: "0xaaa" },
    { id: "don_bob_1", entityId, donorUserId: bob.id, rail: "usdc_direct", gross: "50.00", fee: "0.00", net: "50.00", currency: "usdc", receivedAt: new Date("2026-09-20T10:00:00Z"), chainTxHash: "0xbbb" },
    { id: "don_anon", entityId, donorUserId: null, rail: "usdc_direct", gross: "5.00", fee: "0.00", net: "5.00", currency: "usdc", receivedAt: new Date("2026-09-21T10:00:00Z"), chainTxHash: "0xccc" },
    // outside the month: must not appear
    { id: "don_august", entityId, donorUserId: alice.id, rail: "card", gross: "99.00", fee: "3.17", net: "95.83", currency: "usd", stripeSessionId: "cs_aug", receivedAt: new Date("2026-08-20T10:00:00Z"), chainTxHash: "0xddd" },
  ]);
  return { alice, bob };
}

async function seedPayout(submissionId: string, recipientUserId: string) {
  await db.insert(schema.payouts).values({
    id: "pay_1",
    submissionId,
    rail: "usdc_safe",
    amountUsdc: "25.00",
    usdValueAtPayment: "25.00",
    safeTxHash: `0x${"12".repeat(32)}`,
    txHash: `0x${"34".repeat(32)}`,
    executedAt: new Date("2026-09-25T10:00:00Z"),
    easUidCompleted: `0x${"56".repeat(32)}`,
    recipientAddress: "0x2222222222222222222222222222222222222222",
    recipientUserId,
  });
}

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
  clearBalanceCache();
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("months", () => {
  it("reports on the previous whole month", () => {
    expect(previousMonth(new Date("2026-10-01T06:00:00Z"))).toBe("2026-09-01");
    expect(previousMonth(new Date("2026-01-01T06:00:00Z"))).toBe("2025-12-01");
    expect(monthBounds("2026-09-01")).toEqual({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") });
    expect(() => monthBounds("nope")).toThrow();
  });
});

describe("assembleReport", () => {
  it("gathers the balance, inflows by rail and payouts with tx hash, UID and thumbnails", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);
    await seedPayout(s.submissionId, s.claimant.id);

    const data = await assembleReport(db, deps, s.entity, MONTH);
    expect(data.balance.usdc).toBe("100"); // the fake Safe holds 100 USDC
    expect(data.inflow_totals).toMatchObject({ count: 4, gross_usd: "85.00", net_usd: "83.53" }); // August is excluded
    expect(data.inflows.map((i) => i.rail).sort()).toEqual(["card", "usdc_direct"]);
    expect(data.payouts).toHaveLength(1);
    expect(data.payouts[0]).toMatchObject({ amount: "25.00", safe_tx_hash: `0x${"12".repeat(32)}`, eas_uid: `0x${"56".repeat(32)}` });
    expect(data.payouts[0]!.recipient_handle).toBe("claimant-boulder-creek");
    expect(data.as_of).toBe(NOW.toISOString());
  });

  it("says the balance is unknown rather than zero when the RPC is down", async () => {
    const s = await seeded();
    deps.publicClientFake.rpcDown = true;
    const data = await assembleReport(db, deps, s.entity, MONTH);
    expect(data.balance).toMatchObject({ usdc: null, reason: "rpc_unavailable" });
    expect(renderPublicMd(data, "x", "template")).toContain("it is unknown");
  });

  it("builds a facts-1.0 sheet whose atoms are the report's own numbers", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);
    await seedPayout(s.submissionId, s.claimant.id);
    const sheet = buildFactSheet(await assembleReport(db, deps, s.entity, MONTH));

    expect(sheet.schema_version).toBe("1.0");
    expect(sheet.atoms.length).toBeGreaterThan(4);
    const values = sheet.atoms.filter((a) => a.kind === "number").map((a) => a.value);
    expect(values).toContain(100); // balance
    expect(values).toContain(83.53); // net donations
    expect(values).toContain(25); // the payout
    for (const a of sheet.atoms) expect(Object.keys(a)).toContain("kind");
  });
});

describe("sendDonorReport", () => {
  it("REFUSES when reconciliation is blocked: nothing written, a steward paged", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);
    await setConfig(db, `donor_report_blocked.${s.entity.slug}`, true, NOW);
    expect(await isBlocked(db, s.entity.slug)).toBe(true);

    const r = await sendDonorReport(db, deps, s.entity, MONTH);
    expect(r).toMatchObject({ ok: false, code: "reconciliation_blocked", entity: s.entity.slug, month: MONTH });

    expect(await db.select().from(schema.donorReports)).toHaveLength(0);
    // the only mail is the steward page, not a donor mail
    expect(deps.notifyFake.sent).toHaveLength(1);
    expect(deps.notifyFake.sent[0]!.subject).toContain("held back");
    expect(deps.notifyFake.sent[0]!.to).not.toContain("alice@example.org");
  });

  it("is blocked by a real reconciliation mismatch and sends once it is clean", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);
    // the ledger says 83.53 net arrived on chain; the Safe says 100 → mismatch
    const bad = await reconcileEntity(db, deps, s.entity);
    expect(bad.ok).toBe(false);
    expect(await isBlocked(db, s.entity.slug)).toBe(true);
    expect(await sendDonorReport(db, deps, s.entity, MONTH)).toMatchObject({ ok: false, code: "reconciliation_blocked" });

    // make the chain agree with the ledger and re-reconcile
    deps.publicClientFake.usdcBalance = parseUnits(bad.expected_usdc!, 6);
    clearBalanceCache();
    const good = await reconcileEntity(db, deps, s.entity);
    expect(good.ok).toBe(true);
    expect(await isBlocked(db, s.entity.slug)).toBe(false);

    clearBalanceCache();
    const r = await sendDonorReport(db, deps, s.entity, MONTH);
    expect(r.ok).toBe(true);
  });

  it("sends when clean: a report row, sent_at after the mail, and 100 % coverage of donors of record", async () => {
    const s = await seeded();
    const { alice, bob } = await seedMonth(s.entity.id);
    await seedPayout(s.submissionId, s.claimant.id);

    const donors = await donorsOfRecord(db, s.entity.id, MONTH);
    expect(donors.map((d) => d.user_id).sort()).toEqual([alice.id, bob.id]);
    expect(donors.find((d) => d.user_id === alice.id)).toMatchObject({ count: 2, gross_usd: "30.00" });

    const r = await sendDonorReport(db, deps, s.entity, MONTH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coverage).toMatchObject({ donors_total: 2, donors_notified: 2, pct: 100 });
    expect(await coverage(db, s.entity.id, MONTH)).toMatchObject({ donors_total: 2, donors_notified: 2, pct: 100 });

    const [row] = await db.select().from(schema.donorReports).where(and(eq(schema.donorReports.entityId, s.entity.id), eq(schema.donorReports.month, MONTH)));
    expect(row!.sentAt).toBeTruthy();
    expect(row!.donorsNotified).toBe(2);
    expect(row!.publicMd).toBeTruthy();

    // one mail per donor of record, each with their own figures
    const donorMails = deps.notifyFake.sent.filter((m) => m.to.some((t) => t.endsWith("@example.org") && t !== "alice"));
    expect(donorMails.map((m) => m.to[0]).sort()).toEqual(["alice@example.org", "bob@example.org"]);
    const aliceMail = donorMails.find((m) => m.to[0] === "alice@example.org")!;
    expect(aliceMail.text).toContain("$30.00");
    expect(aliceMail.text).toContain(`0x${"12".repeat(32)}`); // the Safe tx hash
    expect(aliceMail.text).toContain(`0x${"56".repeat(32)}`); // the attestation UID
    expect(aliceMail.text).toContain("No token, ever");

    const kinds = (await listEntityEvents(db, s.entity.id)).map((e) => e.kind);
    expect(kinds).toContain("donor_report.assembled");
    expect(kinds).toContain("donor_report.sent");
  });

  it("public_md contains no donor identity", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);
    await seedPayout(s.submissionId, s.claimant.id);
    await sendDonorReport(db, deps, s.entity, MONTH);

    const [row] = await db.select().from(schema.donorReports).where(eq(schema.donorReports.entityId, s.entity.id));
    const md = row!.publicMd!;
    for (const secret of ["alice", "bob", "alice@example.org", "bob@example.org", "don_alice_1", "don_bob_1"]) {
      expect(md.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    // it does carry the public facts
    expect(md).toContain("$25.00 USDC");
    expect(md).toContain(`0x${"12".repeat(32)}`);
    expect(md).toContain("Donations are shown by rail and in total.");
  });

  it("uses the templated paragraph when the guard holds, and records which was used", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);

    const held = await sendDonorReport(db, deps, s.entity, MONTH, { gatewayUrl: "fake:held" });
    expect(held).toMatchObject({ ok: true, paragraph_source: "template", guard: "held" });
    const [row] = await db.select().from(schema.donorReports).where(eq(schema.donorReports.entityId, s.entity.id));
    expect(row!.guardResult).toBe("held");
    expect(row!.narrativeMd).toContain("received 4 donations totalling $85.00");
    expect(row!.publicMd).toContain("did not pass the fact guard");
    expect((row!.data as { paragraph_source: string }).paragraph_source).toBe("template");
  });

  it("uses the entity's paragraph when the guard passes", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);
    const ok = await sendDonorReport(db, deps, s.entity, MONTH, { gatewayUrl: "fake:" });
    expect(ok).toMatchObject({ ok: true, paragraph_source: "entity", guard: "pass" });
    const [row] = await db.select().from(schema.donorReports).where(eq(schema.donorReports.entityId, s.entity.id));
    expect(row!.publicMd).toContain("checked against the figures in this report");
  });

  it("falls back to the template when the tunnel is down", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);
    expect(await sendDonorReport(db, deps, s.entity, MONTH, { gatewayUrl: "fake:asleep" })).toMatchObject({ ok: true, paragraph_source: "template" });
  });

  it("leaves sent_at null when a donor mail fails", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);
    const broken: FakeDeps = { ...deps, notify: { send: async () => { throw new Error("smtp down"); } } };

    const r = await sendDonorReport(db, broken, s.entity, MONTH);
    expect(r).toMatchObject({ ok: false, code: "mail_failed" });
    const [row] = await db.select().from(schema.donorReports).where(eq(schema.donorReports.entityId, s.entity.id));
    expect(row!.sentAt).toBeNull();
    expect(row!.donorsNotified).toBe(0);
    expect(row!.publicMd).toBeTruthy(); // the assembled report survives for the retry
  });

  it("refuses to send the same month twice unless a human forces it", async () => {
    const s = await seeded();
    await seedMonth(s.entity.id);
    expect((await sendDonorReport(db, deps, s.entity, MONTH)).ok).toBe(true);
    expect(await sendDonorReport(db, deps, s.entity, MONTH)).toMatchObject({ ok: false, code: "already_sent" });
    expect((await sendDonorReport(db, deps, s.entity, MONTH, { force: true })).ok).toBe(true);
  });

  it("still publishes a report for a month with no identified donors: coverage of nobody is complete", async () => {
    const s = await seeded();
    const r = await sendDonorReport(db, deps, s.entity, MONTH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coverage).toMatchObject({ donors_total: 0, donors_notified: 0, pct: 100 });
    const [row] = await db.select().from(schema.donorReports).where(eq(schema.donorReports.entityId, s.entity.id));
    expect(row!.sentAt).toBeTruthy();
    expect(row!.publicMd).toContain("Nothing was paid out this month.");
  });
});
