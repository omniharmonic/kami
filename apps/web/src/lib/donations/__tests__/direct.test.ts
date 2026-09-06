/**
 * The direct-USDC rail: polling the Transaction Service for incoming transfers,
 * and "this was me" attribution, which must refuse a signature from any address
 * but the one the money came from (architecture §7.6).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, type Address } from "viem";
import * as schema from "@/db/schema";
import { listEntityEvents } from "@/db/events";
import { closeTestDb, createTestDb, seedUser, type TestDb } from "@/db/test-utils";
import { makeFakeDeps, SAFE, type FakeDeps } from "@/lib/treasury/__tests__/fakes";
import { seedPayoutChain } from "@/lib/treasury/__tests__/seed";

/** `seedPayoutChain` returns the entity row from before the Safe address is set. */
async function seeded(slug = "boulder-creek") {
  const s = await seedPayoutChain(db, { slug });
  const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.id, s.entity.id));
  return { ...s, entity: entity! };
}
import { claimDirectDonation, directDonationMessage, parseTransfer, pollDirectDonations, safeQrDataUrl } from "../direct";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-09-06T12:00:00.000Z");
const TX = `0x${"ab".repeat(32)}`;

function withIncoming(d: FakeDeps, results: unknown[]): FakeDeps {
  const base = d.apiKit();
  const patched = { ...base, getIncomingTransactions: async () => ({ results }) } as ReturnType<FakeDeps["apiKit"]>;
  return { ...d, apiKit: () => patched };
}

function transfer(over: Partial<Record<string, unknown>> = {}) {
  return {
    type: "ERC20_TRANSFER",
    transactionHash: TX,
    from: "0x3333333333333333333333333333333333333333",
    to: SAFE,
    value: "25000000",
    tokenAddress: deps.chain.usdc.address,
    executionDate: "2026-09-04T10:00:00Z",
    logIndex: 3,
    ...over,
  };
}

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("pollDirectDonations", () => {
  it("records an incoming USDC transfer once, anonymous, with the sender kept for later attribution", async () => {
    const s = await seeded();
    const d = withIncoming(deps, [transfer()]);

    const first = await pollDirectDonations(db, d, s.entity);
    const second = await pollDirectDonations(db, d, s.entity);

    expect(first.recorded).toHaveLength(1);
    expect(second.recorded).toHaveLength(0);
    const rows = await db.select().from(schema.donations);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rail: "usdc_direct", gross: "25.00", fee: "0.00", net: "25.00", donorUserId: null, chainTxHash: TX });
    const events = await listEntityEvents(db, s.entity.id);
    expect(events.find((e) => e.kind === "donation.recorded")?.payload).toMatchObject({ attributed: false });
  });

  it("ignores transfers of other tokens and zero-value transfers", async () => {
    const s = await seeded();
    const d = withIncoming(deps, [
      transfer({ tokenAddress: "0x9999999999999999999999999999999999999999" }),
      transfer({ value: "0", logIndex: 4 }),
      transfer({ tokenAddress: null, logIndex: 5 }),
    ]);
    const r = await pollDirectDonations(db, d, s.entity);
    expect(r.recorded).toHaveLength(0);
    expect(r.skipped).toBe(3);
    expect(await db.select().from(schema.donations)).toHaveLength(0);
  });

  it("reports the Transaction Service being down instead of inventing an empty month", async () => {
    const s = await seeded();
    const broken = { ...deps, apiKit: () => ({ ...deps.apiKit(), getIncomingTransactions: async () => { throw new Error("tx service down"); } }) } as FakeDeps;
    const r = await pollDirectDonations(db, broken, s.entity);
    expect(r.error).toContain("tx service down");
    expect(r.recorded).toHaveLength(0);
  });

  it("parseTransfer refuses a record missing the fields we depend on", () => {
    expect(parseTransfer(null)).toBeNull();
    expect(parseTransfer({ transactionHash: TX })).toBeNull();
    expect(parseTransfer(transfer())?.logIndex).toBe(3);
  });
});

describe("claimDirectDonation", () => {
  async function seedDirect() {
    const s = await seeded();
    const sender = privateKeyToAccount(generatePrivateKey());
    const d = withIncoming(deps, [transfer({ from: sender.address })]);
    await pollDirectDonations(db, d, s.entity);
    const donor = await seedUser(db, "donor-direct");
    return { s, sender, donor, d };
  }

  it("attributes the donation when the sending wallet signs the message", async () => {
    const { s, sender, donor, d } = await seedDirect();
    const signature = await sender.signMessage({ message: directDonationMessage(TX, d.chain.chainId) });

    const r = await claimDirectDonation(db, d, { txHash: TX, signature, userId: donor.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getAddress(r.signer as Address)).toBe(getAddress(sender.address));
    const [row] = await db.select().from(schema.donations).where(eq(schema.donations.chainTxHash, TX));
    expect(row!.donorUserId).toBe(donor.id);
    expect((await listEntityEvents(db, s.entity.id)).map((e) => e.kind)).toContain("donation.attributed");
  });

  it("REFUSES a signature from the wrong address and leaves the donation anonymous", async () => {
    const { donor, d } = await seedDirect();
    const impostor = privateKeyToAccount(generatePrivateKey());
    const signature = await impostor.signMessage({ message: directDonationMessage(TX, d.chain.chainId) });

    const r = await claimDirectDonation(db, d, { txHash: TX, signature, userId: donor.id });
    expect(r).toMatchObject({ ok: false, code: "wrong_signer", status: 422 });
    const [row] = await db.select().from(schema.donations).where(eq(schema.donations.chainTxHash, TX));
    expect(row!.donorUserId).toBeNull();
  });

  it("refuses a signature over a different transaction (no replay onto another donation)", async () => {
    const { sender, donor, d } = await seedDirect();
    const otherTx = `0x${"cd".repeat(32)}`;
    const signature = await sender.signMessage({ message: directDonationMessage(otherTx, d.chain.chainId) });

    expect(await claimDirectDonation(db, d, { txHash: TX, signature, userId: donor.id })).toMatchObject({ ok: false, code: "wrong_signer" });
  });

  it("refuses an unknown transaction and a donation someone else already claimed", async () => {
    const { sender, donor, d } = await seedDirect();
    expect(await claimDirectDonation(db, d, { txHash: `0x${"ff".repeat(32)}`, signature: "0x00", userId: donor.id })).toMatchObject({ ok: false, code: "not_found" });

    const signature = await sender.signMessage({ message: directDonationMessage(TX, d.chain.chainId) });
    await claimDirectDonation(db, d, { txHash: TX, signature, userId: donor.id });
    const other = await seedUser(db, "donor-other");
    expect(await claimDirectDonation(db, d, { txHash: TX, signature, userId: other.id })).toMatchObject({ ok: false, code: "already_claimed" });
  });
});

describe("safeQrDataUrl", () => {
  it("renders a PNG data URL server-side for a real address and null for anything else", async () => {
    const url = await safeQrDataUrl(SAFE);
    expect(url?.startsWith("data:image/png;base64,")).toBe(true);
    expect(await safeQrDataUrl("not-an-address")).toBeNull();
    expect(await safeQrDataUrl("")).toBeNull();
  });
});
