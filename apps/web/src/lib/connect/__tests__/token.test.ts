/**
 * The token, from the page's side.
 *
 * Three promises are asserted here, because all three are promises a screen can
 * quietly break:
 *
 *  - it is shown once: nothing the page can read back afterwards contains the
 *    value, because nothing but a sha256 was stored;
 *  - rotating invalidates the previous one — asserted against
 *    `verifyEntityToken`, the function the MCP request path actually calls;
 *  - both are written into the entity's own audit log, without the value.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listEntityEvents } from "@/db/events";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import { verifyEntityToken } from "@/lib/mcp/tokens";
import { mintConnectToken, tokenPrefix, tokenState } from "../token";
import { connectTestDb, seedConnectEntity } from "./helpers";

let db: TestDb;
const entity = { id: "entity/boulder-creek", slug: "boulder-creek" };

beforeAll(async () => {
  db = await connectTestDb();
  await seedConnectEntity(db, "boulder-creek");
});
afterAll(async () => {
  await closeTestDb(db);
});

describe("connect · the bearer token", () => {
  it("reports honestly that none exists before one is minted", async () => {
    const state = await tokenState(db, "boulder-creek");
    expect(state.exists).toBe(false);
    expect(state.fingerprint).toBeNull();
    expect(state.minted_at).toBeNull();
    // absent, never zero
    expect(state.age_s).toBeNull();
    expect(state.prefix).toBe("kami_boulder-creek_");
  });

  it("hands the value back exactly once, and never renders it again", async () => {
    const minted = await mintConnectToken(db, entity, "u-maya", new Date("2026-09-06T10:00:00Z"));
    expect(minted.token).toMatch(/^kami_boulder-creek_[0-9a-f]{48}$/);
    expect(minted.replaced).toBe(false);

    const after = await tokenState(db, "boulder-creek", new Date("2026-09-06T10:00:30Z"));
    expect(after.exists).toBe(true);
    expect(after.age_s).toBe(30);
    expect(after.fingerprint).toHaveLength(8);
    // nothing readable afterwards contains the secret half
    expect(JSON.stringify(after)).not.toContain(minted.token.split("_")[2]);
    expect(after.prefix).toBe(tokenPrefix("boulder-creek"));
  });

  it("rotating invalidates the previous token on the path the MCP actually checks", async () => {
    const first = await mintConnectToken(db, entity, "u-maya");
    expect(await verifyEntityToken(db, first.token)).toEqual({ slug: "boulder-creek" });

    const second = await mintConnectToken(db, entity, "u-maya");
    expect(second.replaced).toBe(true);
    expect(await verifyEntityToken(db, first.token)).toBeNull();
    expect(await verifyEntityToken(db, second.token)).toEqual({ slug: "boulder-creek" });
    expect((await tokenState(db, "boulder-creek")).rotated).toBe(true);
  });

  it("records the mint in the entity's audit log, with a fingerprint and never the token", async () => {
    const minted = await mintConnectToken(db, entity, "u-ada");
    const events = await listEntityEvents(db, entity.id);
    const last = events[events.length - 1]!;
    expect(last.kind).toBe("mcp_token.rotated");
    expect(last.actor).toBe("u-ada");
    expect(JSON.stringify(last.payload)).not.toContain(minted.token);
    expect((last.payload as { fingerprint: string }).fingerprint).toHaveLength(8);
  });
});
