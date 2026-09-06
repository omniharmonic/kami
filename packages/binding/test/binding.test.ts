import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TwinClient } from "@kami/twin-client";
import { describe, expect, it } from "vitest";

import {
  BindingSchemaError,
  bindingSha256,
  canonicalJson,
  checkSupersession,
  loadBinding,
  parseBinding,
  proposeBinding,
  validateBinding,
  type Binding,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures", "public");
const BOULDER_YAML = join(here, "..", "..", "..", "profiles", "boulder-creek", "binding.yaml");
const TWIN_IDS_SCHEMA = "/home/user/frontrange-twin/sources/ids-schema.json";

const tree = () => new TwinClient({ localDir: FIXTURES, userAgent: "kami/0.1.0-test (synergy@benjaminlife.one)" });
const boulder = async (): Promise<Binding> => structuredClone(await loadBinding(BOULDER_YAML));

describe("schemas", () => {
  it.skipIf(!existsSync(TWIN_IDS_SCHEMA))("vendored ids-schema is byte-identical to the twin's", () => {
    const ours = readFileSync(join(here, "..", "schemas", "ids-schema-1.0.json"));
    const theirs = readFileSync(TWIN_IDS_SCHEMA);
    expect(Buffer.compare(ours, theirs)).toBe(0);
  });

  it("loads the Boulder Creek YAML and it matches place-set-binding-1.0", async () => {
    const b = await loadBinding(BOULDER_YAML);
    expect(b.entity_id).toBe("entity/boulder-creek");
    expect(b.anchor).toBe("place/boulder-creek-near-orodell-co");
    expect(b.members.filter((m) => m.role === "main_stem_gauge")).toHaveLength(4);
    expect(b.needs.map((n) => n.need)).toEqual(["flow", "storage", "snow", "water", "air", "drought"]);
    expect(b.frozen_at).toBe("2026-09-06T00:00:00Z"); // stays a string through the YAML core schema
    expect(b.reviewed_by).toBeNull();
    expect(b.twin_index_etag).toBeNull();
  });

  it("rejects an unknown top-level key and a bad entity id at the schema layer", async () => {
    const b = await boulder();
    expect(() => parseBinding(JSON.stringify({ ...b, extra: 1 }), "json")).toThrow(BindingSchemaError);
    expect(() => parseBinding(JSON.stringify({ ...b, entity_id: "Entity/Boulder" }), "json")).toThrow(BindingSchemaError);
  });
});

describe("validateBinding — rules 1–6 against the fixture tree", () => {
  it("the Boulder Creek YAML validates with zero errors", async () => {
    const res = await validateBinding(await boulder(), tree());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([]);
  });

  it("rule 1: an id not in the index fails; a malformed id fails", async () => {
    const b = await boulder();
    b.members.push({ id: "place/not-a-real-gauge", role: "gauge" });
    b.needs[0]!.places = ["Place/UPPER"];
    const res = await validateBinding(b, tree());
    expect(res.ok).toBe(false);
    const r1 = res.errors.filter((e) => e.rule === 1);
    expect(r1.map((e) => e.path)).toEqual(expect.arrayContaining([`/members/${b.members.length - 1}/id`, "/needs/0/places/0"]));
  });

  it("rule 2: an id record with an extra key fails ids-schema", async () => {
    const b = await boulder();
    b.members.push({ id: "place/coal-creek-near-plainview-co", role: "gauge" });
    const res = await validateBinding(b, tree());
    const r2 = res.errors.filter((e) => e.rule === 2);
    expect(r2).toHaveLength(1);
    expect(r2[0]!.message).toContain('unexpected key "elevation_m"');
    expect(res.errors.filter((e) => e.rule !== 2)).toEqual([]);
  });

  it("rule 3: a main_stem_gauge without discharge fails; a non-watershed in watersheds fails", async () => {
    const b = await boulder();
    b.members.push({ id: "place/niwot", role: "main_stem_gauge" });
    b.watersheds.push("place/gross-reservoir");
    b.boundary.geometry_urls.push("https://data.bioregionaltwin.org/geom/place/gross-reservoir.geojson");
    const res = await validateBinding(b, tree());
    const r3 = res.errors.filter((e) => e.rule === 3);
    expect(r3.map((e) => e.path)).toEqual([`/members/${b.members.length - 1}`, "/watersheds/4"]);
    expect(r3[0]!.message).toMatch(/requires a discharge datastream/);
  });

  it("rule 3: every constrained role is checked against conditions.json", async () => {
    const b = await boulder();
    b.members = [
      { id: "place/gross-reservoir", role: "snotel" },
      { id: "place/niwot", role: "reservoir" },
      { id: "place/boulder-cu-2102-athens-st", role: "water_quality" },
      { id: "place/south-boulder-cr-at-forebay-nr-eldorado-springs-co", role: "air" },
      { id: "place/secret-spring", role: "air" }, // no readings today
    ];
    const res = await validateBinding(b, tree());
    expect(res.errors.filter((e) => e.rule === 3).map((e) => e.path)).toEqual(["/members/0", "/members/1", "/members/2", "/members/3", "/members/4"]);
  });

  it("rule 4: a generalized place as a boundary geometry source fails; as a reading source it passes", async () => {
    const b = await boulder();
    b.members.push({ id: "place/secret-spring", role: "other" });
    b.boundary.geometry_urls.push("https://data.bioregionaltwin.org/geom/place/secret-spring.geojson");
    const res = await validateBinding(b, tree());
    const r4 = res.errors.filter((e) => e.rule === 4);
    expect(r4).toHaveLength(1);
    expect(r4[0]!.path).toBe("/boundary/geometry_urls/4");
    expect(r4[0]!.message).toMatch(/generalized/);
    expect(res.errors.filter((e) => e.rule !== 4)).toEqual([]);
  });

  it("rule 4: a geometry URL that is not a published twin geom fails", async () => {
    const b = await boulder();
    b.boundary.geometry_urls.push("https://example.com/my-own-polygon.geojson");
    const res = await validateBinding(b, tree());
    expect(res.errors.filter((e) => e.rule === 4).map((e) => e.message)).toEqual([expect.stringContaining("not a twin geom URL")]);
  });

  it("rule 5: a member outside the watersheds' HUC-12 set warns (not an error)", async () => {
    const b = await boulder();
    b.members.push({ id: "place/clear-creek-at-golden-co", role: "gauge" });
    const res = await validateBinding(b, tree());
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([
      { rule: 5, path: `/members/${b.members.length - 1}/id`, message: expect.stringContaining("101900040101") },
    ]);
  });

  it("rule 5: a need whose property has no reading today warns", async () => {
    const b = await boulder();
    b.needs[2]!.property = "soil_moisture_8in";
    const res = await validateBinding(b, tree());
    expect(res.ok).toBe(true);
    expect(res.warnings.map((w) => w.path)).toEqual(["/needs/2/property"]);
  });

  it("rule 6: an agg outside the enum fails", async () => {
    const b = await boulder();
    (b.needs[0] as { agg: string }).agg = "p95";
    const res = await validateBinding(b, tree());
    expect(res.ok).toBe(false);
    expect(res.errors.filter((e) => e.rule === 6)).toEqual([{ rule: 6, path: "/needs/0/agg", message: expect.stringContaining("p95") }]);
    expect(res.errors.filter((e) => e.rule === "schema")).toEqual([]); // not double-reported
  });
});

describe("bindingSha256", () => {
  it("is stable under key reordering and formatting, and changes when data changes", async () => {
    const b = await boulder();
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(b).reverse()))) as Binding;
    reordered.members = reordered.members.map((m) => ({ role: m.role, id: m.id, ...(m.name !== undefined ? { name: m.name } : {}) }));
    expect(bindingSha256(reordered)).toBe(bindingSha256(b));
    expect(bindingSha256(b)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}');
    const changed = { ...b, binding_version: 2 };
    expect(bindingSha256(changed)).not.toBe(bindingSha256(b));
    // array order is data
    const swapped = { ...b, members: [...b.members].reverse() };
    expect(bindingSha256(swapped)).not.toBe(bindingSha256(b));
  });
});

