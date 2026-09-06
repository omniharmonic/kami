/**
 * The Passport refresh (T2.14). The property under test is the one that
 * matters: **an absent score is absent, never zero.** Without a key, without a
 * wallet, with the API down or unreadable, nothing is written and an existing
 * score survives untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, seedEntity, seedUser, type TestDb } from "@/db/test-utils";
import { CACHE_TTL_MS, passportStatus, refreshPassportScore, runPassportRefresh, scoreUrl, usersDueForRefresh } from "../refresh";

let db: TestDb;
const NOW = new Date("2026-09-06T12:00:00.000Z");
const WALLET = "0x6666666666666666666666666666666666666666";
const ENV = { PASSPORT_API_KEY: "pk_test", PASSPORT_SCORER_ID: "42", PASSPORT_API_URL: "https://passport.test" };

function fetchReturning(body: unknown, status = 200) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function seedPerson(id = "person-1", opts: { wallet?: string | null; score?: string | null; checkedAt?: Date | null } = {}) {
  const u = await seedUser(db, id);
  await db
    .update(schema.users)
    .set({
      walletAddress: opts.wallet === undefined ? WALLET : opts.wallet,
      passportScore: opts.score ?? null,
      passportCheckedAt: opts.checkedAt ?? null,
    })
    .where(eq(schema.users.id, u.id));
  return u;
}

async function stored(id: string) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return { score: row!.passportScore, checkedAt: row!.passportCheckedAt };
}

beforeEach(async () => {
  db = await createTestDb();
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("refreshPassportScore with no API key", () => {
  it("writes nothing at all", async () => {
    const u = await seedPerson("no-key-1");
    const { impl, calls } = fetchReturning({ score: "31.2" });
    const r = await refreshPassportScore(db, u.id, { env: {}, fetchImpl: impl, now: () => NOW, log: () => {} });

    expect(r).toMatchObject({ unavailable: true, reason: "no_api_key", score: null });
    expect(calls).toHaveLength(0);
    expect(await stored(u.id)).toEqual({ score: null, checkedAt: null });
  });

  it("does NOT zero an existing score — an absent answer is not a low score", async () => {
    const u = await seedPerson("no-key-2", { score: "27.5", checkedAt: new Date("2026-08-01T00:00:00Z") });
    const r = await refreshPassportScore(db, u.id, { env: {}, fetchImpl: fetchReturning({}).impl, now: () => NOW, log: () => {} });

    expect(r).toMatchObject({ unavailable: true, reason: "no_api_key", score: 27.5 });
    const after = await stored(u.id);
    expect(Number(after.score)).toBe(27.5);
    expect(after.checkedAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("refreshPassportScore with a key", () => {
  it("stores the score and the check time", async () => {
    const u = await seedPerson("keyed-1");
    const { impl, calls } = fetchReturning({ address: WALLET, score: "31.2", passing_score: true });
    const r = await refreshPassportScore(db, u.id, { env: ENV, fetchImpl: impl, now: () => NOW });

    expect(r).toMatchObject({ unavailable: false, score: 31.2, cached: false });
    expect(calls[0]).toBe(scoreUrl(ENV, WALLET));
    const after = await stored(u.id);
    expect(Number(after.score)).toBe(31.2);
    expect(after.checkedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("serves the cached score for 24 hours and refreshes after", async () => {
    const u = await seedPerson("keyed-2", { score: "20", checkedAt: new Date(NOW.getTime() - CACHE_TTL_MS + 60_000) });
    const fresh = fetchReturning({ score: "99" });
    expect(await refreshPassportScore(db, u.id, { env: ENV, fetchImpl: fresh.impl, now: () => NOW })).toMatchObject({ unavailable: false, score: 20, cached: true });
    expect(fresh.calls).toHaveLength(0);

    await db.update(schema.users).set({ passportCheckedAt: new Date(NOW.getTime() - CACHE_TTL_MS - 1000) }).where(eq(schema.users.id, u.id));
    expect(await refreshPassportScore(db, u.id, { env: ENV, fetchImpl: fresh.impl, now: () => NOW })).toMatchObject({ unavailable: false, score: 99, cached: false });
  });

  it("leaves the stored score alone on an HTTP error, a network error and an unreadable body", async () => {
    const u = await seedPerson("keyed-3", { score: "18", checkedAt: new Date("2026-08-01T00:00:00Z") });
    const deps = { env: ENV, now: () => NOW, log: () => {} };

    expect(await refreshPassportScore(db, u.id, { ...deps, fetchImpl: fetchReturning({ detail: "nope" }, 503).impl })).toMatchObject({ unavailable: true, reason: "http_error", score: 18 });
    const boom = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    expect(await refreshPassportScore(db, u.id, { ...deps, fetchImpl: boom })).toMatchObject({ unavailable: true, reason: "network_error", score: 18 });
    expect(await refreshPassportScore(db, u.id, { ...deps, fetchImpl: fetchReturning({ nothing: "useful" }).impl })).toMatchObject({ unavailable: true, reason: "unreadable", score: 18 });

    const after = await stored(u.id);
    expect(Number(after.score)).toBe(18);
    expect(after.checkedAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("says so when a person has no wallet, rather than scoring them zero", async () => {
    const u = await seedPerson("keyed-4", { wallet: null });
    expect(await refreshPassportScore(db, u.id, { env: ENV, fetchImpl: fetchReturning({ score: "50" }).impl, now: () => NOW })).toMatchObject({ unavailable: true, reason: "no_wallet" });
    expect(await stored(u.id)).toMatchObject({ score: null });
  });
});

describe("the daily job", () => {
  it("picks up people who claimed or were paid in the last 90 days and nobody else", async () => {
    const entity = await seedEntity(db);
    const claimant = await seedPerson("claimant", { wallet: WALLET });
    const payee = await seedPerson("payee", { wallet: "0x7777777777777777777777777777777777777777" });
    await seedPerson("bystander", { wallet: "0x8888888888888888888888888888888888888888" });
    const old = await seedPerson("long-ago", { wallet: "0x9999999999999999999999999999999999999999" });

    await db.insert(schema.bounties).values({
      id: "b1",
      entityId: entity.id,
      title: "t",
      whyMd: "w",
      deliverableMd: "d",
      verificationTier: 2,
      evidenceSpec: {},
      capUsdc: "25.00",
      twinRefs: [],
      specSha256: "0x00",
      status: "open",
    });
    await db.insert(schema.claims).values([
      { id: "c1", bountyId: "b1", userId: claimant.id, claimedAt: new Date(NOW.getTime() - 5 * 86_400_000) },
      { id: "c2", bountyId: "b1", userId: old.id, claimedAt: new Date(NOW.getTime() - 200 * 86_400_000) },
    ]);
    await db.insert(schema.payouts).values({ id: "p1", rail: "usdc_safe", amountUsdc: "25.00", recipientUserId: payee.id, executedAt: new Date(NOW.getTime() - 3 * 86_400_000) });

    expect(await usersDueForRefresh(db, { now: NOW })).toEqual(["claimant", "payee"]);
  });

  it("is an honest no-op with no key: no writes, and it says why", async () => {
    const u = await seedPerson("nokey", { score: "12", checkedAt: new Date("2026-08-01T00:00:00Z") });
    const lines: string[] = [];
    const r = await runPassportRefresh(db, { env: {}, log: (l) => lines.push(l) });
    expect(r).toMatchObject({ no_api_key: true, refreshed: 0 });
    expect(lines.join("\n")).toContain("no PASSPORT_API_KEY");
    expect(Number((await stored(u.id)).score)).toBe(12);
  });
});

describe("passportStatus", () => {
  it("labels a missing score 'unverified' rather than reporting a number", async () => {
    const u = await seedPerson("unscored", { score: null });
    expect(await passportStatus(db, u.id)).toMatchObject({ score: null, label: "unverified" });
    await db.update(schema.users).set({ passportScore: "22" }).where(eq(schema.users.id, u.id));
    expect(await passportStatus(db, u.id)).toMatchObject({ score: 22, label: "checked" });
  });
});
