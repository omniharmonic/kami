import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as client from "@/db/client";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { defaultDataDir, loadStatus, type Status } from "@/lib/status";
import { cleanupTmpDirs, NOW, seedBoulderCreek } from "@/lib/jobs/__tests__/helpers";

const mocks = vi.hoisted(() => ({ access: vi.fn(), published: vi.fn() }));
vi.mock("@/lib/entity-access", () => ({ requireVisibleEntity: mocks.access }));
vi.mock("@/lib/entities", () => ({ getStatusCached: mocks.published }));
import { getVisibleEntityDashboard } from "./entities-private";

let db: TestDb;
let fixture: Status;
const entity = { id: "entity/boulder-creek", slug: "boulder-creek", from_db: true, consultation_done_at: null };
const beforeApproval = new Date(NOW.getTime() - 60_000);

beforeAll(async () => {
  ({ db } = await seedBoulderCreek({ consultationDone: false, paused: true }));
  client.setDbForTests(db as unknown as client.Db);
  fixture = (await loadStatus("boulder-creek", { dataDir: defaultDataDir() }))!;
});
afterAll(async () => { client.setDbForTests(null); await closeTestDb(db); await cleanupTmpDirs(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  mocks.access.mockReset().mockResolvedValue({ entity, preview: true });
  mocks.published.mockReset().mockResolvedValue(fixture);
  await db.update(schema.entities).set({ bindingVersion: 1 }).where(eq(schema.entities.id, entity.id));
  await db.update(schema.entityBindings).set({ review: "approved", reviewedAt: beforeApproval });
  await db.delete(schema.needSnapshots);
  await db.insert(schema.needSnapshots).values({ entityId: entity.id, asOf: NOW,
    snapshot: { ...fixture.snapshot, paused: true }, snapshotHash: "fixture", mood: "asleep", staleDriving: true });
});

describe("authorized private dashboard snapshots", () => {
  it("shows approved private needs with stale/asleep preserved and never reads public cache", async () => {
    const result = await getVisibleEntityDashboard("boulder-creek");
    expect(result.snapshot).toMatchObject({ paused: true, stale_driving: true, mood: "asleep" });
    expect(result.snapshot!.needs.length).toBeGreaterThan(0);
    expect(result.asOf).toBe(NOW.toISOString());
    expect(result.status).toBeNull();
    expect(mocks.published).not.toHaveBeenCalled();
  });
  it("rejects unauthorized access before either snapshot source is read", async () => {
    mocks.access.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    const read = vi.spyOn(client, "withDb");
    await expect(getVisibleEntityDashboard("boulder-creek")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(read).not.toHaveBeenCalled();
    expect(mocks.published).not.toHaveBeenCalled();
  });
  it("keeps public retrieval on the existing published status path", async () => {
    mocks.access.mockResolvedValue({ entity: { ...entity, consultation_done_at: NOW.toISOString() }, preview: false });
    const read = vi.spyOn(client, "withDb");
    const result = await getVisibleEntityDashboard("boulder-creek");
    expect(result.status).toBe(fixture);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.published).toHaveBeenCalledWith("boulder-creek");
  });
  it("withholds needs for a pending current binding", async () => {
    await db.update(schema.entityBindings).set({ review: "pending_review" });
    expect((await getVisibleEntityDashboard("boulder-creek")).snapshot).toBeNull();
  });
  it("does not reuse snapshots computed before current approval", async () => {
    await db.update(schema.entityBindings).set({ reviewedAt: new Date(NOW.getTime() + 60_000) });
    expect((await getVisibleEntityDashboard("boulder-creek")).snapshot).toBeNull();
  });
  it("does not fall back to a previously approved binding when current pointer changes", async () => {
    await db.update(schema.entities).set({ bindingVersion: 2 }).where(eq(schema.entities.id, entity.id));
    expect((await getVisibleEntityDashboard("boulder-creek")).snapshot).toBeNull();
  });
  it("rejects malformed or foreign snapshot data", async () => {
    await db.update(schema.needSnapshots).set({ snapshot: { ...fixture.snapshot, entity_id: "entity/other" } });
    expect((await getVisibleEntityDashboard("boulder-creek")).snapshot).toBeNull();
    await db.update(schema.needSnapshots).set({ snapshot: { entity_id: entity.id } });
    expect((await getVisibleEntityDashboard("boulder-creek")).snapshot).toBeNull();
  });
});
