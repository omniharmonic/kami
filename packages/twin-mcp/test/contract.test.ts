/**
 * Architecture §4.3 — the contract tests, verbatim. Runs every tool against the
 * checked-in fixture trees. The platform re-runs this file against its pinned
 * package; a nightly job runs it against https://data.bioregionaltwin.org.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, describe, expect, it } from "vitest";
import { validateBinding, loadBindingFile } from "../src/binding.js";
import { byteLength, MAX_OUTPUT_BYTES, paginate } from "../src/envelope.js";
import { FACTS_SCHEMA } from "../src/schemas.generated.js";
import { CONTRACT_VERSION, runTool, toolListing } from "../src/server.js";
import { TOOLS } from "../src/tools/index.js";
import { TreeReader } from "../src/tree.js";
import { BINDING_FILE, FIXTURE_LIVE, FIXTURE_STALE, collectKeys, collectReadings, makeCtx, NOW, PKG } from "./helpers.js";

const HONESTY = ["time", "unit", "source_id", "stale", "staleness_s", "source_status"] as const;

/** Representative inputs for every tool; each runs against both trees. */
const CALLS: [string, Record<string, unknown>][] = [
  ["find_places", { query: "boulder", limit: 50 }],
  ["find_places", { kind: "watershed", huc: "1019000506" }],
  ["get_place", { id: "place/boulder-creek-near-orodell-co" }],
  ["get_place", { id: "place/gross-reservoir" }],
  ["get_place", { id: "place/boulder-creek-co-near-orodell" }],
  ["get_place", { id: "watershed/huc10-1019000506" }],
  ["get_place", { id: "bioregion/front-range", series: false }],
  ["get_conditions", { place_ids: ["place/boulder-creek-near-orodell-co", "place/niwot", "place/boulder-creek-co-near-orodell"] }],
  ["get_conditions", { within: "watershed/huc10-1019000506", limit: 50 }],
  ["get_conditions", { huc: "1019000505" }],
  ["get_live", { layer: "drought" }],
  ["get_live", { layer: "drought", within: "watershed/huc10-1019000504" }],
  ["get_live", { layer: "alerts", within: "watershed/huc10-1019000506" }],
  ["get_live", { layer: "fires" }],
  ["get_live", { layer: "detections", within: "bioregion/front-range" }],
  ["get_live", { layer: "quakes" }],
  ["get_snow", {}],
  ["get_health", {}],
  ["get_boundary_summary", {}],
  ["get_briefing", {}],
  ["explain", { property: "discharge" }],
  ["explain", { property: "pm25", value: 40 }],
  ["explain", { property: "soil_moisture_8in" }],
  ["list_entities", {}],
  ["resolve_entity", { query: "boulder-creek" }],
  ["resolve_entity", { query: "watershed/huc10-1019000506" }],
  ["get_entity_status", {}],
  ["get_reading_history", { place_id: "place/boulder-creek-near-orodell-co", property: "discharge", window: "24h" }],
  ["get_reading_history", { place_id: "place/gross-reservoir", property: "reservoir_fill", window: "7d" }],
  ["get_alerts", {}],
  ["compare_to_normal", { place_id: "place/boulder-creek-near-orodell-co", property: "discharge" }],
];

async function everyOutput(tree: string) {
  const ctx = await makeCtx(tree);
  const outs: { call: string; out: Record<string, unknown> }[] = [];
  for (const [name, input] of CALLS) outs.push({ call: `${name}(${JSON.stringify(input)})`, out: await runTool(ctx, name, input) });
  return outs;
}

