/** A whole entity — row, binding, soul — for the connect tests. */
import * as schema from "@/db/schema";
import { createTestDb, seedUser, type TestDb } from "@/db/test-utils";

export const VOICE = "You speak for this creek plainly. You never claim to be it.";

export async function seedConnectEntity(
  db: TestDb,
  slug = "boulder-creek",
  over: { paused?: boolean; review?: "pending_review" | "approved"; createdBy?: string | null; withSoul?: boolean } = {},
) {
  const id = `entity/${slug}`;
  await db.insert(schema.entities).values({
    id,
    slug,
    name: "Boulder Creek",
    archetype: "creek",
    bindingVersion: 1,
    soulVersion: 1,
    hermesProfile: slug,
    createdBy: over.createdBy === undefined ? "u-maya" : over.createdBy,
    consultationDoneAt: new Date("2026-08-01T00:00:00Z"),
    pausedAt: over.paused ? new Date() : null,
  });
  await db.insert(schema.entityBindings).values({
    entityId: id,
    bindingVersion: 1,
    binding: {
      schema_version: "1.0",
      binding_version: 1,
      entity_id: id,
      archetype: "creek",
      anchor: "place/boulder-creek-near-orodell-co",
      stream_id: null,
      commons_handle: `wiki/places/named/${slug}`,
      members: [{ id: "place/boulder-creek-near-orodell-co", role: "main_stem_gauge" }],
      watersheds: ["watershed/huc10-1019000504"],
      reach_ids: [],
      boundary: { geometry_urls: [] },
      needs: [{ need: "flow", property: "discharge", places: ["place/boulder-creek-near-orodell-co"], agg: "single" }],
      membership_rule: "watershed name contains 'Boulder Creek'",
      frozen_at: "2026-09-06T00:00:00Z",
      reviewed_by: null,
      twin_index_etag: null,
    } as unknown as object,
    sha256: "a".repeat(64),
    review: over.review ?? "approved",
  });
  if (over.withSoul !== false) {
    await db.insert(schema.souls).values({ entityId: id, soulVersion: 1, hardRulesVersion: "1", voiceMd: VOICE, editedBy: "u-maya" });
  }
  return id;
}

export async function connectTestDb(): Promise<TestDb> {
  const db = await createTestDb();
  await seedUser(db, "u-maya", "maya@example.org");
  await seedUser(db, "u-ada", "ada@example.org");
  await seedUser(db, "u-nobody", "nobody@example.org");
  return db;
}
