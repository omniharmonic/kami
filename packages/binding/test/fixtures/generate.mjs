// Generates the fixture tree under test/fixtures/public/ (and, with
// --twin-client, the smaller tree under ../../twin-client/test/fixtures/).
//
// Shapes follow docs/research/twin-survey.md §1.4, §1.5, §3.1, §3.3, §4.1,
// §4.4: sorted keys, no nulls (the publisher's `_compact`), whole-second Z
// timestamps, the verdict dialect in conditions.json and the threshold dialect
// on place pages. HUC-12 codes and station huc12 assignments are SYNTHETIC
// but self-consistent; the four HUC-10 names follow PRD Appendix B.
//
//   node test/fixtures/generate.mjs [--twin-client]

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = "https://data.bioregionaltwin.org";
const SITE = "https://bioregionaltwin.org";
const NOW = "2026-09-06T06:00:00Z";
const NOW_MS = Date.parse(NOW);

const sortKeys = (v) =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .filter((k) => v[k] !== null && v[k] !== undefined)
            .map((k) => [k, sortKeys(v[k])]),
        )
      : v;
const dumps = (v) => JSON.stringify(sortKeys(v));

const ageS = (time) => Math.round((NOW_MS - Date.parse(time)) / 1000);
const CRIT = {
  "cdss.telemetry": 10800,
  "usgs.ogcapi.latest": 10800,
  "nrcs.awdb": 86400,
  "epa.airnow": 43200,
  "derived.fill": 86400,
};

// A reading in both dialects. `verdict` for conditions.json, `threshold` for pages.
function reading(r, dialect) {
  const base = { property: r.property, value: r.value, unit: r.unit, time: r.time, source_id: r.source_id };
  if (r.quality) base.quality = r.quality;
  if (r.derived) {
    base.derived = true;
    base.basis = r.basis;
  }
  if (dialect === "verdict") {
    const s = ageS(r.time);
    return { ...base, staleness_s: s, stale: s > CRIT[r.source_id] };
  }
  return { ...base, staleness_crit_s: CRIT[r.source_id] };
}

// --- watersheds ------------------------------------------------------------------
const HUC10 = [
  ["1019000504", "Headwaters Boulder Creek", [["01", "Middle Boulder Creek"], ["02", "North Boulder Creek"], ["03", "Fourmile Creek"], ["04", "Boulder Creek-Orodell"]]],
  ["1019000505", "South Boulder Creek", [["01", "Headwaters South Boulder Creek"], ["02", "Middle South Boulder Creek"], ["03", "Gross Reservoir-South Boulder Creek"], ["04", "Outlet South Boulder Creek"]]],
  ["1019000506", "Coal Creek-Boulder Creek", [["01", "Coal Creek"], ["02", "Rock Creek"], ["03", "Boulder Creek-Boulder"], ["04", "Dry Creek-Boulder Creek"]]],
  ["1019000507", "Boulder Creek-Saint Vrain Creek", [["01", "Boulder Creek-Valmont"], ["02", "Dry Creek Number 2"], ["03", "Boulder Creek-White Rocks"], ["04", "Outlet Boulder Creek"]]],
];

const watersheds = [];
for (const [huc, name, kids] of HUC10) {
  const id = `watershed/huc10-${huc}`;
  const children = kids.map(([s]) => `watershed/huc12-${huc}${s}`);
  watersheds.push({
    id,
    kind: "watershed",
    name,
    bbox: [-105.7, 39.9, -105.0, 40.1],
    props: { huc, level: 10, area_sqkm: 300 + Number(huc.slice(-1)) * 25, states: "CO" },
    children,
    parent_id: "watershed/huc8-10190005",
  });
  for (const [s, cname] of kids) {
    watersheds.push({
      id: `watershed/huc12-${huc}${s}`,
      kind: "watershed",
      name: cname,
      huc12: `${huc}${s}`,
      bbox: [-105.6, 39.95, -105.1, 40.05],
      props: { huc: `${huc}${s}`, level: 12, area_sqkm: 60, states: "CO" },
      children: [],
      parent_id: id,
    });
  }
}

