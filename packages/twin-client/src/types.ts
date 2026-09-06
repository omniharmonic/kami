/**
 * Wire shapes of the twin's published tree, ported from the twin's
 * `web/src/data/types.ts` (frontrange-twin @ 6546246) and cross-checked
 * against `docs/research/twin-survey.md` (cited below as "survey §n").
 *
 * The one convention that matters: the publisher's `_compact()` drops every
 * key whose value is `None` (survey §1.2), so anything the backend can leave
 * out is `field?: T` here — never a required `T | null`. Absent means
 * unknown; it never means zero and it never means fresh (survey Appendix #2).
 */

/** Source verdict enum (survey §2.4). */
export type Health = "ok" | "warning" | "critical" | "unknown";

/** One observation, as `_reading` writes it (survey §2.1). */
export interface Reading {
  /** Closed vocabulary, e.g. "discharge", "swe", "pm25", or a source-prefixed name like "usgs_63160" (survey §2.5). */
  property: string;
  /** Numeric result. Absent when the source reported only text. */
  value?: number | null;
  /** Non-numeric result, e.g. "Ice". */
  value_text?: string | null;
  /** UCUM unit, e.g. "[ft_i]3/s", "Cel". */
  unit?: string | null;
  /** Phenomenon time — when it happened (ISO 8601, whole seconds, Z). */
  time?: string | null;
  /** When the source produced the value. */
  result_time?: string | null;
  /** The source's own quality flag, verbatim. */
  quality?: string | null;
  source_id: string;
  /** True only for `reservoir_fill` today (survey §2.6). */
  derived?: boolean;
  /** e.g. ["reservoir_storage", "capacity_af"]. */
  basis?: string[];
  /**
   * Age in seconds at publish time. The `clock=True` dialect: only on
   * `latest/conditions.json` and `latest/snow.json` (survey §2.2).
   */
  staleness_s?: number | null;
  /** The published verdict, same dialect as `staleness_s`. */
  stale?: boolean | null;
  /**
   * The source's `staleness_crit` in seconds. The `clock=False` dialect:
   * only on the per-place pages, which are CDN-cached, so the client subtracts
   * against its own clock (survey §2.2). See `readingStaleness()`.
   */
  staleness_crit_s?: number | null;
}

/** One station of `latest/conditions.json` (survey §1.4). */
export interface Station {
  /** Registry id, e.g. "place/boulder-creek-near-orodell-co". */
  id: string;
  /** Verbatim, trailing spaces included ("Gross Reservoir "). */
  name: string;
  /** Always "monitoring_site" in conditions.json. */
  kind: string;
  lon?: number | null;
  lat?: number | null;
  huc12?: string | null;
  /** Sorted identifier schemes for this place, e.g. ["cdwr_station", "usgs_nwis"]. */
  networks?: string[];
  /** The filtered subset: only `capacity_af` / `capacity_dam`; omitted when both are absent. */
  props?: Record<string, unknown> | null;
  /** Per datastream, never per property — a reservoir can carry two `discharge` readings. */
  readings: Reading[];
}

/** `conditions.sources[source_id]` (survey §1.4). */
export interface SourceHealth {
  health: Health;
  /** Absent for a source that has never succeeded. */
  last_ok?: string | null;
  staleness_s?: number | null;
  attribution: string;
  /** "A" | "B" | "C" | "static". */
  tier?: string;
  /** "public-domain" | "cc-by-nc" | ... */
  license?: string;
}

/** `latest/conditions.json` (survey §1.4). */
export interface Conditions {
  schema_version: string;
  /** The build's `now` — the badge's clock. */
  generated_at: string;
  /** [-106.5, 38.5, -104.0, 41.0] */
  bbox: number[];
  sources: Record<string, SourceHealth>;
  /** Sorted by id; only monitoring_sites with at least one reading. */
  stations: Station[];
}

