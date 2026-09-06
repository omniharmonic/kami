/**
 * `computeSnapshot` — readings + live layers + platform facts → HealthSnapshot.
 * Pure: no clock (takes `now`), no network, no randomness.
 *
 * Also: `snapshotHash` (the pulse precheck's "changed" key) and
 * `classifyDeltas` (what changed between two snapshots, and whether it is
 * worth waking the model for).
 */

import { createHash } from "node:crypto";
import { bandFor, isDroughtClass } from "./bands.js";
import { alertLevel, computeMood, latestSnapshot, type MoodContext } from "./mood.js";
import { season } from "./season.js";
import type {
  ComputeOptions,
  Delta,
  DroughtClass,
  HealthSnapshot,
  LiveInputs,
  NeedInput,
  NeedName,
  NeedSnapshot,
  NeedSpec,
  Trend,
} from "./types.js";
import { specWeight } from "./types.js";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** UCUM → display unit. Unknown units pass through unchanged. */
export const DISPLAY_UNITS: Record<string, string> = {
  "[ft_i]3/s": "cfs",
  Cel: "°C",
  "[degF]": "°F",
  "[in_i]": "in",
  "[acr_us].[ft_i]": "acre-feet",
  "%": "%",
  "ug/m3": "µg/m³",
  "mg/L": "mg/L",
  m: "m",
  ft: "ft",
};

export function displayUnit(unit: string | null | undefined): string | null {
  if (unit === null || unit === undefined || unit === "") return null;
  return DISPLAY_UNITS[unit] ?? unit;
}