// --- stations ------------------------------------------------------------------
const T_STALE = "2026-09-04T20:15:00Z"; // 118 000 s before NOW — PRD App. B
const T_FRESH = "2026-09-06T05:30:00Z";
const cdssProps = (gnis, huc10, wdid, por) => ({
  cdwr_station_type: "Stream Gage",
  cdwr_structure_type: "Stream Gage",
  cdwr_station_status: "Active",
  cdwr_water_source: "BOULDER CREEK",
  cdwr_stream_gnis_id: gnis,
  cdwr_wdid: wdid,
  cdwr_huc10: huc10,
  cdwr_parameters: "DISCHRG",
  cdwr_por_start: por,
  cdwr_por_end: "2026-09-04",
  cdwr_data_source: "Co. Division of Water Resources",
});
const discharge = (value, time = T_STALE) => ({ property: "discharge", value, unit: "[ft_i]3/s", time, source_id: "cdss.telemetry", quality: "O" });

const stations = [
  {
    id: "place/boulder-creek-near-orodell-co", name: "BOULDER CREEK NEAR ORODELL, CO.", huc12: "101900050404",
    lon: -105.330825, lat: 40.006375, networks: ["cdwr_station", "usgs_nwis"],
    sameAs: ["https://dwr.state.co.us/Tools/Stations/BOCOROCO", "https://waterdata.usgs.gov/monitoring-location/06727500"],
    props: cdssProps("00178354", "1019000504", "0600501", "1906-10-01"),
    readings: [discharge(15.4)],
    series: { "BOCOROCO/DISCHRG": { property: "discharge", unit: "[ft_i]3/s", source_id: "cdss.telemetry", t: ["2026-09-04T19:15:00Z", T_STALE], v: [15.6, 15.4] } },
  },
  {
    id: "place/boulder-creek-co-below-broadway-st", name: "BOULDER CREEK CO BELOW BROADWAY ST", huc12: "101900050603",
    lon: -105.28, lat: 40.014, networks: ["cdwr_station"],
    sameAs: ["https://dwr.state.co.us/Tools/Stations/BOCBBRCO"],
    props: cdssProps("00178354", "1019000506", "0600502", "1986-10-01"),
    readings: [discharge(21.0)],
  },
  {
    id: "place/boulder-creek-at-north-75th-st-near-boulder-co", name: "BOULDER CREEK AT NORTH 75TH ST. NEAR BOULDER, CO", huc12: "101900050604",
    lon: -105.178, lat: 40.052, networks: ["cdwr_station", "usgs_nwis"],
    sameAs: ["https://dwr.state.co.us/Tools/Stations/BOC109CO", "https://waterdata.usgs.gov/monitoring-location/06730200"],
    props: cdssProps("00178354", "1019000506", "0600503", "1986-10-01"),
    readings: [discharge(48.2, T_FRESH)],
  },
  {
    id: "place/boulder-creek-at-mouth-near-longmont-co", name: "BOULDER CREEK AT MOUTH NEAR LONGMONT, CO", huc12: "101900050704",
    lon: -105.02, lat: 40.15, networks: ["cdwr_station"],
    sameAs: ["https://dwr.state.co.us/Tools/Stations/BOCMOUCO"],
    props: cdssProps("00178354", "1019000507", "0600504", "1997-10-01"),
    readings: [discharge(62.5)],
  },
  {
    id: "place/niwot", name: "Niwot", huc12: "101900050401", lon: -105.5452, lat: 40.03581, networks: ["nrcs_snotel"],
    props: { awdb_elevation_m: 3021.0, awdb_station_triplet: "663:CO:SNTL" },
    readings: [
      { property: "swe", value: 0.0, unit: "[in_i]", time: "2026-09-04T06:00:00Z", source_id: "nrcs.awdb" },
      { property: "snow_depth", value: 0.0, unit: "[in_i]", time: "2026-09-04T06:00:00Z", source_id: "nrcs.awdb" },
      { property: "precip_accum", value: 0.3, unit: "[in_i]", time: "2026-09-04T06:00:00Z", source_id: "nrcs.awdb" },
      { property: "air_temp", value: 9.1, unit: "Cel", time: "2026-09-04T06:00:00Z", source_id: "nrcs.awdb" },
    ],
  },
  {
    id: "place/lake-eldora", name: "Lake Eldora", huc12: "101900050402", lon: -105.59, lat: 39.94, networks: ["nrcs_snotel"],
    props: { awdb_elevation_m: 2957.0, awdb_station_triplet: "564:CO:SNTL" },
    readings: [
      { property: "swe", value: 0.0, unit: "[in_i]", time: "2026-09-04T06:00:00Z", source_id: "nrcs.awdb" },
      { property: "snow_depth", value: 0.0, unit: "[in_i]", time: "2026-09-04T06:00:00Z", source_id: "nrcs.awdb" },
    ],
  },
  {
    id: "place/university-camp-2", name: "University Camp", huc12: "101900050401", lon: -105.57, lat: 40.03, networks: ["nrcs_snotel"],
    props: { awdb_elevation_m: 3140.0, awdb_station_triplet: "838:CO:SNTL" },
    readings: [
      { property: "swe", value: 0.0, unit: "[in_i]", time: "2026-09-04T06:00:00Z", source_id: "nrcs.awdb" },
      { property: "snow_depth", value: 0.0, unit: "[in_i]", time: "2026-09-04T06:00:00Z", source_id: "nrcs.awdb" },
    ],
  },
  {
    id: "place/union-reservoir", name: "UNION RESERVOIR", huc12: "101900050703", lon: -105.04, lat: 40.17, networks: ["cdwr_station"],
    props: { capacity_af: 12800, capacity_dam: "Union Dam", capacity_source: "co.damsafety", cdwr_station_type: "Reservoir" },
    stationProps: { capacity_af: 12800, capacity_dam: "Union Dam" },
    readings: [
      { property: "reservoir_storage", value: 9860.0, unit: "[acr_us].[ft_i]", time: T_FRESH, source_id: "cdss.telemetry" },
      { property: "reservoir_fill", value: 77.0, unit: "%", time: T_FRESH, source_id: "derived.fill", derived: true, basis: ["reservoir_storage", "capacity_af"] },
    ],
  },
  {
    id: "place/leggett-valmont-reservoir", name: "LEGGETT-VALMONT RESERVOIR", huc12: "101900050701", lon: -105.19, lat: 40.03, networks: ["cdwr_station"],
    props: { cdwr_station_type: "Reservoir" },
    readings: [{ property: "reservoir_storage", value: 3120.0, unit: "[acr_us].[ft_i]", time: T_FRESH, source_id: "cdss.telemetry" }],
  },
  {
    id: "place/six-mile-reservoir", name: "SIX MILE RESERVOIR", huc12: "101900050702", lon: -105.12, lat: 40.06, networks: ["cdwr_station"],
    props: { cdwr_station_type: "Reservoir" },
    readings: [{ property: "reservoir_storage", value: 1410.0, unit: "[acr_us].[ft_i]", time: T_STALE, source_id: "cdss.telemetry" }],
  },
  {
    id: "place/gross-reservoir", name: "Gross Reservoir ", huc12: "101900050503", lon: -105.357318, lat: 39.94771,
    networks: ["cdwr_station"], sameAs: ["https://dwr.state.co.us/Tools/Stations/GROSRECO"],
    props: { capacity_af: 41811, capacity_dam: "Gross Dam", capacity_source: "co.damsafety", cdwr_station_type: "Reservoir" },
    stationProps: { capacity_af: 41811, capacity_dam: "Gross Dam" },
    readings: [
      { property: "reservoir_storage", value: 29281.0, unit: "[acr_us].[ft_i]", time: "2021-09-20T15:30:00Z", source_id: "cdss.telemetry" },
      { property: "reservoir_fill", value: 70.0, unit: "%", time: "2021-09-20T15:30:00Z", source_id: "derived.fill", derived: true, basis: ["reservoir_storage", "capacity_af"] },
    ],
  },
  {
    id: "place/south-boulder-cr-at-forebay-nr-eldorado-springs-co", name: "SOUTH BOULDER CR AT FOREBAY NR ELDORADO SPRINGS, CO", huc12: "101900050504",
    lon: -105.29, lat: 39.93, networks: ["usgs_nwis"], sameAs: ["https://waterdata.usgs.gov/monitoring-location/06729450"],
    props: { usgs_site_type: "ST" },
    readings: [
      { property: "water_temp", value: 12.4, unit: "Cel", time: T_FRESH, source_id: "usgs.ogcapi.latest", quality: "P" },
      { property: "dissolved_oxygen", value: 8.1, unit: "mg/L", time: T_FRESH, source_id: "usgs.ogcapi.latest", quality: "P" },
      { property: "ph", value: 7.6, unit: "[pH]", time: T_FRESH, source_id: "usgs.ogcapi.latest", quality: "P" },
      { property: "turbidity", value: 1.9, unit: "[FNU]", time: T_FRESH, source_id: "usgs.ogcapi.latest", quality: "P" },
      { property: "specific_conductance", value: 84, unit: "uS/cm", time: T_FRESH, source_id: "usgs.ogcapi.latest", quality: "P" },
    ],
  },
  {
    id: "place/boulder-cu-2102-athens-st", name: "Boulder CU 2102 Athens St", huc12: "101900050603", lon: -105.27, lat: 40.01,
    networks: ["epa_aqs"], props: { epa_aqs_site: "080130014" },
    readings: [
      { property: "pm25", value: 6.2, unit: "ug/m3", time: T_STALE, source_id: "epa.airnow", quality: "qc" },
      { property: "ozone", value: 41, unit: "ppb", time: T_STALE, source_id: "epa.airnow", quality: "qc" },
    ],
  },
  {
    // rule-2 fixture: its id record carries an extra key (see below)
    id: "place/coal-creek-near-plainview-co", name: "COAL CREEK NEAR PLAINVIEW, CO", huc12: "101900050601", lon: -105.23, lat: 39.86,
    networks: ["cdwr_station"], props: cdssProps("00178012", "1019000506", "0600601", "1998-10-01"),
    readings: [discharge(0.8, T_FRESH)], extraIdKey: { elevation_m: 1960 },
  },
  {
    // unrelated: a different HUC-8
    id: "place/clear-creek-at-golden-co", name: "CLEAR CREEK AT GOLDEN, CO", huc12: "101900040101", lon: -105.235, lat: 39.755,
    networks: ["cdwr_station", "usgs_nwis"], props: cdssProps("00169989", "1019000401", "0700101", "1974-10-01"),
    readings: [discharge(35.0, T_FRESH)],
  },
];