describe("checkSupersession", () => {
  it("on a clean tree returns no findings and no draft", async () => {
    const res = await checkSupersession(await boulder(), tree());
    expect(res.findings).toEqual([]);
    expect(res.draft).toBeUndefined();
  });

  it("drafts a successor for a superseded member and flags a vanished id as missing", async () => {
    const b = await boulder();
    // retire the 75th St gauge onto its old id, and add a gauge that no longer exists
    b.members[2] = { id: "place/boulder-creek-at-75th-st", role: "main_stem_gauge" };
    b.members.push({ id: "place/gone-gauge", role: "gauge" });
    b.needs.push({ need: "flow_lower", property: "discharge", places: ["place/boulder-creek-at-75th-st"], agg: "single" });
    const now = new Date("2026-09-07T02:00:00Z");
    const res = await checkSupersession(b, tree(), { now });
    expect(res.findings).toEqual([
      { id: "place/boulder-creek-at-75th-st", role: "main_stem_gauge", state: "stale", reason: "superseded", successor: "place/boulder-creek-at-north-75th-st-near-boulder-co", needs: ["flow_lower"] },
      { id: "place/gone-gauge", role: "gauge", state: "missing", needs: [] },
    ]);
    const d = res.draft!;
    expect(d.binding_version).toBe(2);
    expect(d.reviewed_by).toBeNull();
    expect(d.frozen_at).toBe("2026-09-07T02:00:00Z");
    expect(d.members[2]!.id).toBe("place/boulder-creek-at-north-75th-st-near-boulder-co");
    expect(d.needs.at(-1)!.places).toEqual(["place/boulder-creek-at-north-75th-st-near-boulder-co"]);
    expect(d.members.some((m) => m.id === "place/gone-gauge")).toBe(true); // a steward decides about the missing one
    expect(b.binding_version).toBe(1); // input untouched
  });
});

