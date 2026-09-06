/**
 * From the twin's published tree to `@kami/needs` inputs.
 *
 * Every reading crosses this boundary as a `NeedInput` carrying
 * `time, unit, source_id, stale, staleness_s, source_status` (ADR-E11);
 * `withStaleness` from `@kami/twin-client` resolves both staleness dialects
 * and the source verdict from `conditions.sources`. Absent means unknown:
 * a need with no reading resolves to `null`, never to zero.
 *
 * Aggregations (architecture §3 rule 6):
 *   single           the first place's reading
 *   mean|median|min|max   over the places' fresh readings (stale ones are
 *                    excluded unless every reading is stale, in which case the
 *                    aggregate is itself stale)
 *   mean_24h         the place page's 7-day series windowed to the 24 h
 *                    ending at the latest reading's time (the EPA band basis)
 *   max_intersecting drought: max `dm` of `latest/drought.geojson` polygons
 *                    whose bbox intersects a watershed bbox — see `geo.ts`
 *                    for why this is an approximation
 */
import {
  SOURCE_THRESHOLDS,
  TwinUnreachable,
  withStaleness,
  type Conditions,
  type HonestReading,
  type LiveCollection,
  type LiveLayer,
  type LivePropsByLayer,
  type PlacePage,
  type Series,
  type TwinClient,
} from "@kami/twin-client";
import type { Binding, BindingNeed } from "@kami/binding";
import type { DroughtClass, FloodCategory, LiveInputs, NeedInput, NwsAlert, NwsSeverity, SeriesSummary, Trend } from "@kami/needs";
import { bboxFrom, bboxOfGeometry, overlapsAny, type BBox } from "./geo";

const DAY_S = 24 * 3600;
const WEEK_S = 7 * DAY_S;

/**
 * Memoises the tree reads one job run needs, on top of the client's own
 * ETag cache, and turns `TwinUnreachable` into "the last cached body or
 * null" so one dead artifact degrades one need, not the whole run.
 */
export class TreeReader {
  private readonly pages = new Map<string, Promise<PlacePage | null>>();
  private conditionsP: Promise<Conditions | null> | null = null;
  private readonly layers = new Map<string, Promise<LiveCollection<Record<string, unknown>> | null>>();
  readonly unreachable: string[] = [];

  constructor(
    readonly twin: TwinClient,
    readonly nowMs: number,
  ) {}

  private async guard<T>(path: string, p: Promise<{ data: T } | null>): Promise<T | null> {
    try {
      const r = await p;
      return r ? r.data : null;
    } catch (err) {
      if (err instanceof TwinUnreachable) {
        this.unreachable.push(path);
        return (err.cached as T | null) ?? null;
      }
      throw err;
    }
  }

  conditions(): Promise<Conditions | null> {
    if (!this.conditionsP) this.conditionsP = this.guard("latest/conditions.json", this.twin.conditions());
    return this.conditionsP;
  }

  page(id: string): Promise<PlacePage | null> {
    let p = this.pages.get(id);
    if (!p) {
      p = this.guard(`latest/${id}.json`, this.twin.placePage(id));
      this.pages.set(id, p);
    }
    return p;
  }

  live<L extends LiveLayer>(layer: L): Promise<LiveCollection<LivePropsByLayer[L]> | null> {
    let p = this.layers.get(layer);
    if (!p) {
      p = this.guard(`latest/${layer}.geojson`, this.twin.live(layer)) as Promise<LiveCollection<Record<string, unknown>> | null>;
      this.layers.set(layer, p);
    }
    return p as Promise<LiveCollection<LivePropsByLayer[L]> | null>;
  }

  async snowlineM(): Promise<number | null> {
    const snow = await this.guard("latest/snow.json", this.twin.snow());
    return typeof snow?.snowline_m === "number" ? snow.snowline_m : null;
  }

  /** The bbox of a published place/watershed page (never its geometry). */
  async bboxOf(id: string): Promise<BBox | null> {
    const page = await this.page(id);
    return bboxFrom(page?.bbox ?? null);
  }
}

