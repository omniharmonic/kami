/**
 * The pulse: resolve a binding's needs against the tree, judge the live
 * layers over its watersheds, hash the members' readings, and emit a
 * facts-1.0 block the guard can consume directly.
 */

import type { Binding, BindingNeed } from "./binding.js";
import type { ToolContext } from "./context.js";
import { bandFor, explainRaw } from "./explanations.js";
import { bboxOf, centroidOf, geometriesIntersectApprox, pointInPolygon } from "./geo.js";
import { snapshotHash } from "./hash.js";
import { meanOf, medianOf, normalizeReading, summarizeSeries, windowSeries, type OutReading, type SourceStatusIndex } from "./readings.js";
import { readingStalenessWithFallback, sourceStatus, thresholdsFor, type SourceStatus } from "./staleness.js";
import * as twin from "./twin.js";
import type { Conditions, Feature, FeatureCollection, Geometry, HealthBoard, IndexEntry, PlacePage, Reading, Series, Station } from "./types.js";

export interface NeedOut {
  need: string;
  property: string;
  place_id: string | null;
  place_ids?: string[];
  agg: string;
  value: number | null;
  unit: string | null;
  time: string | null;
  stale: boolean;
  staleness_s: number | null;
  source_id: string | null;
  source_status: SourceStatus;
  week: { min: number | null; max: number | null; trend: "rising" | "falling" | "flat" | null } | null;
  percentile_por: null;
  label: string;
  forecast?: true;
  n?: number;
  note?: string;
}

export interface AlertOut {
  kind: "nws" | "drought" | "fire" | "air";
  id: string;
  headline: string;
  severity: string | null;
  until: string | null;
  place_ids: string[];
  url: string | null;
  /** How it was tied to the entity; null for a zone-only alert we could not place. */
  matched_by: "watershed" | "member" | null;
  centroid?: [number, number] | null;
}

export interface LiveOut {
  drought_max_dm: number | null;
  drought_label: string | null;
  drought_period_end: string | null;
  alerts: { id: string; event: string | null; severity: string | null; headline: string | null; until: string | null; matched_by: "watershed" | null }[];
  alerts_total: number;
  fires_inside: number;
  detections_24h: number;
  approximation: string;
}

export interface EntityStatus {
  entity_id: string;
  archetype: string;
  anchor: string;
  binding_version: number;
  frozen_at: string;
  members_n: number;
  needs: NeedOut[];
  live: LiveOut;
  sources: Record<string, { health: SourceStatus; staleness_s: number | null; last_ok: string | null }>;
  snapshot_hash: string;
  facts: FactSheet;
}

export type Atom =
  | { kind: "number"; value: number; unit: string | null; property: string | null; place_id: string | null; time: string | null; stale: boolean; staleness_s: number | null; source_id: string | null; forecast: boolean; label: string | null }
  | { kind: "time"; value: string; role: string | null; place_id: string | null; property: string | null }
  | { kind: "place"; id: string; name: string; aliases?: string[] }
  | { kind: "count"; value: number; of: string; place_id: string | null }
  | { kind: "enum"; name: string; value: string | number; place_id: string | null };

export interface FactSheet {
  schema_version: "1.0";
  as_of: string;
  tree_generated_at: string | null;
  source_tool: string | null;
  atoms: Atom[];
}

const APPROXIMATION =
  "Polygon tests are bbox overlap plus point-in-polygon of vertices and centroids (no edge clipping); zone-only NWS alerts carry no polygon and cannot be placed.";

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Loaded once per call; every need reads from here. */
export class EntityData {
  private pages = new Map<string, Promise<PlacePage | null>>();
  private geoms = new Map<string, Promise<Geometry | null>>();
  private layers = new Map<string, Promise<FeatureCollection | null>>();
  constructor(
    readonly ctx: ToolContext,
    readonly conditions: Conditions | null,
    readonly health: HealthBoard | null,
    readonly sources: SourceStatusIndex,
    readonly index: Map<string, IndexEntry>,
  ) {}

