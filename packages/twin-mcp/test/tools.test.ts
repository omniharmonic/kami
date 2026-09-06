import { describe, expect, it } from "vitest";
import { assertNoGeometry, assertSize, ContractViolation } from "../src/envelope.js";
import { centroidOf, geometriesIntersectApprox, pointInPolygon } from "../src/geo.js";
import { runTool } from "../src/server.js";
import { FIXTURE_LIVE, FIXTURE_STALE, makeCtx } from "./helpers.js";

const sq = (x0: number, y0: number, x1: number, y1: number) => ({ type: "Polygon" as const, coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });

describe("geometry helpers (server-side only)", () => {
  it("ray-casting point-in-polygon honours holes and MultiPolygons", () => {
    const withHole = { type: "Polygon" as const, coordinates: [...sq(0, 0, 10, 10).coordinates, ...sq(4, 4, 6, 6).coordinates] };
    expect(pointInPolygon(1, 1, withHole)).toBe(true);
    expect(pointInPolygon(5, 5, withHole)).toBe(false);
    expect(pointInPolygon(11, 5, withHole)).toBe(false);
    const multi = { type: "MultiPolygon" as const, coordinates: [sq(0, 0, 1, 1).coordinates, sq(5, 5, 6, 6).coordinates] };
    expect(pointInPolygon(5.5, 5.5, multi)).toBe(true);
    expect(pointInPolygon(3, 3, multi)).toBe(false);
    expect(centroidOf(sq(0, 0, 2, 4))).toEqual([1, 2]);
  });
  it("approximate intersection", () => {
    expect(geometriesIntersectApprox(sq(0, 0, 10, 10), sq(5, 5, 15, 15))).toBe(true);
    expect(geometriesIntersectApprox(sq(0, 0, 10, 10), sq(20, 20, 30, 30))).toBe(false);
    expect(geometriesIntersectApprox(sq(0, 0, 10, 10), sq(2, 2, 3, 3))).toBe(true);
  });
});

describe("envelope guards", () => {
  it("assertNoGeometry catches coordinates and geometry objects but allows null geometry, centroids, bboxes and URLs", () => {
    expect(() => assertNoGeometry({ a: { coordinates: [1, 2] } })).toThrow(ContractViolation);
    expect(() => assertNoGeometry({ geometry: { type: "Polygon", coordinates: [] } })).toThrow(ContractViolation);
    expect(() => assertNoGeometry({ geometry: null, centroid: [1, 2], bbox: [0, 0, 1, 1], geometry_url: "https://x/geom/a.geojson" })).not.toThrow();
  });
  it("assertSize enforces 16 KB", () => {
    expect(() => assertSize({ s: "x".repeat(16 * 1024) })).toThrow(/16384/);
    expect(() => assertSize({ s: "x" })).not.toThrow();
  });
});