// ---------------------------------------------------------------------------
// single readings
// ---------------------------------------------------------------------------

export type ResolvedReading = { reading: HonestReading; from: "conditions" | "page" };

/** conditions.json first (it carries the verdict), the place page as fallback. */
export async function readingFor(reader: TreeReader, placeId: string, property: string): Promise<ResolvedReading | null> {
  const conditions = await reader.conditions();
  const health = conditions?.sources ?? null;
  const station = conditions?.stations.find((s) => s.id === placeId);
  const fromStation = station?.readings.find((r) => r.property === property);
  if (fromStation) return { reading: withStaleness(fromStation, reader.nowMs, SOURCE_THRESHOLDS, health), from: "conditions" };
  const page = await reader.page(placeId);
  const fromPage = page?.readings.find((r) => r.property === property);
  if (fromPage) return { reading: withStaleness(fromPage, reader.nowMs, SOURCE_THRESHOLDS, health), from: "page" };
  return null;
}

export function toNeedInput(h: HonestReading, series_summary: SeriesSummary | null = null): NeedInput {
  const value = typeof h.value === "number" && Number.isFinite(h.value) ? h.value : null;
  return {
    value,
    unit: h.unit,
    time: h.time,
    source_id: h.source_id,
    stale: h.stale,
    staleness_s: h.staleness_s,
    source_status: h.source_status,
    context: null,
    series_summary,
  };
}

// ---------------------------------------------------------------------------
// series
// ---------------------------------------------------------------------------

export function seriesFor(page: PlacePage | null, property: string): Series | null {
  if (!page) return null;
  for (const s of Object.values(page.series ?? {})) if (s.property === property) return s;
  return null;
}

export function windowValues(series: Series, endMs: number, windowS: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < series.t.length; i++) {
    const t = Date.parse(series.t[i] ?? "");
    const v = series.v[i];
    if (!Number.isFinite(t) || t > endMs || t < endMs - windowS * 1000) continue;
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function meanOf(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** rising/falling when the last quarter's mean differs from the first quarter's by > 5 % (or > 0 from zero). */
export function trendOf(values: number[]): Trend | null {
  if (values.length < 4) return null;
  const q = Math.max(1, Math.floor(values.length / 4));
  const first = meanOf(values.slice(0, q))!;
  const last = meanOf(values.slice(-q))!;
  const base = Math.max(Math.abs(first), 1e-9);
  const rel = (last - first) / base;
  if (first === 0 && last === 0) return "flat";
  if (rel > 0.05) return "rising";
  if (rel < -0.05) return "falling";
  return "flat";
}

export function summarizeSeries(series: Series | null, endMs: number, windowS = WEEK_S): SeriesSummary | null {
  if (!series) return null;
  const vals = windowValues(series, endMs, windowS);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), last: vals[vals.length - 1]!, trend: trendOf(vals), n: vals.length };
}

// ---------------------------------------------------------------------------
// per-need resolution
// ---------------------------------------------------------------------------

async function singleReading(reader: TreeReader, placeId: string, property: string): Promise<NeedInput | null> {
  const hit = await readingFor(reader, placeId, property);
  if (!hit) return null;
  const page = await reader.page(placeId);
  const end = hit.reading.time ? Date.parse(hit.reading.time) : reader.nowMs;
  return toNeedInput(hit.reading, summarizeSeries(seriesFor(page, property), Number.isFinite(end) ? end : reader.nowMs));
}

async function mean24h(reader: TreeReader, placeId: string, property: string): Promise<NeedInput | null> {
  const base = await singleReading(reader, placeId, property);
  if (!base) return null;
  const page = await reader.page(placeId);
  const series = seriesFor(page, property);
  if (!series) return base; // no series published: the latest value stands in, labelled as such by its time
  const end = base.time ? Date.parse(base.time) : reader.nowMs;
  const vals = windowValues(series, Number.isFinite(end) ? end : reader.nowMs, DAY_S);
  const mean = meanOf(vals);
  if (mean === null) return base;
  return { ...base, value: Math.round(mean * 100) / 100 };
}

