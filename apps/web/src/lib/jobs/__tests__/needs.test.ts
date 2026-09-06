import { afterAll, describe, expect, it, vi } from "vitest";
import { desc, eq, sql } from "drizzle-orm";
import type { HealthSnapshot } from "@kami/needs";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { CACHE_CONTROL } from "@/lib/publish";
import { runNeedsJob, specsFromBinding, loadCurrentBinding } from "../needs";
import { precheck } from "../precheck";
import { setConfig } from "../common";
import { bumpGeneratedAt, cleanupTmpDirs, copyFixtureTree, FIXTURE_TREE, NOW, readPublishedStatus, seedBoulderCreek, twinFromFixtures } from "./helpers";

// Each case builds a fresh PGlite database and runs every migration; on a box
// running several suites at once that can outlast the shared 60 s default.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });


const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => closeTestDb(d)));
  await cleanupTmpDirs();
});

describe("the hourly needs job", () => {
  it("produces a snapshot row and a status file for a seeded Boulder Creek entity", async () => {
    const { db, entity, publisher, binding } = await seedBoulderCreek();
    dbs.push(db);
    const twin = twinFromFixtures();
    const out = await runNeedsJob({ db, twin, publisher, now: NOW, gpuOnline: true });
    expect(out.results).toHaveLength(1);
    const r = out.results[0]!;
    expect(r).toMatchObject({ slug: "boulder-creek", status: "published", new_snapshot: true });
    expect(r.published!.key).toBe("entity/boulder-creek/status.json");

    const rows = await db.select().from(schema.needSnapshots).where(eq(schema.needSnapshots.entityId, entity.id));
    expect(rows).toHaveLength(1);
    const snapshot = rows[0]!.snapshot as HealthSnapshot;
    expect(snapshot.entity_id).toBe("entity/boulder-creek");
    expect(snapshot.needs.map((n) => n.need)).toEqual(specsFromBinding(binding).map((s) => s.need));

    // every reading crossing the boundary carries the honesty fields (ADR-E11)
    for (const n of snapshot.needs) {
      expect(n).toHaveProperty("time");
      expect(n).toHaveProperty("unit");
      expect(n).toHaveProperty("source_id");
      expect(typeof n.stale).toBe("boolean");
      expect(n).toHaveProperty("staleness_s");
      expect(["ok", "warning", "critical", "unknown"]).toContain(n.source_status);
    }
    // the fixture's flow reading at Orodell, resolved through the binding
    const flow = snapshot.needs.find((n) => n.need === "flow")!;
    expect(flow.place_id).toBe("place/boulder-creek-near-orodell-co");
    expect(flow.value).toBe(15.4);
    // reservoir_fill comes off the derived reading
    expect(snapshot.needs.find((n) => n.need === "storage")!.value).toBe(72);
    // drought: max dm of the polygons whose bbox meets a watershed bbox (D1 in the fixture)
    expect(snapshot.drought_class).toBe(1);
    // no geometry ever crosses the boundary
    expect(JSON.stringify(snapshot)).not.toContain("coordinates");

    const file = (await readPublishedStatus(publisher, "boulder-creek"))!;
    expect(file.entity_id).toBe("entity/boulder-creek");
    expect(file.snapshot_id).toBe(rows[0]!.id);
    expect(file.binding_version).toBe(1);
    expect((file.entity as Record<string, unknown>).anchor).toBe("place/boulder-creek-near-orodell-co");
    expect(file.board).toMatchObject({ open: 0, claimed: 0, in_review: 0, paid: 0, human_proposals: 0 });
    expect(file.treasury).toMatchObject({ safe_address: null, balance_usdc: null, pending: 0 });
    expect(Array.isArray(file.pulses)).toBe(true);
    const headers = await publisher.get("entity/boulder-creek/status.json");
    expect(headers!.cacheControl).toBe(CACHE_CONTROL.latest);
  });

  it("a stale driving reading publishes mood asleep, never distressed (ADR-E11)", async () => {
    const { db, publisher } = await seedBoulderCreek({ slug: "stale-creek" });
    dbs.push(db);
    // The fixture's Orodell discharge is stale (2026-09-04 20:15Z) as of a 2026-09-06 clock.
    const out = await runNeedsJob({ db, twin: twinFromFixtures(), publisher, now: NOW, gpuOnline: true });
    expect(out.results[0]!.status).toBe("published");
    const file = (await readPublishedStatus(publisher, "stale-creek"))!;
    const snapshot = file.snapshot as HealthSnapshot;
    expect(snapshot.needs.find((n) => n.need === "flow")!.stale).toBe(true);
    expect(snapshot.stale_driving).toBe(true);
    expect(snapshot.mood).toBe("asleep");
    expect(snapshot.mood_reason).toBe("I can't feel my gauge");
    // a stale need carries no health, but keeps its last value and time
    const flow = snapshot.needs.find((n) => n.need === "flow")!;
    expect(flow.health).toBeNull();
    expect(flow.value).toBe(15.4);
    expect(flow.time).toBe("2026-09-04T20:15:00Z");
  });

  it("a second run whose only change is generated_at writes no new snapshot and precheck says unchanged", async () => {
    const { db, entity, publisher } = await seedBoulderCreek({ slug: "idem-creek" });
    dbs.push(db);
    const treeA = await copyFixtureTree();
    await runNeedsJob({ db, twin: twinFromFixtures(treeA), publisher, now: NOW, gpuOnline: true });
    const first = await db.select().from(schema.needSnapshots).where(eq(schema.needSnapshots.entityId, entity.id));
    expect(first).toHaveLength(1);

    // the twin republishes: every generated_at moves, nothing else does
    const bumped = await bumpGeneratedAt(treeA, "2026-09-06T07:00:00Z");
    expect(bumped).toBeGreaterThan(5);

    const laterNow = new Date(NOW.getTime() + 3600_000);
    const second = await runNeedsJob({ db, twin: twinFromFixtures(treeA, () => laterNow.getTime()), publisher, now: laterNow, gpuOnline: true });
    expect(second.results[0]).toMatchObject({ status: "published", new_snapshot: false });

    const after = await db.select().from(schema.needSnapshots).where(eq(schema.needSnapshots.entityId, entity.id));
    expect(after).toHaveLength(1);
    expect(after[0]!.snapshotHash).toBe(first[0]!.snapshotHash);

    // and with no pulse yet, the precheck says "changed" once and stays truthful about the hash
    const before = await precheck(db, entity.id);
    expect(before).toMatchObject({ changed: true, snapshot_id: first[0]!.id, snapshot_hash: first[0]!.snapshotHash });

    // after a pulse against that snapshot, an unchanged twin means changed === false
    await db.insert(schema.pulses).values({ entityId: entity.id, at: laterNow, woke: true, snapshotId: first[0]!.id, text: null, guardResult: "pass" });
    const p = await precheck(db, entity.id);
    expect(p.changed).toBe(false);
    expect(p.last_pulse!.snapshot_hash).toBe(first[0]!.snapshotHash);

    // the status file was republished with a fresh as_of even though the snapshot did not move
    const file = (await readPublishedStatus(publisher, "idem-creek"))!;
    expect(file.as_of).toBe(laterNow.toISOString());
    expect(file.snapshot_hash).toBe(first[0]!.snapshotHash);
  });

  it("skips an entity whose binding is not approved, and reports why", async () => {
    const { db, publisher } = await seedBoulderCreek({ slug: "pending-creek", review: "pending_review" });
    dbs.push(db);
    const out = await runNeedsJob({ db, twin: twinFromFixtures(), publisher, now: NOW });
    expect(out.results[0]).toMatchObject({ slug: "pending-creek", status: "skipped", reason: "binding_pending_review" });
    expect(await readPublishedStatus(publisher, "pending-creek")).toBeNull();
  });

  it("takes gpu_online from the last heartbeat and paused from entities.paused_at", async () => {
    const { db, entity, publisher } = await seedBoulderCreek({ slug: "gpu-creek" });
    dbs.push(db);
    // no heartbeat at all → asleep, "my thinking machine is off"
    await runNeedsJob({ db, twin: twinFromFixtures(), publisher, now: NOW });
    let file = (await readPublishedStatus(publisher, "gpu-creek"))!;
    expect((file.snapshot as HealthSnapshot).gpu_online).toBe(false);
    expect((file.snapshot as HealthSnapshot).mood).toBe("asleep");

    // a heartbeat 5 minutes old → online
    const later = new Date(NOW.getTime() + 3600_000);
    await setConfig(db, "gpu_last_seen_at", new Date(later.getTime() - 5 * 60_000).toISOString(), later);
    await db.update(schema.entities).set({ pausedAt: NOW }).where(eq(schema.entities.id, entity.id));
    await runNeedsJob({ db, twin: twinFromFixtures(FIXTURE_TREE, () => later.getTime()), publisher, now: later });
    file = (await readPublishedStatus(publisher, "gpu-creek"))!;
    const snapshot = file.snapshot as HealthSnapshot;
    expect(snapshot.gpu_online).toBe(true);
    expect(snapshot.paused).toBe(true);
    expect(snapshot.mood_reason).toBe("paused by my guardians");
  });

  it("reads the current binding by entities.binding_version", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "binding-creek" });
    dbs.push(db);
    const loaded = await loadCurrentBinding(db, entity);
    expect("binding" in loaded && loaded.binding.anchor).toBe("place/boulder-creek-near-orodell-co");
    await db.update(schema.entities).set({ bindingVersion: null }).where(eq(schema.entities.id, entity.id));
    const [row] = await db.select().from(schema.entities).where(eq(schema.entities.id, entity.id));
    expect(await loadCurrentBinding(db, row!)).toEqual({ error: "no_binding_version" });
  });

  it("counts a stale-flip run as a new snapshot with notable deltas", async () => {
    const { db, entity, publisher } = await seedBoulderCreek({ slug: "delta-creek" });
    dbs.push(db);
    await runNeedsJob({ db, twin: twinFromFixtures(), publisher, now: NOW, gpuOnline: true });
    const [first] = await db.select().from(schema.needSnapshots).where(eq(schema.needSnapshots.entityId, entity.id)).orderBy(desc(schema.needSnapshots.asOf));
    // a fresher clock makes more readings stale — the world moved, so a row is written
    const later = new Date(NOW.getTime() + 30 * 86400_000);
    const out = await runNeedsJob({ db, twin: twinFromFixtures(undefined, () => later.getTime()), publisher, now: later, gpuOnline: true });
    expect(out.results[0]!.new_snapshot).toBe(true);
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.needSnapshots).where(eq(schema.needSnapshots.entityId, entity.id));
    expect(n!.n).toBe(2);
    expect(first!.snapshotHash).not.toBe(out.results[0]!.snapshot_hash);
  });

  it("withholds status.json until a steward records consultation, but still stores the snapshot", async () => {
    // PRD §13 #4. Before this, consultation_done_at was a label on an admin
    // screen: the page published regardless of whether anyone had been consulted.
    const { db, entity, publisher } = await seedBoulderCreek({ slug: "unconsulted-creek", consultationDone: false });
    dbs.push(db);
    const out = await runNeedsJob({ db, twin: twinFromFixtures(), publisher, now: NOW, gpuOnline: true });

    expect(out.results[0]!.status).toBe("withheld");
    expect(out.results[0]!.reason).toBe("consultation_not_done");
    expect(await publisher.get("entity/unconsulted-creek/status.json")).toBeNull();

    // The record exists from day one; only the publication waits.
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.needSnapshots)
      .where(eq(schema.needSnapshots.entityId, entity.id));
    expect(n!.n).toBe(1);

    // Once a steward records it, the very next run publishes.
    await db.update(schema.entities).set({ consultationDoneAt: new Date("2026-09-01T00:00:00Z") }).where(eq(schema.entities.id, entity.id));
    const later = new Date(NOW.getTime() + 3600_000);
    const after = await runNeedsJob({ db, twin: twinFromFixtures(undefined, () => later.getTime()), publisher, now: later, gpuOnline: true });
    expect(after.results[0]!.status).toBe("published");
    expect(await publisher.get("entity/unconsulted-creek/status.json")).not.toBeNull();
  });
});
