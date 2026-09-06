/**
 * Staleness, honestly.
 *
 * The twin answers "how old is this and is that too old?" two different ways
 * on purpose (survey §2.2): `latest/conditions.json` and `latest/snow.json`
 * ship the verdict (`staleness_s` + `stale`); the ~2,000 cached place pages
 * ship the threshold (`staleness_crit_s`) and the reader subtracts. Mixing
 * them silently is how a 26-day-old gauge gets drawn as current (survey
 * Appendix #4). `readingStaleness` below is the twin's own resolver
 * (`web/src/data/reading.ts:44-67`), ported exactly.
 */

import type { Conditions, Health, HealthBoard, Reading, SourceHealth } from "./types.js";

export interface ReadingStaleness {
  /** Age of the value in seconds as of `now`; `null` when we cannot tell. */
  seconds: number | null;
  /** Past the source's `staleness_crit`. Never a guess. */
  stale: boolean;
  /** True when no timestamp, no threshold and no flag were available. Unknown ≠ fresh. */
  unknown: boolean;
}

/**
 * Threshold-then-flag: compute from `staleness_crit_s` when present (that
 * answer is current), fall back to the published `stale` flag, and report
 * `unknown: true` when neither dialect is present.
 */
export function readingStaleness(reading: Reading, now: number = Date.now()): ReadingStaleness {
  const t = reading.time ? Date.parse(reading.time) : NaN;
  const age = Number.isNaN(t) ? null : Math.max(0, (now - t) / 1000);

  const crit = reading.staleness_crit_s;
  if (age !== null && typeof crit === "number" && crit > 0) {
    return { seconds: age, stale: age > crit, unknown: false };
  }

  if (typeof reading.stale === "boolean") {
    return {
      seconds: age ?? reading.staleness_s ?? null,
      stale: reading.stale,
      unknown: false,
    };
  }

  // No threshold, no flag. We may know how old it is; "too old?" is unanswerable.
  return { seconds: age, stale: false, unknown: true };
}

export interface SourceThreshold {
  tier: "A" | "B" | "C" | "static";
  nominal_cadence_s: number;
  staleness_warn_s: number;
  staleness_crit_s: number;
}

export type SourceThresholds = Readonly<Record<string, SourceThreshold>>;

/**
 * `source_id → seconds`, transcribed from the twin's `sources/sources.seed.yaml`
 * (survey §2.3; seed line numbers there). `staleness_crit_s` is exactly the
 * `staleness_crit_s` a reading from that source carries on a place page.
 * Prefer `latest/health.json` when you have it — this table is the fallback
 * for when the board is not in hand, and it can drift from the live registry.
 */
export const SOURCE_THRESHOLDS: SourceThresholds = Object.freeze({
  "cdss.telemetry": { tier: "A", nominal_cadence_s: 900, staleness_warn_s: 2700, staleness_crit_s: 10800 },
  "usgs.ogcapi.latest": { tier: "A", nominal_cadence_s: 900, staleness_warn_s: 2700, staleness_crit_s: 10800 },
  "nwps.gauges": { tier: "A", nominal_cadence_s: 3600, staleness_warn_s: 10800, staleness_crit_s: 43200 },
  "nrcs.awdb": { tier: "A", nominal_cadence_s: 3600, staleness_warn_s: 14400, staleness_crit_s: 86400 },
  "nws.alerts": { tier: "A", nominal_cadence_s: 120, staleness_warn_s: 600, staleness_crit_s: 3600 },
  "nws.observations": { tier: "A", nominal_cadence_s: 600, staleness_warn_s: 2700, staleness_crit_s: 10800 },
  "nasa.firms": { tier: "A", nominal_cadence_s: 600, staleness_warn_s: 3600, staleness_crit_s: 21600 },
  "nifc.wfigs": { tier: "A", nominal_cadence_s: 300, staleness_warn_s: 1800, staleness_crit_s: 10800 },
  "epa.airnow": { tier: "A", nominal_cadence_s: 3600, staleness_warn_s: 10800, staleness_crit_s: 43200 },
  "usgs.quakes": { tier: "A", nominal_cadence_s: 300, staleness_warn_s: 1800, staleness_crit_s: 21600 },
  "csu.coagmet": { tier: "A", nominal_cadence_s: 900, staleness_warn_s: 3600, staleness_crit_s: 21600 },
  "usdm.current": { tier: "A", nominal_cadence_s: 604800, staleness_warn_s: 777600, staleness_crit_s: 1382400 },
  "purpleair.sensors": { tier: "B", nominal_cadence_s: 3600, staleness_warn_s: 10800, staleness_crit_s: 43200 },
  "noaa.hms.smoke": { tier: "B", nominal_cadence_s: 10800, staleness_warn_s: 43200, staleness_crit_s: 172800 },
  "usgs.wbd": { tier: "static", nominal_cadence_s: 31536000, staleness_warn_s: 34560000, staleness_crit_s: 69120000 },
  "usgs.nhdplus_hr": { tier: "static", nominal_cadence_s: 31536000, staleness_warn_s: 34560000, staleness_crit_s: 69120000 },
  "epa.ecoregions": { tier: "static", nominal_cadence_s: 31536000, staleness_warn_s: 34560000, staleness_crit_s: 69120000 },
  "usgs.monitoring_locations": { tier: "static", nominal_cadence_s: 2592000, staleness_warn_s: 3888000, staleness_crit_s: 7776000 },
  "cdss.surfacewater": { tier: "static", nominal_cadence_s: 2592000, staleness_warn_s: 3888000, staleness_crit_s: 7776000 },
  "nws.stations": { tier: "static", nominal_cadence_s: 2592000, staleness_warn_s: 3888000, staleness_crit_s: 7776000 },
  "co.damsafety": { tier: "static", nominal_cadence_s: 7776000, staleness_warn_s: 10368000, staleness_crit_s: 31536000 },
  "derived.fill": { tier: "static", nominal_cadence_s: 300, staleness_warn_s: 10800, staleness_crit_s: 86400 },
} satisfies Record<string, SourceThreshold>);