async function multiReading(reader: TreeReader, places: string[], property: string, agg: "mean" | "median" | "min" | "max"): Promise<NeedInput | null> {
  const hits = (await Promise.all(places.map((p) => readingFor(reader, p, property)))).filter((h): h is ResolvedReading => h !== null);
  const withValue = hits.filter((h) => typeof h.reading.value === "number" && Number.isFinite(h.reading.value));
  if (!withValue.length) return hits[0] ? toNeedInput(hits[0].reading) : null;
  const fresh = withValue.filter((h) => !h.reading.stale);
  const pool = fresh.length ? fresh : withValue;
  const values = pool.map((h) => h.reading.value as number);
  const v = agg === "mean" ? meanOf(values) : agg === "median" ? medianOf(values) : agg === "min" ? Math.min(...values) : Math.max(...values);
  const newest = [...pool].sort((a, b) => Date.parse(b.reading.time ?? "") - Date.parse(a.reading.time ?? ""))[0]!.reading;
  const worstStatus = pool.map((h) => h.reading.source_status).reduce((acc, s) => (rank(s) > rank(acc) ? s : acc), "ok" as HonestReading["source_status"]);
  return {
    value: v === null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000,
    unit: newest.unit,
    time: newest.time,
    source_id: newest.source_id,
    stale: fresh.length === 0,
    staleness_s: Math.max(...pool.map((h) => h.reading.staleness_s ?? 0)),
    source_status: worstStatus,
    context: null,
    series_summary: null,
  };
}

function rank(s: HonestReading["source_status"]): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : s === "unknown" ? 1 : 0;
}

export type DroughtResult = { dm: DroughtClass | null; input: NeedInput | null; n_intersecting: number };

export function isDroughtClass(v: unknown): v is DroughtClass {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4;
}

/** `max_intersecting` over the watersheds' bboxes (approximation documented in geo.ts). */
export async function droughtOver(reader: TreeReader, watershedBoxes: readonly BBox[]): Promise<DroughtResult> {
  const layer = await reader.live("drought");
  if (!layer) return { dm: null, input: null, n_intersecting: 0 };
  let best: { dm: DroughtClass; time: string | null } | null = null;
  let n = 0;
  for (const f of layer.features) {
    if (!overlapsAny(bboxOfGeometry(f.geometry), watershedBoxes)) continue;
    n++;
    const dm = f.properties.dm;
    if (!isDroughtClass(dm)) continue;
    if (!best || dm > best.dm) best = { dm, time: f.properties.period_start ?? f.properties.phenomenon_time ?? null };
  }
  const ref = layer.features[0];
  const time = best?.time ?? ref?.properties.period_start ?? ref?.properties.phenomenon_time ?? layer.generated_at;
  const t = SOURCE_THRESHOLDS["usdm.current"]!;
  const ageS = Number.isFinite(Date.parse(time)) ? Math.max(0, Math.round((reader.nowMs - Date.parse(time)) / 1000)) : null;
  const conditions = await reader.conditions();
  const boardStatus = conditions?.sources["usdm.current"]?.health;
  const input: NeedInput = {
    value: best ? best.dm : null,
    unit: "USDM class",
    time,
    source_id: "usdm.current",
    stale: ageS === null ? false : ageS > t.staleness_crit_s,
    staleness_s: ageS,
    source_status: boardStatus ?? (ageS === null ? "unknown" : ageS > t.staleness_crit_s ? "critical" : ageS > t.staleness_warn_s ? "warning" : "ok"),
    context: null,
    series_summary: null,
  };
  return { dm: best?.dm ?? null, input, n_intersecting: n };
}

