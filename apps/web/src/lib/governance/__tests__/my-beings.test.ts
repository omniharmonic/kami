import { afterEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, seedEntity, seedUser, type TestDb } from "@/db/test-utils";
import { setDbForTests } from "@/db/client";
import { entities, entityRoles } from "@/db/schema";
import { getMyBeings } from "../my-beings";

let db: TestDb;
afterEach(async () => { setDbForTests(null); if (db) await closeTestDb(db); });
it("lists only owned or accepted active memberships, preserving private state and connection permissions", async () => {
  db = await createTestDb();
  setDbForTests(db);
  await seedUser(db, "u-me");
  await seedUser(db, "u-other");
  for (const slug of ["owned", "stewarded", "invited", "revoked", "other", "evaluator"]) {
    await seedEntity(db, { slug, name: slug, consultationDone: false, paused: true });
  }
  await db.update(entities).set({ createdBy: "u-me" }).where(eq(entities.slug, "owned"));
  await db.insert(entityRoles).values([
    { entityId: "entity/stewarded", userId: "u-me", role: "steward", acceptedAt: new Date() },
    { entityId: "entity/invited", userId: "u-me", role: "guardian" },
    { entityId: "entity/revoked", userId: "u-me", role: "guardian", acceptedAt: new Date(), revokedAt: new Date() },
    { entityId: "entity/other", userId: "u-other", role: "steward", acceptedAt: new Date() },
    { entityId: "entity/evaluator", userId: "u-me", role: "evaluator", acceptedAt: new Date() },
  ]);
  const result = await getMyBeings(db, { id: "u-me", email: "u-me@example.org", name: null, age_gate_ok: true, platform_admin: false });
  expect(result.map((row) => row.slug)).toEqual(["evaluator", "owned", "stewarded"]);
  expect(result.every((row) => row.private && row.paused)).toBe(true);
  expect(result.find((row) => row.slug === "evaluator")?.access.may_view).toBe(false);
  expect(result.find((row) => row.slug === "stewarded")?.access.may_mint).toBe(true);
  expect(result.find((row) => row.slug === "owned")?.access.may_view).toBe(true);
});
