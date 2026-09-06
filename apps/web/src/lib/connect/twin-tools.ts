/**
 * The twin MCP’s published tool contract (@bioregionaltwin/mcp, contract 1.0),
 * as a data table this app can render.
 *
 * GENERATED from that package’s own registry (`TOOLS` in
 * `packages/twin-mcp/src/tools/index.ts`) — do not hand-edit. The twin MCP is a
 * separate package that `@kami/web` does not depend on (it is written to be
 * lifted verbatim into the twin’s own repo, ADR-E15), so the list is pinned
 * here rather than imported at run time; `__tests__/tools.test.ts` re-reads the
 * real registry and fails on any drift, which is what keeps this file honest.
 *
 * Regenerate: `pnpm build:packages`, then see the failure message in that test.
 */

export type TwinToolDef = { name: string; description: string; deprecated?: boolean };

/** Architecture §4.2 order: primitives, then composites. */
export const TWIN_TOOLS: readonly TwinToolDef[] = [
  { name: "find_places", description: "Search the twin's identity registry (id/index.json) by name substring, kind, HUC prefix or bbox. Returns ids to pass to get_place. Paginated (limit ≤ 50)." },
  { name: "get_place", description: "One place: its identity record (id/<id>.json), its latest readings with stale/staleness_s computed from staleness_crit_s against the current clock, a 7-day series summary per datastream (min, max, last, trend, n) and points_url for the raw series. No series points and no geometry are returned; use geometry_url." },
  { name: "get_conditions", description: "Latest readings for monitoring sites from latest/conditions.json, filtered by place_ids, a HUC prefix, or `within` a place polygon (point-in-polygon computed server-side; properties only are returned). Paginated and size-capped." },
  { name: "get_live", description: "Features of a live layer (alerts | drought | fires | detections | quakes), optionally only those intersecting the polygon of `within`. Properties plus centroid/bbox only — never a ring. Zone-only NWS alerts have no polygon and are returned with geometry: null, matched_by: null. Drought features carry dm, label, period_start, period_end." },
  { name: "get_snow", description: "The snowline artifact (latest/snow.json): snowline_m (null when fewer than 3 usable sites, none report snow, or all are stale), opacity, the SNOTEL basis with per-site stale flags, and the rule verbatim." },
  { name: "get_health", description: "The honesty board (latest/health.json): per source, is the feed up (health, last_ok, staleness_s) and are its values fresh (readings, stale_readings), with the thresholds that decide." },
  { name: "get_boundary_summary", description: "The bioregion boundary as a proposal with its reasoning: id, boundary_version, ring, area_sqkm, huc8[], method, the first 600 characters of the rationale (CC BY-SA 4.0), rationale_url and geometry_url. No ring is returned." },
  { name: "get_briefing", description: "The twin's weekly briefing (fact sheet + guarded analysis) when the twin publishes one; {available:false} until briefings/ ships." },
  { name: "explain", description: "Plain-language explanation of a property (discharge, swe, pm25, …) or a class:<kind> key, with unit help and, where a settled scale exists, bands. Static copy vendored from the twin, CC BY-SA 4.0 with attribution. Never a model output. Pass `value` to get the band it falls in." },
  { name: "list_entities", description: "Bindings this server was started with (stdio: --binding files). The hosted Worker returns {entities: []} — the twin does not host an entity registry." },
  { name: "resolve_entity", description: "Resolve `query` to a validated place-set binding: an entity slug configured on this server, a twin watershed/stream id (→ a proposed binding, binding_version 0, unreviewed), or an https binding_url on an allowlisted origin (→ fetched and validated against schema + rules 1–6)." },
  { name: "get_entity_status", description: "THE pulse call: for the entity's binding, each need resolved with its aggregation (value, unit, time, stale, staleness_s, source_status, 7-day week{min,max,trend}, label, percentile_por: null until the twin publishes baselines), the live picture over its watersheds (drought_max_dm, alerts, fires_inside, detections_24h), source health, snapshot_hash (sha256 over members' readings excluding generated_at/staleness_s) and a facts-1.0 block for the guard." },
  { name: "get_reading_history", description: "Summary of one property's series at a place over 24h or 7d (min, max, last, trend, n) from the place page's 7-day series, plus points_url. Raw points never go to the model." },
  { name: "get_alerts", description: "Everything alert-shaped touching the entity: NWS alerts (polygon-matched to its watersheds, or zone-only with matched_by: null), the Drought Monitor class when ≥ D1, active fires inside, and PM2.5 beyond Moderate at its air member." },
  { name: "compare_to_normal", description: "Where today's reading sits against the site's record. Blocked until the twin publishes baselines: returns {available:false, reason:\"twin publishes no baseline yet\", record_start?}. When a reading carries a `context` block or normals/<id>.json exists, returns {percentile_por, median_por, years_of_record, label, provisional}." },
] as const;

/**
 * The twin server has no write path at all: it is a pure function of the
 * twin’s published static files (its README, “no database, no origin server,
 * no write path”). Nothing an agent calls there can change anything.
 */
export const TWIN_IS_READ_ONLY = true;

export const TWIN_PACKAGE = "@bioregionaltwin/mcp";
export const TWIN_DEFAULT_TREE = "https://data.bioregionaltwin.org";