/** One row of `latest/health.json` (survey §4.1). */
export interface HealthSource extends SourceHealth {
  source_id: string;
  title?: string;
  agency?: string;
  /** Omitted unless `failing`. */
  last_error?: string | null;
  /** Gated readings from this source. */
  readings?: number;
  stale_readings?: number;
  nominal_cadence_s?: number;
  staleness_warn_s?: number;
  staleness_crit_s?: number;
}

/** `latest/health.json` (survey §4.1). */
export interface HealthBoard {
  schema_version: string;
  generated_at: string;
  /** Ordered by source_id. */
  sources: HealthSource[];
}

// --- tiles ------------------------------------------------------------------

export interface Archive {
  url: string;
  minzoom: number;
  maxzoom: number;
}

export interface PmtilesLayer {
  type: "pmtiles";
  archives: Archive[];
  attribution: string;
  encoding?: "terrarium" | "mapbox";
  placeholder?: boolean;
  /** MapLibre glyph template; braces must never be percent-encoded (survey §4.5). */
  glyphs?: string;
  sprite?: string;
}

export interface XyzLayer {
  type: "xyz";
  url: string;
  minzoom: number;
  maxzoom: number;
  attribution: string;
  encoding?: "terrarium" | "mapbox";
  placeholder?: boolean;
}

export type TileLayer = PmtilesLayer | XyzLayer;

/** `tiles/manifest.json` — cache class `id`, not `tiles` (survey §4.5). */
export interface TilesManifest {
  schema_version: string;
  generated_at: string;
  layers: {
    basemap: PmtilesLayer | null;
    terrain: TileLayer | null;
    imagery: PmtilesLayer | null;
  };
}

// --- per-place pages ----------------------------------------------------------

/** One datastream's 7-day history, thinned to ≤ 2000 points, never averaged (survey §1.5). */
export interface Series {
  property: string;
  unit?: string | null;
  source_id: string;
  /** ISO Z. */
  t: string[];
  /** Same length as `t`; null where the source sent text. */
  v: (number | null)[];
}

/** `latest/{ns}/{slug}.json` (survey §1.5). Its `generated_at` is not a clock (survey Appendix #5). */
export interface PlacePage {
  schema_version: string;
  generated_at: string;
  id: string;
  /** The full `core.place_kind` enum — watershed, bioregion, fire_event, ... */
  kind: string;
  name: string;
  huc12?: string | null;
  /** Omitted when the parent did not survive the gate. */
  parent_id?: string | null;
  /** Only when the successor is itself published. The page stays forever; render the banner. */
  superseded_by?: string | null;
  /** [minx,miny,maxx,maxy]; a point collapses to [x,y,x,y]. */
  bbox?: number[] | null;
  centroid?: [number, number] | null;
  /** Sorted; `[]` is present, not dropped. */
  children?: string[];
  /** The FULL gated props bag (not the station subset). */
  props?: Record<string, unknown>;
  /** `staleness_crit_s` dialect, no clock. */
  readings: Reading[];
  /** Keyed by the datastream's external key, e.g. "BOCOROCO/DISCHRG". */
  series: Record<string, Series>;
}

// --- identity registry --------------------------------------------------------

/** One entry of `id/index.json.places` — only `id, kind, name, bbox, huc12` (survey §3.3). */
export interface IdIndexEntry {
  id: string;
  kind: string;
  name: string;
  bbox?: number[];
  huc12?: string;
}

/** `id/index.json` (survey §3.3). Superseded and non-active places are absent. */
export interface IdIndex {
  schema_version: string;
  generated_at: string;
  /** == places.length */
  count: number;
  /** Sorted by id. */
  places: IdIndexEntry[];
}

