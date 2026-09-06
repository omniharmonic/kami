/**
 * Builds the checked-in fixture trees from the twin's own fixture
 * (`web/src/__fixtures__/conditions.json`, a real 2026-09-04 build) plus
 * hand-authored identity, geometry, live-layer and boundary files.
 *
 *   tsx scripts/refresh-fixtures.ts                       # both trees
 *   tsx scripts/refresh-fixtures.ts --stale --out fixtures/public
 *   tsx scripts/refresh-fixtures.ts --out fixtures/public-live
 *   --twin <path to frontrange-twin>   (default $TWIN_REPO or /home/user/frontrange-twin)
 *
 * `fixtures/public` is the ALL-STALE 2026-09-06T05:00:00Z build (every Tier-A
 * feed but USGS critical); `fixtures/public-live` is the same tree with fresh
 * timestamps and nothing stale. Watershed rectangles and HUC-12 assignments
 * are SYNTHETIC — see fixtures/README.md.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;
interface Reading extends Json { property: string; value?: number | null; unit?: string | null; time?: string | null; result_time?: string | null; quality?: string | null; source_id: string; stale?: boolean; staleness_s?: number; staleness_crit_s?: number; derived?: boolean; basis?: string[] }
interface Station { id: string; name: string; kind: string; lat: number; lon: number; readings: Reading[]; huc12?: string; networks?: string[]; props?: Json }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const TWIN = opt("--twin") ?? process.env["TWIN_REPO"] ?? "/home/user/frontrange-twin";

const PUBLIC = "https://data.bioregionaltwin.org";
const SITE = "https://bioregionaltwin.org";
const COMMONS = "https://prism.omniharmonic.com/p/front-range";
const NOW = "2026-09-06T05:00:00Z";
const NOW_MS = Date.parse(NOW);

// --- source registry (sources.seed.yaml, survey §2.3) --------------------------
const SOURCES: Record<string, { title: string; agency: string; tier: string; license: string; cadence: number; warn: number; crit: number; attribution?: string }> = {
  "cdss.telemetry": { title: "Colorado DWR Telemetry Stations", agency: "Colorado Division of Water Resources", tier: "A", license: "public-domain", cadence: 900, warn: 2700, crit: 10800 },
  "usgs.ogcapi.latest": { title: "USGS Water Data OGC API - latest-continuous", agency: "U.S. Geological Survey", tier: "A", license: "public-domain", cadence: 900, warn: 2700, crit: 10800 },
  "nwps.gauges": { title: "NOAA National Water Prediction Service", agency: "NOAA / National Weather Service", tier: "A", license: "public-domain", cadence: 3600, warn: 10800, crit: 43200 },
  "nrcs.awdb": { title: "NRCS AWDB (SNOTEL, snow courses, BOR reservoirs)", agency: "USDA NRCS", tier: "A", license: "public-domain", cadence: 3600, warn: 14400, crit: 86400 },
  "nws.alerts": { title: "NWS Active Alerts", agency: "NOAA / National Weather Service", tier: "A", license: "public-domain", cadence: 120, warn: 600, crit: 3600 },
  "nws.observations": { title: "NWS Station Observations", agency: "NOAA / National Weather Service", tier: "A", license: "public-domain", cadence: 600, warn: 2700, crit: 10800 },
  "nasa.firms": { title: "NASA FIRMS Active Fire Detections", agency: "NASA / MODAPS", tier: "A", license: "public-domain", cadence: 600, warn: 3600, crit: 21600 },
  "nifc.wfigs": { title: "NIFC WFIGS Fire Incidents and Perimeters", agency: "Wildland Fire Interagency Geospatial Services", tier: "A", license: "public-domain", cadence: 300, warn: 1800, crit: 10800 },
  "epa.airnow": { title: "AirNow Air Quality", agency: "US EPA", tier: "A", license: "public-domain", cadence: 3600, warn: 10800, crit: 43200 },
  "usgs.quakes": { title: "USGS Earthquake Catalog", agency: "U.S. Geological Survey", tier: "A", license: "public-domain", cadence: 300, warn: 1800, crit: 21600 },
  "usdm.current": { title: "US Drought Monitor", agency: "NDMC / UNL / USDA / NOAA", tier: "A", license: "public-domain", cadence: 604800, warn: 777600, crit: 1382400 },
  "derived.fill": { title: "Reservoir fill (derived)", agency: "Front Range Bioregional Twin", tier: "static", license: "public-domain", cadence: 300, warn: 10800, crit: 86400, attribution: "Derived by the twin: CDSS reservoir storage ÷ Colorado Dam Safety normal storage" },
};
const NETWORKS: Record<string, string[]> = { "cdss.telemetry": ["cdwr_station"], "usgs.ogcapi.latest": ["usgs_nwis"], "nwps.gauges": ["nwps_lid"], "nrcs.awdb": ["nrcs_snotel"], "epa.airnow": ["epa_aqs"], "nws.observations": [] };

// --- which stations, and what we override ---------------------------------------
const STATION_IDS = [
  "place/boulder-creek-near-orodell-co", "place/boulder-creek-co-below-broadway-st", "place/boulder-creek-at-north-75th-st-near-boulder-co", "place/boulder-creek-at-mouth-near-longmont-co",
  "place/boulder-creek-below-broadway-street", "place/boulder-creek-co-near-orodell", "place/boulder-creek-co-below-nederland", "place/boulder-creek-at-109-st-near-erie-co", "place/boulder-creek-below-wellman-ditch",
  "place/middle-boulder-creek-at-nederland-co", "place/middle-boulder-creek-below-barker-meadow-reservoir", "place/middle-boulder-creek-co-at-nederland",
  "place/fourmile-creek-at-orodell-co", "place/fourmile-creek-at-logan-mill-road-near-crisman-co", "place/fourmile-canyon-creek-near-sunshine-co", "place/bummers-gulch-near-el-vado-co",
  "place/south-boulder-creek-above-gross-reservoir-at-pinecliffe", "place/south-boulder-creek-below-gross-reservoir", "place/south-boulder-cr-at-forebay-nr-eldorado-springs-co", "place/south-boulder-creek-near-eldorado-springs-co-2", "place/south-boulder-creek-co-above-eldorado-springs", "place/south-boulder-creek-above-howard-ditch",
  "place/gross-reservoir", "place/leggett-valmont-reservoir", "place/six-mile-reservoir",
  "place/niwot", "place/lake-eldora", "place/university-camp-2",
  "place/boulder-cu-2102-athens-st", "place/boulder-reservoir", "place/boulder-municipal-airport",
  "place/coal-creek-above-boulder-creek-confulence", "place/coal-creek-near-louisville-co", "place/city-of-boulder-effluent-release-to-boulder-creek",
  "place/anderson-ditch", "place/farmers-ditch", "place/silver-lake-ditch", "place/dry-creek-carrier-ditch-above-boulder-creek-confluence", "place/leggett-ditch", "place/wellman-ditch-tail",
];
const COMMONS_MEMBERS = new Set(["place/boulder-creek-near-orodell-co", "place/boulder-creek-co-below-broadway-st", "place/boulder-creek-at-north-75th-st-near-boulder-co", "place/boulder-creek-at-mouth-near-longmont-co", "place/niwot", "place/gross-reservoir", "place/south-boulder-cr-at-forebay-nr-eldorado-springs-co", "place/boulder-cu-2102-athens-st"]);

// --- synthetic watersheds: four HUC-10 rectangles, six HUC-12s each -----------------
interface Huc10 { code: string; name: string; bbox: [number, number, number, number]; area: number }
const HUC10: Huc10[] = [
  { code: "1019000504", name: "Middle Boulder Creek", bbox: [-105.70, 39.90, -105.45, 40.08], area: 421.3 },
  { code: "1019000505", name: "South Boulder Creek", bbox: [-105.45, 39.85, -105.20, 39.97], area: 356.8 },
  { code: "1019000506", name: "Boulder Creek-Fourmile Creek", bbox: [-105.45, 39.97, -105.22, 40.08], area: 244.9 },
  { code: "1019000507", name: "Lower Boulder Creek", bbox: [-105.22, 39.97, -104.98, 40.15], area: 512.6 },
];
const HUC12_NAMES = ["Headwaters", "Upper", "Middle", "Lower", "Outlet", "Tributary"];
function huc12For(lon: number, lat: number): string | undefined {
  for (const h of HUC10) {
    const [x0, y0, x1, y1] = h.bbox;
    if (lon >= x0 && lon < x1 && lat >= y0 && lat < y1) {
      const band = Math.min(5, Math.floor(((lon - x0) / (x1 - x0)) * 6));
      return `${h.code}${String(band + 1).padStart(2, "0")}`;
    }
  }
  return undefined;
}

// --- helpers ----------------------------------------------------------------
function dumps(v: unknown): string { return JSON.stringify(sortKeys(v)); }
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as Json).sort().map((k) => [k, sortKeys((v as Json)[k])]));
  return v;
}
function compact<T extends Json>(o: T): T { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T; }
function iso(ms: number): string { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); }
function seed(s: string): () => number { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; }
function r2(n: number): number { return Math.round(n * 100) / 100; }
function shortId(id: string): string { return id.split("/")[1]!; }
function write(out: string, path: string, body: string, contentType: string, cacheClass: "latest" | "id" | "geom" | "boundary", sidecar = false) {
  const file = join(out, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body.endsWith("\n") ? body : body + "\n");
  if (sidecar) {
    const cc = { latest: "public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400", id: "public, max-age=300", geom: "public, max-age=300", boundary: "public, max-age=300" }[cacheClass];
    writeFileSync(`${file}.headers.json`, JSON.stringify({ "Cache-Control": cc, "Content-Type": contentType, ETag: `"fx-${seed(path)().toString(16).slice(2, 10)}"` }, null, 2) + "\n");
  }
}

// --- series synthesis (7 days, hourly, ending at the reading's time) -----------------
function series(id: string, prop: string, value: number, endMs: number): { t: string[]; v: number[] } {
  const rnd = seed(`${id}:${prop}`);
  const t: string[] = [], v: number[] = [];
  const n = 7 * 24 + 1;
  for (let i = 0; i < n; i++) {
    const ms = endMs - (n - 1 - i) * 3600_000;
    const h = (n - 1 - i);
    let x: number;
    if (prop === "discharge" || prop === "flow_forecast") x = value * (1 + 0.06 * Math.sin((2 * Math.PI * (ms / 3600_000)) / 24) + 0.04 * (rnd() - 0.5) + 0.0009 * h);
    else if (prop === "swe" || prop === "snow_depth") x = value;
    else if (prop === "reservoir_storage") x = value * (1 + 0.00025 * h);
    else if (prop === "pm25" || prop === "pm10" || prop === "ozone") x = Math.max(0.5, value + 3 * (rnd() - 0.5) + 1.5 * Math.sin((2 * Math.PI * (ms / 3600_000)) / 24));
    else if (prop === "water_temp" || prop === "air_temp") x = value + 4 * Math.sin((2 * Math.PI * ((ms / 3600_000) - 3)) / 24) + 0.5 * (rnd() - 0.5);
    else if (prop === "precip_accum") x = value - 0.002 * h;
    else x = value * (1 + 0.02 * (rnd() - 0.5));
    if (i === n - 1) x = value;
    t.push(iso(ms)); v.push(r2(Math.max(0, x)));
  }
  return { t, v };
}
function seriesKey(st: Station, r: Reading): string {
  const P: Record<string, string> = { discharge: "DISCHRG", reservoir_storage: "STORAGE", stage: "STAGE", gage_height: "00065", swe: "WTEQ", snow_depth: "SNWD", precip_accum: "PREC", air_temp: "TOBS", pm25: "88101", pm10: "81102", ozone: "44201", water_temp: "00010", dissolved_oxygen: "00300", ph: "00400", specific_conductance: "00095", turbidity: "63680", usgs_63160: "63160", flow_forecast: "FCST" };
  const rnd = seed(st.id);
  const code = P[r.property] ?? r.property.toUpperCase();
  if (st.id === "place/boulder-creek-near-orodell-co") return `BOCOROCO/${code}`;
  if (r.source_id === "cdss.telemetry") return `${shortId(st.id).replace(/-/g, "").slice(0, 8).toUpperCase()}/${code}`;
  if (r.source_id === "usgs.ogcapi.latest") return `0${Math.floor(6700000 + rnd() * 99999)}/${code}`;
  if (r.source_id === "nwps.gauges") return `${shortId(st.id).slice(0, 4).toUpperCase()}C2/${code}`;
  if (r.source_id === "nrcs.awdb") return `${Math.floor(600 + rnd() * 400)}:CO:SNTL/${code}`;
  return `${shortId(st.id)}/${code}`;
}

// --- build --------------------------------------------------------------------
function build(out: string, stale: boolean) {
  rmSync(out, { recursive: true, force: true });
  const twinFixture = JSON.parse(readFileSync(join(TWIN, "web/src/__fixtures__/conditions.json"), "utf8")) as { stations: Station[] };
  const byId = new Map(twinFixture.stations.map((s) => [s.id, s]));
  const stations: Station[] = [];
  for (const id of STATION_IDS) {
    const src = byId.get(id);
    if (!src) throw new Error(`station ${id} not in twin fixture`);
    stations.push(JSON.parse(JSON.stringify(src)) as Station);
  }
  // A generalized place (rule 4 fixture): a private headgate whose point is the HUC-12's point-on-surface.
  stations.push({ id: "place/private-headgate-generalized", name: "Private Headgate (generalized)", kind: "monitoring_site", lat: 40.02, lon: -105.30, readings: [{ property: "discharge", value: 0.4, unit: "[ft_i]3/s", time: "2026-09-04T07:15:00Z", source_id: "cdss.telemetry", quality: "O" }] });

  const LIVE_T = Date.parse("2026-09-06T04:45:00Z");
  const per: Record<string, (r: Reading) => number> = stale
    ? {
        "cdss.telemetry": (r) => (r.time ? Date.parse(r.time) + 13 * 3600_000 : LIVE_T), // Orodell 07:15 → 20:15 on the 4th
        "usgs.ogcapi.latest": () => LIVE_T,
        "nwps.gauges": (r) => Date.parse(r.time!),
        "nrcs.awdb": (r) => Date.parse(r.time!),
        "epa.airnow": (r) => Date.parse(r.time!),
        "nws.observations": (r) => Date.parse(r.time!),
      }
    : {
        "cdss.telemetry": () => LIVE_T,
        "usgs.ogcapi.latest": () => LIVE_T,
        "nwps.gauges": () => LIVE_T - 30 * 60_000,
        "nrcs.awdb": () => Date.parse("2026-09-06T04:00:00Z"),
        "epa.airnow": () => Date.parse("2026-09-06T04:00:00Z"),
        "nws.observations": () => LIVE_T - 10 * 60_000,
      };

  for (const st of stations) {
    st.huc12 = huc12For(st.lon, st.lat);
    const nets = new Set<string>();
    for (const r of st.readings) {
      const shift = per[r.source_id] ?? (() => LIVE_T);
      let ms = shift(r);
      if (stale && st.id === "place/gross-reservoir") ms = LIVE_T; // storage live even while the feed is critical
      if (stale && st.id === "place/south-boulder-cr-at-forebay-nr-eldorado-springs-co") ms = LIVE_T;
      if (stale && (st.id === "place/bummers-gulch-near-el-vado-co" || st.id === "place/coal-creek-near-louisville-co")) ms = Date.parse(r.time!); // dead USGS gauges stay dead
      r.time = iso(ms);
      r.result_time = iso(ms + 5 * 60_000);
      for (const n of NETWORKS[r.source_id] ?? []) nets.add(n);
    }
    if (nets.size) st.networks = [...nets].sort();
    if (st.id === "place/gross-reservoir") {
      st.readings[0]!.value = 30104.0;
      st.props = { capacity_af: 41811, capacity_dam: "Gross Dam" };
    }
    if (st.id === "place/south-boulder-cr-at-forebay-nr-eldorado-springs-co") for (const r of st.readings) if (r.property === "water_temp") r.value = 12.0;
    if (st.id === "place/boulder-creek-co-near-orodell") {
      st.readings.push({ property: "flow_forecast", value: 14.0, unit: "[ft_i]3/s", time: iso(NOW_MS + 7 * 3600_000), result_time: st.readings[0]!.result_time, source_id: "nwps.gauges" });
    }
  }
  stations.sort((a, b) => a.id.localeCompare(b.id));

  // conditions.json (clock dialect)
  const condStations = stations.map((st) => {
    const readings: Reading[] = st.readings.map((r) => {
      const age = Math.max(0, Math.round((NOW_MS - Date.parse(r.time!)) / 1000));
      const crit = SOURCES[r.source_id]!.crit;
      return compact({ ...r, staleness_s: r.property === "flow_forecast" ? Math.round((NOW_MS - Date.parse(r.time!)) / 1000) : age, stale: age > crit });
    });
    if (st.props?.["capacity_af"]) {
      const s = readings.find((r) => r.property === "reservoir_storage")!;
      readings.push({ property: "reservoir_fill", value: Math.round((1000 * (s.value as number)) / (st.props["capacity_af"] as number)) / 10, unit: "%", time: s.time, result_time: s.result_time, source_id: "derived.fill", derived: true, basis: ["reservoir_storage", "capacity_af"], stale: s.stale, staleness_s: s.staleness_s });
    }
    return compact({ id: st.id, name: st.name, kind: st.kind, lon: st.lon, lat: st.lat, huc12: st.huc12, networks: st.networks, props: st.props, readings });
  });

  const healthOf = (src: string): { health: string; last_ok: string; staleness_s: number } => {
    const S = SOURCES[src]!;
    const verdict: Record<string, string> = stale
      ? { "cdss.telemetry": "critical", "nws.alerts": "critical", "usdm.current": "ok", "nrcs.awdb": "warning", "derived.fill": "ok", "epa.airnow": "critical", "usgs.ogcapi.latest": "ok", "nwps.gauges": "critical", "nws.observations": "critical", "nifc.wfigs": "ok", "usgs.quakes": "ok", "nasa.firms": "unknown" }
      : Object.fromEntries(Object.keys(SOURCES).map((k) => [k, k === "nasa.firms" ? "unknown" : "ok"]));
    const h = verdict[src] ?? "ok";
    const ageFor = h === "critical" ? S.crit + Math.round(S.crit * 0.9) + 600 : h === "warning" ? Math.round((S.warn + S.crit) / 2) : Math.round(S.cadence * 0.4);
    return { health: h, last_ok: iso(NOW_MS - ageFor * 1000), staleness_s: ageFor };
  };
  const condSources: Json = {};
  for (const [src, S] of Object.entries(SOURCES)) {
    const h = healthOf(src);
    condSources[src] = compact({ health: h.health, last_ok: h.health === "unknown" ? undefined : h.last_ok, staleness_s: h.health === "unknown" ? undefined : h.staleness_s, attribution: S.attribution ?? S.agency, tier: S.tier, license: S.license });
  }
  write(out, "latest/conditions.json", dumps({ schema_version: "1.0", generated_at: NOW, bbox: [-106.5, 38.5, -104.0, 41.0], sources: condSources, stations: condStations }), "application/json", "latest", true);

  // health.json
  const counts = new Map<string, { n: number; stale: number }>();
  for (const s of condStations) for (const r of s.readings as Reading[]) { const c = counts.get(r.source_id) ?? { n: 0, stale: 0 }; c.n++; if (r.stale) c.stale++; counts.set(r.source_id, c); }
  const board = Object.entries(SOURCES).map(([src, S]) => {
    const h = healthOf(src);
    const c = counts.get(src) ?? { n: 0, stale: 0 };
    return compact({ source_id: src, title: S.title, agency: S.agency, tier: S.tier, license: S.license, attribution: S.attribution ?? S.agency, health: h.health, last_ok: h.health === "unknown" ? undefined : h.last_ok, last_error: h.health === "critical" ? iso(NOW_MS - 300_000) : undefined, staleness_s: h.health === "unknown" ? undefined : h.staleness_s, nominal_cadence_s: S.cadence, staleness_warn_s: S.warn, staleness_crit_s: S.crit, readings: c.n, stale_readings: c.stale });
  }).sort((a, b) => (a.source_id as string).localeCompare(b.source_id as string));
  write(out, "latest/health.json", dumps({ schema_version: "1.0", generated_at: NOW, sources: board }), "application/json", "latest");

  // snow.json
  const ELEV: Record<string, number> = { "place/niwot": 3021.0, "place/lake-eldora": 2957.0, "place/university-camp-2": 3139.0 };
  const basis = Object.entries(ELEV).map(([id, elevation_m]) => {
    const st = condStations.find((s) => s.id === id)!;
    const swe = (st.readings as Reading[]).find((r) => r.property === "swe")!;
    const depth = (st.readings as Reading[]).find((r) => r.property === "snow_depth")!;
    return { id, elevation_m, swe_mm: Math.round((swe.value as number) * 25.4 * 10) / 10, snow_depth_cm: Math.round((depth.value as number) * 2.54 * 10) / 10, time: swe.time, stale: !!swe.stale };
  });
  write(out, "latest/snow.json", dumps({ schema_version: "1.0", generated_at: NOW, snowline_m: null, opacity: 0.0, basis, rule: "lowest elevation at which ≥2 of the 3 nearest-by-elevation SNOTEL sites report snow depth > 0; opacity = median SWE above the line / 300 mm, capped at 1", stale: stale }), "application/json", "latest");

  // live layers
  const rect = (b: [number, number, number, number]) => ({ type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] });
  const fc = (source_id: string, features: unknown[]) => dumps({ type: "FeatureCollection", schema_version: "1.0", generated_at: NOW, source_id, features });
  write(out, "latest/alerts.geojson", fc("nws.alerts", [{
    type: "Feature", geometry: null,
    properties: { id: "urn:oid:2.49.0.1.840.0.fixture-red-flag-bou-2026-09-06", event: "Red Flag Warning", severity: "Severe", certainty: "Likely", urgency: "Expected", headline: "Red Flag Warning issued September 5 at 3:12PM MDT until September 6 at 8:00PM MDT by NWS Denver CO", description: "Gusty west winds and single-digit relative humidity are expected over the foothills and adjacent plains. Any fire that develops will spread rapidly.", instruction: "A Red Flag Warning means that critical fire weather conditions are either occurring now or will shortly.", onset: "2026-09-06T17:00:00Z", sender: "NWS Denver CO", area_desc: "Boulder And Jefferson Counties Below 6000 Feet/West Broomfield County", ugc: ["COZ039"], office: "BOU", phenomenon_time: "2026-09-05T21:12:00Z", expires_at: "2026-09-07T02:00:00Z", source_id: "nws.alerts" },
  }]), "application/geo+json", "latest");
  const droughtProps = (dm: number, oid: number) => ({ id: `${dm}-${oid}`, dm, label: `D${dm}`, period_start: "2026-09-01T06:00:00Z", period_end: "2026-09-07T06:00:00Z", release_date: "2026-09-03T12:30:00Z", national_area_sq_mi: dm === 0 ? 1210345.2 : 812004.7, national_cumulative_pct: dm === 0 ? 34.1 : 22.9, national_categorical_pct: dm === 0 ? 11.2 : 9.8, phenomenon_time: "2026-09-01T06:00:00Z", expires_at: "2026-09-15T06:00:00Z", source_id: "usdm.current" });
  write(out, "latest/drought.geojson", fc("usdm.current", [
    { type: "Feature", geometry: rect([-105.75, 39.80, -104.95, 40.20]), properties: droughtProps(0, 91001) },
    { type: "Feature", geometry: rect([-105.30, 39.80, -104.95, 40.20]), properties: droughtProps(1, 91002) },
  ]), "application/geo+json", "latest");
  write(out, "latest/fires.geojson", fc("nifc.wfigs", []), "application/geo+json", "latest");
  write(out, "latest/detections.geojson", fc("nasa.firms", []), "application/geo+json", "latest");
  write(out, "latest/quakes.geojson", fc("usgs.quakes", []), "application/geo+json", "latest");

  // identity: index, id records, geom, place pages
  const index: Json[] = [];
  const HUC8 = ["10190002", "10190003", "10190004", "10190005", "10190006", "10190007"];
  const bioBbox = [-106.19, 39.29, -104.62, 40.99];
  const idRecord = (o: Json) => compact({ schema_version: "1.0", ...o, generated_at: NOW });
  const geomFeature = (id: string, kind: string, name: string, geometry: unknown, huc12?: string) => dumps({ type: "Feature", schema_version: "1.0", generated_at: NOW, geometry, properties: compact({ id, kind, name, huc12 }) });
  const pageOf = (o: Json) => dumps(compact({ schema_version: "1.0", generated_at: NOW, ...o }));
  const bioGeom = { type: "MultiPolygon", coordinates: [[[[-106.19, 39.29], [-104.62, 39.29], [-104.62, 40.99], [-105.40, 40.99], [-106.19, 40.40], [-106.19, 39.29]]]] };

  // bioregion + huc8
  index.push({ id: "bioregion/front-range", kind: "bioregion", name: "Front Range Bioregion", bbox: bioBbox });
  write(out, "id/bioregion/front-range.json", dumps(idRecord({ id: "bioregion/front-range", kind: "bioregion", name: "Front Range Bioregion", bbox: bioBbox, sensitivity: "public", geometry_url: `${PUBLIC}/geom/bioregion/front-range.geojson`, latest_url: `${PUBLIC}/latest/bioregion/front-range.json`, twin_url: `${SITE}/front-range/twin?focus=bioregion/front-range`, commons_url: `${COMMONS}/notes/wiki%2Fplaces%2Fbioregion` })), "application/json", "id");
  write(out, "geom/bioregion/front-range.geojson", geomFeature("bioregion/front-range", "bioregion", "Front Range Bioregion", bioGeom), "application/geo+json", "geom");
  write(out, "latest/bioregion/front-range.json", pageOf({ id: "bioregion/front-range", kind: "bioregion", name: "Front Range Bioregion", bbox: bioBbox, centroid: [-105.405, 40.14], children: HUC8.map((h) => `watershed/huc8-${h}`), props: { boundary_version: "v1", ring: "A", method: "ST_Union of the six v1 HUC-8 subbasins (WBD), intersected with EPA Level IV ecoregions (US_L3CODE 21 or US_L4CODE 25l)", huc8: HUC8, area_sqkm: 12814.0 }, readings: [], series: {} }), "application/json", "latest");
  const h8 = "watershed/huc8-10190005";
  const h8Bbox = [-105.70, 39.85, -104.98, 40.30];
  index.push({ id: h8, kind: "watershed", name: "St. Vrain", bbox: h8Bbox });
  write(out, `id/${h8}.json`, dumps(idRecord({ id: h8, kind: "watershed", name: "St. Vrain", bbox: h8Bbox, sensitivity: "public", geometry_url: `${PUBLIC}/geom/${h8}.geojson`, latest_url: `${PUBLIC}/latest/${h8}.json`, twin_url: `${SITE}/front-range/twin?focus=${h8}`, commons_url: `${COMMONS}/notes/wiki%2Fplaces%2Fwatersheds%2Fhuc10190005` })), "application/json", "id");
  write(out, `latest/${h8}.json`, pageOf({ id: h8, kind: "watershed", name: "St. Vrain", bbox: h8Bbox, centroid: [-105.34, 40.075], parent_id: "bioregion/front-range", children: HUC10.map((h) => `watershed/huc10-${h.code}`), props: { huc: "10190005", level: 8, area_sqkm: 2534.0, states: "CO" }, readings: [], series: {} }), "application/json", "latest");

  for (const h of HUC10) {
    const id = `watershed/huc10-${h.code}`;
    const kids = HUC12_NAMES.map((_, i) => `watershed/huc12-${h.code}${String(i + 1).padStart(2, "0")}`);
    index.push({ id, kind: "watershed", name: h.name, bbox: h.bbox });
    write(out, `id/${id}.json`, dumps(idRecord({ id, kind: "watershed", name: h.name, bbox: h.bbox, sensitivity: "public", geometry_url: `${PUBLIC}/geom/${id}.geojson`, latest_url: `${PUBLIC}/latest/${id}.json`, twin_url: `${SITE}/front-range/twin?focus=${id}`, commons_url: `${COMMONS}/notes/wiki%2Fplaces%2Fwatersheds%2Fhuc${h.code}` })), "application/json", "id");
    write(out, `geom/${id}.geojson`, geomFeature(id, "watershed", h.name, rect(h.bbox)), "application/geo+json", "geom");
    write(out, `latest/${id}.json`, pageOf({ id, kind: "watershed", name: h.name, bbox: h.bbox, centroid: [r2((h.bbox[0] + h.bbox[2]) / 2 * 1) , r2((h.bbox[1] + h.bbox[3]) / 2)], parent_id: h8, children: kids, props: { huc: h.code, level: 10, area_sqkm: h.area, states: "CO" }, readings: [], series: {} }), "application/json", "latest");
    kids.forEach((kid, i) => {
      const code = `${h.code}${String(i + 1).padStart(2, "0")}`;
      const w = (h.bbox[2] - h.bbox[0]) / 6;
      const bb = [r2(h.bbox[0] + i * w), h.bbox[1], r2(h.bbox[0] + (i + 1) * w), h.bbox[3]];
      const name = `${HUC12_NAMES[i]} ${h.name}`;
      index.push({ id: kid, kind: "watershed", name, bbox: bb, huc12: code });
      write(out, `id/${kid}.json`, dumps(idRecord({ id: kid, kind: "watershed", name, huc12: code, bbox: bb, sensitivity: "public", geometry_url: `${PUBLIC}/geom/${kid}.geojson`, latest_url: `${PUBLIC}/latest/${kid}.json`, twin_url: `${SITE}/front-range/twin?focus=${kid}`, commons_url: `${COMMONS}/notes/wiki%2Fplaces%2Fwatersheds%2Fhuc${code}` })), "application/json", "id");
      write(out, `latest/${kid}.json`, pageOf({ id: kid, kind: "watershed", name, huc12: code, bbox: bb, centroid: [r2((bb[0]! + bb[2]!) / 2), r2((bb[1]! + bb[3]!) / 2)], parent_id: id, children: [], props: { huc: code, huc12: code, level: 12, area_sqkm: r2(h.area / 6), states: "CO" }, readings: [], series: {} }), "application/json", "latest");
    });
  }

  // stations
  const CDWR_ORODELL = { cdwr_station_type: "Stream Gage", cdwr_structure_type: "Stream Gage", cdwr_station_status: "Active", cdwr_water_source: "BOULDER CREEK", cdwr_stream_gnis_id: "00178354", cdwr_wdid: "0600510", cdwr_huc10: "1019000506", cdwr_parameters: "DISCHRG,GAGE_HT", cdwr_por_start: "1986-10-01", cdwr_por_end: "2026-09-04", cdwr_data_source: "Colorado Division of Water Resources" };
  for (const st of stations) {
    const generalized = st.id.endsWith("-generalized");
    const point = generalized ? [-105.3125, 40.0225] : [st.lon, st.lat];
    const bbox = [point[0], point[1], point[0], point[1]];
    const sameAs = st.id === "place/boulder-creek-near-orodell-co" ? ["https://dwr.state.co.us/Tools/Stations/BOCOROCO", "https://waterdata.usgs.gov/monitoring-location/06727500"] : undefined;
    index.push(compact({ id: st.id, kind: st.kind, name: st.name, bbox, huc12: st.huc12 }));
    write(out, `id/${st.id}.json`, dumps(idRecord({ id: st.id, kind: st.kind, name: st.name, huc12: st.huc12, bbox, sensitivity: generalized ? "generalized" : "public", geometry_url: `${PUBLIC}/geom/${st.id}.geojson`, latest_url: `${PUBLIC}/latest/${st.id}.json`, twin_url: `${SITE}/front-range/twin?focus=${st.id}`, commons_url: COMMONS_MEMBERS.has(st.id) ? `${COMMONS}/notes/wiki%2Fplaces%2Fmonitoring%2F${shortId(st.id)}` : undefined, sameAs })), "application/json", "id");
    write(out, `geom/${st.id}.geojson`, geomFeature(st.id, st.kind, st.name, { type: "Point", coordinates: point }, st.huc12), "application/geo+json", "geom");
    const pageReadings: Reading[] = st.readings.map((r) => compact({ ...r, staleness_crit_s: SOURCES[r.source_id]!.crit }));
    const ser: Json = {};
    for (const r of st.readings) { if (typeof r.value !== "number") continue; const key = seriesKey(st, r); ser[key] = { property: r.property, unit: r.unit, source_id: r.source_id, ...series(st.id, r.property, r.value, Date.parse(r.time!)) }; }
    const props: Json = { ...(st.props ?? {}) };
    if (st.id === "place/boulder-creek-near-orodell-co") Object.assign(props, CDWR_ORODELL);
    if (ELEV[st.id]) props["awdb_elevation_m"] = ELEV[st.id];
    if (st.id === "place/gross-reservoir") {
      props["capacity_source"] = "co.damsafety";
      const s = pageReadings.find((r) => r.property === "reservoir_storage")!;
      pageReadings.push({ property: "reservoir_fill", value: Math.round((1000 * (s.value as number)) / (props["capacity_af"] as number)) / 10, unit: "%", time: s.time, result_time: s.result_time, source_id: "derived.fill", derived: true, basis: ["reservoir_storage", "capacity_af"], staleness_crit_s: s.staleness_crit_s });
    }
    write(out, `latest/${st.id}.json`, pageOf({ id: st.id, kind: st.kind, name: st.name, huc12: st.huc12, bbox, centroid: point, parent_id: st.huc12 ? `watershed/huc12-${st.huc12}` : undefined, children: [], props: Object.keys(props).length ? props : undefined, readings: pageReadings, series: ser }), "application/json", "latest", st.id === "place/boulder-creek-near-orodell-co");
  }

  index.sort((a, b) => (a.id as string).localeCompare(b.id as string));
  write(out, "id/index.json", dumps({ schema_version: "1.0", generated_at: NOW, count: index.length, places: index }), "application/json", "id", true);

  // boundary
  write(out, "boundary/v1.geojson", dumps({ type: "Feature", schema_version: "1.0", generated_at: NOW, geometry: bioGeom, properties: { id: "bioregion/front-range", name: "Front Range Bioregion", boundary_version: "v1", ring: "A", area_sqkm: 12814.0, huc8: HUC8, method: "ST_Union of the six v1 HUC-8 subbasins (WBD), intersected with the union of EPA Level IV ecoregion polygons where US_L3CODE = '21' (Southern Rockies) or US_L4CODE = '25l' (Front Range Fans); ST_MakeValid + ST_Buffer(0); parts smaller than 1% of the total area dropped; ST_CollectionExtract(..., 3).", rationale_url: `${PUBLIC}/boundary/v1.md` } }), "application/geo+json", "boundary", true);
  write(out, "boundary/v1.md", `# The Front Range Bioregion, boundary/v1 — rationale (fixture)

*Version v1 · Ring A · fixture copy for the MCP contract tests · 12,814 km²*

A bioregional boundary is not a fact. It is a proposal about where one place
stops being itself and starts being somewhere else, and the only honest way to
publish one is with the reasoning attached, a version number on it, and an
invitation to argue.

## What v1 is

Ring A is the union of six USGS Watershed Boundary Dataset HUC-8 subbasins
draining the eastern slope of the Southern Rockies into the South Platte —
${HUC8.join(", ")} — clipped west at the Continental Divide and east at the
outer edge of EPA Level IV ecoregion 25l "Front Range Fans".

## About this copy

This file is a short synthetic stand-in for the twin's \`data/boundary/rationale-v1.md\`
(the real rationale is longer and is CC BY-SA 4.0). The polygon beside it is a
simplified shape, not the real Ring A. Both exist so the contract tests can
exercise \`get_boundary_summary\` without the live tree.
`, "text/markdown", "boundary");

  console.log(`${out}: ${index.length} index entries, ${stations.length} stations, ${stale ? "STALE" : "live"} build at ${NOW}`);
}

const outArg = opt("--out");
if (outArg) build(join(process.cwd(), outArg), flag("--stale"));
else {
  build(join(root, "fixtures/public"), true);
  build(join(root, "fixtures/public-live"), false);
}
if (!existsSync(join(TWIN, "web/src/__fixtures__/conditions.json"))) console.warn("twin fixture not found at", TWIN);
