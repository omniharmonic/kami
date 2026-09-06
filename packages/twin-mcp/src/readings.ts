/**
 * One reading, made honest for output: the five honesty fields
 * (`time, unit, source_id, stale, staleness_s` + `source_status`), a label,
 * and `forecast: true` on anything modelled. Absent stays absent.
 */

import { explainRaw } from "./explanations.js";
import { readingStalenessWithFallback, sourceStatus, thresholdsFor, type SourceStatus } from "./staleness.js";
import type { Conditions, HealthBoard, Reading, Series, SourceHealth } from "./types.js";

export interface OutReading {
  property: string;
  label: string;
  value: number | null;
  value_text?: string;
  unit: string | null;
  time: string | null;
  result_time?: string;
  quality?: string;
  source_id: string;
  stale: boolean;
  staleness_s: number | null;
  /** True when we could not judge staleness at all (no threshold, no flag). */
  staleness_unknown?: true;
  source_status: SourceStatus;
  forecast?: true;
  derived?: true;
  basis?: string[];
  /** The proposed baseline block, passed through when the tree ever ships it. */
  context?: Record<string, unknown>;
}

/** Health verdict per source from `conditions.sources` and/or `health.json`. */
export class SourceStatusIndex {
  private readonly map = new Map<string, SourceStatus>();
  constructor(conditions?: Pick<Conditions, "sources"> | null, board?: HealthBoard | null) {
    if (board) for (const s of board.sources) this.map.set(s.source_id, s.health);
    if (conditions) for (const [id, s] of Object.entries(conditions.sources)) this.map.set(id, s.health);
  }
  status(source_id: string, fallbackStaleness?: number | null): SourceStatus {
    const known = this.map.get(source_id);
    if (known) return known;
    const t = thresholdsFor(source_id);
    if (t && fallbackStaleness !== undefined) return sourceStatus(fallbackStaleness, t.warn_s, t.crit_s);
    return "unknown";
  }
  has(source_id: string): boolean {
    return this.map.has(source_id);
  }
  entries(): Record<string, SourceStatus> {
    return Object.fromEntries(this.map);
  }
  static fromSources(sources: Record<string, SourceHealth>): SourceStatusIndex {
    return new SourceStatusIndex({ sources });
  }
}

export function labelFor(property: string): string {
  const e = explainRaw(property);
  if (property === "flow_forecast" || property === "stage_forecast") {
    return /forecast/i.test(e.label) ? e.label : `${e.label} (forecast)`;
  }
  return e.label;
}

export function normalizeReading(r: Reading, now: number, sources: SourceStatusIndex): OutReading {
  const st = readingStalenessWithFallback(r, now);
  const staleness_s = st.seconds === null ? null : Math.round(st.seconds);
  const out: OutReading = {
    property: r.property,
    label: labelFor(r.property),
    value: typeof r.value === "number" ? r.value : null,
    unit: r.unit ?? null,
    time: r.time ?? null,
    source_id: r.source_id,
    stale: st.stale,
    staleness_s,
    source_status: sources.status(r.source_id, staleness_s),
  };
  if (st.unknown) out.staleness_unknown = true;
  if (r.value_text) out.value_text = r.value_text;
  if (r.result_time) out.result_time = r.result_time;
  if (r.quality) out.quality = r.quality;
  if (r.property.endsWith("_forecast")) out.forecast = true;
  if (r.derived) out.derived = true;
  if (r.basis) out.basis = r.basis;
  if (r.context && typeof r.context === "object") out.context = r.context;
  return out;
}

export interface SeriesSummary {
  property: string;
  unit: string | null;
  source_id: string;
  n: number;
  min: number | null;
  max: number | null;
  last: number | null;
  first: number | null;
  /** Sign of last − first, thresholded at 2 % of the range: rising | falling | flat. */
  trend: "rising" | "falling" | "flat" | null;
  start: string | null;
  end: string | null;
}

export function summarizeSeries(s: Series): SeriesSummary {
  const pts: { t: string; v: number }[] = [];
  for (let i = 0; i < s.t.length; i++) {
    const v = s.v[i];
    if (typeof v === "number" && Number.isFinite(v)) pts.push({ t: s.t[i]!, v });
  }
  const out: SeriesSummary = {
    property: s.property,
    unit: s.unit ?? null,
    source_id: s.source_id,
    n: pts.length,
    min: null,
    max: null,
    last: null,
    first: null,
    trend: null,
    start: pts[0]?.t ?? null,
    end: pts[pts.length - 1]?.t ?? null,
  };
  if (pts.length === 0) return out;
  let min = Infinity, max = -Infinity;
  for (const p of pts) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  out.min = min;
  out.max = max;
  out.first = pts[0]!.v;
  out.last = pts[pts.length - 1]!.v;
  if (pts.length >= 2) {
    const range = max - min;
    const delta = out.last - out.first;
    const eps = Math.max(range * 0.02, Number.EPSILON);
    out.trend = delta > eps ? "rising" : delta < -eps ? "falling" : "flat";
  } else {
    out.trend = "flat";
  }
  return out;
}

/** Series restricted to points within `windowS` seconds before `end`. */
export function windowSeries(s: Series, end: number, windowS: number): Series {
  const t: string[] = [], v: (number | null)[] = [];
  for (let i = 0; i < s.t.length; i++) {
    const ms = Date.parse(s.t[i]!);
    if (!Number.isNaN(ms) && ms <= end && ms >= end - windowS * 1000) {
      t.push(s.t[i]!);
      v.push(s.v[i] ?? null);
    }
  }
  return { ...s, t, v };
}

export function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Keys that could carry a location inside a props bag; never re-emitted. */
const LOCATOR_KEYS = new Set(["point", "geometry", "coordinates", "location", "coagmet_location", "latitude", "longitude", "lat", "lon", "utm_x", "utm_y"]);

function isCoordinatePair(v: unknown): boolean {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");
}

/** A props bag with anything location-shaped removed (mirrors the twin's gate). */
export function safeProps(props: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (LOCATOR_KEYS.has(k) || k.startsWith("precise_") || isCoordinatePair(v)) continue;
    out[k] = v;
  }
  return out;
}