describe("tools", () => {
  it("get_conditions within a watershed uses PIP and never returns lon/lat", async () => {
    const out = await runTool(await makeCtx(), "get_conditions", { within: "watershed/huc10-1019000506", limit: 50 });
    const ids = (out["stations"] as { id: string }[]).map((s) => s.id);
    expect(ids).toContain("place/boulder-creek-near-orodell-co");
    expect(ids).not.toContain("place/gross-reservoir");
    expect(JSON.stringify(out)).not.toMatch(/"lon"|"lat"/);
    expect(out["sources"]).toHaveProperty("cdss.telemetry");
  });

  it("get_live alerts: the zone-only alert is returned with geometry: null and matched_by: null even under within", async () => {
    const out = await runTool(await makeCtx(), "get_live", { layer: "alerts", within: "watershed/huc10-1019000504" });
    const f = (out["features"] as Record<string, unknown>[])[0]!;
    expect(f["geometry"]).toBeNull();
    expect(f["matched_by"]).toBeNull();
    expect(f["event"]).toBe("Red Flag Warning");
    expect(out["unplaced"]).toBe(1);
  });

  it("get_live drought within the western watershed sees D0 only; the eastern one sees D1", async () => {
    const west = await runTool(await makeCtx(), "get_live", { layer: "drought", within: "watershed/huc10-1019000504" });
    expect((west["features"] as { dm: number }[]).map((f) => f.dm)).toEqual([0]);
    const east = await runTool(await makeCtx(), "get_live", { layer: "drought", within: "watershed/huc10-1019000507" });
    expect((east["features"] as { dm: number }[]).map((f) => f.dm).sort()).toEqual([0, 1]);
    expect((east["features"] as { period_end: string; label: string }[])[1]).toMatchObject({ label: "D1", period_end: "2026-09-07T06:00:00Z" });
  });

  it("get_snow: snowline null with a stale basis on the stale tree", async () => {
    const out = await runTool(await makeCtx(), "get_snow", {});
    expect(out["snowline_m"]).toBeNull();
    expect((out["basis"] as { id: string; stale: boolean }[]).find((b) => b.id === "place/niwot")!.stale).toBe(true);
    const live = await runTool(await makeCtx(FIXTURE_LIVE), "get_snow", {});
    expect((live["basis"] as { stale: boolean }[]).every((b) => !b.stale)).toBe(true);
  });

  it("get_health mirrors the fixture verdicts", async () => {
    const out = await runTool(await makeCtx(), "get_health", {});
    const by = Object.fromEntries((out["sources"] as { source_id: string; health: string }[]).map((s) => [s.source_id, s.health]));
    expect(by).toMatchObject({ "cdss.telemetry": "critical", "nws.alerts": "critical", "usdm.current": "ok", "nrcs.awdb": "warning", "derived.fill": "ok", "epa.airnow": "critical", "usgs.ogcapi.latest": "ok" });
  });

  it("get_boundary_summary returns prose and URLs, no ring", async () => {
    const out = await runTool(await makeCtx(), "get_boundary_summary", {});
    expect(out["huc8"]).toEqual(["10190002", "10190003", "10190004", "10190005", "10190006", "10190007"]);
    expect(String(out["rationale"]).length).toBeLessThanOrEqual(601);
    expect(out["geometry_url"]).toMatch(/boundary\/v1\.geojson$/);
    expect(out["rationale_license"]).toBe("CC BY-SA 4.0");
  });

  it("get_place on a watershed lists children and parent; on an unknown id errors not_found", async () => {
    const out = await runTool(await makeCtx(), "get_place", { id: "watershed/huc10-1019000506" });
    expect((out["children"] as string[]).length).toBe(6);
    expect(out["parent_id"]).toBe("watershed/huc8-10190005");
    await expect(runTool(await makeCtx(), "get_place", { id: "place/nowhere" })).rejects.toThrow(/not published/);
  });

  it("get_reading_history 24h summary ends at the series' last point", async () => {
    const out = await runTool(await makeCtx(), "get_reading_history", { place_id: "place/boulder-creek-near-orodell-co", property: "discharge", window: "24h" });
    const s = out["summary"] as { n: number; last: number; end: string };
    expect(s.n).toBe(25);
    expect(s.last).toBe(15.4);
    expect(s.end).toBe("2026-09-04T20:15:00Z");
    expect(out["points_url"]).toMatch(/latest\/place\/boulder-creek-near-orodell-co\.json$/);
    const fill = await runTool(await makeCtx(), "get_reading_history", { place_id: "place/gross-reservoir", property: "reservoir_fill" });
    expect((fill["summary"] as { last: number }).last).toBe(72);
  });

  it("get_alerts: zone-only NWS alert unplaced, D1 drought raised, no fire, no air alert on Good PM2.5", async () => {
    const out = await runTool(await makeCtx(), "get_alerts", {});
    const kinds = (out["alerts"] as { kind: string; matched_by: string | null }[]);
    expect(kinds.map((a) => a.kind)).toEqual(["nws", "drought"]);
    expect(kinds[0]!.matched_by).toBeNull();
  });

  it("resolve_entity proposes a binding for a watershed id and refuses a non-allowlisted URL", async () => {
    const out = await runTool(await makeCtx(), "resolve_entity", { query: "watershed/huc10-1019000506" });
    expect(out["proposed"]).toBe(true);
    const b = out["binding"] as { members: { id: string; role: string }[]; anchor: string; binding_version: number };
    expect(b.binding_version).toBe(0);
    expect(b.members.some((m) => m.id === "place/boulder-creek-near-orodell-co" && m.role === "gauge")).toBe(true);
    expect(b.members.some((m) => m.id === "place/boulder-cu-2102-athens-st" && m.role === "air")).toBe(true);
    await expect(runTool(await makeCtx(), "resolve_entity", { query: "https://evil.example/binding.yaml" })).rejects.toThrow(/not allowlisted/);
    const cfg = await runTool(await makeCtx(), "resolve_entity", { query: "entity/boulder-creek" });
    expect(cfg["resolved_from"]).toBe("configured");
    expect(cfg["ok"]).toBe(true);
  });

  it("get_entity_status: stale gauge but live reservoir; source_status is the feed's verdict, stale the reading's", async () => {
    const out = await runTool(await makeCtx(FIXTURE_STALE), "get_entity_status", {});
    const needs = Object.fromEntries((out["needs"] as Record<string, unknown>[]).map((n) => [n["need"], n]));
    expect(needs["storage"]).toMatchObject({ value: 72, unit: "%", stale: false, source_status: "ok", source_id: "derived.fill" });
    expect(needs["flow"]).toMatchObject({ stale: true, source_status: "critical" });
    expect(needs["drought"]).toMatchObject({ value: 1, label: "Drought class: D1 · Moderate drought", percentile_por: null });
    expect(needs["air"]).toMatchObject({ agg: "mean_24h", n: 25, stale: true });
    expect((needs["storage"] as { week: { min: number } }).week.min).toBeGreaterThan(70);
    expect((out["live"] as { drought_max_dm: number; fires_inside: number }).drought_max_dm).toBe(1);
    expect(out["sources"]).toHaveProperty("usdm.current");
  });
});