/** `id/<id>.json`, exactly `sources/ids-schema.json` (survey §3.1; `additionalProperties: false`). */
export interface IdRecord {
  schema_version: "1.0";
  /** `^[a-z_]+/[a-z0-9-]+$`; immutable once published; aliased on rename; never reused. */
  id: string;
  kind: string;
  name: string;
  huc12?: string;
  bbox?: number[];
  /** Only "public" | "generalized" ever reach the wire (survey §3.5). */
  sensitivity?: string;
  geometry_url?: string;
  latest_url?: string;
  twin_url?: string;
  /** Present only when the knowledge commons publishes a note for this place. */
  commons_url?: string;
  /** Omitted when empty; only wikidata/gnis/usgs_nwis/cdwr_station schemes are templated (survey §3.2). */
  sameAs?: string[];
  generated_at: string;
}

// --- geometry-bearing artifacts -----------------------------------------------

export type Geometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "MultiPoint" | "LineString"; coordinates: number[][] }
  | { type: "Polygon" | "MultiLineString"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };

/** `boundary/v1.geojson` — a single Feature, not a collection (survey §3.4). */
export interface BoundaryFeature {
  type: "Feature";
  schema_version: string;
  generated_at: string;
  geometry: Geometry | null;
  properties: {
    id: string;
    name: string;
    boundary_version: string;
    ring?: string;
    area_sqkm?: number;
    huc8?: string[];
    method?: string;
    rationale_url?: string;
    [k: string]: unknown;
  };
}

/** `geom/{id}.geojson` — a single Feature; `geometry` may be null (survey §3.4). */
export interface GeomFeature {
  type: "Feature";
  schema_version: string;
  generated_at: string;
  geometry: Geometry | null;
  properties: { id: string; kind: string; name: string; huc12?: string; [k: string]: unknown };
}

// --- live feature collections -------------------------------------------------

export type LiveProps<P = Record<string, unknown>> = P & {
  /** The row's external key — except fires, where it is a place id (survey §4.4). */
  id: string;
  source_id: string;
  phenomenon_time?: string | null;
  expires_at?: string | null;
};

/** `geometry` really is nullable: a zone-only NWS alert ships geometryless (survey §4.4). */
export interface LiveFeature<P = Record<string, unknown>> {
  type: "Feature";
  geometry: Geometry | null;
  properties: LiveProps<P>;
}

export interface LiveCollection<P = Record<string, unknown>> {
  type: "FeatureCollection";
  schema_version: string;
  generated_at: string;
  /** alert→nws.alerts, detection→nasa.firms, quake→usgs.quakes, drought→usdm.current, fires→nifc.wfigs. */
  source_id: string;
  /** Sorted by properties.id. */
  features: LiveFeature<P>[];
}

/** `latest/alerts.geojson` — verbatim from `twin/adapters/nws_alerts.py`; do not invent fields (survey §4.4). */
export interface AlertProps {
  event?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  /** "Severe" and "Extreme" are the ones that matter. */
  severity?: string;
  certainty?: string;
  urgency?: string;
  area_desc?: string;
  /** "NWS Denver CO". */
  sender?: string;
  /** "BOU" | "PUB" | null. */
  office?: string | null;
  /** NWS zone codes — why a zone-only alert has no polygon. */
  ugc?: string[];
  /** When the hazard STARTS. */
  onset?: string;
}

/** `latest/fires.geojson` — `id` is a place id like "place/willow" (survey §4.4). */
export interface FireProps {
  name?: string;
  kind?: string;
  active?: boolean;
  fire_acres?: number;
  daily_acres?: number;
  percent_contained?: number;
  containment_time?: string | null;
  discovery_time?: string | null;
  fire_cause?: string;
  incident_type_category?: string;
  poo_county?: string;
  unique_fire_identifier?: string;
  modified_on?: string;
}

/** `latest/detections.geojson` — VIIRS `confidence` is a class letter 'l'|'n'|'h' (survey §4.4). */
export interface DetectionProps {
  confidence?: string;
  /** Fire radiative power, MW. */
  frp?: number;
  /** Brightness temperature of the I-4 channel, kelvin. */
  bright_ti4?: number;
  satellite?: string;
  instrument?: string;
  /** e.g. "VIIRS_NOAA20_NRT". */
  sensor?: string;
  /** 'D' | 'N'. */
  daynight?: string;
}

