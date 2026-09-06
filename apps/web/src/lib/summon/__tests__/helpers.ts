/**
 * Fixtures for the summon tests: a PGlite database, a fake twin read from a
 * local directory (the sandbox cannot reach data.bioregionaltwin.org), and a
 * second, entirely different twin tree so nothing in the code can assume the
 * Front Range (plan T3.8).
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { idsJsonSchema } from "@kami/binding";
import { TwinClient } from "@kami/twin-client";
import { closeTestDb, createTestDb, seedUser, type TestDb } from "@/db/test-utils";
import { setConfig } from "@/lib/jobs/common";
import { resetTwinClientsForTests, twinBaseUrlKey, twinTreeDirKey } from "../twin";

export { closeTestDb, createTestDb, seedUser };
export type { TestDb };

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/web/src/lib/summon/__tests__ → repo root */
export const REPO_ROOT = path.resolve(here, "..", "..", "..", "..", "..", "..");
export const FRONT_RANGE_TREE = path.join(REPO_ROOT, "packages", "binding", "test", "fixtures", "public");

export function twinFromDir(dir: string): TwinClient {
  // minIntervalMs 0: fixtures are local files, and each test wants a fresh read.
  return new TwinClient({ localDir: dir, userAgent: "kami-web-test/0.1 (test@kami.invalid)", minIntervalMs: 0 });
}

export function frontRangeTwin(): TwinClient {
  return twinFromDir(FRONT_RANGE_TREE);
}

// ---------------------------------------------------------------------------
// "the other twin" — two places, another continent, another schema file
// ---------------------------------------------------------------------------

const OTHER_GENERATED_AT = "2026-09-06T06:00:00Z";

/**
 * A minimal published tree in the twin's own shapes: one HUC-10 watershed,
 * one gauge with a discharge reading, and the tree's own
 * `sources/ids-schema.json`. Nothing about it is Colorado.
 */