describe("proposeBinding('Boulder Creek')", () => {
  it("returns the four main-stem gauges, the snotel/reservoir/WQ/air members and six needs", async () => {
    const now = new Date("2026-09-06T06:00:00Z");
    const p = await proposeBinding({ query: "Boulder Creek", tree: tree(), gnisId: "00178354", now });
    expect(p.provenance).toBe("platform guess — steward review required");
    const b = p.binding;
    expect(b.watersheds).toEqual(["watershed/huc10-1019000504", "watershed/huc10-1019000505", "watershed/huc10-1019000506", "watershed/huc10-1019000507"]);
    expect(b.members.filter((m) => m.role === "main_stem_gauge").map((m) => m.id)).toEqual([
      "place/boulder-creek-near-orodell-co",
      "place/boulder-creek-co-below-broadway-st",
      "place/boulder-creek-at-north-75th-st-near-boulder-co",
      "place/boulder-creek-at-mouth-near-longmont-co",
    ]);
    expect(b.anchor).toBe("place/boulder-creek-near-orodell-co"); // longest record (1906)
    const roles = Object.fromEntries(b.members.map((m) => [m.id, m.role]));
    expect(roles["place/niwot"]).toBe("snotel");
    expect(roles["place/lake-eldora"]).toBe("snotel");
    expect(roles["place/gross-reservoir"]).toBe("reservoir");
    expect(roles["place/union-reservoir"]).toBe("reservoir");
    expect(roles["place/south-boulder-cr-at-forebay-nr-eldorado-springs-co"]).toBe("water_quality");
    expect(roles["place/boulder-cu-2102-athens-st"]).toBe("air");
    expect(roles["place/coal-creek-near-plainview-co"]).toBe("gauge"); // discharge, but not the creek's name
    expect(roles["place/clear-creek-at-golden-co"]).toBeUndefined(); // another HUC-8
    expect(roles["place/secret-spring"]).toBeUndefined(); // no readings today
    expect(b.needs.map((n) => [n.need, n.property, n.agg])).toEqual([
      ["flow", "discharge", "single"],
      ["storage", "reservoir_fill", "single"],
      ["snow", "swe", "single"],
      ["water", "dissolved_oxygen", "single"],
      ["air", "pm25", "mean_24h"],
      ["drought", "dm", "max_intersecting"],
    ]);
    expect(b.needs[1]!.places).toEqual(["place/gross-reservoir"]); // largest capacity with a fill reading
    expect(b.boundary.geometry_urls).toHaveLength(4);
    expect(b.membership_rule).toBe("watershed name contains 'Boulder Creek' + props.cdwr_stream_gnis_id == '00178354'");
    expect(b.reviewed_by).toBeNull();
    expect(b.frozen_at).toBe("2026-09-06T06:00:00Z");
    expect(p.stats.huc12s).toBe(16);
    expect(p.notes.some((n) => /folded into their selected parents/.test(n))).toBe(true);
  });

  it("the proposal validates against the tree and is deterministic", async () => {
    const now = new Date("2026-09-06T06:00:00Z");
    const a = await proposeBinding({ query: "boulder creek", tree: tree(), gnisId: "00178354", now });
    const b = await proposeBinding({ query: "boulder creek", tree: tree(), gnisId: "00178354", now });
    expect(bindingSha256(a.binding)).toBe(bindingSha256(b.binding));
    const res = await validateBinding(a.binding, tree());
    // the only error is the fixture's deliberately malformed id record (rule 2), which the
    // proposer rightly picked up as a gauge in the HUC-12 set — exactly what a steward should see
    expect(res.errors).toEqual([{ rule: 2, path: expect.stringMatching(/^\/members\/\d+\/id$/), message: expect.stringContaining("place/coal-creek-near-plainview-co") }]);
    expect(res.warnings).toEqual([]);
  });

  it("without a GNIS id the main stem is still found by name; the rule text says so", async () => {
    const p = await proposeBinding({ query: "Boulder Creek", tree: tree() });
    expect(p.binding.members.filter((m) => m.role === "main_stem_gauge")).toHaveLength(4);
    expect(p.binding.membership_rule).toBe("watershed name contains 'Boulder Creek'");
  });
});
