/**
 * The mint/rotate server action.
 *
 * The warning on the page is not the guarantee — this is. A rotation that
 * arrives without the confirmation is refused here, so a client that skipped
 * the warning still cannot skip the consequence; and the previous token is
 * asserted dead against `verifyEntityToken`, the function the MCP request path
 * calls, rather than against anything this feature owns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type User = { id: string; email: string; name: string | null; age_gate_ok: boolean; platform_admin: boolean };
let currentUser: User | null = null;

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return { ...actual, getSession: async () => (currentUser ? { user: currentUser, expiresAt: new Date(Date.now() + 3_600_000) } : null) };
});

import * as schema from "@/db/schema";
import { setDbForTests } from "@/db/client";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import { EMPTY_MINT_STATE } from "@/components/connect/TokenPanel";
import { verifyEntityToken } from "@/lib/mcp/tokens";
import { connectTestDb, seedConnectEntity } from "@/lib/connect/__tests__/helpers";
import { eq } from "drizzle-orm";
import { mintConnectTokenAction, publishConnectEntityAction } from "../actions";

const maya: User = { id: "u-maya", email: "maya@example.org", name: "Maya", age_gate_ok: true, platform_admin: false };
const ada: User = { id: "u-ada", email: "ada@example.org", name: "Ada", age_gate_ok: true, platform_admin: false };

let db: TestDb;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  db = await connectTestDb();
  setDbForTests(db);
  await seedConnectEntity(db, "boulder-creek");
  await db.insert(schema.entityRoles).values({ entityId: "entity/boulder-creek", userId: "u-maya", role: "steward", acceptedAt: new Date() });
  await db.insert(schema.entityRoles).values({ entityId: "entity/boulder-creek", userId: "u-ada", role: "guardian", acceptedAt: new Date() });
  currentUser = maya;
});

afterEach(async () => {
  currentUser = null;
  setDbForTests(null);
  await closeTestDb(db);
});

describe("mintConnectTokenAction", () => {
  it("mints once and returns the value exactly once", async () => {
    const first = await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "boulder-creek" }));
    expect(first.ok).toBe(true);
    expect(first.token).toMatch(/^kami_boulder-creek_[0-9a-f]{48}$/);
    expect(first.replaced).toBe(false);
    expect(await verifyEntityToken(db, first.token!)).toEqual({ slug: "boulder-creek" });
  });

  it("refuses to rotate without the confirmation, and changes nothing when it refuses", async () => {
    const first = await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "boulder-creek" }));
    const refused = await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "boulder-creek" }));
    expect(refused).toEqual({ ok: false, error: "confirm_required" });
    expect(await verifyEntityToken(db, first.token!)).toEqual({ slug: "boulder-creek" });
  });

  it("rotates when confirmed, and the previous token stops working", async () => {
    const first = await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "boulder-creek" }));
    const second = await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "boulder-creek", confirm: "yes" }));
    expect(second.ok).toBe(true);
    expect(second.replaced).toBe(true);
    expect(await verifyEntityToken(db, first.token!)).toBeNull();
    expect(await verifyEntityToken(db, second.token!)).toEqual({ slug: "boulder-creek" });
  });

  it("refuses a guardian, a stranger and a signed-out caller", async () => {
    currentUser = ada;
    expect(await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "boulder-creek" }))).toEqual({ ok: false, error: "forbidden" });
    currentUser = { id: "u-nobody", email: "nobody@example.org", name: null, age_gate_ok: true, platform_admin: false };
    expect(await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "boulder-creek" }))).toEqual({ ok: false, error: "forbidden" });
    currentUser = null;
    expect(await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "boulder-creek" }))).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses an unknown or malformed slug without touching anything", async () => {
    expect(await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "no-such-creek" }))).toEqual({ ok: false, error: "not_found" });
    expect(await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "Not A Slug" }))).toEqual({ ok: false, error: "not_found" });
  });

  it("lets the creator mint even without a role row", async () => {
    await seedConnectEntity(db, "left-hand-creek", { createdBy: "u-maya" });
    const res = await mintConnectTokenAction(EMPTY_MINT_STATE, form({ slug: "left-hand-creek" }));
    expect(res.ok).toBe(true);
  });
});


describe("publishConnectEntityAction", () => {
  it("lets an accepted steward publish without a summon draft or consultation", async () => {
    await db.update(schema.entities).set({ publishedAt: null, consultationDoneAt: null, pausedAt: new Date() }).where(eq(schema.entities.slug, "boulder-creek"));
    const result = await publishConnectEntityAction({ ok: false, message: "" }, form({ slug: "boulder-creek" }));
    expect(result.ok).toBe(true);
    const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.slug, "boulder-creek"));
    expect(entity!.publishedAt).not.toBeNull();
    expect(entity!.consultationDoneAt).toBeNull();
    expect(entity!.pausedAt).not.toBeNull();
  });
  it("refuses guardians and anonymous callers without changing publication", async () => {
    currentUser = ada;
    expect((await publishConnectEntityAction({ ok: false, message: "" }, form({ slug: "boulder-creek" }))).ok).toBe(false);
    currentUser = null;
    expect((await publishConnectEntityAction({ ok: false, message: "" }, form({ slug: "boulder-creek" }))).ok).toBe(false);
    const [entity] = await db.select().from(schema.entities).where(eq(schema.entities.slug, "boulder-creek"));
    expect(entity!.publishedAt).toBeNull();
  });
});
