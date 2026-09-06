/**
 * The server half of ADR-E07: a Privy access token is verified, the wallet is
 * created on demand, and `privy_did` / `wallet_address` are the only things
 * stored. No key crosses this boundary; there is no field for one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, seedUser, type TestDb } from "@/db/test-utils";
import { disconnectWallet, getOrCreateWallet, offrampUrl, verifyPrivyToken, type PrivyServerLike, type PrivyUser } from "../server";

const ADDRESS = "0x5555555555555555555555555555555555555555";

class FakePrivy implements PrivyServerLike {
  users = new Map<string, PrivyUser>();
  created: string[] = [];
  verifyThrows = false;
  getThrows = false;

  async verifyAuthToken(token: string) {
    if (this.verifyThrows || token === "bad") throw new Error("invalid token");
    return { userId: `did:privy:${token}` };
  }
  async getUserById(userId: string): Promise<PrivyUser> {
    if (this.getThrows) throw new Error("privy down");
    return this.users.get(userId) ?? { id: userId };
  }
  async createWallets({ userId }: { userId: string }): Promise<PrivyUser> {
    this.created.push(userId);
    const user: PrivyUser = { id: userId, wallet: { address: ADDRESS.toLowerCase(), walletClientType: "privy" } };
    this.users.set(userId, user);
    return user;
  }
}

let db: TestDb;
let privy: FakePrivy;

beforeEach(async () => {
  db = await createTestDb();
  privy = new FakePrivy();
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("verifyPrivyToken", () => {
  it("returns the DID for a good token and refuses a bad one without echoing it", async () => {
    expect(await verifyPrivyToken("abc", { privy })).toMatchObject({ ok: true, did: "did:privy:abc" });
    const bad = await verifyPrivyToken("bad", { privy });
    expect(bad).toMatchObject({ ok: false, code: "invalid_token", status: 401 });
    if (!bad.ok) expect(bad.message).not.toContain("bad");
  });

  it("says so when Privy is not configured, and when no token is offered", async () => {
    expect(await verifyPrivyToken("abc", { privy: null })).toMatchObject({ ok: false, code: "not_configured", status: 503 });
    expect(await verifyPrivyToken(null, { privy })).toMatchObject({ ok: false, code: "no_token" });
  });
});

describe("getOrCreateWallet", () => {
  it("creates a wallet on demand and stores only the DID and the checksummed address", async () => {
    const user = await seedUser(db, "person-1");
    const r = await getOrCreateWallet(db, { privy, did: "did:privy:abc", log: () => {} }, user.id);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallet.created).toBe(true);
    expect(privy.created).toEqual(["did:privy:abc"]);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row!.privyDid).toBe("did:privy:abc");
    expect(row!.walletAddress).toBe(ADDRESS); // checksummed, from Privy, never from the client
  });

  it("is idempotent and never calls Privy again once an address is stored", async () => {
    const user = await seedUser(db, "person-2");
    await getOrCreateWallet(db, { privy, did: "did:privy:abc" }, user.id);
    const again = await getOrCreateWallet(db, { privy, did: "did:privy:abc" }, user.id);
    expect(again).toMatchObject({ ok: true });
    if (again.ok) expect(again.wallet.created).toBe(false);
    expect(privy.created).toHaveLength(1);
  });

  it("refuses to move one Privy account onto a second Kami account", async () => {
    const a = await seedUser(db, "person-a");
    const b = await seedUser(db, "person-b");
    await getOrCreateWallet(db, { privy, did: "did:privy:abc" }, a.id);
    expect(await getOrCreateWallet(db, { privy, did: "did:privy:abc" }, b.id)).toMatchObject({ ok: false, code: "did_taken", status: 409 });
  });

  it("changes nothing when Privy is unreachable or unconfigured", async () => {
    const user = await seedUser(db, "person-3");
    expect(await getOrCreateWallet(db, { privy: null }, user.id)).toMatchObject({ ok: false, code: "not_configured" });
    privy.getThrows = true;
    expect(await getOrCreateWallet(db, { privy, did: "did:privy:abc", log: () => {} }, user.id)).toMatchObject({ ok: false, code: "privy_error", status: 502 });
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row!.walletAddress).toBeNull();
    expect(row!.privyDid).toBeNull();
  });

  it("disconnecting forgets the link and nothing else", async () => {
    const user = await seedUser(db, "person-4");
    await getOrCreateWallet(db, { privy, did: "did:privy:abc" }, user.id);
    await disconnectWallet(db, user.id);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row!.walletAddress).toBeNull();
    expect(row!.privyDid).toBeNull();
  });
});

describe("offrampUrl", () => {
  it("prefers config, accepts only https, and is null when unset", () => {
    expect(offrampUrl("https://pay.example.org/offramp", {})).toBe("https://pay.example.org/offramp");
    expect(offrampUrl(null, { OFFRAMP_URL: "https://env.example.org/x" })).toBe("https://env.example.org/x");
    expect(offrampUrl("javascript:alert(1)", {})).toBeNull();
    expect(offrampUrl("http://insecure.example.org", {})).toBeNull();
    expect(offrampUrl(null, {})).toBeNull();
  });
});