/**
 * The twin's verdict function (survey §2.4, `build.py:810-820`), minus the
 * `failing` branch, which needs `last_error` and lives on the health board.
 */
export function sourceStatusFromThresholds(
  sourceId: string,
  stalenessS: number | null | undefined,
  thresholds: SourceThresholds = SOURCE_THRESHOLDS,
): Health {
  const t = thresholds[sourceId];
  if (!t || stalenessS === null || stalenessS === undefined) return "unknown";
  if (stalenessS > t.staleness_crit_s) return "critical";
  if (stalenessS > t.staleness_warn_s) return "warning";
  return "ok";
}

/** A health board or a `conditions.sources` map — either answers "is the feed up?". */
export type HealthLookup = HealthBoard | Record<string, SourceHealth>;

/** The source verdict from `latest/health.json` or `conditions.sources`; `unknown` when the source is not listed. */
export function sourceStatusFromHealth(sourceId: string, health: HealthLookup): Health {
  if ("sources" in health && Array.isArray(health.sources)) {
    return health.sources.find((s) => s.source_id === sourceId)?.health ?? "unknown";
  }
  return (health as Record<string, SourceHealth>)[sourceId]?.health ?? "unknown";
}

/**
 * A reading with the five honesty fields every boundary must carry
 * (`time, unit, source_id, stale, staleness_s`) plus `source_status`
 * (ADR-E11). `staleness_unknown` says the verdict is not a verdict; `fresh`
 * is the only field safe to gate "draw as current" on.
 */
export type HonestReading = Reading & {
  time: string | null;
  unit: string | null;
  source_id: string;
  stale: boolean;
  staleness_s: number | null;
  source_status: Health;
  /** True when neither dialect was present — never draw as fresh. */
  staleness_unknown: boolean;
  /** `!stale && !staleness_unknown`. */
  fresh: boolean;
};

/**
 * Resolve a reading from either dialect into the honesty fields.
 *
 * `source_status` comes from the health board (or `conditions.sources`) when
 * one is supplied, else from the thresholds table against this reading's own
 * age — a per-reading proxy for the feed's verdict, marked as such.
 */
export function withStaleness(
  reading: Reading,
  now: number = Date.now(),
  sourceThresholds: SourceThresholds = SOURCE_THRESHOLDS,
  health?: HealthLookup | null,
): HonestReading {
  const s = readingStaleness(reading, now);
  const source_status = health
    ? sourceStatusFromHealth(reading.source_id, health)
    : sourceStatusFromThresholds(reading.source_id, s.seconds, sourceThresholds);
  return {
    ...reading,
    time: reading.time ?? null,
    unit: reading.unit ?? null,
    source_id: reading.source_id,
    stale: s.stale,
    staleness_s: s.seconds === null ? null : Math.round(s.seconds),
    source_status,
    staleness_unknown: s.unknown,
    fresh: !s.stale && !s.unknown,
  };
}

/** Convenience: resolve every reading on a conditions station or a place page. */
export function readingsWithStaleness(
  readings: Reading[],
  now: number = Date.now(),
  sourceThresholds: SourceThresholds = SOURCE_THRESHOLDS,
  health?: HealthLookup | null,
): HonestReading[] {
  return readings.map((r) => withStaleness(r, now, sourceThresholds, health));
}

/** `conditions.sources` is itself a `HealthLookup`. */
export function healthFromConditions(conditions: Conditions): HealthLookup {
  return conditions.sources;
}
