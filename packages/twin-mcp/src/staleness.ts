/**
 * How old is a reading, and is that too old?
 *
 * `readingStaleness` is a verbatim port of the twin's canonical resolver
 * (`frontrange-twin/web/src/data/reading.ts:44-67`). The publisher speaks two
 * dialects on purpose: `latest/conditions.json` and `latest/snow.json` ship a
 * precomputed verdict (`stale`, `staleness_s`, against the build clock) because
 * they are rewritten every cycle; the ~2,000 per-place pages ship only the
 * threshold (`staleness_crit_s`) because they sit in a CDN and a baked verdict
 * would rot. Preference is threshold-then-flag, and a reading with neither is
 * `unknown` — which is not fresh and must never be drawn as fresh.
 */

import type { Health, Reading } from "./types.js";

export interface ReadingStaleness {
  /** Age of the value in seconds as of `now`; null when we cannot tell. */
  seconds: number | null;
  /** Past the source's `staleness_crit`. Never a guess. */
  stale: boolean;
  /** True when no timestamp+threshold and no flag were available. */
  unknown: boolean;
}

export function readingStaleness(
  reading: Pick<Reading, "time" | "stale" | "staleness_s" | "staleness_crit_s">,
  now: number = Date.now(),
): ReadingStaleness {
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

  return { seconds: age, stale: false, unknown: true };
}

export type SourceStatus = Health;

/**
 * `meta.v_source_health`'s CASE, as the publisher re-derives it
 * (`twin/publisher/build.py` `_health`). `failing` means the newest word from
 * the source is an error (`last_error > last_ok`).
 */
export function sourceStatus(
  staleness_s: number | null | undefined,
  warn_s: number,
  crit_s: number,
  failing = false,
): SourceStatus {
  if (staleness_s === null || staleness_s === undefined || Number.isNaN(staleness_s)) return "unknown";
  if (staleness_s > crit_s) return "critical";
  if (staleness_s > warn_s) return "warning";
  if (failing) return "warning";
  return "ok";
}

/**
 * `source_id → {warn_s, crit_s}` from `frontrange-twin/sources/sources.seed.yaml`
 * (survey §2.3). Used ONLY as a last resort, when a place-page reading carries
 * neither dialect; the tree's own thresholds always win when present.
 */
export const SOURCE_THRESHOLDS: Readonly<Record<string, { warn_s: number; crit_s: number; tier: string }>> = {
  "cdss.telemetry": { warn_s: 2700, crit_s: 10800, tier: "A" },
  "usgs.ogcapi.latest": { warn_s: 2700, crit_s: 10800, tier: "A" },
  "nwps.gauges": { warn_s: 10800, crit_s: 43200, tier: "A" },
  "nrcs.awdb": { warn_s: 14400, crit_s: 86400, tier: "A" },
  "nws.alerts": { warn_s: 600, crit_s: 3600, tier: "A" },
  "nws.observations": { warn_s: 2700, crit_s: 10800, tier: "A" },
  "nasa.firms": { warn_s: 3600, crit_s: 21600, tier: "A" },
  "nifc.wfigs": { warn_s: 1800, crit_s: 10800, tier: "A" },
  "epa.airnow": { warn_s: 10800, crit_s: 43200, tier: "A" },
  "usgs.quakes": { warn_s: 1800, crit_s: 21600, tier: "A" },
  "csu.coagmet": { warn_s: 3600, crit_s: 21600, tier: "A" },
  "usdm.current": { warn_s: 777600, crit_s: 1382400, tier: "A" },
  "purpleair.sensors": { warn_s: 10800, crit_s: 43200, tier: "B" },
  "noaa.hms.smoke": { warn_s: 43200, crit_s: 172800, tier: "B" },
  "usgs.wbd": { warn_s: 34560000, crit_s: 69120000, tier: "static" },
  "usgs.nhdplus_hr": { warn_s: 34560000, crit_s: 69120000, tier: "static" },
  "epa.ecoregions": { warn_s: 34560000, crit_s: 69120000, tier: "static" },
  "usgs.monitoring_locations": { warn_s: 3888000, crit_s: 7776000, tier: "static" },
  "cdss.surfacewater": { warn_s: 3888000, crit_s: 7776000, tier: "static" },
  "nws.stations": { warn_s: 3888000, crit_s: 7776000, tier: "static" },
  "co.damsafety": { warn_s: 10368000, crit_s: 31536000, tier: "static" },
  "derived.fill": { warn_s: 10800, crit_s: 86400, tier: "static" },
};

export function thresholdsFor(source_id: string): { warn_s: number; crit_s: number } | null {
  const t = SOURCE_THRESHOLDS[source_id];
  return t ? { warn_s: t.warn_s, crit_s: t.crit_s } : null;
}

/**
 * Staleness for a reading that lacks both dialects, using the seed table as a
 * threshold. Still `unknown` when the source is not in the table or the reading
 * has no `time`.
 */
export function readingStalenessWithFallback(reading: Reading, now: number): ReadingStaleness {
  const direct = readingStaleness(reading, now);
  if (!direct.unknown) return direct;
  const t = thresholdsFor(reading.source_id);
  if (!t || direct.seconds === null) return direct;
  return { seconds: direct.seconds, stale: direct.seconds > t.crit_s, unknown: false };
}
