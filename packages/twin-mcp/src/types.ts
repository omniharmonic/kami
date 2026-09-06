/**
 * Wire shapes of the twin's published tree, mirrored from
 * `frontrange-twin/web/src/data/types.ts` and `twin/publisher/build.py`.
 *
 * The publisher runs every value through `_compact()`, which drops nulls, so
 * anything it can leave out is `?:` here, never `| null` alone.
 */

export type Health = "ok" | "warning" | "critical" | "unknown";

export interface Reading {
  property: string;
  value?: number | null;
  value_text?: string | null;
  unit?: string | null;
  time?: string | null;
  result_time?: string | null;
  quality?: string | null;
  source_id: string;
  derived?: boolean;
  basis?: string[];
  /** conditions.json / snow.json only (clock dialect). */
  staleness_s?: number | null;
  stale?: boolean | null;
  /** per-place pages only (threshold dialect). */
  staleness_crit_s?: number | null;
  /** Proposed baseline block (not published today). */
  context?: Record<string, unknown> | null;
}

export interface Station {
  id: string;
  name: string;
  kind: string;
  lon?: number | null;
  lat?: number | null;
  huc12?: string | null;
  networks?: string[];
  props?: Record<string, unknown> | null;
  readings: Reading[];
}

export interface SourceHealth {
  health: Health;
  last_ok?: string | null;
  staleness_s?: number | null;
  attribution: string;
  tier?: string;
  license?: string;
}

export interface Conditions {
  schema_version: string;
  generated_at: string;
  bbox: number[];
  sources: Record<string, SourceHealth>;
  stations: Station[];
}

export interface Series {
  property: string;
  unit?: string | null;
  source_id: string;
  t: string[];
  v: (number | null)[];
}

export interface PlacePage {
  schema_version: string;
  generated_at: string;
  id: string;
  kind: string;
  name: string;
  huc12?: string | null;
  parent_id?: string | null;
  superseded_by?: string | null;
  bbox?: number[] | null;
  centroid?: [number, number] | null;
  children?: string[];
  props?: Record<string, unknown>;
  readings: Reading[];
  series: Record<string, Series>;
}

export interface IdRecord {
  schema_version: "1.0";
  id: string;
  kind: string;
  name: string;
  huc12?: string;
  bbox?: number[];
  sensitivity?: "public" | "generalized";
  geometry_url?: string;
  latest_url?: string;
  twin_url?: string;
  commons_url?: string;
  sameAs?: string[];
  generated_at: string;
}

export interface IndexEntry {
  id: string;
  kind: string;
  name: string;
  bbox?: number[];
  huc12?: string;
}

export interface IdIndex {
  schema_version: string;
  generated_at: string;
  count: number;
  places: IndexEntry[];
}

export interface HealthSource {
  source_id: string;
  title: string;
  agency: string;
  tier: string;
  license: string;
  attribution: string;
  health: Health;
  last_ok?: string | null;
  last_error?: string | null;
  staleness_s?: number | null;
  nominal_cadence_s: number;
  staleness_warn_s: number;
  staleness_crit_s: number;
  readings: number;
  stale_readings: number;
}

export interface HealthBoard {
  schema_version: string;
  generated_at: string;
  sources: HealthSource[];
}

export interface SnowSite {
  id: string;
  elevation_m: number;
  swe_mm?: number;
  snow_depth_cm?: number;
  time?: string;
  stale: boolean;
}

export interface SnowState {
  schema_version: string;
  generated_at: string;
  snowline_m: number | null;
  opacity: number;
  basis: SnowSite[];
  rule: string;
  stale: boolean;
}

export type Position = number[];

export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint" | "LineString"; coordinates: Position[] }
  | { type: "Polygon" | "MultiLineString"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };

export interface Feature<P = Record<string, unknown>> {
  type: "Feature";
  geometry: Geometry | null;
  properties: P;
  schema_version?: string;
  generated_at?: string;
}

export interface FeatureCollection<P = Record<string, unknown>> {
  type: "FeatureCollection";
  schema_version: string;
  generated_at: string;
  source_id?: string;
  features: Feature<P>[];
}

export type LiveLayer = "alerts" | "drought" | "fires" | "detections" | "quakes";