  static async load(ctx: ToolContext): Promise<EntityData> {
    const [c, h, i] = await Promise.all([twin.conditions(ctx.reader), twin.health(ctx.reader), twin.index(ctx.reader)]);
    const sources = await twin.sourceIndex(ctx.reader);
    return new EntityData(ctx, c, h, sources, i ? twin.indexById(i) : new Map());
  }

  station(id: string): Station | undefined {
    return this.conditions?.stations.find((s) => s.id === id);
  }
  page(id: string): Promise<PlacePage | null> {
    if (!this.pages.has(id)) this.pages.set(id, twin.placePage(this.ctx.reader, id));
    return this.pages.get(id)!;
  }
  geometry(id: string): Promise<Geometry | null> {
    if (!this.geoms.has(id)) this.geoms.set(id, twin.geometryOf(this.ctx.reader, id));
    return this.geoms.get(id)!;
  }
  layer(name: "alerts" | "drought" | "fires" | "detections" | "quakes"): Promise<FeatureCollection | null> {
    if (!this.layers.has(name)) this.layers.set(name, twin.layer(this.ctx.reader, name));
    return this.layers.get(name)!;
  }
  get now(): number {
    return this.ctx.now();
  }
}

/** Freshest reading of `property` at a place: conditions.json first (clock dialect), then the place page. */
export async function readingAt(d: EntityData, place_id: string, property: string): Promise<{ reading: Reading; from: "conditions" | "page" } | null> {
  const pick = (rs: Reading[]) => {
    const c = rs.filter((r) => r.property === property);
    if (!c.length) return null;
    c.sort((a, b) => Date.parse(b.time ?? "") - Date.parse(a.time ?? ""));
    return c[0]!;
  };
  const st = d.station(place_id);
  const fromC = st ? pick(st.readings) : null;
  if (fromC) return { reading: fromC, from: "conditions" };
  const page = await d.page(place_id);
  const fromP = page ? pick(page.readings) : null;
  return fromP ? { reading: fromP, from: "page" } : null;
}

/** The 7-day series for a property on a place page. `reservoir_fill` is derived
 * from the storage series ÷ `props.capacity_af`, exactly as the publisher derives
 * the reading (twin/publisher/derived.py), because the page carries no fill series. */
export function seriesFor(page: PlacePage, property: string): Series | null {
  const direct = Object.values(page.series ?? {}).find((s) => s.property === property);
  if (direct) return direct;
  if (property === "reservoir_fill") {
    const storage = Object.values(page.series ?? {}).find((s) => s.property === "reservoir_storage");
    const cap = page.props?.["capacity_af"];
    if (storage && typeof cap === "number" && cap > 0) {
      return { property: "reservoir_fill", unit: "%", source_id: "derived.fill", t: storage.t, v: storage.v.map((v) => (typeof v === "number" ? Math.round((1000 * v) / cap) / 10 : null)) };
    }
  }
  return null;
}

async function weekFor(d: EntityData, place_id: string, property: string): Promise<NeedOut["week"]> {
  const page = await d.page(place_id);
  if (!page) return null;
  const series = seriesFor(page, property);
  if (!series) return null;
  const s = summarizeSeries(series);
  return { min: s.min, max: s.max, trend: s.trend };
}

function labelWithBand(property: string, value: number | null): string {
  const key = property === "dm" ? "class:drought" : property;
  const base = explainRaw(key).label;
  const band = value === null ? null : bandFor(key, value);
  return band ? `${base}: ${band.name}` : base;
}

function baseNeed(n: BindingNeed): NeedOut {
  return {
    need: n.need,
    property: n.property,
    place_id: n.places[0] ?? null,
    agg: n.agg,
    value: null,
    unit: null,
    time: null,
    stale: false,
    staleness_s: null,
    source_id: null,
    source_status: "unknown",
    week: null,
    percentile_por: null,
    label: explainRaw(n.property === "dm" ? "class:drought" : n.property).label,
  };
}