export async function resolveNeedInput(reader: TreeReader, need: BindingNeed, watershedBoxes: readonly BBox[]): Promise<NeedInput | null> {
  const first = need.places[0];
  switch (need.agg) {
    case "max_intersecting":
      return (await droughtOver(reader, watershedBoxes)).input;
    case "mean_24h":
      return first ? mean24h(reader, first, need.property) : null;
    case "mean":
    case "median":
    case "min":
    case "max":
      return need.places.length ? multiReading(reader, need.places, need.property, need.agg) : null;
    case "single":
    default:
      return first ? singleReading(reader, first, need.property) : null;
  }
}

// ---------------------------------------------------------------------------
// live layers
// ---------------------------------------------------------------------------

const SEVERITIES: NwsSeverity[] = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"];
const FLOOD: FloodCategory[] = ["none", "action", "minor", "moderate", "major"];

export async function watershedBoxes(reader: TreeReader, binding: Binding): Promise<BBox[]> {
  const boxes = await Promise.all(binding.watersheds.map((w) => reader.bboxOf(w)));
  return boxes.filter((b): b is BBox => b !== null);
}

/**
 * NWS alerts intersecting the entity: by bbox when the alert has geometry,
 * by UGC zone when it does not (zone-only alerts ship `geometry: null`,
 * survey §4.4). The entity's zones come from `config.entity_ugc.<slug>`
 * until the twin publishes `id/ugc.json` (TW-9, *verify*). Expired alerts
 * are dropped.
 */
export async function alertsFor(reader: TreeReader, boxes: readonly BBox[], ugcZones: readonly string[]): Promise<NwsAlert[]> {
  const layer = await reader.live("alerts");
  if (!layer) return [];
  const zones = new Set(ugcZones.map((z) => z.toUpperCase()));
  const out: NwsAlert[] = [];
  for (const f of layer.features) {
    const p = f.properties;
    const exp = p.expires_at ? Date.parse(p.expires_at) : NaN;
    if (Number.isFinite(exp) && exp < reader.nowMs) continue;
    let hit = false;
    if (f.geometry) hit = overlapsAny(bboxOfGeometry(f.geometry), boxes);
    else if (Array.isArray(p.ugc)) hit = p.ugc.some((z) => zones.has(String(z).toUpperCase()));
    if (!hit) continue;
    const sev = SEVERITIES.includes(p.severity as NwsSeverity) ? (p.severity as NwsSeverity) : "Unknown";
    out.push({ severity: sev, event: p.event, id: p.id });
  }
  return out;
}

export async function floodCategoryFor(reader: TreeReader, anchor: string): Promise<FloodCategory | null> {
  const page = await reader.page(anchor);
  const raw = page?.props?.["flood_category"];
  return typeof raw === "string" && FLOOD.includes(raw as FloodCategory) ? (raw as FloodCategory) : null;
}

export async function firesInside(reader: TreeReader, boxes: readonly BBox[]): Promise<number | null> {
  const layer = await reader.live("fires");
  if (!layer) return null;
  return layer.features.filter((f) => overlapsAny(bboxOfGeometry(f.geometry), boxes)).length;
}

export type LiveGathered = LiveInputs & { watershed_boxes: number; drought_intersecting: number };

export async function gatherLive(
  reader: TreeReader,
  binding: Binding,
  opts: { ugcZones: readonly string[]; bountyCompletedIn24h: boolean },
): Promise<LiveGathered> {
  const boxes = await watershedBoxes(reader, binding);
  const [drought, alerts, flood, fires] = await Promise.all([
    droughtOver(reader, boxes),
    alertsFor(reader, boxes, opts.ugcZones),
    floodCategoryFor(reader, binding.anchor),
    firesInside(reader, boxes),
  ]);
  return {
    drought_class: drought.dm,
    alerts,
    flood_category: flood,
    fires_inside: fires,
    bounty_completed_in_24h: opts.bountyCompletedIn24h,
    watershed_boxes: boxes.length,
    drought_intersecting: drought.n_intersecting,
  };
}
