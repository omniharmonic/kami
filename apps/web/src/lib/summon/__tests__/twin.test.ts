/**
 * Second-bioregion readiness (plan T3.8). Every twin read for an entity goes
 * through `twinFor()`, and a binding is validated against *that* twin's
 * `sources/ids-schema.json`. The proof is a fixture tree that has nothing to
 * do with the Front Range: two places in an Oregon coastal watershed, its own
 * schema file, its own source id.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proposeBinding } from "@kami/binding";
import {
  bindTwinTo,
  closeTestDb,
  createTestDb,
  frontRangeTwin,
  twinFromDir,
  writeOtherTwinTree,
  type TestDb,
} from "./helpers";
import { describeSensing } from "../sensing";
import { searchPlaces } from "../places";
import { proposeForPlace } from "../propose";
import { idsSchemaFor, resetTwinClientsForTests, twinFor, twinTargetFor, validateBindingForTwin } from "../twin";

let db: TestDb;
let otherDir: string;

beforeAll(async () => {
  db = await createTestDb();
  otherDir = writeOtherTwinTree();
});
afterAll(async () => {
  resetTwinClientsForTests();
  await closeTestDb(db);
});

describe("twinFor resolves per entity", () => {
  it("falls back to the platform default when nothing is configured", async () => {
    const target = await twinTargetFor("entity/boulder-creek", { db });
    expect(target.slug).toBe("boulder-creek");
    expect(target.base_url).toMatch(/^https?:\/\//);
    expect(["env", "default"]).toContain(target.source);
  });

  it("uses the per-entity config row when one exists (the twin_base_url column does not exist yet)", async () => {
    await bindTwinTo(db, "salmon-creek", otherDir);
    const target = await twinTargetFor("entity/salmon-creek", { db });
    expect(target.source).toBe("config");
    expect(target.local_dir).toBe(otherDir);
    expect(target.base_url).toBe("https://data.othertwin.example");

    const tree = await twinFor("entity/salmon-creek", { db });
    const index = await tree.index();
    expect(index!.data.places.map((p) => p.id).sort()).toEqual([
      "place/salmon-creek-at-tidewater-or",
      "watershed/huc10-1710030201",
    ]);
    // and the Front Range entity still reads the Front Range
    const other = await twinFor("entity/boulder-creek", { db });
    expect(other.localDir).not.toBe(otherDir);
  });
});

describe("a binding on another twin", () => {
  it("proposes, validates and senses without a line of Front Range knowledge", async () => {
    const tree = twinFromDir(otherDir);

    const found = await searchPlaces(tree, { query: "salmon" });
    expect(found.total).toBe(2);
    expect(found.places[0]!.kind).toBe("watershed");

    const proposal = await proposeBinding({ query: "Salmon Creek", tree, archetype: "creek", slug: "salmon-creek" });
    expect(proposal.binding.anchor).toBe("place/salmon-creek-at-tidewater-or");
    expect(proposal.binding.watersheds).toEqual(["watershed/huc10-1710030201"]);
    expect(proposal.binding.needs.map((n) => n.need)).toContain("flow");

    const schema = await idsSchemaFor(tree);
    expect(schema.from).toBe("twin");
    expect(schema.schema.title).toBe("Other twin identity registry entry");

    const result = await validateBindingForTwin(proposal.binding, tree);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.ids_schema.from).toBe("twin");

    const sensing = await describeSensing(proposal.binding, tree);
    const flow = sensing.rows.find((r) => r.need === "flow")!;
    expect(flow.state).toBe("live");
    expect(flow.value).toBe(42.7);
    expect(flow.source_id).toBe("otn.telemetry");
    // the honest gap: no baseline is published on this tree either
    expect(flow.percentile_available).toBe(false);
    expect(sensing.gaps.join(" ")).toMatch(/no percentile is published for flow yet/);
  });

  it("reports an id record that fails the other twin's own schema", async () => {
    const strictDir = writeOtherTwinTree();
    // The other twin narrows `kind`; a record the pinned schema accepts but
    // this twin's schema does not must be an error, not a silence.
    const { writeFileSync } = await import("node:fs");
    const path = await import("node:path");
    const file = path.join(strictDir, "id", "place", "salmon-creek-at-tidewater-or.json");
    const record = JSON.parse((await import("node:fs")).readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...record, kind: "restoration_site" }, null, 2));

    const tree = twinFromDir(strictDir);
    const proposal = await proposeBinding({ query: "Salmon Creek", tree, archetype: "creek", slug: "salmon-creek" });
    const result = await validateBindingForTwin(proposal.binding, tree);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /sources\/ids-schema\.json/.test(e.message))).toBe(true);
  });

  it("proposeForPlace works end to end on the other twin", async () => {
    const tree = twinFromDir(otherDir);
    const { place, siblings, context } = await proposeForPlace(tree, { place_id: "place/salmon-creek-at-tidewater-or" }, { db });
    expect(context.kind).toBe("monitoring_site");
    expect(place.validation.ok).toBe(true);
    expect(place.binding.entity_id).toMatch(/^entity\/salmon-creek$/);
    expect(place.provenance).toMatch(/platform guess/);
    expect(place.ids_schema_from).toBe("twin");
    expect(siblings).toEqual([]);
    expect(place.sensing.length).toBeGreaterThan(0);
  });
});

describe("the Front Range tree still works", () => {
  it("validates Boulder Creek against the pinned schema when the tree publishes none", async () => {
    const tree = frontRangeTwin();
    const schema = await idsSchemaFor(tree);
    expect(schema.from).toBe("pinned");
    const proposal = await proposeBinding({ query: "Boulder Creek", tree, gnisId: "00178354", archetype: "creek", slug: "boulder-creek" });
    const result = await validateBindingForTwin(proposal.binding, tree);
    // no error may claim to come from a schema this tree does not publish
    expect(result.errors.filter((e) => /sources\/ids-schema\.json/.test(e.message))).toEqual([]);
    // the one error the shipped fixture does carry is the pinned schema's
    // `additionalProperties: false` on a station page, which is rule 2 working
    expect(result.errors.every((e) => e.rule === 2 && /ids-schema/.test(e.message))).toBe(true);
  });
});