// a generalized place: no readings, point generalized onto its HUC-12
const secretSpring = {
  id: "place/secret-spring", kind: "other", name: "Secret Spring", huc12: "101900050402",
  bbox: [-105.49, 40.02, -105.49, 40.02], sensitivity: "generalized",
};

// --- writers ---------------------------------------------------------------------
function idRecord(p, extra = {}) {
  return {
    schema_version: "1.0", id: p.id, kind: p.kind ?? "monitoring_site", name: p.name, huc12: p.huc12, bbox: p.bbox ?? [p.lon, p.lat, p.lon, p.lat],
    sensitivity: p.sensitivity ?? "public",
    geometry_url: `${BASE}/geom/${p.id}.geojson`, latest_url: `${BASE}/latest/${p.id}.json`, twin_url: `${SITE}/front-range/twin?focus=${p.id}`,
    sameAs: p.sameAs, generated_at: NOW, ...extra,
  };
}
function indexEntry(p) {
  return { id: p.id, kind: p.kind ?? "monitoring_site", name: p.name, bbox: p.bbox ?? [p.lon, p.lat, p.lon, p.lat], huc12: p.huc12 };
}
function placePage(p, extra = {}) {
  return {
    schema_version: "1.0", generated_at: NOW, id: p.id, kind: p.kind ?? "monitoring_site", name: p.name, huc12: p.huc12,
    parent_id: p.parent_id, bbox: p.bbox ?? [p.lon, p.lat, p.lon, p.lat], centroid: p.lon !== undefined ? [p.lon, p.lat] : undefined,
    children: p.children ?? [], props: p.props,
    readings: (p.readings ?? []).map((r) => reading(r, "threshold")), series: p.series ?? {}, ...extra,
  };
}
function station(p) {
  return { id: p.id, name: p.name, kind: "monitoring_site", lon: p.lon, lat: p.lat, huc12: p.huc12, networks: p.networks, props: p.stationProps, readings: p.readings.map((r) => reading(r, "verdict")) };
}
const SOURCES = {
  "cdss.telemetry": { title: "Colorado DWR Telemetry Stations", agency: "Colorado Division of Water Resources", tier: "A", license: "public-domain", cadence: 900, warn: 2700, crit: 10800, last_ok: "2026-09-06T05:55:06Z", staleness_s: 751, health: "ok" },
  "usgs.ogcapi.latest": { title: "USGS Water Data OGC API", agency: "U.S. Geological Survey", tier: "A", license: "public-domain", cadence: 900, warn: 2700, crit: 10800, last_ok: "2026-09-06T05:50:00Z", staleness_s: 1800, health: "ok" },
  "nrcs.awdb": { title: "NRCS AWDB (SNOTEL)", agency: "USDA Natural Resources Conservation Service", tier: "A", license: "public-domain", cadence: 3600, warn: 14400, crit: 86400, last_ok: "2026-09-04T06:10:00Z", staleness_s: 172200, health: "critical" },
  "epa.airnow": { title: "EPA AirNow", agency: "U.S. Environmental Protection Agency", tier: "A", license: "public-domain", cadence: 3600, warn: 10800, crit: 43200, last_ok: "2026-09-04T20:20:00Z", staleness_s: 121000, health: "critical" },
  "usdm.current": { title: "U.S. Drought Monitor", agency: "National Drought Mitigation Center", tier: "A", license: "public-domain", cadence: 604800, warn: 777600, crit: 1382400, last_ok: "2026-09-04T12:00:00Z", staleness_s: 151200, health: "ok" },
  "derived.fill": { title: "Derived reservoir fill", agency: "Front Range Bioregional Twin", tier: "static", license: "public-domain", cadence: 300, warn: 10800, crit: 86400, health: "unknown", attribution: "Derived by the twin: CDSS reservoir storage ÷ Colorado Dam Safety normal storage" },
};
function conditionsSources() {
  return Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, { health: s.health, last_ok: s.last_ok, staleness_s: s.staleness_s, attribution: s.attribution ?? s.agency, tier: s.tier, license: s.license }]));
}
function healthBoard(stationList) {
  return {
    schema_version: "1.0", generated_at: NOW,
    sources: Object.entries(SOURCES).map(([source_id, s]) => {
      const rs = stationList.flatMap((p) => p.readings.map((r) => reading(r, "verdict"))).filter((r) => r.source_id === source_id);
      return { source_id, title: s.title, agency: s.agency, tier: s.tier, license: s.license, attribution: s.attribution ?? s.agency, health: s.health, last_ok: s.last_ok, staleness_s: s.staleness_s, nominal_cadence_s: s.cadence, staleness_warn_s: s.warn, staleness_crit_s: s.crit, readings: rs.length, stale_readings: rs.filter((r) => r.stale).length };
    }),
  };
}

