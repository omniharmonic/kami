import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateIdRecord, validateBindingShape } from "../src/binding.js";
import { BINDING_SCHEMA, FACTS_SCHEMA, IDS_SCHEMA } from "../src/schemas.generated.js";
import { FIXTURE_STALE, PKG } from "./helpers.js";

describe("schemas", () => {
  it("schemas/facts-1.0.json is byte-identical to packages/facts-schema/facts-1.0.json (one schema, two emitters)", () => {
    const ours = readFileSync(join(PKG, "schemas/facts-1.0.json"));
    let theirs: Buffer;
    try {
      theirs = readFileSync(join(PKG, "../facts-schema/facts-1.0.json"));
    } catch {
      return; // standalone checkout (after the lift into frontrange-twin/mcp)
    }
    expect(Buffer.compare(ours, theirs)).toBe(0);
  });

  it("schemas/ids-schema-1.0.json matches the twin's sources/ids-schema.json when the twin is present", () => {
    let theirs: string;
    try {
      theirs = readFileSync(join(process.env["TWIN_REPO"] ?? "/home/user/frontrange-twin", "sources/ids-schema.json"), "utf8");
    } catch {
      return;
    }
    expect(JSON.parse(readFileSync(join(PKG, "schemas/ids-schema-1.0.json"), "utf8"))).toEqual(JSON.parse(theirs));
  });

  it("the embedded copies equal the files (run scripts/embed-schemas.ts after editing a schema)", () => {
    for (const [name, embedded] of [["facts-1.0.json", FACTS_SCHEMA], ["ids-schema-1.0.json", IDS_SCHEMA], ["place-set-binding-1.0.json", BINDING_SCHEMA]] as const) {
      expect(JSON.parse(readFileSync(join(PKG, "schemas", name), "utf8")), name).toEqual(embedded);
    }
  });

  it("every fixture id record validates against ids-schema; nulls and extra keys are rejected", () => {
    const idx = JSON.parse(readFileSync(join(FIXTURE_STALE, "id/index.json"), "utf8")) as { places: { id: string }[]; count: number };
    expect(idx.count).toBe(idx.places.length);
    expect(idx.count).toBeGreaterThanOrEqual(40);
    for (const p of idx.places) expect(validateIdRecord(JSON.parse(readFileSync(join(FIXTURE_STALE, `id/${p.id}.json`), "utf8"))), p.id).toEqual([]);
    expect(validateIdRecord({ schema_version: "1.0", id: "place/x", kind: "monitoring_site", name: "x", generated_at: "2026-09-06T05:00:00Z", huc12: null }).length).toBeGreaterThan(0);
    expect(validateIdRecord({ schema_version: "1.0", id: "place/x", kind: "monitoring_site", name: "x", generated_at: "2026-09-06T05:00:00Z", extra: 1 }).length).toBeGreaterThan(0);
  });

  it("the binding schema rejects a bad entity_id, role and agg", () => {
    const base = { schema_version: "1.0", binding_version: 1, entity_id: "entity/x", archetype: "creek", anchor: "place/a", members: [{ id: "place/a", role: "gauge" }], watersheds: [], needs: [{ need: "flow", property: "discharge", places: ["place/a"], agg: "single" }], frozen_at: "2026-09-06T00:00:00Z" };
    expect(validateBindingShape(base)).toEqual([]);
    expect(validateBindingShape({ ...base, entity_id: "place/x" }).length).toBeGreaterThan(0);
    expect(validateBindingShape({ ...base, members: [{ id: "place/a", role: "sensor" }] }).length).toBeGreaterThan(0);
    expect(validateBindingShape({ ...base, needs: [{ ...base.needs[0], agg: "p90" }] }).length).toBeGreaterThan(0);
  });
});
