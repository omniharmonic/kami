/**
 * Runtime validation for the envelopes in `types.ts`.
 *
 * Deliberately lenient: every object is `looseObject`, so a new optional key
 * the twin adds is data, not a crash (architecture §4.4 — "a tree change
 * surfaces as data"). What we do assert is the shape we dereference: ids,
 * `readings[]`, `source_id`, `generated_at`, the FeatureCollection envelope.
 */

import { z } from "zod";

const iso = z.string();
const nullableNum = z.number().nullable().optional();
const nullableStr = z.string().nullable().optional();

export const HealthSchema = z.enum(["ok", "warning", "critical", "unknown"]);

export const ReadingSchema = z.looseObject({
  property: z.string(),
  value: nullableNum,
  value_text: nullableStr,
  unit: nullableStr,
  time: nullableStr,
  result_time: nullableStr,
  quality: nullableStr,
  source_id: z.string(),
  derived: z.boolean().optional(),
  basis: z.array(z.string()).optional(),
  staleness_s: nullableNum,
  stale: z.boolean().nullable().optional(),
  staleness_crit_s: nullableNum,
});

export const StationSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  lon: nullableNum,
  lat: nullableNum,
  huc12: nullableStr,
  networks: z.array(z.string()).optional(),
  props: z.record(z.string(), z.unknown()).nullable().optional(),
  readings: z.array(ReadingSchema),
});

export const SourceHealthSchema = z.looseObject({
  health: HealthSchema,
  last_ok: nullableStr,
  staleness_s: nullableNum,
  attribution: z.string(),
  tier: z.string().optional(),
  license: z.string().optional(),
});

export const ConditionsSchema = z.looseObject({
  schema_version: z.string(),
  generated_at: iso,
  bbox: z.array(z.number()),
  sources: z.record(z.string(), SourceHealthSchema),
  stations: z.array(StationSchema),
});

export const HealthSourceSchema = SourceHealthSchema.extend({
  source_id: z.string(),
  title: z.string().optional(),
  agency: z.string().optional(),
  last_error: nullableStr,
  readings: z.number().optional(),
  stale_readings: z.number().optional(),
  nominal_cadence_s: z.number().optional(),
  staleness_warn_s: z.number().optional(),
  staleness_crit_s: z.number().optional(),
});

export const HealthBoardSchema = z.looseObject({
  schema_version: z.string(),
  generated_at: iso,
  sources: z.array(HealthSourceSchema),
});

export const SeriesSchema = z.looseObject({
  property: z.string(),
  unit: nullableStr,
  source_id: z.string(),
  t: z.array(z.string()),
  v: z.array(z.number().nullable()),
});

export const PlacePageSchema = z.looseObject({
  schema_version: z.string(),
  generated_at: iso,
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  huc12: nullableStr,
  parent_id: nullableStr,
  superseded_by: nullableStr,
  bbox: z.array(z.number()).nullable().optional(),
  centroid: z.tuple([z.number(), z.number()]).nullable().optional(),
  children: z.array(z.string()).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  readings: z.array(ReadingSchema),
  series: z.record(z.string(), SeriesSchema).default({}),
});

export const IdIndexEntrySchema = z.looseObject({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  bbox: z.array(z.number()).optional(),
  huc12: z.string().optional(),
});

export const IdIndexSchema = z.looseObject({
  schema_version: z.string(),
  generated_at: iso,
  count: z.number(),
  places: z.array(IdIndexEntrySchema),
});

/** Structural mirror of ids-schema; the byte-exact JSON Schema check lives in `@kami/binding`. */
export const IdRecordSchema = z.looseObject({
  schema_version: z.literal("1.0"),
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  huc12: z.string().optional(),
  bbox: z.array(z.number()).optional(),
  sensitivity: z.string().optional(),
  geometry_url: z.string().optional(),
  latest_url: z.string().optional(),
  twin_url: z.string().optional(),
  commons_url: z.string().optional(),
  sameAs: z.array(z.string()).optional(),
  generated_at: iso,
});

export const GeometrySchema = z.looseObject({
  type: z.string(),
  coordinates: z.unknown().optional(),
  geometries: z.array(z.unknown()).optional(),
});

export const LiveFeatureSchema = z.looseObject({
  type: z.literal("Feature"),
  geometry: GeometrySchema.nullable(),
  properties: z.looseObject({
    id: z.string(),
    source_id: z.string(),
    phenomenon_time: nullableStr,
    expires_at: nullableStr,
  }),
});

export const LiveCollectionSchema = z.looseObject({
  type: z.literal("FeatureCollection"),
  schema_version: z.string(),
  generated_at: iso,
  source_id: z.string(),
  features: z.array(LiveFeatureSchema),
});

export const BoundaryFeatureSchema = z.looseObject({
  type: z.literal("Feature"),
  schema_version: z.string(),
  generated_at: iso,
  geometry: GeometrySchema.nullable(),
  properties: z.looseObject({
    id: z.string(),
    name: z.string(),
    boundary_version: z.string(),
  }),
});

export const ReachFeatureSchema = z.looseObject({
  type: z.literal("Feature"),
  geometry: z.looseObject({ type: z.literal("LineString"), coordinates: z.array(z.tuple([z.number(), z.number()])) }),
  properties: z.looseObject({
    id: z.string(),
    name: nullableStr,
    order: z.number(),
    km: z.number(),
    ds: nullableStr,
  }),
});

export const ReachCollectionSchema = z.looseObject({
  type: z.literal("FeatureCollection"),
  schema_version: z.string(),
  generated_at: iso,
  features: z.array(ReachFeatureSchema),
});

export const ReachSpeedSchema = z.looseObject({
  cfs: z.number(),
  gauge: z.string(),
  hops: z.number(),
  stale: z.boolean(),
});

export const FlowNetworkSchema = z.looseObject({
  schema_version: z.string(),
  generated_at: iso,
  rule: z.string(),
  reaches: z.record(z.string(), ReachSpeedSchema),
});

export const SnowSiteSchema = z.looseObject({
  id: z.string(),
  elevation_m: z.number(),
  swe_mm: nullableNum,
  snow_depth_cm: nullableNum,
  time: nullableStr,
  stale: z.boolean().optional(),
});

export const SnowStateSchema = z.looseObject({
  schema_version: z.string(),
  generated_at: iso,
  snowline_m: z.number().nullable(),
  opacity: z.number(),
  basis: z.array(SnowSiteSchema),
  rule: z.string(),
  stale: z.boolean(),
});

export const TilesManifestSchema = z.looseObject({
  schema_version: z.string(),
  generated_at: iso,
  layers: z.looseObject({
    basemap: z.unknown().nullable(),
    terrain: z.unknown().nullable(),
    imagery: z.unknown().nullable(),
  }),
});

/** Proposal shape only (survey §2.7); asserted loosely so the day it ships nothing breaks. */
export const NormalsSchema = z.looseObject({
  place_id: z.string(),
  property: z.string(),
  generated_at: iso,
});

export const BriefingSchema = z.looseObject({});