describe.each([
  ["fixtures/public (all-stale)", FIXTURE_STALE],
  ["fixtures/public-live (fresh)", FIXTURE_LIVE],
])("contract against %s", (_label, tree) => {
  const outputs = everyOutput(tree);

  it("exercises every registered tool", () => {
    const called = new Set(CALLS.map(([n]) => n));
    for (const t of TOOLS) expect(called.has(t.name), `no contract call for ${t.name}`).toBe(true);
  });

  it("every reading in every tool output has time, unit, source_id, stale, staleness_s, source_status", async () => {
    let n = 0;
    for (const { call, out } of await outputs) {
      for (const r of collectReadings(out)) {
        n++;
        for (const k of HONESTY) expect(k in r, `${call}: reading ${r["property"]} lacks ${k}`).toBe(true);
        expect(typeof r["stale"]).toBe("boolean");
        expect(["ok", "warning", "critical", "unknown"]).toContain(r["source_status"]);
        expect(r["staleness_s"] === null || typeof r["staleness_s"] === "number").toBe(true);
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it("no key named coordinates anywhere in any output", async () => {
    for (const { call, out } of await outputs) {
      const keys = collectKeys(out);
      expect(keys.has("coordinates"), `${call} leaked coordinates`).toBe(false);
      expect(keys.has("geometries"), `${call} leaked geometries`).toBe(false);
    }
  });

  it("every output is ≤ 16 KB and carries the envelope", async () => {
    for (const { call, out } of await outputs) {
      expect(byteLength(out), `${call} too big`).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
      expect(out["as_of"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect("schema_version" in out && "tree_generated_at" in out).toBe(true);
    }
  });

  it("flow_forecast carries forecast: true and 'forecast' in label", async () => {
    let seen = 0;
    for (const { out } of await outputs) {
      for (const r of collectReadings(out).filter((r) => r["property"] === "flow_forecast")) {
        seen++;
        expect(r["forecast"]).toBe(true);
        expect(String(r["label"]).toLowerCase()).toContain("forecast");
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe("get_entity_status on the fixture binding", () => {
  it("yields exactly the expected six needs[] (test/expected/entity-status-needs.json)", async () => {
    const ctx = await makeCtx(FIXTURE_STALE);
    const out = await runTool(ctx, "get_entity_status", {});
    const expected = JSON.parse(readFileSync(join(PKG, "test/expected/entity-status-needs.json"), "utf8"));
    expect(out["needs"]).toEqual(expected);
    expect((out["needs"] as unknown[]).length).toBe(6);
  });

  it("a stale fixture reading yields stale: true; the live tree yields stale: false", async () => {
    const stale = await runTool(await makeCtx(FIXTURE_STALE), "get_entity_status", {});
    const flow = (stale["needs"] as Record<string, unknown>[]).find((n) => n["need"] === "flow")!;
    expect(flow["stale"]).toBe(true);
    expect(flow["value"]).toBe(15.4);
    expect(flow["staleness_s"]).toBe(117900);
    const live = await runTool(await makeCtx(FIXTURE_LIVE), "get_entity_status", {});
    for (const n of live["needs"] as Record<string, unknown>[]) expect(n["stale"], `${n["need"]} stale on the live tree`).toBe(false);
  });

  it("a place-page reading older than its staleness_crit_s yields stale: true (threshold dialect)", async () => {
    const out = await runTool(await makeCtx(FIXTURE_STALE), "get_place", { id: "place/boulder-creek-near-orodell-co" });
    const r = (out["readings"] as Record<string, unknown>[])[0]!;
    expect(r["stale"]).toBe(true);
    expect(r["staleness_s"]).toBe(117900);
    const gross = await runTool(await makeCtx(FIXTURE_STALE), "get_place", { id: "place/gross-reservoir" });
    const fill = (gross["readings"] as Record<string, unknown>[]).find((x) => x["property"] === "reservoir_fill")!;
    expect(fill["stale"]).toBe(false);
    expect(fill["value"]).toBe(72);
  });

  it("emits a facts block that validates against facts-1.0", async () => {
    const out = await runTool(await makeCtx(FIXTURE_STALE), "get_entity_status", {});
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(FACTS_SCHEMA as unknown as object);
    expect(validate(out["facts"]), JSON.stringify(validate.errors)).toBe(true);
    const atoms = (out["facts"] as { atoms: { kind: string; value?: unknown }[] }).atoms;
    expect(atoms.some((a) => a.kind === "number" && a.value === 15.4)).toBe(true);
    expect(atoms.some((a) => a.kind === "enum" && a.value === "D1")).toBe(true);
  });
});

describe("binding validator", () => {
  it("accepts the fixture binding with no errors", async () => {
    const r = await validateBinding(await loadBindingFile(BINDING_FILE), new TreeReader({ tree: FIXTURE_STALE }));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("rejects an id absent from id/index.json", async () => {
    const doc = (await loadBindingFile(BINDING_FILE)) as Record<string, unknown>;
    (doc["members"] as Record<string, unknown>[]).push({ id: "place/does-not-exist", role: "gauge" });
    const r = await validateBinding(doc, new TreeReader({ tree: FIXTURE_STALE }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("rule 1") && e.includes("place/does-not-exist"))).toBe(true);
  });

  it("rejects a generalized place as a boundary geometry source", async () => {
    const doc = (await loadBindingFile(BINDING_FILE)) as Record<string, unknown>;
    (doc["boundary"] as { geometry_urls: string[] }).geometry_urls.push("https://data.bioregionaltwin.org/geom/place/private-headgate-generalized.geojson");
    const r = await validateBinding(doc, new TreeReader({ tree: FIXTURE_STALE }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("rule 4") && e.includes("generalized"))).toBe(true);
  });

  it("rejects a main_stem_gauge without a discharge datastream", async () => {
    const doc = (await loadBindingFile(BINDING_FILE)) as Record<string, unknown>;
    (doc["members"] as Record<string, unknown>[]).push({ id: "place/boulder-creek-co-below-nederland", role: "main_stem_gauge" }); // stage only
    const r = await validateBinding(doc, new TreeReader({ tree: FIXTURE_STALE }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("rule 3") && e.includes("discharge"))).toBe(true);
  });

  it("rejects an unknown agg (rule 6) at the schema", async () => {
    const doc = (await loadBindingFile(BINDING_FILE)) as Record<string, unknown>;
    (doc["needs"] as Record<string, unknown>[])[0]!["agg"] = "p90";
    const r = await validateBinding(doc, new TreeReader({ tree: FIXTURE_STALE }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/agg|enum|schema/);
  });
});

describe("snapshot_hash", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const clone = () => {
    const d = mkdtempSync(join(tmpdir(), "twin-mcp-"));
    cpSync(FIXTURE_STALE, d, { recursive: true });
    dirs.push(d);
    return d;
  };
  const hashOf = async (tree: string) => (await runTool(await makeCtx(tree), "get_entity_status", {}))["snapshot_hash"] as string;

  it("is unchanged when only generated_at changes, and changes when a value changes", async () => {
    const base = await hashOf(FIXTURE_STALE);
    const a = clone();
    const p = join(a, "latest/conditions.json");
    writeFileSync(p, readFileSync(p, "utf8").replace('"generated_at":"2026-09-06T05:00:00Z"', '"generated_at":"2026-09-06T05:05:00Z"'));
    expect(await hashOf(a)).toBe(base);
    const b = clone();
    const q = join(b, "latest/conditions.json");
    const txt = readFileSync(q, "utf8");
    expect(txt).toContain('"value":15.4');
    writeFileSync(q, txt.replace('"value":15.4', '"value":15.5'));
    expect(await hashOf(b)).not.toBe(base);
  });
});

describe("blocked composites and metadata", () => {
  it("compare_to_normal returns available:false with the twin's reason", async () => {
    const out = await runTool(await makeCtx(), "compare_to_normal", { place_id: "place/boulder-creek-near-orodell-co", property: "discharge" });
    expect(out["available"]).toBe(false);
    expect(out["reason"]).toBe("twin publishes no baseline yet");
    expect(out["record_start"]).toBe("1986-10-01");
  });

  it("get_briefing returns available:false", async () => {
    const out = await runTool(await makeCtx(), "get_briefing", {});
    expect(out["available"]).toBe(false);
    expect(out["reason"]).toBe("twin publishes no briefings yet");
  });

  it("pagination caps at 50", async () => {
    const items = Array.from({ length: 140 }, (_, i) => i);
    const page = paginate(items, undefined, 500);
    expect(page.items.length).toBe(50);
    expect(page.next_cursor).toBeTruthy();
    const out = await runTool(await makeCtx(), "find_places", { limit: 50 });
    expect((out["places"] as unknown[]).length).toBe(50);
    expect(out["next_cursor"]).toBeTruthy();
    const next = await runTool(await makeCtx(), "find_places", { limit: 50, cursor: out["next_cursor"] });
    expect((next["places"] as unknown[]).length).toBe(71 - 50);
    await expect(runTool(await makeCtx(), "find_places", { limit: 51 })).rejects.toThrow(/invalid input/);
  });

  it("tools/list carries _meta.contract_version", () => {
    const tools = toolListing();
    expect(tools.length).toBe(TOOLS.length);
    for (const t of tools) {
      expect(t._meta["contract_version"]).toBe(CONTRACT_VERSION);
      expect(t.inputSchema["type"]).toBe("object");
    }
    expect(CONTRACT_VERSION).toBe("1.0");
  });

  it("as_of follows the injected clock", async () => {
    const out = await runTool(await makeCtx(FIXTURE_STALE, { now: NOW + 3_600_000 }), "get_snow", {});
    expect(out["as_of"]).toBe("2026-09-06T06:00:00Z");
  });
});