function writeTree(root, { stationList, watershedList, extras, includeGeneralized }) {
  rmSync(root, { recursive: true, force: true });
  const put = (rel, body) => {
    const f = join(root, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, typeof body === "string" ? body : dumps(body) + "\n");
  };
  const indexed = [...stationList.map(indexEntry), ...watershedList.map(indexEntry), ...(includeGeneralized ? [indexEntry(secretSpring)] : []), ...(extras.index ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  put("id/index.json", { schema_version: "1.0", generated_at: NOW, count: indexed.length, places: indexed });
  for (const p of stationList) {
    put(`id/${p.id}.json`, idRecord(p, p.extraIdKey ?? {}));
    put(`latest/${p.id}.json`, placePage(p));
  }
  for (const w of watershedList) {
    put(`id/${w.id}.json`, idRecord(w));
    put(`latest/${w.id}.json`, placePage(w));
  }
  if (includeGeneralized) {
    put(`id/${secretSpring.id}.json`, idRecord(secretSpring));
    put(`latest/${secretSpring.id}.json`, placePage(secretSpring));
  }
  for (const [rel, body] of Object.entries(extras.files ?? {})) put(rel, body);
  put("latest/conditions.json", { schema_version: "1.0", generated_at: NOW, bbox: [-106.5, 38.5, -104.0, 41.0], sources: conditionsSources(), stations: stationList.map(station).sort((a, b) => (a.id < b.id ? -1 : 1)) });
  put("latest/health.json", healthBoard(stationList));
}

// --- the binding tree ---------------------------------------------------------
const retired = {
  id: "place/boulder-creek-at-75th-st", name: "BOULDER CREEK AT 75TH ST", huc12: "101900050604", lon: -105.178, lat: 40.052,
  props: cdssProps("00178354", "1019000506", "0600503", "1986-10-01"), readings: [],
};
writeTree(join(here, "public"), {
  stationList: stations,
  watershedList: watersheds,
  includeGeneralized: true,
  extras: {
    files: {
      // a superseded page: kept under latest/, absent from id/ and the index (survey §1.5)
      [`latest/${retired.id}.json`]: placePage(retired, { superseded_by: "place/boulder-creek-at-north-75th-st-near-boulder-co" }),
      "latest/drought.geojson": {
        type: "FeatureCollection", schema_version: "1.0", generated_at: NOW, source_id: "usdm.current",
        features: [
          { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-105.7, 39.9], [-105.0, 39.9], [-105.0, 40.2], [-105.7, 40.2], [-105.7, 39.9]]] },
            properties: { id: "1-40213", source_id: "usdm.current", dm: 1, label: "D1", period_start: "2026-09-01", period_end: "2026-09-07", release_date: "2026-09-03", phenomenon_time: "2026-09-01T00:00:00Z", expires_at: "2026-09-15T00:00:00Z" } },
        ],
      },
      "latest/snow.json": {
        schema_version: "1.0", generated_at: NOW, snowline_m: null, opacity: 0,
        basis: [{ id: "place/niwot", elevation_m: 3021.0, swe_mm: 0.0, snow_depth_cm: 0.0, time: "2026-09-04T06:00:00Z", stale: true }],
        rule: "lowest elevation at which ≥2 of the 3 nearest-by-elevation SNOTEL sites report snow depth > 0; opacity = median SWE above the line / 300 mm, capped at 1",
        stale: true,
      },
    },
  },
});

// --- the twin-client tree (smaller) ---------------------------------------
if (process.argv.includes("--twin-client")) {
  const pick = (ids) => stations.filter((s) => ids.includes(s.id));
  writeTree(join(here, "..", "..", "..", "twin-client", "test", "fixtures"), {
    stationList: pick(["place/boulder-creek-near-orodell-co", "place/boulder-creek-co-below-broadway-st", "place/niwot", "place/gross-reservoir"]),
    watershedList: watersheds.filter((w) => w.id === "watershed/huc10-1019000504"),
    includeGeneralized: false,
    extras: { index: [{ id: "bioregion/front-range", kind: "bioregion", name: "Front Range Bioregion", bbox: [-106.19, 39.29, -104.62, 40.99] }] },
  });
}
