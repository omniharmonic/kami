import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { bindingSha256 } from "@kami/binding";
import { closeTestDb, seedUser, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { verifyEventChain } from "@/db/events";
import { seedBoulderCreek, NOW, twinFromFixtures } from "@/lib/jobs/__tests__/helpers";
import { approveSensing, refreshSensing, sensingStatus, SensingWarnings } from "../sensing";
vi.setConfig({ testTimeout: 180000, hookTimeout: 180000 });
const dbs: TestDb[] = [];
afterAll(async () => { await Promise.all(dbs.map(closeTestDb)); });
async function setup(review: "approved" | "pending_review" = "approved") {
    const seeded = await seedBoulderCreek({ review, consultationDone: false, paused: true });
    dbs.push(seeded.db);
    await seedUser(seeded.db, "sensing-steward", "steward@example.org");
    await seeded.db.insert(schema.entityRoles).values({ entityId: seeded.entity.id, userId: "sensing-steward", role: "steward", acceptedAt: NOW });
    return seeded;
}
describe("self-service sensing", () => {
    it("computes a private paused snapshot and throttles duplicate refresh requests", async () => {
        const { db, entity } = await setup();
        const input = { slug: entity.slug, userId: "sensing-steward" };
        const result = await refreshSensing(db, input, { twin: twinFromFixtures(), now: NOW });
        expect(result.status).toBe("withheld");
        expect(result.snapshot_id).toBeTruthy();
        await expect(refreshSensing(db, input, { twin: twinFromFixtures(), now: NOW })).rejects.toThrow("already requested");
        const [fresh] = await db.select().from(schema.entities).where(eq(schema.entities.id, entity.id));
        expect(fresh?.pausedAt).not.toBeNull();
        expect(fresh?.consultationDoneAt).toBeNull();
        const status = await sensingStatus(db, entity);
        expect(status.places.length).toBeGreaterThan(0);
        expect(status.needs.length).toBeGreaterThan(0);
        expect(status.snapshot).not.toBeNull();
    });
    it("refuses non-stewards and pending refresh before any twin work", async () => {
        const { db, entity } = await setup("pending_review");
        const twin = twinFromFixtures();
        const spy = vi.spyOn(twin, "get");
        await expect(refreshSensing(db, { slug: entity.slug, userId: "intruder" }, { twin })).rejects.toThrow("accepted steward");
        await expect(refreshSensing(db, { slug: entity.slug, userId: "sensing-steward" }, { twin })).rejects.toThrow("Approve");
        expect(spy).not.toHaveBeenCalled();
        expect(await db.select().from(schema.needSnapshots)).toHaveLength(0);
    });
    it("refuses stale review hashes and records approval with the actual reviewer", async () => {
        const { db, entity, binding } = await setup("pending_review");
        const input = { slug: entity.slug, userId: "sensing-steward", version: binding.binding_version, hash: bindingSha256(binding) };
        await expect(approveSensing(db, { ...input, hash: "0".repeat(64) }, twinFromFixtures())).rejects.toThrow("changed");
        // The current profile may contain genuine warnings against an older fixture
        // tree. Validation is deliberately controlled here; live I/O never occurs.
        const module = await import("@kami/binding");
        const validation = vi.spyOn(module, "validateBinding").mockResolvedValue({ ok: true, errors: [], warnings: [] });
        try {
            await approveSensing(db, input, twinFromFixtures());
        }
        finally {
            validation.mockRestore();
        }
        const [row] = await db.select().from(schema.entityBindings).where(eq(schema.entityBindings.entityId, entity.id));
        expect(row?.review).toBe("approved");
        expect(row?.reviewedBy).toBe(input.userId);
        expect(row?.sha256).toBe(bindingSha256(row?.binding));
        expect((await verifyEventChain(db, entity.id)).ok).toBe(true);
    });
    it("requires explicit acceptance of the exact current twin warnings", async () => {
        const { db, entity, binding } = await setup("pending_review");
        const input = { slug: entity.slug, userId: "sensing-steward", version: binding.binding_version, hash: bindingSha256(binding) };
        const warnings = [{ rule: 5 as const, path: "/needs/0", message: "This source has no current reading." }];
        const module = await import("@kami/binding");
        const validation = vi.spyOn(module, "validateBinding").mockResolvedValue({ ok: true, errors: [], warnings });
        try {
            await expect(approveSensing(db, input, twinFromFixtures())).rejects.toBeInstanceOf(SensingWarnings);
            await expect(approveSensing(db, { ...input, acceptedWarningHash: "wrong" }, twinFromFixtures())).rejects.toBeInstanceOf(SensingWarnings);
            await approveSensing(db, { ...input, acceptedWarningHash: bindingSha256(warnings) }, twinFromFixtures());
            const [row] = await db.select().from(schema.entityBindings).where(eq(schema.entityBindings.entityId, entity.id));
            expect(row?.review).toBe("approved");
        }
        finally {
            validation.mockRestore();
        }
    });
    it("detects a binding change while live validation was running", async () => {
        const { db, entity, binding } = await setup("pending_review");
        const input = { slug: entity.slug, userId: "sensing-steward", version: binding.binding_version, hash: bindingSha256(binding) };
        const module = await import("@kami/binding");
        const validation = vi.spyOn(module, "validateBinding").mockImplementation(async () => {
            await db.update(schema.entityBindings).set({ sha256: "b".repeat(64) }).where(eq(schema.entityBindings.entityId, entity.id));
            return { ok: true, errors: [], warnings: [] };
        });
        try {
            await expect(approveSensing(db, input, twinFromFixtures())).rejects.toThrow("changed");
        }
        finally {
            validation.mockRestore();
        }
        const [row] = await db.select().from(schema.entityBindings).where(eq(schema.entityBindings.entityId, entity.id));
        expect(row?.review).toBe("pending_review");
    });
});
