/**
 * @kami/needs — types.
 *
 * `HealthSnapshot` is architecture §9.1 verbatim. Everything else here is the
 * input side: what the twin publishes (a reading), what the binding declares
 * (a need spec), and what the platform knows (live layers, pause, GPU).
 *
 * Invariants (CLAUDE.md): every reading carries time, unit, source_id, stale,
 * staleness_s, source_status. Absent means unknown, never zero. Nothing is
 * interpolated. `stale` on a driving need forces `mood: asleep` (ADR-E11).
 */

export type NeedName =
  | "flow"
  | "storage"
  | "snow"
  | "water"
  | "air"
  | "drought"
  | "stage"
  | "fire"
  | "alerts";

export type SourceStatus = "ok" | "warning" | "critical" | "unknown";
export type Trend = "rising" | "falling" | "flat";
export type Mood = "asleep" | "content" | "concerned" | "distressed" | "celebrating";
export type DroughtClass = 0 | 1 | 2 | 3 | 4;
export type AlertLevel = 0 | 1 | 2 | 3;
export type FloodCategory = "none" | "action" | "minor" | "moderate" | "major";
/** 0 freeze, 1 runoff, 2 monsoon, 3 fall. */
export type Season = 0 | 1 | 2 | 3;

/** One need as it appears in the published snapshot (architecture §9.1). */
export type NeedSnapshot = {
  need: NeedName;
  place_id: string | null;
  property: string;
  value: number | null;
  unit: string | null;
  time: string | null;
  source_id: string | null;
  stale: boolean;
  staleness_s: number | null;
  source_status: SourceStatus;
  /** null until the twin publishes baselines */
  percentile: number | null;
  /** from published bands only (EPA, USDM, NWPS flood, reservoir_fill) */
  band: string | null;
  /** 0–1, null when stale or unbanded */
  health: number | null;
  trend_7d: Trend | null;
  /** guarded, templated: "15.4 cfs at Orodell, 2026-09-04 20:15Z, stale" */
  label: string;
};

/** Architecture §9.1, exactly. */
export type HealthSnapshot = {
  schema_version: "1.0";
  entity_id: string;
  /** ISO */
  as_of: string;
  needs: NeedSnapshot[];
  drought_class: DroughtClass | null;
  alert_level: AlertLevel;
  flood_category: FloodCategory | null;
  /** any need with weight > 0 is stale */
  stale_driving: boolean;
  mood: Mood;
  /** templated, e.g. "drought D1 in my watershed" */
  mood_reason: string;
  /** 0 freeze, 1 runoff, 2 monsoon, 3 fall — by date and snowline */
  season: Season;
  gpu_online: boolean;
  paused: boolean;
  /** earned by humans only */
  cosmetics: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The twin's forthcoming baseline block on a reading (implementation plan
 * decision #15 / TW-5). Optional everywhere; `percentile` is the only field
 * this package reads.
 */
export type ReadingContext = {
  class?: string | null;
  /** 0–100, percentile of the value against the published period of record */
  percentile?: number | null;
  basis_kind?: string | null;
  years_of_record?: number | null;
  provisional?: boolean;
  sentence?: string | null;
};

/** A short summary of the recent series (the twin's `week` block, generalised). */
export type SeriesSummary = {
  min: number | null;
  max: number | null;
  last: number | null;
  trend: Trend | null;
  n: number;
};

/** A reading as the twin publishes it, already aggregated per the spec's `agg`. */
export type NeedInput = {
  value: number | null;
  /** UCUM */
  unit: string | null;
  /** ISO */
  time: string | null;
  source_id: string | null;
  stale: boolean;
  staleness_s: number | null;
  source_status: SourceStatus;
  context?: ReadingContext | null;
  series_summary?: SeriesSummary | null;
};

export type NeedAgg = "single" | "mean_24h" | "max_intersecting" | (string & {});

/** One entry of the binding's `needs:` list (architecture §3), plus display hints. */
export type NeedSpec = {
  need: NeedName;
  property: string;
  places: string[];
  agg: NeedAgg;
  /**
   * 0–1. A need with weight 0 never drives mood (it is display-only); weight
   * also scales the mean-health term of rule 5. Defaults: see `defaultWeight`.
   */
  weight?: number;
  /** Short human place name for labels ("Orodell"). Derived from the place id when absent. */
  place_label?: string;
};

export type NwsSeverity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";

export type NwsAlert = {
  severity: NwsSeverity;
  event?: string;
  id?: string;
};

/** Live layers and platform facts the pulse passes alongside the readings. */
export type LiveInputs = {
  /** max USDM class intersecting the boundary; null = unknown / no polygon */
  drought_class: DroughtClass | null;
  /** NWS alerts intersecting the boundary (empty when none or unknown) */
  alerts: NwsAlert[];
  /** NWPS category at the anchor gauge; null when the gauge has no flood categories */
  flood_category: FloodCategory | null;
  /** fire perimeters inside the boundary; null = unknown */
  fires_inside: number | null;
  /** a `BountyCompleted` attestation for this entity in the last 24 h */
  bounty_completed_in_24h: boolean;
};

export type ComputeOptions = {
  now: Date;
  /** earlier snapshots, any order; the latest `as_of` is used for hysteresis */
  previous_snapshots?: HealthSnapshot[];
  gpu_online: boolean;
  paused: boolean;
  cosmetics?: Record<string, number>;
  /** from `latest/snow.json`; null when the twin publishes none */
  snowline_m?: number | null;
};

/** Result of the mood rules before hysteresis. */
export type MoodResult = { mood: Mood; reason: string };

export type DeltaKind =
  | "band_change"
  | "alert_start"
  | "alert_end"
  | "stale_flip"
  | "mood_change"
  | "value_change";

export type Delta = {
  kind: DeltaKind;
  /** the need concerned, or null for snapshot-level fields */
  need: NeedName | null;
  /** which field changed (`band`, `stale`, `value`, `alert_level`, `mood`, `drought_class`, `flood_category`) */
  field: string;
  from: unknown;
  to: unknown;
  /** band_change, alert_start/end, stale_flip, mood_change are notable; value_change is not */
  notable: boolean;
};

/** Default weights by need (task T0.6): 1 for the drivers, 0.5 for snow/water/air. */
export function defaultWeight(need: NeedName): number {
  switch (need) {
    case "snow":
    case "water":
    case "air":
      return 0.5;
    default:
      return 1;
  }
}

/** The effective weight of a spec, clamped to 0–1. */
export function specWeight(spec: NeedSpec): number {
  const w = spec.weight ?? defaultWeight(spec.need);
  if (!Number.isFinite(w)) return 0;
  return Math.min(1, Math.max(0, w));
}