/** Numbers as the twin would print them: up to 2 decimals, no trailing zeros, integers bare. */
export function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/** "2026-09-04T20:15:00.000Z" → "2026-09-04 20:15Z". Non-ISO strings pass through. */
export function formatTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const ms = Date.parse(time);
  if (!Number.isFinite(ms)) return time;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`;
}

/** "place/boulder-creek-near-orodell-co" → "boulder creek near orodell co" (used only when no `place_label`). */
export function placeLabelFromId(place_id: string): string {
  const slug = place_id.includes("/") ? place_id.slice(place_id.indexOf("/") + 1) : place_id;
  return slug.replace(/-/g, " ");
}

/**
 * The guarded, templated label, e.g. "15.4 cfs at Orodell, 2026-09-04 20:15Z, stale".
 * USDM classes print as "D1". A missing reading prints "no <property> reading[ at <place>]".
 */
export function needLabel(spec: NeedSpec, reading: NeedInput | null): string {
  const place = spec.place_label ?? (spec.places[0] ? placeLabelFromId(spec.places[0]) : null);
  if (reading === null || reading.value === null) {
    const where = place ? ` at ${place}` : "";
    const when = reading ? formatTime(reading.time) : null;
    const tail = [when, reading?.stale ? "stale" : null].filter(Boolean).join(", ");
    return `no ${spec.property} reading${where}${tail ? `, ${tail}` : ""}`;
  }
  let head: string;
  if (spec.property === "dm" && isDroughtClass(reading.value)) {
    head = `D${reading.value}`;
  } else {
    const unit = displayUnit(reading.unit);
    const v = formatValue(reading.value);
    head = unit === null ? v : unit === "%" ? `${v} %` : `${v} ${unit}`;
  }
  if (place) head += ` at ${place}`;
  const parts = [head];
  const when = formatTime(reading.time);
  if (when) parts.push(when);
  if (reading.stale) parts.push("stale");
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Needs
// ---------------------------------------------------------------------------

function trendOf(reading: NeedInput | null): Trend | null {
  const t = reading?.series_summary?.trend;
  return t === "rising" || t === "falling" || t === "flat" ? t : null;
}

/** One need row. Stale → `health: null` (still shows band of the last value). Missing → everything null. */
export function buildNeed(spec: NeedSpec, reading: NeedInput | null, live: LiveInputs): NeedSnapshot {
  const place_id = spec.places[0] ?? null;
  if (reading === null) {
    return {
      need: spec.need,
      place_id,
      property: spec.property,
      value: null,
      unit: null,
      time: null,
      source_id: null,
      stale: false,
      staleness_s: null,
      source_status: "unknown",
      percentile: null,
      band: null,
      health: null,
      trend_7d: null,
      label: needLabel(spec, null),
    };
  }
  const percentile =
    typeof reading.context?.percentile === "number" && Number.isFinite(reading.context.percentile)
      ? reading.context.percentile
      : null;
  const { band, health } = bandFor(spec.property, reading.value, {
    percentile,
    flood_category: live.flood_category,
  });
  return {
    need: spec.need,
    place_id,
    property: spec.property,
    value: reading.value,
    unit: reading.unit,
    time: reading.time,
    source_id: reading.source_id,
    stale: reading.stale,
    staleness_s: reading.staleness_s,
    source_status: reading.source_status,
    percentile,
    band,
    health: reading.stale ? null : health,
    trend_7d: trendOf(reading),
    label: needLabel(spec, reading),
  };
}

function droughtClassOf(live: LiveInputs, specs: NeedSpec[], readings: Readings): DroughtClass | null {
  if (isDroughtClass(live.drought_class)) return live.drought_class;
  // Fall back to a non-stale `dm` reading when the caller passed the drought need as a reading.
  for (const spec of specs) {
    if (spec.property !== "dm") continue;
    const r = readings[spec.need];
    if (r && !r.stale && isDroughtClass(r.value)) return r.value;
  }
  return null;
}

export type Readings = Partial<Record<NeedName, NeedInput | null>>;

/** weights by need for the mood rules, from the specs */
export function weightsOf(specs: readonly NeedSpec[]): Partial<Record<NeedName, number>> {
  const w: Partial<Record<NeedName, number>> = {};
  for (const s of specs) w[s.need] = specWeight(s);
  return w;
}

// ---------------------------------------------------------------------------
// computeSnapshot
// ---------------------------------------------------------------------------

export function computeSnapshot(
  entity_id: string,
  specs: NeedSpec[],
  readings: Readings,
  live: LiveInputs,
  opts: ComputeOptions,
): HealthSnapshot {
  const needs = specs.map((spec) => buildNeed(spec, readings[spec.need] ?? null, live));

  // stale_driving: a need with weight > 0 whose reading is stale. Missing is not stale.
  const stale_driving = specs.some((spec) => specWeight(spec) > 0 && readings[spec.need]?.stale === true);

  const base: Omit<HealthSnapshot, "mood" | "mood_reason"> = {
    schema_version: "1.0",
    entity_id,
    as_of: opts.now.toISOString(),
    needs,
    drought_class: droughtClassOf(live, specs, readings),
    alert_level: alertLevel(live.alerts),
    flood_category: live.flood_category ?? null,
    stale_driving,
    season: season(opts.now, opts.snowline_m ?? null),
    gpu_online: opts.gpu_online,
    paused: opts.paused,
    cosmetics: { ...(opts.cosmetics ?? {}) },
  };

  const ctx: MoodContext = { bounty_completed_in_24h: live.bounty_completed_in_24h, weights: weightsOf(specs) };
  const { mood, reason } = computeMood(base, latestSnapshot(opts.previous_snapshots), ctx);

  return { ...base, mood, mood_reason: reason };
}

// ---------------------------------------------------------------------------
// snapshotHash — the pulse precheck's "changed" key (architecture §4, §5.2)
// ---------------------------------------------------------------------------

/**
 * sha256 over the needs' {place_id, property, value, unit, time, stale} plus
 * drought_class, alert_level, flood_category. `as_of` and `staleness_s` are
 * excluded on purpose: they change every hour whether or not the world did.
 */
export function snapshotHash(snapshot: HealthSnapshot): string {
  const canonical = {
    needs: snapshot.needs.map((n) => ({
      place_id: n.place_id,
      property: n.property,
      value: n.value,
      unit: n.unit,
      time: n.time,
      stale: n.stale,
    })),
    drought_class: snapshot.drought_class,
    alert_level: snapshot.alert_level,
    flood_category: snapshot.flood_category,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ---------------------------------------------------------------------------
// classifyDeltas
// ---------------------------------------------------------------------------

const NOTABLE: Record<Delta["kind"], boolean> = {
  band_change: true,
  alert_start: true,
  alert_end: true,
  stale_flip: true,
  mood_change: true,
  value_change: false,
};

function delta(kind: Delta["kind"], need: NeedName | null, field: string, from: unknown, to: unknown): Delta {
  return { kind, need, field, from, to, notable: NOTABLE[kind] };
}

/**
 * What changed from `prev` to `next`. Needs are matched by name; a need
 * present on one side only is ignored (a binding change is not a pulse).
 */
export function classifyDeltas(prev: HealthSnapshot, next: HealthSnapshot): Delta[] {
  const out: Delta[] = [];
  const prevByNeed = new Map(prev.needs.map((n) => [n.need, n] as const));

  for (const n of next.needs) {
    const p = prevByNeed.get(n.need);
    if (!p) continue;
    if (p.stale !== n.stale) out.push(delta("stale_flip", n.need, "stale", p.stale, n.stale));
    if (p.band !== n.band) out.push(delta("band_change", n.need, "band", p.band, n.band));
    if (p.value !== n.value) out.push(delta("value_change", n.need, "value", p.value, n.value));
  }

  if (prev.drought_class !== next.drought_class) {
    out.push(delta("band_change", "drought", "drought_class", prev.drought_class, next.drought_class));
  }
  if (prev.flood_category !== next.flood_category) {
    out.push(delta("band_change", "stage", "flood_category", prev.flood_category, next.flood_category));
  }
  if (prev.alert_level === 0 && next.alert_level > 0) {
    out.push(delta("alert_start", "alerts", "alert_level", prev.alert_level, next.alert_level));
  } else if (prev.alert_level > 0 && next.alert_level === 0) {
    out.push(delta("alert_end", "alerts", "alert_level", prev.alert_level, next.alert_level));
  }
  if (prev.mood !== next.mood) out.push(delta("mood_change", null, "mood", prev.mood, next.mood));

  return out;
}

/** True when any delta is notable — the pulse should wake the model. */
export function hasNotableDelta(deltas: readonly Delta[]): boolean {
  return deltas.some((d) => d.notable);
}