/** `latest/quakes.geojson` — the scale is `mag_type`, never `magnitude_type` (survey §4.4). */
export interface QuakeProps {
  mag?: number;
  mag_type?: string;
  place?: string;
  depth_km?: number;
  /** 'automatic' | 'reviewed'. */
  status?: string;
  /** "earthquake" | "quarry blast". */
  type?: string;
  url?: string;
}

/** `latest/drought.geojson` — `dm` 0–4 for D0–D4; the national_* fields are real and undeclared upstream (survey §4.4). */
export interface DroughtProps {
  dm?: number;
  label?: string;
  period_start?: string;
  period_end?: string;
  release_date?: string;
  national_area_sq_mi?: number;
  national_cumulative_pct?: number;
  national_categorical_pct?: number;
}

export type LiveLayer = "alerts" | "fires" | "detections" | "quakes" | "drought";

export interface LivePropsByLayer {
  alerts: AlertProps;
  fires: FireProps;
  detections: DetectionProps;
  quakes: QuakeProps;
  drought: DroughtProps;
}

// --- network ------------------------------------------------------------------

/** One reach of `network/reaches.geojson` (survey §4.3). Only stream order ≥ 4 ships. */
export interface ReachFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: {
    /** NHDPlusID as a string. */
    id: string;
    name?: string | null;
    order: number;
    km: number;
    /** The downstream reach's id; an explicit `null` at the outlet — the one deliberate null in the tree. */
    ds?: string | null;
  };
}

export interface ReachCollection {
  type: "FeatureCollection";
  schema_version: string;
  generated_at: string;
  features: ReachFeature[];
}

/** A reach's pace: the discharge at the nearest upstream gauge, carried down (survey §4.3). */
export interface ReachSpeed {
  cfs: number;
  gauge: string;
  /** 0 when the gauge sits on this reach. */
  hops: number;
  stale: boolean;
}

/** `latest/flow_network.json` (survey §4.3). Keys are string NHDPlusIDs. */
export interface FlowNetwork {
  schema_version: string;
  generated_at: string;
  /** The honesty line, verbatim from the publisher. */
  rule: string;
  reaches: Record<string, ReachSpeed>;
}

// --- snow ---------------------------------------------------------------------

/** One basis site of `latest/snow.json`; entries go through `_compact` (survey §4.2). */
export interface SnowSite {
  id: string;
  elevation_m: number;
  swe_mm?: number | null;
  snow_depth_cm?: number | null;
  time?: string | null;
  stale?: boolean;
}

/** `latest/snow.json` (survey §4.2). A 404 is `null`, not an error. */
export interface SnowState {
  schema_version: string;
  generated_at: string;
  /** Null when < 3 usable sites, none report snow, or all are stale. */
  snowline_m: number | null;
  /** 0–1: median SWE above the line / 300 mm, capped. */
  opacity: number;
  basis: SnowSite[];
  /** Verbatim `SNOW_RULE`. */
  rule: string;
  stale: boolean;
}

// --- not yet published (survey §1.6, §6) --------------------------------------

/**
 * `normals/{ns}/{slug}.json` — PROPOSAL, NOT PUBLISHED (survey §2.7). Typed
 * loosely so the getter can return it the day it ships; until then `null`.
 */
export interface Normals {
  place_id: string;
  datastream?: string;
  property: string;
  unit?: string;
  basis?: Record<string, unknown>;
  percentile_levels?: number[];
  by_doy?: Record<string, Record<string, unknown>>;
  timing?: Record<string, unknown>;
  rule?: string;
  generated_at: string;
  [k: string]: unknown;
}

/** `briefings/latest.json` — SPECIFIED, NOT BUILT (survey §6). */
export interface Briefing {
  title?: string;
  summary?: string;
  sections?: unknown[];
  watch?: unknown[];
  generated_at?: string;
  [k: string]: unknown;
}