function applyReading(out: NeedOut, r: OutReading): void {
  out.value = r.value;
  out.unit = r.unit;
  out.time = r.time;
  out.stale = r.stale;
  out.staleness_s = r.staleness_s;
  out.source_id = r.source_id;
  out.source_status = r.source_status;
  out.label = labelWithBand(out.property, r.value);
  if (r.forecast) out.forecast = true;
  if (r.staleness_unknown) out.note = "staleness unknown: reading carries neither threshold nor flag";
}

export async function resolveNeed(d: EntityData, b: Binding, n: BindingNeed): Promise<NeedOut> {
  const out = baseNeed(n);
  if (n.agg === "max_intersecting") return droughtNeed(d, b, out);

  if (n.agg === "single") {
    const hit = n.places[0] ? await readingAt(d, n.places[0], n.property) : null;
    if (!hit) {
      out.note = `no ${n.property} reading published at ${n.places[0] ?? "(no place)"}`;
      return out;
    }
    applyReading(out, normalizeReading(hit.reading, d.now, d.sources));
    out.week = await weekFor(d, n.places[0]!, n.property);
    return out;
  }

  if (n.agg === "mean_24h") {
    const place = n.places[0];
    const hit = place ? await readingAt(d, place, n.property) : null;
    if (!hit || !place) {
      out.note = `no ${n.property} reading published at ${place ?? "(no place)"}`;
      return out;
    }
    const latest = normalizeReading(hit.reading, d.now, d.sources);
    applyReading(out, latest);
    const page = await d.page(place);
    const series = page ? seriesFor(page, n.property) : null;
    const end = latest.time ? Date.parse(latest.time) : d.now;
    if (series) {
      const w = windowSeries(series, end, 24 * 3600);
      const vals = w.v.filter((v): v is number => typeof v === "number");
      const mean = meanOf(vals);
      if (mean !== null) {
        out.value = Math.round(mean * 100) / 100;
        out.n = vals.length;
        out.label = labelWithBand(n.property, out.value);
        out.note = `mean of ${vals.length} points in the 24 h ending ${latest.time}`;
      }
    } else {
      out.note = "no 7-day series published; latest value shown instead of a 24 h mean";
    }
    out.week = await weekFor(d, place, n.property);
    return out;
  }

  // mean | median | min | max over several places
  const hits = (await Promise.all(n.places.map((p) => readingAt(d, p, n.property)))).map((h, i) => ({ h, p: n.places[i]! }));
  const norm = hits.filter((x) => x.h).map((x) => ({ r: normalizeReading(x.h!.reading, d.now, d.sources), p: x.p }));
  if (!norm.length) {
    out.note = `no ${n.property} reading published at any of ${n.places.join(", ")}`;
    return out;
  }
  const fresh = norm.filter((x) => !x.r.stale && x.r.value !== null);
  const pool = fresh.length ? fresh : norm.filter((x) => x.r.value !== null);
  const values = pool.map((x) => x.r.value as number);
  const agg = n.agg === "mean" ? meanOf(values) : n.agg === "median" ? medianOf(values) : n.agg === "min" ? Math.min(...values) : Math.max(...values);
  const newest = [...norm].sort((a, b) => Date.parse(b.r.time ?? "") - Date.parse(a.r.time ?? ""))[0]!.r;
  out.place_id = null;
  out.place_ids = pool.map((x) => x.p);
  out.value = agg === null || !Number.isFinite(agg) ? null : Math.round(agg * 1000) / 1000;
  out.unit = newest.unit;
  out.time = newest.time;
  out.stale = fresh.length === 0;
  out.staleness_s = Math.max(...norm.map((x) => x.r.staleness_s ?? 0));
  out.source_id = newest.source_id;
  out.source_status = newest.source_status;
  out.n = pool.length;
  out.label = labelWithBand(n.property, out.value);
  if (fresh.length < norm.length) out.note = `${norm.length - fresh.length} of ${norm.length} readings stale and excluded from the aggregate`;
  return out;
}

