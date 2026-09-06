import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { MemoryNoteStore, runCommonsSync } from "../sync";
import { fencedBlock } from "../fence";
import type { Note } from "../client";
import { NOW, seedBoulderCreek } from "@/lib/jobs/__tests__/helpers";

// Each case builds a fresh PGlite database and runs every migration; on a box
// running several suites at once that can outlast the shared 60 s default.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });


const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => closeTestDb(d)));
});

async function seedContent(db: TestDb, entityId: string) {
  await db.insert(schema.souls).values({ entityId, soulVersion: 1, hardRulesVersion: "v1", voiceMd: "I am a creek that counts what passes." });
  await db.insert(schema.needSnapshots).values({
    entityId,
    asOf: NOW,
    snapshot: {
      schema_version: "1.0",
      entity_id: entityId,
      as_of: NOW.toISOString(),
      needs: [{ need: "flow", place_id: "place/boulder-creek-near-orodell-co", property: "discharge", value: 15.4, unit: "[ft_i]3/s", time: "2026-09-04T20:15:00Z", source_id: "cdss.telemetry", stale: true, staleness_s: 121500, source_status: "critical", percentile: null, band: null, health: null, trend_7d: null, label: "15.4 cfs at Orodell, 2026-09-04 20:15Z, stale" }],
      drought_class: 1,
      alert_level: 0,
      flood_category: null,
      stale_driving: true,
      mood: "asleep",
      mood_reason: "I can't feel my gauge",
      season: 2,
      gpu_online: true,
      paused: false,
      cosmetics: {},
    },
    snapshotHash: "h1",
    mood: "asleep",
    staleDriving: true,
  });
  await db.insert(schema.pulses).values([
    { entityId, at: new Date(NOW.getTime() - 2 * 86400_000), woke: true, text: "The gauge at Orodell went quiet after 2026-09-04 20:15Z.", guardResult: "pass", deltas: [{ kind: "stale_flip", need: "flow", field: "stale", from: false, to: true, notable: true }] },
    { entityId, at: new Date(NOW.getTime() - 86400_000), woke: true, text: null, guardResult: null, deltas: [] },
  ]);
  await db.insert(schema.strategies).values({ id: "st1", entityId, quarter: "2026-Q3", memoMd: "Know where my water goes.", ratifiedAt: NOW, createdAt: NOW });
  await db.insert(schema.donorReports).values({ id: "dr1", entityId, month: "2026-08-01", data: {}, narrativeMd: "private draft", publicMd: "In August, $120 went out to two people." });
  await db.insert(schema.bounties).values({
    id: "b1",
    entityId,
    title: "Photograph the diversions",
    whyMd: "Flow at Orodell is 15.4 cfs (2026-09-04T20:15Z, cdss.telemetry).",
    deliverableMd: "Six geotagged photos",
    verificationTier: 2,
    evidenceSpec: { min_photos: 6 },
    capUsdc: "40.00",
    twinRefs: ["place/boulder-creek-near-orodell-co", "watershed/huc10-1019000504"],
    status: "open",
    specSha256: "a".repeat(64),
    createdAt: NOW,
  });
}