export function writeOtherTwinTree(root?: string): string {
  const dir = root ?? mkdtempSync(path.join(tmpdir(), "kami-other-twin-"));
  const write = (rel: string, value: unknown) => {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  };
  const base = "https://data.othertwin.example";

  const watershed = {
    id: "watershed/huc10-1710030201",
    kind: "watershed",
    name: "Salmon Creek",
    bbox: [-123.4, 45.1, -123.0, 45.4],
  };
  const gauge = {
    id: "place/salmon-creek-at-tidewater-or",
    kind: "monitoring_site",
    name: "SALMON CREEK AT TIDEWATER, OR",
    huc12: "171003020101",
    bbox: [-123.2, 45.2, -123.2, 45.2],
  };

  write("id/index.json", {
    schema_version: "1.0",
    generated_at: OTHER_GENERATED_AT,
    count: 2,
    places: [gauge, watershed],
  });
  write(`id/${watershed.id}.json`, {
    schema_version: "1.0",
    id: watershed.id,
    kind: "watershed",
    name: watershed.name,
    bbox: watershed.bbox,
    sensitivity: "public",
    geometry_url: `${base}/geom/${watershed.id}.geojson`,
    latest_url: `${base}/latest/${watershed.id}.json`,
    generated_at: OTHER_GENERATED_AT,
  });
  write(`id/${gauge.id}.json`, {
    schema_version: "1.0",
    id: gauge.id,
    kind: "monitoring_site",
    name: gauge.name,
    huc12: gauge.huc12,
    bbox: gauge.bbox,
    sensitivity: "public",
    geometry_url: `${base}/geom/${gauge.id}.geojson`,
    latest_url: `${base}/latest/${gauge.id}.json`,
    generated_at: OTHER_GENERATED_AT,
  });
  write(`latest/${watershed.id}.json`, {
    schema_version: "1.0",
    id: watershed.id,
    kind: "watershed",
    name: watershed.name,
    bbox: watershed.bbox,
    generated_at: OTHER_GENERATED_AT,
    children: ["watershed/huc12-171003020101"],
    props: { huc: "1710030201", level: 10, states: "OR" },
    readings: [],
    series: {},
  });
  write(`latest/${gauge.id}.json`, {
    schema_version: "1.0",
    id: gauge.id,
    kind: "monitoring_site",
    name: gauge.name,
    huc12: gauge.huc12,
    bbox: gauge.bbox,
    centroid: [-123.2, 45.2],
    generated_at: OTHER_GENERATED_AT,
    children: [],
    props: { water_source: "SALMON CREEK", por_start: "1974-10-01" },
    readings: [
      { property: "discharge", value: 42.7, unit: "[ft_i]3/s", time: "2026-09-06T05:30:00Z", source_id: "otn.telemetry", staleness_crit_s: 10800 },
    ],
    series: {},
  });
  write("latest/conditions.json", {
    schema_version: "1.0",
    generated_at: OTHER_GENERATED_AT,
    bbox: [-124, 45, -123, 46],
    sources: { "otn.telemetry": { health: "ok", tier: "A", license: "public-domain", attribution: "Other Twin Network", last_ok: OTHER_GENERATED_AT, staleness_s: 600 } },
    stations: [
      {
        id: gauge.id,
        name: gauge.name,
        kind: "monitoring_site",
        lon: -123.2,
        lat: 45.2,
        huc12: gauge.huc12,
        networks: ["otn_station"],
        readings: [
          { property: "discharge", value: 42.7, unit: "[ft_i]3/s", time: "2026-09-06T05:30:00Z", source_id: "otn.telemetry", stale: false, staleness_s: 1800 },
        ],
      },
    ],
  });
  write("latest/drought.geojson", {
    type: "FeatureCollection",
    schema_version: "1.0",
    generated_at: OTHER_GENERATED_AT,
    source_id: "otn.drought",
    features: [],
  });
  // The tree's own copy of the coupling surface (survey §3.1). Same shape as
  // the Front Range's; the point of the test is that it is *fetched*, not
  // assumed.
  write("sources/ids-schema.json", {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${base}/id/schema/place-1.0.json`,
    title: "Other twin identity registry entry",
    type: "object",
    required: ["schema_version", "id", "kind", "name", "generated_at"],
    additionalProperties: false,
    properties: {
      schema_version: { const: "1.0" },
      id: { type: "string", pattern: "^[a-z_]+/[a-z0-9-]+$" },
      kind: { type: "string", enum: ["watershed", "monitoring_site", "other"] },
      name: { type: "string" },
      huc12: { type: "string", pattern: "^[0-9]{12}$" },
      bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
      sensitivity: { type: "string", enum: ["public", "generalized"] },
      geometry_url: { type: "string", format: "uri" },
      latest_url: { type: "string", format: "uri" },
      twin_url: { type: "string", format: "uri" },
      commons_url: { type: "string", format: "uri" },
      sameAs: { type: "array", items: { type: "string", format: "uri" } },
      generated_at: { type: "string", format: "date-time" },
    },
  });
  return dir;
}

/**
 * A copy of the Front Range fixture with the one deliberately-corrupt id
 * record repaired. `packages/binding`'s fixture plants `elevation_m` on
 * `place/coal-creek-near-plainview-co` so its own tests can exercise rule 2
 * (`additionalProperties: false`); a whole-creek summon on that tree
 * legitimately refuses, which is asserted separately. The timed run needs a
 * tree whose records are all well-formed, so it uses this copy.
 */
export function frontRangeTreeRepaired(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kami-front-range-ok-"));
  cpSync(FRONT_RANGE_TREE, dir, { recursive: true });
  const file = path.join(dir, "id", "place", "coal-creek-near-plainview-co.json");
  const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  delete record["elevation_m"];
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  return dir;
}

/** A copy of the Front Range fixture that also publishes `sources/ids-schema.json`. */
export function frontRangeTreeWithSchema(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kami-front-range-"));
  cpSync(FRONT_RANGE_TREE, dir, { recursive: true });
  // the pinned schema, so the copy is honest about what it publishes
  const schema = idsJsonSchema;
  mkdirSync(path.join(dir, "sources"), { recursive: true });
  writeFileSync(path.join(dir, "sources", "ids-schema.json"), `${JSON.stringify(schema, null, 2)}\n`);
  return dir;
}

/** Point one entity (or one prospective slug) at a fixture tree. */
export async function bindTwinTo(db: TestDb, slug: string, dir: string, baseUrl = "https://data.othertwin.example"): Promise<void> {
  await setConfig(db, twinTreeDirKey(slug), dir);
  await setConfig(db, twinBaseUrlKey(slug), baseUrl);
  resetTwinClientsForTests();
}

export async function freshDb(): Promise<TestDb> {
  const db = await createTestDb();
  return db;
}