export async function droughtOver(d: EntityData, watersheds: string[]): Promise<{ dm: number | null; feature: Feature | null; n_intersecting: number; polygons: Geometry[] }> {
  const layer = await d.layer("drought");
  const polygons = (await Promise.all(watersheds.map((w) => d.geometry(w)))).filter((g): g is Geometry => !!g);
  if (!layer) return { dm: null, feature: null, n_intersecting: 0, polygons };
  let best: Feature | null = null;
  let n = 0;
  for (const f of layer.features) {
    if (!polygons.some((p) => geometriesIntersectApprox(f.geometry, p))) continue;
    n++;
    const dm = Number(f.properties["dm"]);
    if (!Number.isFinite(dm)) continue;
    if (!best || dm > Number(best.properties["dm"])) best = f;
  }
  return { dm: best ? Number(best.properties["dm"]) : null, feature: best, n_intersecting: n, polygons };
}

async function droughtNeed(d: EntityData, b: Binding, out: NeedOut): Promise<NeedOut> {
  const { dm, feature, polygons } = await droughtOver(d, b.watersheds);
  const layer = await d.layer("drought");
  out.place_id = null;
  out.place_ids = b.watersheds;
  out.source_id = "usdm.current";
  out.unit = null;
  out.source_status = d.sources.status("usdm.current");
  if (!layer) {
    out.note = "latest/drought.geojson is not published";
    return out;
  }
  if (!polygons.length) {
    out.note = "no watershed geometry published to intersect";
    return out;
  }
  const t = thresholdsFor("usdm.current")!;
  const ref = feature ?? layer.features[0] ?? null;
  const time = (ref?.properties["period_start"] as string | undefined) ?? (ref?.properties["phenomenon_time"] as string | undefined) ?? layer.generated_at;
  const age = Math.max(0, Math.round((d.now - Date.parse(time)) / 1000));
  out.time = time;
  out.staleness_s = age;
  out.stale = age > t.crit_s;
  if (!d.sources.has("usdm.current")) out.source_status = sourceStatus(age, t.warn_s, t.crit_s);
  out.value = dm;
  out.label = dm === null ? "Drought class: none" : labelWithBand("dm", dm);
  if (dm === null) out.note = "no Drought Monitor polygon intersects the watersheds this week";
  out.week = null;
  return out;
}

export async function liveFor(d: EntityData, b: Binding): Promise<LiveOut> {
  const { dm, feature, polygons } = await droughtOver(d, b.watersheds);
  const [alerts, fires, detections] = await Promise.all([d.layer("alerts"), d.layer("fires"), d.layer("detections")]);
  const inside = (g: Geometry | null): boolean => {
    if (!g) return false;
    if (g.type === "Point") return polygons.some((p) => pointInPolygon(g.coordinates[0]!, g.coordinates[1]!, p));
    return polygons.some((p) => geometriesIntersectApprox(g, p));
  };
  const alertsOut: LiveOut["alerts"] = [];
  for (const f of alerts?.features ?? []) {
    const matched: "watershed" | null = f.geometry ? (inside(f.geometry) ? "watershed" : null) : null;
    if (f.geometry && !matched) continue; // has a polygon and it is elsewhere
    alertsOut.push({
      id: String(f.properties["id"]),
      event: (f.properties["event"] as string) ?? null,
      severity: (f.properties["severity"] as string) ?? null,
      headline: truncate((f.properties["headline"] as string) ?? null, 120),
      until: (f.properties["expires_at"] as string) ?? null,
      matched_by: matched,
    });
  }
  return {
    drought_max_dm: dm,
    drought_label: dm === null ? null : (feature?.properties["label"] as string) ?? `D${dm}`,
    drought_period_end: (feature?.properties["period_end"] as string) ?? null,
    alerts: alertsOut.slice(0, 10),
    alerts_total: alertsOut.length,
    fires_inside: (fires?.features ?? []).filter((f) => inside(f.geometry)).length,
    detections_24h: (detections?.features ?? []).filter((f) => inside(f.geometry)).length,
    approximation: APPROXIMATION,
  };
}