describe("the weekly commons sync", () => {
  it("writes one note per kind with the right tags, place_id and generated_by, and indexes them", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "commons-creek" });
    dbs.push(db);
    await seedContent(db, entity.id);
    const store = new MemoryNoteStore();
    const report = await runCommonsSync({ db, store, now: NOW, readPublic: async () => null });
    expect(report.counts.failed).toBe(0);

    const paths = [...store.notes.keys()].sort();
    expect(paths).toContain("entities/commons-creek");
    expect(paths).toContain("entities/commons-creek/memos/2026-Q3");
    expect(paths).toContain("entities/commons-creek/reports/2026-08");
    expect(paths).toContain("entities/commons-creek/bounties/b1");
    expect(paths.some((p) => p.startsWith("entities/commons-creek/state/"))).toBe(true);

    const page = store.notes.get("entities/commons-creek")!;
    expect(page.tags).toEqual(["entity", "entity/page"]);
    expect(page.metadata).toMatchObject({ place_id: "place/boulder-creek-near-orodell-co", generated_by: "entity-agent", ai_generated: true, binding_version: 1 });
    expect(page.content).toContain("I'm an AI voice for commons-creek");
    expect(page.content).toContain("I am a creek that counts what passes.");
    // wikilink plus absolute-URL fallback into the front-range publication
    expect(page.content).toContain("[[wiki/places/watersheds/huc1019000504]]");
    expect(page.content).toContain("https://prism.omniharmonic.com/p/front-range/notes/wiki%2Fplaces%2Fwatersheds%2Fhuc1019000504");

    const state = store.notes.get(paths.find((p) => p.startsWith("entities/commons-creek/state/"))!)!;
    expect(state.tags).toEqual(["entity", "entity/state"]);
    expect(state.content).toContain("gauge went quiet");
    expect(state.content).toContain("The gauge at Orodell went quiet");

    const bounty = store.notes.get("entities/commons-creek/bounties/b1")!;
    expect(bounty.tags).toEqual(["entity", "entity/bounty"]);
    expect(bounty.metadata).toMatchObject({ bounty_id: "b1", status: "open", spec_sha256: "a".repeat(64) });
    expect(bounty.content).toContain("a".repeat(64));

    // the private half of a donor report never leaves Postgres
    const report_note = store.notes.get("entities/commons-creek/reports/2026-08")!;
    expect(report_note.content).toContain("In August, $120 went out");
    expect(report_note.content).not.toContain("private draft");

    // commons_notes indexes what was mirrored, and commons_path is written back
    const indexed = await db.select().from(schema.commonsNotes).where(eq(schema.commonsNotes.entityId, entity.id));
    expect(indexed.length).toBe(store.notes.size);
    expect(indexed.every((n) => n.contentSha256 && n.lastSyncedAt)).toBe(true);
    const [strategy] = await db.select().from(schema.strategies).where(eq(schema.strategies.id, "st1"));
    expect(strategy!.commonsPath).toBe("entities/commons-creek/memos/2026-Q3");
    const [b] = await db.select().from(schema.bounties).where(eq(schema.bounties.id, "b1"));
    expect(b!.commonsPath).toBe("entities/commons-creek/bounties/b1");
  });

  it("is idempotent: a second run writes nothing", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "idem-commons" });
    dbs.push(db);
    await seedContent(db, entity.id);
    const store = new MemoryNoteStore();
    const first = await runCommonsSync({ db, store, now: NOW, readPublic: async () => null });
    expect(first.counts.created).toBeGreaterThan(0);
    const writes = store.writes;
    const second = await runCommonsSync({ db, store, now: new Date(NOW.getTime() + 60_000), readPublic: async () => null });
    expect(second.counts.created).toBe(0);
    expect(second.counts.updated).toBe(0);
    expect(second.counts.unchanged).toBe(first.counts.created);
    expect(store.writes).toBe(writes);
  });

  it("never quotes a TK-labelled commons note on the entity page", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "tk-commons" });
    dbs.push(db);
    await seedContent(db, entity.id);
    const tkNote: Note = {
      path: "wiki/places/monitoring/boulder-creek-near-orodell-co",
      content: "This reach carries knowledge held by the community and must not be quoted by a machine.",
      metadata: { tk_labels: ["TK Attribution"], sensitivity: "public" },
      tags: ["commons-seed"],
      updated_at: NOW.toISOString(),
    };
    const store = new MemoryNoteStore();
    await runCommonsSync({ db, store, now: NOW, readPublic: async () => tkNote });
    const page = store.notes.get("entities/tk-commons")!;
    expect(page.content).not.toContain("knowledge held by the community");
    expect(page.content).not.toContain("The place, as the commons describes it");

    // the same note without labels is quoted
    const store2 = new MemoryNoteStore();
    await runCommonsSync({ db: (await seedBoulderCreek({ slug: "ok-commons" })).db, store: store2, now: NOW, readPublic: async () => ({ ...tkNote, metadata: { sensitivity: "public" } }) });
    const page2 = store2.notes.get("entities/ok-commons")!;
    expect(page2.content).toContain("knowledge held by the community");
  });

  it("leaves a human's prose below the fence untouched by the weekly job", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "human-commons" });
    dbs.push(db);
    await seedContent(db, entity.id);
    const store = new MemoryNoteStore();
    await runCommonsSync({ db, store, now: NOW, readPublic: async () => null });
    const human = "\n## Neighbours' log\n\nWe walked the reach on Sunday.\n";
    store.humanEdit("entities/human-commons", (c) => c + human);
    await db.insert(schema.pulses).values({ entityId: entity.id, at: NOW, woke: true, text: "A new pulse.", guardResult: "pass", deltas: [] });
    for (let i = 0; i < 5; i++) await runCommonsSync({ db, store, now: new Date(NOW.getTime() + i * 60_000), readPublic: async () => null });
    const page = store.notes.get("entities/human-commons")!;
    expect(page.content.endsWith(human)).toBe(true);
    expect(fencedBlock(page.content)).toContain("# human-commons");
  });
});