export function truncate(s: string | null, n: number): string | null {
  if (s === null || s === undefined) return null;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export async function membersHash(d: EntityData, b: Binding): Promise<string> {
  const rows: { id: string; readings: Reading[] }[] = [];
  for (const m of [...b.members].sort((a, c) => a.id.localeCompare(c.id))) {
    const st = d.station(m.id);
    if (st) rows.push({ id: st.id, readings: st.readings });
    else {
      const page = await d.page(m.id);
      if (page) rows.push({ id: m.id, readings: page.readings });
    }
  }
  return snapshotHash(rows);
}

function sourcesFor(d: EntityData, needs: NeedOut[]): EntityStatus["sources"] {
  const ids = new Set<string>(["nws.alerts", "usdm.current"]);
  for (const n of needs) if (n.source_id) ids.add(n.source_id);
  const out: EntityStatus["sources"] = {};
  for (const id of [...ids].sort()) {
    const fromBoard = d.health?.sources.find((s) => s.source_id === id);
    const fromCond = d.conditions?.sources[id];
    out[id] = {
      health: fromBoard?.health ?? fromCond?.health ?? d.sources.status(id),
      staleness_s: fromBoard?.staleness_s ?? fromCond?.staleness_s ?? null,
      last_ok: fromBoard?.last_ok ?? fromCond?.last_ok ?? null,
    };
  }
  return out;
}

export function factsFor(d: EntityData, b: Binding, needs: NeedOut[], live: LiveOut, as_of: string, tree_generated_at: string | null): FactSheet {
  const atoms: Atom[] = [];
  atoms.push({ kind: "time", value: as_of, role: "as_of", place_id: null, property: null });
  for (const m of b.members) {
    const name = d.index.get(m.id)?.name ?? d.station(m.id)?.name;
    if (name) atoms.push({ kind: "place", id: m.id, name: name.trim() });
  }
  for (const w of b.watersheds) {
    const name = d.index.get(w)?.name;
    if (name) atoms.push({ kind: "place", id: w, name });
  }
  for (const n of needs) {
    if (n.value !== null) {
      atoms.push({
        kind: "number",
        value: n.value,
        unit: n.unit,
        property: n.property,
        place_id: n.place_id,
        time: n.time,
        stale: n.stale,
        staleness_s: n.staleness_s,
        source_id: n.source_id,
        forecast: n.forecast === true,
        label: n.label,
      });
    }
    if (n.time) atoms.push({ kind: "time", value: n.time, role: "reading_time", place_id: n.place_id, property: n.property });
    if (n.week) {
      for (const [k, v] of [["min", n.week.min], ["max", n.week.max]] as const)
        if (v !== null) atoms.push({ kind: "number", value: v, unit: n.unit, property: n.property, place_id: n.place_id, time: null, stale: n.stale, staleness_s: null, source_id: n.source_id, forecast: false, label: `7-day ${k} of ${n.label}` });
    }
    // Ages in seconds and feed verdicts are words in prose, not numbers the guard
    // matches; they stay on needs[] and out of the atoms to keep the pulse small.
  }
  if (live.drought_max_dm !== null) atoms.push({ kind: "enum", name: "drought_class", value: live.drought_label ?? `D${live.drought_max_dm}`, place_id: null });
  if (live.drought_period_end) atoms.push({ kind: "time", value: live.drought_period_end, role: "period_end", place_id: null, property: "dm" });
  atoms.push({ kind: "count", value: live.alerts_total, of: "alerts", place_id: null });
  atoms.push({ kind: "count", value: live.fires_inside, of: "fires_inside", place_id: null });
  atoms.push({ kind: "count", value: live.detections_24h, of: "detections_24h", place_id: null });
  atoms.push({ kind: "count", value: b.members.length, of: "members", place_id: null });
  atoms.push({ kind: "count", value: needs.length, of: "needs", place_id: null });
  for (const a of live.alerts) if (a.until) atoms.push({ kind: "time", value: a.until, role: "valid_until", place_id: null, property: null });
  return { schema_version: "1.0", as_of, tree_generated_at, source_tool: "get_entity_status", atoms };
}

export async function entityStatus(ctx: ToolContext, b: Binding): Promise<EntityStatus> {
  const d = await EntityData.load(ctx);
  const needs: NeedOut[] = [];
  for (const n of b.needs) needs.push(await resolveNeed(d, b, n));
  const live = await liveFor(d, b);
  const as_of = iso(ctx.now());
  const tree_generated_at = d.conditions?.generated_at ?? null;
  return {
    entity_id: b.entity_id,
    archetype: b.archetype,
    anchor: b.anchor,
    binding_version: b.binding_version,
    frozen_at: b.frozen_at,
    members_n: b.members.length,
    needs,
    live,
    sources: sourcesFor(d, needs),
    snapshot_hash: await membersHash(d, b),
    facts: factsFor(d, b, needs, live, as_of, tree_generated_at),
  };
}

/** `get_alerts`: everything alert-shaped that touches the binding. */
export async function alertsFor(ctx: ToolContext, b: Binding): Promise<AlertOut[]> {
  const d = await EntityData.load(ctx);
  const live = await liveFor(d, b);
  const out: AlertOut[] = [];
  const alerts = await d.layer("alerts");
  for (const a of live.alerts) {
    const f = alerts?.features.find((x) => String(x.properties["id"]) === a.id);
    out.push({
      kind: "nws",
      id: a.id,
      headline: a.headline ?? a.event ?? "NWS alert",
      severity: a.severity,
      until: a.until,
      place_ids: a.matched_by ? b.watersheds : [],
      url: (f?.properties["url"] as string) ?? null,
      matched_by: a.matched_by,
      centroid: f ? centroidOf(f.geometry) : null,
    });
  }
  if (live.drought_max_dm !== null && live.drought_max_dm >= 1) {
    out.push({
      kind: "drought",
      id: `usdm-D${live.drought_max_dm}`,
      headline: `US Drought Monitor ${live.drought_label ?? `D${live.drought_max_dm}`} touches the entity's watersheds`,
      severity: live.drought_label,
      until: live.drought_period_end,
      place_ids: b.watersheds,
      url: "https://droughtmonitor.unl.edu/CurrentMap/StateDroughtMonitor.aspx?CO",
      matched_by: "watershed",
    });
  }
  const fires = await d.layer("fires");
  const polygons = (await Promise.all(b.watersheds.map((w) => d.geometry(w)))).filter((g): g is Geometry => !!g);
  for (const f of fires?.features ?? []) {
    const g = f.geometry;
    const hit = g && (g.type === "Point" ? polygons.some((p) => pointInPolygon(g.coordinates[0]!, g.coordinates[1]!, p)) : polygons.some((p) => geometriesIntersectApprox(g, p)));
    if (!hit) continue;
    out.push({
      kind: "fire",
      id: String(f.properties["id"]),
      headline: `${f.properties["name"] ?? f.properties["id"]}: ${f.properties["daily_acres"] ?? f.properties["fire_acres"] ?? "?"} acres, ${f.properties["percent_contained"] ?? "?"} % contained`,
      severity: null,
      until: null,
      place_ids: b.watersheds,
      url: null,
      matched_by: "watershed",
      centroid: centroidOf(g),
    });
  }
  for (const m of b.members.filter((x) => x.role === "air")) {
    const hit = await readingAt(d, m.id, "pm25");
    if (!hit) continue;
    const r = normalizeReading(hit.reading, d.now, d.sources);
    const band = r.value === null ? null : bandFor("pm25", r.value);
    if (!band || band.name === "Good" || band.name === "Moderate") continue;
    out.push({
      kind: "air",
      id: `${m.id}:pm25`,
      headline: `PM2.5 ${r.value} ${r.unit} — ${band.name}${r.stale ? " (stale reading)" : ""}`,
      severity: band.name,
      until: null,
      place_ids: [m.id],
      url: null,
      matched_by: "member",
    });
  }
  return out;
}

export { bboxOf, readingStalenessWithFallback };
