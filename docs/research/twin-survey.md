# The Front Range Bioregional Twin — a read-only survey for Kami

Surveyed at `/home/user/frontrange-twin`, commit `6546246` ("chore: drop a stray harness scratch file"), 2026-09-06. Nothing was modified. All citations are `path:line` in that repo. Published tree lives at `https://data.bioregionaltwin.org`; the site at `https://bioregionaltwin.org`.

**Read-only contract.** The twin publishes files, not an API (`twin/publisher/build.py:1-24`). There is no public origin, no auth, no write path. Kami reads it exactly as a browser does. The twin's own architecture already anticipates this consumer — see §9.

---

## 1. The published tree

### 1.1 Every path the publisher writes

Canonical listing: `twin/publisher/build.py:8-23` (module docstring), assembled in `build_all` at `twin/publisher/build.py:1393-1409`, sorted by path.

| Path pattern | Builder | Cache class | Content-Type |
|---|---|---|---|
| `latest/conditions.json` | `_conditions` `build.py:889-940` | `latest` | `application/json` |
| `latest/health.json` | `_health_board` `build.py:1123-1165` | `latest` | `application/json` |
| `latest/snow.json` | `_snow` `build.py:943-1016` | `latest` | `application/json` |
| `latest/alerts.geojson` | `_alerts` `build.py:1059-1060` | `latest` | `application/geo+json` |
| `latest/detections.geojson` | `_detections` `build.py:1063-1066` | `latest` | `application/geo+json` |
| `latest/quakes.geojson` | `_quakes` `build.py:1069-1070` | `latest` | `application/geo+json` |
| `latest/drought.geojson` | `_drought` `build.py:1073-1074` | `latest` | `application/geo+json` |
| `latest/fires.geojson` | `_fires` `build.py:1077-1108` | `latest` | `application/geo+json` |
| `latest/flow_network.json` | `_network` `build.py:1168-1187` | `latest` | `application/json` |
| `latest/{ns}/{slug}.json` (place page) | `_places` `build.py:1194-1218` | `latest` | `application/json` |
| `id/index.json` | `_places` `build.py:1277-1288` | `id` | `application/json` |
| `id/{ns}/{slug}.json` | `_places` `build.py:1246-1263` | `id` | `application/json` |
| `geom/{ns}/{slug}.geojson` | `_places` `build.py:1219-1238` | `geom` | `application/geo+json` |
| `boundary/v1.geojson` | `_boundary` `build.py:1300-1327` | `boundary` | `application/geo+json` |
| `boundary/v1.md` | `_boundary` `build.py:1328-1336` | `boundary` | `text/markdown` |
| `network/reaches.geojson` | `_network` `build.py:1185` | `network` | `application/geo+json` |
| `tiles/manifest.json` | `twin/build/manifest.py:262-273` | `id` | `application/json` |
| `tiles/basemap-<sha8>.pmtiles`, `tiles/assets-<sha8>/fonts/…`, `…/sprites/black.*` | `twin/build/vector.py`, `twin/build/assets.py` | `tiles` | various |

`{ns}/{slug}` is the place id verbatim: `latest/place/boulder-creek-near-orodell-co.json`, `id/watershed/huc10-1019000504.json`, `geom/bioregion/front-range.geojson`. Namespaces seen in the tree: `place/`, `watershed/`, `bioregion/`.

**Not yet published (do not build against):** `briefings/…` (specified but unbuilt — §6), `normals/…`, `snapshots/…`, `series/…`, `species/…`, `raster/…` (all proposals — §1.6). `network/reaches.geojson` + `latest/flow_network.json` are built in `build.py` but `README.md:73-77` lists NHDPlus flowlines as "what is not" done; treat them as may-404.

### 1.2 Determinism, hashing, `generated_at`

- `_dumps` (`build.py:192-198`): `json.dumps(separators=(",",":"), sort_keys=True, ensure_ascii=False)`. Sorted keys, no whitespace, real UTF-8.
- `_iso` (`build.py:201-205`): **the only timestamp format emitted** — UTC, whole seconds, trailing `Z`: `2026-09-04T08:22:38Z`.
- `_compact` (`build.py:208-216`): **drops every key whose value is `None`.** This is why every optional field in `web/src/data/types.ts` is `field?: T` and not `T | null`. Explicit nulls are validation errors under `sources/ids-schema.json`'s `additionalProperties: false`; omission is the only way to say "unknown". Exception: `network/reaches.geojson` writes `ds: null` deliberately at an outlet (`twin/publisher/network.py:116`, and `types.ts:345`).
- `generated_at` is the build's `now`, an argument, never `datetime.now()` (`build.py:31-40`, `_Ctx.__init__` `build.py:239-243`). Every JSON/GeoJSON artifact carries it, asserted in `tests/test_publisher_build.py:205-212`.
- `content_hash_for` (`build.py:164-166`) hashes the body with `"generated_at":"…"` replaced by `"generated_at":"*"` (`build.py:160-161`), so the publisher can skip uploads for the ~4,000 files whose data did not change.
- **Freshness guarantee:** files *directly* under `latest/` (`conditions.json`, `health.json`, `snow.json`, `flow_network.json`, the five geojsons) are rewritten every cycle regardless of hash (`always_written`, `backends.py:423-431`). `latest/place/x.json` and everything under `id/`, `geom/`, `boundary/`, `network/` skip on hash equality — **so a place page's `generated_at` can be hours or days behind `conditions.json`'s.** Do not use a place page's `generated_at` as a clock.
- Publish cadence: every `PUBLISH_INTERVAL_S` seconds, default **300** (`twin/publisher/__init__.py:54`, `_default_interval` `:66-73`).
- Withdrawal: a place turning `restricted` is *deleted* from the bucket by `_prune` (`backends.py:526-573`), floor-guarded at `PRUNE_FLOOR_FRACTION = 0.5` / `PRUNE_FLOOR_ARTIFACTS = 100` (`backends.py:114-115`). So a 404 on a previously-known id is a real, meaningful state.

### 1.3 Cache-Control — verbatim, asserted in tests

`twin/publisher/backends.py:87-96`, asserted verbatim at `tests/test_publisher_backends.py:124-138, 616`:

```python
CACHE_CONTROL = {
    "latest":   "public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400",
    "id":       "public, max-age=300",
    "geom":     "public, max-age=300",
    "boundary": "public, max-age=300",
    "tiles":    "public, max-age=31536000, immutable",
    "network":  "public, max-age=3600, stale-while-revalidate=86400",
}
```

`cache_control_for` raises on an unknown class — no safe default (`backends.py:141-152`). The local backend writes a sidecar `<file>.headers.json` next to each body (`HEADERS_SUFFIX`, `backends.py:100`; `_write_headers` `:310-315`) — useful for a fixture tree.

Client-side mirror: `web/src/config.ts:78-79` `FRESH_S = 600`, `STALE_S = 3600`; `REFRESH_MS = 60_000` (`:84`). The conditions and snow polls use `cache: "no-cache"` so a 60 s poll against `max-age=60` still revalidates (`web/src/data/client.ts:240`, `:538`).

### 1.4 `latest/conditions.json`

Built at `build.py:889-940`. TypeScript mirror `web/src/data/types.ts:76-83`:

```ts
export interface Conditions {
  schema_version: string;      // "1.0"
  generated_at: string;        // ISO Z — the badge's clock
  bbox: number[];              // list(cfg.bbox) → [-106.5, 38.5, -104.0, 41.0]
  sources: Record<string, SourceHealth>;
  stations: Station[];         // sorted by id
}
export interface SourceHealth {   // types.ts:67-74
  health: Health;                 // "ok"|"warning"|"critical"|"unknown"
  last_ok?: string | null;
  staleness_s?: number | null;
  attribution: string;
  tier?: string;                  // "A"|"B"|"C"|"static"
  license?: string;               // "public-domain" | "cc-by-nc" | ...
}
export interface Station {        // types.ts:53-65
  id: string; name: string; kind: string;   // kind is always "monitoring_site" here
  lon?: number | null; lat?: number | null;
  huc12?: string | null;
  networks?: string[];            // sorted identifier schemes for this place
  props?: Record<string, unknown> | null;   // ONLY capacity_af / capacity_dam
  readings: Reading[];
}
```

Notes an engineer will need:
- Only `rec.kind == "monitoring_site"` places with at least one reading appear (`build.py:891-896`; test `tests/test_publisher_build.py:307`).
- `networks` = `sorted({scheme for scheme,_ in identifiers})` (`build.py:358-359`). Schemes are enumerated in `sql/002_core.sql:88-90`: `wikidata|gnis|nhd_reachcode|nhdplusv2_comid|huc8|huc10|huc12|geoconnex|usgs_nwis|cdwr_station|nrcs_snotel|epa_aqs|neon_site|irwin|mtbs|gbif_taxon|itis_tsn|usda_plants|osm|h3_r8` (plus `nwps_lid` from `twin/adapters/nwps.py`).
- `props` on a station is the *filtered* subset `("capacity_af", "capacity_dam")` and is omitted entirely (not `{}`) when both are absent (`_STATION_PROPS` `build.py:856`; `_station_props` `build.py:875-883`).
- A derived `reservoir_fill` reading is appended by `_with_fill` (`build.py:859-872`) when `props.capacity_af` exists.
- Source health map values go through `_compact`, so `last_ok` / `staleness_s` are **absent** for a source that has never succeeded (see `nasa.firms` in the checked-in fixture).

### 1.5 `latest/{ns}/{slug}.json` — the place page

Built at `build.py:1194-1218`. TypeScript mirror `types.ts:164-183`:

```ts
export interface PlacePage {
  schema_version: string; generated_at: string;
  id: string; kind: string; name: string;
  huc12?: string | null;
  parent_id?: string | null;      // omitted when the parent did not survive the gate
  superseded_by?: string | null;  // only when the successor is itself published
  bbox?: number[] | null;         // [minx,miny,maxx,maxy]; for a point → [x,y,x,y]
  centroid?: [number, number] | null;
  children?: string[];            // sorted; [] is present, not dropped
  props?: Record<string, unknown>;  // the FULL gated props bag (not the filtered station subset)
  readings: Reading[];            // staleness_crit_s, no clock
  series: Record<string, Series>; // key = external_key, e.g. "BOCOROCO/DISCHRG"
}
export interface Series {         // types.ts:156-162
  property: string; unit?: string | null; source_id: string;
  t: string[];                    // ISO Z
  v: (number | null)[];           // same length as t; null where the source sent text
}
```

- Series window: **7 days**, thinned to at most **2000** points by uniform every-k-th sampling, never averaged (`SERIES_WINDOW`/`MAX_SERIES_POINTS` `build.py:100-101`; `_downsample` `build.py:793-807`).
- Series keys are the datastream's `external_key` (`06730200/00060`, `BOCOROCO/DISCHRG`), qualified as `"{source_id}:{external_key}"` **only** when two sources hand the same place the same key (`_series_keys` `build.py:768-790`).
- `kind` is the full `core.place_kind` enum (`sql/002_core.sql:3-8`), so a place page can be `watershed`, `bioregion`, `fire_event`, etc. — not just `monitoring_site`.
- A **superseded** place keeps its `latest/` and `geom/` page forever but is dropped from `id/` and `id/index.json` (`build.py:1240-1244`; test `tests/test_publisher_build.py:412`). Kami must render the `superseded_by` banner.

### 1.6 Proposed-but-absent prefixes

`docs/proposals/2026-09-06-terrarium-enrichment.md:502-543` sketches the future tree (`normals/`, `snapshots/YYYY/MM/DD/HH.json`, `series/{ns}/{slug}/YYYY-MM.json`, `species/`, `raster/`, plus a new `snapshot` cache class `public, max-age=31536000, immutable`). **Status: proposal, not approved** (`:3`). Kami's client should treat any of these as 404-until-they-exist. Their planned shapes are in Appendix A (`:864-975`) and summarised in §2.7 below.

---

## 2. Readings and staleness

### 2.1 The `Reading` shape

Built by `_reading` (`build.py:724-765`); typed at `web/src/data/types.ts:13-51`:

```ts
export interface Reading {
  property: string;             // "discharge", "air_temp", "soil_moisture_8in", "usgs_63160"
  value?: number | null;
  value_text?: string | null;   // e.g. "Ice" — present only when the source sent text
  unit?: string | null;         // UCUM
  time?: string | null;         // phenomenon_time — when it happened
  result_time?: string | null;  // when the source produced it
  quality?: string | null;      // the source's own flag, verbatim
  source_id: string;
  derived?: boolean;            // true only for reservoir_fill today
  basis?: string[];             // ["reservoir_storage", "capacity_af"]
  staleness_s?: number | null;      // conditions.json / snow.json ONLY
  stale?: boolean | null;           // conditions.json / snow.json ONLY
  staleness_crit_s?: number | null; // per-place pages ONLY
}
```

### 2.2 The two staleness dialects — this is the load-bearing detail

`build.py:42-54` and `_reading`'s docstring `build.py:724-747`:

- **`clock=True`** → `staleness_s` (int seconds) + `stale` (bool), computed against the build's `now`. Used only by `latest/conditions.json` and `latest/snow.json` (`ctx.readings`, `build.py:382-392`). Those files are rewritten every cycle, so a precomputed verdict is honest.
- **`clock=False`** → `staleness_crit_s` (int seconds), and **no** `staleness_s`/`stale` at all. Used by the ~2,000 per-place pages (`ctx.place_readings`, `build.py:394-402`). Those are CDN-cached, so a baked `stale: false` would rot; the client subtracts.

SQL that produces all three: `_LATEST_READINGS_SQL` `build.py:584-593` —
```sql
extract(epoch from (now - l.phenomenon_time))              as staleness_s,
(now - l.phenomenon_time) > r.staleness_crit               as stale,
extract(epoch from r.staleness_crit)                       as staleness_crit_s
```
against `obs.v_latest` (`sql/003_obs.sql:66-72`, `DISTINCT ON (datastream_id) … ORDER BY phenomenon_time DESC`) joined to `meta.source_registry`.

**Per datastream, never per property** (`build.py:383-392`): a reservoir with two conduits yields two `discharge` readings on one station.

**Staleness is per reading, not per source** (`build.py:42-46`): verified live, CDSS `BOC109CO` was <1 h fresh while `BOCOROCO` on the same feed was 26 days stale.

The canonical client-side resolver — **copy this logic into Kami's client** (`web/src/data/reading.ts:44-67`):

```ts
export function readingStaleness(reading: Reading, now = Date.now()): ReadingStaleness {
  const t = reading.time ? Date.parse(reading.time) : NaN;
  const age = Number.isNaN(t) ? null : Math.max(0, (now - t) / 1000);
  const crit = reading.staleness_crit_s;
  if (age !== null && typeof crit === "number" && crit > 0)
    return { seconds: age, stale: age > crit, unknown: false };
  if (typeof reading.stale === "boolean")
    return { seconds: age ?? reading.staleness_s ?? null, stale: reading.stale, unknown: false };
  return { seconds: age, stale: false, unknown: true };   // unknown ≠ fresh
}
```
Preference order is **threshold-then-flag**, and a reading with neither is `unknown: true` — which must never be drawn as fresh (`reading.ts:15-24`).

### 2.3 Source thresholds — the `source_id → seconds` table

Source of truth: `sources/sources.seed.yaml` (seeds `meta.source_registry` via `twin/seed_sources.py`). `staleness_crit` is exactly the `staleness_crit_s` a reading from that source carries.

| `source_id` | tier | nominal cadence | `staleness_warn_s` | **`staleness_crit_s`** | seed line |
|---|---|---|---|---|---|
| `cdss.telemetry` | A | 900 | 2700 | **10800** | `:4-21` |
| `usgs.ogcapi.latest` | A | 900 | 2700 | **10800** | `:23-37` |
| `nwps.gauges` | A | 3600 | 10800 | **43200** | `:39-52` |
| `nrcs.awdb` | A | 3600 | 14400 | **86400** | `:54-67` |
| `nws.alerts` | A | 120 | 600 | **3600** | `:69-83` |
| `nws.observations` | A | 600 | 2700 | **10800** | `:85-97` |
| `nasa.firms` | A | 600 | 3600 | **21600** | `:99-112` |
| `nifc.wfigs` | A | 300 | 1800 | **10800** | `:114-128` |
| `epa.airnow` | A | 3600 | 10800 | **43200** | `:130-144` |
| `usgs.quakes` | A | 300 | 1800 | **21600** | `:146-159` |
| `csu.coagmet` | A | 900 | 3600 | **21600** | `:161-173` |
| `usdm.current` | A | 604800 | 777600 | **1382400** | `:175-185` |
| `purpleair.sensors` | B | 3600 | 10800 | **43200** | `:188-202` (`license_mixable: false`, CC BY-NC) |
| `noaa.hms.smoke` | B | 10800 | 43200 | **172800** | `:204-217` |
| `usgs.wbd` | static | 31536000 | 34560000 | **69120000** | `:220-238` |
| `usgs.nhdplus_hr` | static | 31536000 | 34560000 | **69120000** | `:240-259` |
| `epa.ecoregions` | static | 31536000 | 34560000 | **69120000** | `:261-279` |
| `usgs.monitoring_locations` | static | 2592000 | 3888000 | **7776000** | `:281-306` |
| `cdss.surfacewater` | static | 2592000 | 3888000 | **7776000** | `:308-326` |
| `nws.stations` | static | 2592000 | 3888000 | **7776000** | `:328-344` |
| `co.damsafety` | static | 7776000 | 10368000 | **31536000** | `:346-368` |
| `derived.fill` | static | 300 | 10800 | **86400** | `:370-387` (not a feed) |

`derived.fill` is a pseudo-source for the publisher's own computation (`sources.seed.yaml:370-387`, attribution `"Derived by the twin: CDSS reservoir storage ÷ Colorado Dam Safety normal storage"`).

### 2.4 `source_status` / health verdicts

The enum is `ok | warning | critical | unknown` (`types.ts:11`; asserted in `web/src/data/contract.test.ts:97-101` and `tests/test_publisher_build.py:231-241`).

Computed twice, identically. In SQL (`sql/010_source_health.sql:17-46`) and re-derived in Python against the build's `now` so two builds at the same `now` are byte-identical (`_health`, `build.py:810-820`):

```python
if staleness_s is None:        return "unknown"
if staleness_s > crit_s:       return "critical"
if staleness_s > warn_s:       return "warning"
if failing:                    return "warning"   # newest word is an error
return "ok"
```
`failing` = `last_error is not None and (last_ok is None or last_error > last_ok)` (`build.py:452-455`). A 304 counts as healthy (`sql/010_source_health.sql:8, 36`).

### 2.5 UCUM units and the property vocabulary

Closed vocabulary, `twin/adapters/base.py:66-133`. A source whose property is not in the table publishes under a source-prefixed name (`cdss_wlevel`, `usgs_63160`) rather than inventing a synonym (`base.py:62-65`).

```
discharge [ft_i]3/s      gage_height [ft_i]        stage [ft_i]
stage_forecast [ft_i]    flow_forecast [ft_i]3/s   water_temp Cel
specific_conductance uS/cm  dissolved_oxygen mg/L  ph [pH]   turbidity [FNU]
swe [in_i]  snow_depth [in_i]  precip_accum [in_i]  precip_1h mm  precip_5min mm
air_temp Cel  dewpoint Cel  rh %  wind_speed m/s  wind_gust m/s  wind_dir deg
pressure Pa   visibility m  solar_rad W/m2
soil_moisture{,_4cm,_24cm,_2in,_4in,_8in,_20in,_40in} %
soil_temp{,_5cm,_15cm,_2in,_4in,_8in,_20in,_40in}     Cel
pm25 ug/m3  pm10 ug/m3  ozone ppb  no2 ppb  so2 ppb  co ppm  aqi {AQI}
reservoir_storage [acr_us].[ft_i]   reservoir_elevation [ft_i]
fire_acres [acr_us]   percent_contained %
```
Plus, not in that table: `reservoir_fill` unit `%` (derived, `twin/publisher/derived.py:57`), `cdss_wlevel [ft_i]`, `cdss_storag [acr_us].[ft_i]`, `usgs_00045 [in_i]`, `usgs_62614 [ft_i]`, `usgs_63160 [ft_i]`.

**Empirically present in the checked-in fixture** (`web/src/__fixtures__/conditions.json`, 760 stations, build of 2026-09-04) — property, unit, count, contributing sources. This is the realistic distribution for test fixtures:

| property | unit | n | sources |
|---|---|---|---|
| discharge | `[ft_i]3/s` | 566 | cdss.telemetry, nwps.gauges, usgs.ogcapi.latest |
| stage | `[ft_i]` | 65 | nwps.gauges |
| gage_height | `[ft_i]` | 62 | usgs.ogcapi.latest |
| air_temp | `Cel` | 54 | csu.coagmet, nrcs.awdb, nws.observations |
| cdss_wlevel | `[ft_i]` | 42 | cdss.telemetry |
| dewpoint / rh | `Cel` / `%` | 39 / 39 | csu.coagmet, nws.observations |
| wind_speed / wind_dir / wind_gust | `m/s` / `deg` / `m/s` | 38/38/35 | csu.coagmet, nws.observations |
| usgs_63160 | `[ft_i]` | 37 | usgs.ogcapi.latest |
| reservoir_storage | `[acr_us].[ft_i]` | 36 | cdss.telemetry, nrcs.awdb |
| solar_rad | `W/m2` | 33 | csu.coagmet |
| precip_5min | `mm` | 33 | csu.coagmet |
| soil_temp_15cm / _5cm | `Cel` | 31 / 30 | csu.coagmet |
| ozone | `ppb` | 17 | epa.airnow |
| swe / snow_depth / precip_accum | `[in_i]` | 16 each | nrcs.awdb |
| pm25 | `ug/m3` | 13 | epa.airnow |
| water_temp | `Cel` | 8 | usgs.ogcapi.latest |
| no2 / specific_conductance / visibility | `ppb`/`uS/cm`/`m` | 8/6/6 | epa.airnow, usgs.ogcapi.latest, nws.observations |
| dissolved_oxygen / turbidity / pressure | `mg/L`/`[FNU]`/`Pa` | 5/5/5 | usgs.ogcapi.latest ×2, nws.observations |
| ph / reservoir_elevation / co / soil_moisture_20in / soil_moisture_8in / soil_temp_2in/_8in/_20in | `[pH]`/`[ft_i]`/`ppm`/`%`… | 4 each | — |
| so2 / usgs_00045 / soil_moisture_2in | `ppb`/`[in_i]`/`%` | 3 each | — |
| pm10 / soil_moisture_40in / soil_temp_40in / soil_temp_4in | | 2 each | — |
| flow_forecast / cdss_storag / usgs_62614 / soil_moisture_4cm / soil_moisture_24cm / soil_moisture_4in | | 1 each | — |

Note: that fixture's station objects carry **only** `id, kind, lat, lon, name, readings` — no `huc12`, `networks`, or `props`. It predates those fields; the live tree does emit them. Don't take the fixture as the schema.

Quality flags seen and their meanings (`web/src/data/reading.ts:78-88`): `P` provisional, `A` approved, `U` unverified, `O` observed, `V` verified, `C` computed, `S`/`E` estimated, `qc` quality-controlled. **Unrecognised flags are shown verbatim, never swallowed** (`reading.ts:90-93`).

UCUM → human labels: `UNIT_LABEL` at `reading.ts:123-152`. `[ft_i]3/s`→cfs, `[ft_i]`→ft, `[in_i]`→in, `[acr_us].[ft_i]`→acre-ft, `[acr_us]`→acres, `Cel`→°C, `ug/m3`→µg/m³, `uS/cm`→µS/cm, `W/m2`→W/m², `{AQI}`→AQI, `[NTU]`→NTU, `[FNU]`→FNU, `[pH]`→pH. Unrecognised codes return verbatim (`reading.ts:154-157`).

Property → human label: `PROPERTY_LABEL` `reading.ts:174-216`, with a depth-parsing regex `^soil_(moisture|temp)_(\d+)(in|cm)$` (`reading.ts:221-232`).

Property → family (6 families for colouring): `FAMILY_BY_PROPERTY` `reading.ts:268-306`; families `discharge | snowpack | air | weather | soil | other`, ordered `reading.ts:320-327`. `primaryReading` (`reading.ts:339-350`) picks the lead: family first, then first numeric value, preferring fresh, and **a `flow_forecast` never leads**.

### 2.6 The derived reading (`reservoir_fill`)

`twin/publisher/derived.py:41-67`. Emitted only when `props.capacity_af` is a finite number > 0 and the storage reading has a finite numeric `value`:

```json
{"property":"reservoir_fill","value":62.2,"unit":"%","time":"…","result_time":"…",
 "source_id":"derived.fill","derived":true,
 "basis":["reservoir_storage","capacity_af"], "stale":false,"staleness_s":1358}
```
`value = round(100 * storage.value / capacity_af, 1)`. Staleness keys are **copied verbatim** from the storage reading (`_STALENESS_KEYS` `derived.py:27`), so a fill reading follows whichever dialect its page uses.

### 2.7 `context` / percentiles / `normals` — DOES NOT EXIST TODAY

`docs/proposals/2026-09-06-terrarium-enrichment.md` §3.1 (`:56-118`), status **"proposal — not approved"** (`:3`). Diagnosis at `:32`: "There is no baseline anywhere. No percentile, normal, median or record field exists in the DB or the tree… `Reading` has no stats fields."

Planned baseline shape, Appendix A `:868-905`:

```jsonc
// a per-reading block on latest/conditions.json AND place pages, absent when no baseline
"context": {
  "class": "below",                 // record_low|much_below|below|normal|above|much_above|record_high
  "percentile": 18.4,
  "basis_kind": "percentile_of_record",  // |percent_of_median_1991_2020|departure_from_normal_1991_2020|own_record
  "basis_source": "USGS Statistics API v0 observationNormals",
  "years_of_record": 39,
  "window": "same calendar day",    // |"±15 days pooled"|"trailing 30 days at this site"
  "provisional": true,
  "sentence": "Lower than 4 in 5 Septembers here since 1986 (39 years of record; today's reading is provisional)."
}
```
```jsonc
// normals/{ns}/{slug}.json — one per datastream with a normal, cache class `id`
{ "place_id":"place/boulder-creek-at-orodell", "datastream":"cdss:BOCOROCO:DISCHRG",
  "property":"discharge","unit":"cfs",
  "basis":{"kind":"percentile_of_record","source":"…hyswap method","method":"weibull",
           "window_days":15,"years_of_record":120,"record_begin":"1906-10-01",
           "record_end":"2025-09-30","approval":"flags kept: […]",
           "fetched_at":"2026-09-06T05:58:00Z","licence":"Colorado public record; attribute DWR"},
  "percentile_levels":[5,10,25,50,75,90,95],
  "by_doy":{"09-06":{"n":3720,"p":[22.0,25.1,41.3,58.9,84.2,121.0,150.5],
                     "min":9.8,"min_year":2002,"max":611.0,"max_year":2013,
                     "median":58.9,"mean":71.4}},
  "timing":{"median_peak":"06-03"},
  "rule":"CONTEXT_RULE text: …", "generated_at":"…" }
```
The **copy rule** (`:80`): every relative sentence must name (1) the population, (2) the statistic kind, (3) the record length, (4) provisional-vs-approved. Below 10 water-years: no percentiles, min/median/max only. Median SWE < 1 in: say "no snow is normal on this date", never a percentage. Kami adopts the same rule if it ever computes context itself.

For Kami's MCP `compare_to_normal`, the twin's own architecture already rules: return `{available:false, reason:"twin publishes no baseline yet"}` until `normals/` ships (`docs/proposals/ecological-entities/02-technical-architecture.md:283`).

---

## 3. The identity registry

### 3.1 `sources/ids-schema.json` — in full (34 lines, the entire coupling surface)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://data.bioregionaltwin.org/id/schema/place-1.0.json",
  "title": "Front Range identity registry entry",
  "description": "The ENTIRE coupling surface between the twin and Prism. One ID string, one schema, two URL templates. No shared database, no shared library, no runtime call in either direction.",
  "type": "object",
  "required": ["schema_version", "id", "kind", "name", "generated_at"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "const": "1.0" },
    "id": { "type": "string", "pattern": "^[a-z_]+/[a-z0-9-]+$",
            "description": "Canonical ID, e.g. 'place/boulder-creek'. Immutable once published; aliased on rename; never reused." },
    "kind": { "type": "string", "enum": ["bioregion","watershed","stream_reach","waterbody","lake","reservoir",
             "peak","ridge","trail","protected_area","forest_stand","ecological_system",
             "monitoring_site","municipality","county","fire_event","flood_event",
             "restoration_site","other"] },
    "name":       { "type": "string" },
    "huc12":      { "type": "string", "pattern": "^[0-9]{12}$" },
    "bbox":       { "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4 },
    "sensitivity":{ "type": "string", "enum": ["public", "generalized"] },
    "geometry_url": { "type": "string", "format": "uri" },
    "latest_url":   { "type": "string", "format": "uri" },
    "twin_url":     { "type": "string", "format": "uri" },
    "commons_url":  { "type": "string", "format": "uri" },
    "sameAs":     { "type": "array", "items": { "type": "string", "format": "uri" } },
    "generated_at": { "type": "string", "format": "date-time" }
  }
}
```

`additionalProperties: false` is why the publisher omits rather than nulls (`build.py:210-215`). TypeScript mirror: `types.ts:389-405`.

### 3.2 URL templates

`build.py:826-846`, against `Settings` defaults (`twin/config.py:91-95`):

```
geometry_url = {PUBLIC_BASE_URL}/geom/{place_id}.geojson     → https://data.bioregionaltwin.org/geom/place/x.geojson
latest_url   = {PUBLIC_BASE_URL}/latest/{place_id}.json
twin_url     = {SITE_BASE_URL}/front-range/twin?focus={place_id}   → https://bioregionaltwin.org/front-range/twin?focus=place/x
commons_url  = {COMMONS_BASE_URL}/notes/{urlencoded vault path}    → only when the commons publication lists it
rationale_url= {PUBLIC_BASE_URL}/boundary/v1.md
```

`sameAs` is built from `SAME_AS_TEMPLATES` (`build.py:128-133`), sorted, and **omitted when empty** (`build.py:1259`):
```python
"wikidata":     "https://www.wikidata.org/wiki/{}"
"gnis":         "https://geonames.usgs.gov/apex/f?p=gnispq:3:::NO::P3_FID:{}"
"usgs_nwis":    "https://waterdata.usgs.gov/monitoring-location/{}"
"cdwr_station": "https://dwr.state.co.us/Tools/Stations/{}"
```
Only those four schemes become `sameAs` URIs; the rest stay in `networks`.

### 3.3 `id/index.json`

`build.py:1264-1288`:

```jsonc
{ "schema_version": "1.0",
  "generated_at": "2026-09-06T06:00:00Z",
  "count": 1387,
  "places": [                       // sorted by id
    { "id": "bioregion/front-range", "kind": "bioregion", "name": "Front Range Bioregion",
      "bbox": [-106.19, 39.29, -104.62, 40.99] },
    { "id": "place/boulder-creek-near-orodell-co", "kind": "monitoring_site",
      "name": "BOULDER CREEK NEAR ORODELL, CO.",
      "bbox": [-105.330825, 40.006375, -105.330825, 40.006375],
      "huc12": "101900050301" }
  ] }
```
Index entries carry only `id, kind, name, bbox, huc12` (each `_compact`-ed). **Superseded and non-`active` places are absent from the index and from `id/`** (`build.py:1243-1244`). `count == len(places)`.

### 3.4 Example entries (composed from the code paths; these are fixture-grade)

`place/boulder-creek-near-orodell-co` — the CDSS canyon-mouth gauge. Real coordinates from the fixture (`web/src/__fixtures__/conditions.json`: `lat 40.006375, lon -105.330825`, name `"BOULDER CREEK NEAR ORODELL, CO."`, one `discharge` reading, `quality "O"`, `unit "[ft_i]3/s"`).

```jsonc
// id/place/boulder-creek-near-orodell-co.json
{ "schema_version": "1.0",
  "id": "place/boulder-creek-near-orodell-co",
  "kind": "monitoring_site",
  "name": "BOULDER CREEK NEAR ORODELL, CO.",
  "huc12": "101900050301",
  "bbox": [-105.330825, 40.006375, -105.330825, 40.006375],
  "sensitivity": "public",
  "geometry_url": "https://data.bioregionaltwin.org/geom/place/boulder-creek-near-orodell-co.geojson",
  "latest_url":   "https://data.bioregionaltwin.org/latest/place/boulder-creek-near-orodell-co.json",
  "twin_url":     "https://bioregionaltwin.org/front-range/twin?focus=place/boulder-creek-near-orodell-co",
  "commons_url":  "https://prism.omniharmonic.com/p/front-range/notes/wiki%2Fplaces%2Fmonitoring%2Fboulder-creek-near-orodell-co",
  "sameAs": ["https://dwr.state.co.us/Tools/Stations/BOCOROCO",
             "https://waterdata.usgs.gov/monitoring-location/06727500"],
  "generated_at": "2026-09-06T06:00:00Z" }
```
Its place page's `props` carry the CDSS station block (`twin/ingest/stations.py:626-643`): `cdwr_station_type, cdwr_structure_type, cdwr_station_status, cdwr_water_source, cdwr_stream_gnis_id, cdwr_wdid, cdwr_huc10, cdwr_parameters, cdwr_por_start, cdwr_por_end, cdwr_data_source`. **`props.cdwr_stream_gnis_id` is the STREAM's GNIS id, never a place identifier** — `twin/ingest/stations.py:34` and the inline comment at `:631`. It is exactly what the entity-binding proposal uses as a membership rule: `"watershed name contains 'Boulder Creek' + props.cdwr_stream_gnis_id == '00178354'"` (`docs/proposals/ecological-entities/02-technical-architecture.md:229`).

`place/niwot` — the SNOTEL site (fixture: `lat 40.03581, lon -105.5452`, four `nrcs.awdb` readings — `air_temp Cel`, `precip_accum [in_i]`, `snow_depth [in_i]`, `swe [in_i]` — all `stale: true, staleness_s: 181358` in that build). Its place page's `props` must include `awdb_elevation_m`, which is what puts it into `latest/snow.json` (`build.py:959-961`). `sameAs` would carry `nrcs_snotel` — *not* in `SAME_AS_TEMPLATES`, so a SNOTEL-only site may legitimately have **no** `sameAs` key at all.

`place/gross-reservoir` — fixture: `lat 39.94771, lon -105.357318`, name `"Gross Reservoir "` (note the trailing space — names are verbatim), one `reservoir_storage` reading `29281.0 [acr_us].[ft_i]` with `time 2021-09-20T15:30:00Z`, `stale: true`, `staleness_s: 156358358`. **This is your canonical very-stale fixture.** With `props.capacity_af` from `co.damsafety` it would also carry a `reservoir_fill` derived reading; `props.capacity_dam` and `props.capacity_source` come from the same ingest (`twin/ingest/dams.py:186, 218`).

`watershed/huc10-1019000504` — id minted by `place_id_for_huc` (`twin/ingest/wbd.py:87`: `f"watershed/huc{len(huc)}-{huc}"`). props from `twin/ingest/wbd.py:235-240`: `{"huc": "1019000504", "level": 10, "area_sqkm": …, "states": "CO"}`. Its `parent_id` is `watershed/huc8-10190005` (`huc_parent` `wbd.py:70-80`); its `children` are the HUC-12s. It has **no `huc12`** field (`huc12` is set only when `props->>'huc12'` exists or `kind='watershed' AND length(props->>'huc')=12`, `_PLACES_SQL` `build.py:542-545`). `sameAs` empty (huc schemes aren't templated). Kind `watershed`.

`bioregion/front-range` — `twin/ingest/wbd.py:56-57` (`ROOT_PLACE_ID`, `ROOT_NAME = "Front Range Bioregion"`), geometry filled by `twin/ingest/ecoregions.py:371-420`. props: `{"boundary_version": "v1", "ring": "A", "method": BOUNDARY_METHOD, "huc8": ["10190002","10190003","10190004","10190005","10190006","10190007"], "area_sqkm": <float>}` (`ecoregions.py:399-405`). `parent_id` absent (root). `children` = the six HUC-8 ids.

`boundary/v1.geojson` (`build.py:1304-1327`) is a single **Feature**, not a FeatureCollection:
```jsonc
{ "type":"Feature", "schema_version":"1.0", "generated_at":"…",
  "geometry": { "type":"MultiPolygon", "coordinates":[…] },
  "properties": { "id":"bioregion/front-range", "name":"Front Range Bioregion",
    "boundary_version":"v1", "ring":"A", "area_sqkm":12345.6,
    "huc8":["10190002",…,"10190007"], "method":"…",
    "rationale_url":"https://data.bioregionaltwin.org/boundary/v1.md" } }
```
`boundary/v1.md` is `data/boundary/rationale-v1.md` shipped byte-for-byte (`build.py:1328-1336`). A boundary is a proposal, not a fact — shipping the polygon without the rationale beside it is what turns a proposal into a fact (`build.py:1292-1298`).

`geom/{id}.geojson` (`build.py:1219-1238`) is likewise a single Feature:
```jsonc
{ "type":"Feature","schema_version":"1.0","generated_at":"…",
  "geometry":{"type":"Point","coordinates":[-105.330825,40.006375]},
  "properties":{"id":"place/…","kind":"monitoring_site","name":"…","huc12":"101900050301"} }
```
`geometry` can legitimately be `null` (a geometryless place). Coordinates are rounded to **6 decimals** (`GEOM_PRECISION`, `build.py:95`; `_point` `build.py:1111-1120`).

### 3.5 `superseded_by`, `children`, `parent_id`, `sensitivity`

- `superseded_by` returns the successor **only if the successor is itself published** (`build.py:323-326`). Appears on the place page only; never in `id/`.
- `parent_id` is `None` when the parent did not survive the gate — naming a restricted parent would leak its id (`parent_of` `build.py:328-337`). `_compact` then drops the key.
- `children` is derived from surviving parents (`build.py:339-346`), sorted, and always present (possibly `[]`).
- `sensitivity` on the wire is only `public | generalized` (ids-schema line 26). The DB enum has four (`sql/002_core.sql:11-16`); `restricted` and `governed` are never published at all.

### 3.6 The gate — what Kami will and will not see

`twin/publisher/gate.py`, module docstring `:1-37`:

- `public` → returned unchanged, identically (`gate.py:101-102`).
- `generalized` → geometry becomes a single Point at `ST_PointOnSurface` of the containing HUC-12, bbox collapses onto it, centroid becomes it, and `generalize_props` strips every `precise_*` key, every key in `LOCATOR_PROPS` (`point, coagmet_location, location, latitude, longitude, lat, lon, utm_x, utm_y` — `gate.py:53-65`) and **anything shaped like a two-number list** (`is_coordinate_pair` `gate.py:121-136`). Name, id and readings survive.
- `restricted`, `governed`, or **any unknown value** → `None`, withheld entirely (`gate.py:104-106`). A `generalized` place with no HUC-12 to hide inside is also withheld (`gate.py:107-109`).
- The health board counts only readings from gated places, because a count is an inference channel (`build.py:1131-1136`).

### 3.7 Sample/fixture data in the repo

`public/` is gitignored (`README.md:305`), so there is no live tree checked in. What exists:

- **`web/src/__fixtures__/conditions.json`** — 384,886 bytes, 760 stations, 19 sources, build stamp `2026-09-04T08:22:38Z`. The single best realistic fixture. Used by `web/src/copy/explanations.test.ts:6`.
- **`sources/fixtures.example.json`** — one hand-written `id/` record for `place/boulder-creek` (kind `stream_reach`, huc12 `101900050301`, a wikidata `sameAs`, a `commons_url` under `wiki/places/named/boulder-creek`).
- **`data/boundary/frontrange-boundary-v1.geojson`** + **`data/boundary/rationale-v1.md`** — the real Ring A polygon and its rationale, published as `boundary/v1.*`.
- **`tests/fixtures/*`** — 30 recorded *upstream* API responses (not twin artifacts): `nwps_gauge_{BELC2,CGCC2,CHSC2,ESSC2,GBYC2,SCPC2}.json`, `nws_observations_latest_{KAPA,KBDU,KBJC,KCOS,KDEN,KFNL}.json`, `usgs_latest_continuous_page.json`, `usgs_monitoring_locations_page.json`, `cdss_telemetry_district6_page.json`, `cdss_stations_page.json`, `cdss_surfacewater_stations_page.json`, `awdb_{stations,data_daily}.json`, `coagmet_{latest,metadata,soilmoisture}.json`, `airnow_{api.json,hourly.dat,sites.dat}`, `firms_viirs_area.csv`, `usdm_current.json`, `usgs_quakes_frontrange.json`, `wfigs_{incidents_co,perimeters_co,item_incidents,item_perimeters,perimeters_layer}.json`, `nws_alerts_active_sample_tx.json`, `nws_station_KBDU.json`, `wbd_huc{8,10,12}_sample.json`. Useful for deriving realistic property values and timestamps, **not** for twin artifact shapes.
- **`tests/test_publisher_build.py`** (746 tests repo-wide, `README.md:300`) builds a synthetic tree in a rolled-back transaction; its assertions at `:175-190` are the authoritative "what must exist" list.

---

## 4. The `latest/` artifacts, exactly

### 4.1 `latest/health.json`

`_health_board` `build.py:1123-1165`; type `HealthBoard`/`HealthSource` `types.ts:85-100`.

```jsonc
{ "schema_version": "1.0",
  "generated_at": "2026-09-06T06:00:00Z",
  "sources": [                      // ordered by source_id (SQL ORDER BY, build.py:620)
    { "source_id": "cdss.telemetry",
      "title": "Colorado DWR Telemetry Stations",
      "agency": "Colorado Division of Water Resources",
      "tier": "A",
      "license": "public-domain",
      "attribution": "Colorado Division of Water Resources",
      "health": "ok",
      "last_ok": "2026-09-06T05:55:06Z",
      "last_error": null,           // OMITTED unless `failing`
      "staleness_s": 751,
      "nominal_cadence_s": 900,
      "staleness_warn_s": 2700,
      "staleness_crit_s": 10800,
      "readings": 529,              // gated readings from this source
      "stale_readings": 41 } ] }
```
`attribution` falls back to `agency` when `attribution_html` is null (`build.py:463`). `readings`/`stale_readings` count **gated** places only (`build.py:1138-1145`). Verdict enum: `ok|warning|critical|unknown`, asserted at `web/src/data/contract.test.ts:97-101`.

Two different questions, both answered — "is the feed up?" and "are its values fresh?" — because a source can be perfectly healthy while most of its stations are stale (`build.py:1126-1130`).

### 4.2 `latest/snow.json`

`_snow` `build.py:943-1016`; rule computed in `twin/publisher/snow.py:69-99`; type `SnowState`/`SnowSite` `types.ts:366-387`.

```jsonc
{ "schema_version": "1.0", "generated_at": "…",
  "snowline_m": 3048.0,          // null when < 3 usable sites, or none report snow, or all stale
  "opacity": 0.42,               // 0–1, round(median SWE above the line / 300 mm, 3), capped at 1
  "basis": [ { "id": "place/niwot", "elevation_m": 3021.0,
               "swe_mm": 0.0, "snow_depth_cm": 0.0,
               "time": "2026-09-02T06:00:00Z", "stale": true } ],
  "rule": "lowest elevation at which ≥2 of the 3 nearest-by-elevation SNOTEL sites report snow depth > 0; opacity = median SWE above the line / 300 mm, capped at 1",
  "stale": false }
```
`rule` is verbatim from `SNOW_RULE` `build.py:146-149`. `SWE_FULL_MM = 300.0`, `NEAREST = 3`, `NEEDED = 2` (`snow.py:26-31`). Unit conversion happens once in the publisher: `_IN_TO_MM = 25.4`, `_IN_TO_CM = 2.54` (`build.py:140-141`), so AWDB inches become `swe_mm` / `snow_depth_cm`. `basis` includes every site with elevation + a depth reading, **even when the answer is "no line"** — so the artifact can show its work (`snow.py:56-61`). Entries go through `_compact`, so `swe_mm`/`snow_depth_cm` can be absent.

Client: `useSnow` treats a **404 as `data: null`, not an error** (`web/src/data/client.ts:544-548`).

### 4.3 `latest/flow_network.json` and `network/reaches.geojson`

`twin/publisher/network.py:96-135`; types `FlowNetwork`/`ReachSpeed`/`ReachFeature` `types.ts:334-364`.

```jsonc
// latest/flow_network.json  [cache class: latest]
{ "schema_version":"1.0","generated_at":"…",
  "rule":"direction from the NHD network; speed = the discharge at the nearest upstream gauge, carried downstream to the next gauge",
  "reaches": { "23001700012345": { "cfs": 15.4, "gauge": "place/boulder-creek-near-orodell-co",
                                   "hops": 0, "stale": false } } }
```
Keys are **string** NHDPlusIDs (`network.py:123-135`); `hops: 0` means the gauge sits on that reach; `propagate` is a min-heap BFS with `max_hops = 40` (`network.py:56-93`). `RULE` verbatim at `network.py:33-36`.

```jsonc
// network/reaches.geojson  [cache class: network]
{ "type":"FeatureCollection","schema_version":"1.0","generated_at":"…",
  "features":[ { "type":"Feature",
                 "geometry":{"type":"LineString","coordinates":[[-105.33,40.01],…]},
                 "properties":{"id":"23001700012345","name":"Boulder Creek",
                               "order":4,"km":1.234,"ds":"23001700012346"} } ] }
```
`ds` is an explicit `null` at an outlet (`network.py:116`). Geometry precision **5 decimals**, simplified at tolerance `0.0002` (~20 m), and only `streamorde >= 4` reaches ship (`build.py:636-657`). Gauges snap to the nearest reach within **150 m**, `public` sensitivity only (`_GAUGED_REACHES_SQL` `build.py:666-696`). Client fetches it once per page and treats 404 as "no network" (`client.ts:636-649`).

### 4.4 The five live GeoJSON collections

All produced by `_live_collection` (`build.py:1033-1056`) → `_feature_collection` (`build.py:1019-1030`), except fires. Envelope:

```jsonc
{ "type": "FeatureCollection",
  "schema_version": "1.0",
  "generated_at": "…",
  "source_id": "nws.alerts",          // LIVE_SOURCE / FIRE_SOURCE, build.py:117-123
  "features": [ … ] }                  // sorted by properties.id
```
`source_id` mapping (`build.py:117-123`): `alert→nws.alerts`, `detection→nasa.firms`, `quake→usgs.quakes`, `drought→usdm.current`, fires→`nifc.wfigs`.

Every feature: `{"type":"Feature","geometry": <Geometry|null>, "properties": {…adapter props…, "id","phenomenon_time","expires_at","source_id"}}` (`build.py:1037-1054`). `id` is the row's `external_key`. Time windows: alerts and drought are `unexpired=True` (`expires_at is null or > now`); detections last **24 h**; quakes last **30 d** (`DETECTION_WINDOW`/`QUAKE_WINDOW` `build.py:103-104`).

**`geometry` really is nullable** — `build.py:1047-1050`: "A zone-only NWS alert has no polygon. GeoJSON allows a null geometry and the alert is still the most important thing on the page, so it ships geometryless rather than not at all." Anything drawing these must cope, and must list the ones it cannot draw (`types.ts:194-200`; `web/src/layers/alerts.ts:1-14, 30-41`). The MCP spec formalises this as `geometry: null, matched_by: null` (`docs/proposals/ecological-entities/02-technical-architecture.md:271`).

**`latest/alerts.geojson`** — `AlertProps` `types.ts:233-251`, written at `twin/adapters/nws_alerts.py:185-201`:
`event, severity, certainty, urgency, headline, description, instruction, onset, sender, area_desc, ugc[], office`.
`sender` is NWS's `senderName` ("NWS Denver CO"); `office` is `"BOU"`/`"PUB"` or null; `ugc` is the NWS zone-code array — the reason a zone-only alert has no polygon. `phenomenon_time` = `effective` or `sent`; `expires_at` = `ends` or `expires` — the *hazard*'s end, not the product's (`nws_alerts.py:162-175`). `types.ts:222-232` documents a real historical bug: the interface used to claim `sender_name`, `effective`, `ends`, `status`, `message_type`, none of which the adapter emits. **Do not invent fields.** `severity` values that matter: `"Severe"`, `"Extreme"` (`web/src/layers/alerts.ts:44-46`).

**`latest/drought.geojson`** — `DroughtProps` `types.ts:311-318`; written at `twin/adapters/usdm.py:305-317`:
`dm` (int 0–4), `label` (`DM_LABELS = {0:"D0",1:"D1",2:"D2",3:"D3",4:"D4"}`, `usdm.py:99`), `period_start`, `period_end`, `release_date`, `national_area_sq_mi`, `national_cumulative_pct`, `national_categorical_pct`. Note the client's type only declares the first four — the national fields are real and undeclared. `external_key` (→ `properties.id`) is `f"{dm}-{OBJECTID}"` (`usdm.py:52-57`). `expires_at = ValidStart + 14 days` (`usdm.py:59-63`). Five polygons per weekly release, one per class, clipped to the bbox.

**`latest/fires.geojson`** — `FireProps` `types.ts:255-269`. Built differently: fires are *places*, so `_fires` (`build.py:1077-1108`) reads gated `core.place` rows with `kind == "fire_event"` and `props.active is True`. Properties = the place's whole props bag minus `point`, plus `id` (**a place id like `place/willow`, not an opaque key** — `types.ts:253-254`), `name`, `kind`, then `fire_acres` and `percent_contained` folded in from readings (`FIRE_PROPERTIES` `build.py:136`), plus `phenomenon_time` (max of those readings' times), `expires_at: null`, `source_id: "nifc.wfigs"`. Underlying props from `twin/adapters/wfigs.py:360-374`: `daily_acres, percent_contained, fire_cause, discovery_time, containment_time, incident_type_category, poo_county, unique_fire_identifier, modified_on, point, active`. Geometry is the perimeter polygon when one exists, else a Point from `props.point` (`build.py:1103`). A fire that leaves the feed gets `props.active = false` and drops out of the collection, but its place page survives (`wfigs.py:36-41`).

**`latest/detections.geojson`** — `DetectionProps` `types.ts:277-289`; `twin/adapters/firms.py:267-283`: `frp` (MW), `confidence` (VIIRS **class letter** `'l'|'n'|'h'`, not a percentage), `daynight` (`'D'|'N'`), `satellite`, `instrument`, `bright_ti4` (kelvin), `sensor` (e.g. `"VIIRS_NOAA20_NRT"`).

**`latest/quakes.geojson`** — `QuakeProps` `types.ts:298-309`; `twin/adapters/usgs_quakes.py:187-199`: `mag`, `mag_type` (`"ml"`, `"md"` — **not** `magnitude_type`; `types.ts:295-297` records that bug), `place`, `url`, `status` (`"automatic"`/`"reviewed"`), `depth_km`, `type` (`"earthquake"`, `"quarry blast"`). `expires_at` is always null: an earthquake goes on having happened (`usgs_quakes.py:205-206`).

The client's contract test enumerates the exact keys it dereferences per collection — a good minimum for Kami fixtures (`web/src/data/contract.test.ts:40-63`):
```
alerts:     id source_id event severity headline sender area_desc onset
fires:      id source_id name daily_acres percent_contained discovery_time fire_cause
detections: id source_id frp confidence satellite daynight
quakes:     id source_id mag mag_type place depth_km status
drought:    id source_id dm period_start
```

### 4.5 `tiles/manifest.json`

`twin/build/manifest.py:177-241`, `manifest_artifact` `:262-273` (cache class **`id`**, not `tiles` — the manifest itself is mutable, `manifest.py:29`). Type `TilesManifest` `types.ts:141-149`.

```jsonc
{ "schema_version":"1.0","generated_at":"…",
  "layers": {
    "basemap": { "type":"pmtiles",
      "archives":[{"url":"https://data.bioregionaltwin.org/tiles/basemap-<sha8>.pmtiles","minzoom":0,"maxzoom":15}],
      "attribution":"© OpenStreetMap contributors, Protomaps",
      "glyphs":"https://…/tiles/assets-<sha8>/fonts/{fontstack}/{range}.pbf",
      "sprite":"https://…/tiles/assets-<sha8>/sprites/black" },
    "terrain": { "type":"xyz","encoding":"terrarium",
      "url":"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      "minzoom":0,"maxzoom":15,
      "attribution":"Mazpen/AWS Terrain Tiles; placeholder until the 3DEP build",
      "placeholder":true },
    "imagery": null } }
```
`archives` is a **list** so a zoom-band split is a config change, not a rewrite (`manifest.py:1-14`). `null` distinguishes "layer not built" from "truncated manifest". `glyphs`/`sprite` braces must never be percent-encoded (`manifest.py:120-124`; client's `rebaseTemplate` `client.ts:107-116`). If Kami rebases URLs, mirror `rebaseUrl`/`manifestBaseUrl`/`rebaseManifest` (`client.ts:44-149`).

---

## 5. The explanations table

`web/src/copy/explanations.ts`. Structure (`:18-37`):

```ts
export interface Band {
  upTo: number;      // inclusive upper bound, in the reading's published unit
  name: string;
  note: string;
}
export interface Explanation {
  label: string;
  short: string;     // one line under the value, ≤ 90 chars (test enforces ≤ 120)
  long: string;      // 2–3 sentences: what it measures, how to read it, what high/low means HERE
  unitHelp?: string; // what the unit is, for someone who has never met it
  bands?: Band[];    // ONLY where a settled, citable scale exists
  scale?: string;    // names it for the headline
  source?: string;   // cites it
}
```

One entry copied verbatim (`explanations.ts:56-61`), plus a banded one (`:185-200`):

```ts
discharge: {
  label: "Discharge",
  short: "How much water is flowing past this gauge right now.",
  long: "Discharge is the volume of water passing the gauge each second. On Front Range creeks it peaks with snowmelt in late May and June, then falls through summer to a base flow fed by groundwater and reservoir releases. A sudden rise in a dry month usually means a storm upstream; a fall below the usual base flow means diversions or drought are biting.",
  unitHelp: CFS,   // "cfs is cubic feet per second: how much water passes a point each second. One cfs is about 7.5 gallons — four basketballs — of water passing every second; a few hundred cfs is a creek you would think twice about wading."
},
pm25: {
  label: "PM2.5",
  short: "Fine particles small enough to reach deep into the lungs; wildfire smoke is mostly this.",
  long: "PM2.5 counts particles under 2.5 micrometres across, …",
  unitHelp: UGM3,
  bands: [
    { upTo: 9,    name: "Good", note: "Air quality is satisfactory." },
    { upTo: 35.4, name: "Moderate", note: "Unusually sensitive people should consider limiting prolonged exertion." },
    { upTo: 55.4, name: "Unhealthy for sensitive groups", note: "…" },
    { upTo: 125.4,name: "Unhealthy", note: "…" },
    { upTo: 225.4,name: "Very unhealthy", note: "…" },
    { upTo: Number.POSITIVE_INFINITY, name: "Hazardous", note: "…" },
  ],
  scale: "the EPA 24-hour scale",
  source: "https://www.epa.gov/pm-pollution/final-reconsideration-national-ambient-air-quality-standards-particulate-matter-pm",
},
```

**Every key**, in glossary order (water → snow → air → weather → soil → classes), `explanations.ts:54-353`:

*Water* (`:55-150`): `discharge`, `stage`, `gage_height`, `water_temp`, `reservoir_storage`, `reservoir_fill`, `reservoir_elevation`, `cdss_wlevel`, `cdss_storag`, `flow_forecast`, `turbidity`, `specific_conductance`, `dissolved_oxygen`, `ph`, `usgs_62614`, `usgs_63160`.
*Snow & precipitation* (`:152-182`): `swe`, `snow_depth`, `precip_accum`, `precip_5min`, `usgs_00045`.
*Air* (`:184-247`): `pm25` **(bands)**, `pm10`, `ozone` **(bands)**, `no2`, `so2`, `co`, `visibility`.
*Weather* (`:249-297`): `air_temp`, `dewpoint`, `rh`, `wind_speed`, `wind_gust`, `wind_dir`, `pressure`, `solar_rad`.
*Soil* (`:299-311`): `soil_moisture`, `soil_temp` — depth-suffixed keys are resolved by regex `^soil_(moisture|temp)_(\d+)(in|cm)$` (`:355`, `explain` `:370-374`).
*Classes of thing on the map* (`:313-352`): `class:station`, `class:fire`, `class:detection`, `class:alert`, `class:quake`, `class:drought` **(bands, `upTo: 0..4` matching `dm`)**.

Three entries carry `bands`: `pm25` (EPA 24-hour, revised 2024), `ozone` (EPA 8-hour, source `document.airnow.gov/technical-assistance-document…`), `class:drought` (`scale: "the Drought Monitor"`, source `droughtmonitor.unl.edu/About/AbouttheData/DroughtClassification.aspx`). "Bands exist only where a settled, citable scale applies… everything else stays descriptive rather than inventing thresholds. Static copy, never a model output." (`explanations.ts:8-11`).

API: `explain(key)` never throws — unknown keys get a verbatim label and the sentinel short "A reading this site has no plain-language note for yet." (`:357-376`). `bandFor(key, value)` returns the first band whose `upTo >= value`, or null (`:379-383`). `glossaryKeys()` returns insertion order (`:386-388`).

**Licence.** There is no licence string inside `explanations.ts` itself. The repo's licensing is stated at `README.md:308-317` — **code Apache-2.0, structured facts CC0, prose CC BY-SA 4.0** — and rendered to users at `web/src/ui/About.tsx:147`: `"Code Apache-2.0. Structured facts CC0. Prose CC BY-SA 4.0."` The explanations table is prose, hence **CC BY-SA 4.0**. The twin's own MCP spec makes this explicit: the `explain` tool returns `{label, short, long, unitHelp, bands?, license:"CC BY-SA 4.0", attribution}` and the table is "vendored into the package from `web/src/copy/explanations.ts` at build" (`docs/proposals/ecological-entities/02-technical-architecture.md:275`). Kami must carry the attribution and share-alike if it redistributes this copy. `sources.seed.yaml:2` also flags per-source `license_mixable: false` (CC-BY-NC / ODbL — PurpleAir) which must be partitioned at ingest, never at export.

Contract test: `web/src/copy/explanations.test.ts:14-29` asserts every property in the fixture *and* in the live tree resolves to a real explanation; `:31-35` asserts all six `class:*` keys exist; `:50-56` caps `short` at 120 chars and `long` at 5 sentences.

---

## 6. Briefings, the fact sheet, and the numeric guard

**Status: specified, not built.** No `twin/briefing.py` exists. The `briefings/` prefix is not in `build_all`.

The spec is `docs/superpowers/specs/2026-09-04-alive-twin-design.md:169-177` ("Sub-project 4 — Weekly briefings (specified; planned separately)"):

- **Job:** `twin/briefing.py`, scheduled Sundays 06:00 America/Denver by the existing scheduler; also `make briefing`.
- **Fact sheet first** (`:172`): assembled from the database only — "per family the week's min/max/mean per station, week-over-week change, records vs the station's own history, active alerts, fires and acres, detections count, drought class distribution, snowpack vs date, source health. Every fact carries its place id, timestamp, unit and source. This file is published as `briefings/<date>/facts.json`."
- **Analysis** (`:173`): one Anthropic API call (model `claude-opus-5`) with the fact sheet and a fixed system prompt; output JSON `{title, summary, sections[] (markdown), watch[]}`; structure "headline · water · snow · air · fire · land · what to watch".
- **The numeric guard** (`:174`): *"every number in the model's output must appear in the fact sheet (tokenised numeric comparison with unit-aware tolerance); any miss fails the run, logs the offending sentence, and publishes nothing. The previous briefing stays live."*
- **Publish** (`:175`): `briefings/latest.json`, `briefings/<date>.json`, `briefings/<date>.html`. **Cache class `id` (5 min).**
- **Honesty** (`:177`): the page and email say "analysis written by an AI from the week's measured readings; every number links to its station".
- Budget ceiling: one call per week, fact sheet capped at 60 k tokens (`:203`).

`facts_for` — the importable, place-scoped generator Kami's platform wants — is proposed but unwritten: `docs/proposals/ecological-entities/03-implementation-plan.md:131-132` (**TW-8**, 2 d, phase 2). The ruling is **one schema (`facts-1.0.json`), two emitters (twin Python, TS MCP), one matcher (`factguard`, Python)** (`02-technical-architecture.md:728`).

Atom kinds for the guard (`02-technical-architecture.md:111`): `number` (value, unit, property, place_id, time), `time` (ISO instant), `place` (name or id), `species`, `count` (length of every array in a tool result). Only tool results *after the last user message* are admissible. Tolerances (`03-implementation-plan.md:175` step 5): `|reply − fact| ≤ 0.5×10^(−d)` and relative error ≤ 2 %; counts exact; times same `America/Denver` day, or same hour ±1 h for relative forms.

Prose-generation policy that Kami inherits: model-written prose is **refused on the map and in the modal** and belongs only in the briefing, behind its guard (`docs/proposals/2026-09-06-terrarium-enrichment.md:175`; also `:1013`).

Until it ships, `get_briefing` returns `{available:false}` (`02-technical-architecture.md:274`).

---

## 7. Commons / Parachute integration

Primary doc: `docs/twin-commons-handoff.md` (203 lines, three dated sections). Code: `twin/commons/{paths,stub,sync,vault,index}.py`.

### 7.1 Path conventions

`twin/commons/paths.py:11-16` — shelved by **kind**, not id namespace:

```python
SHELVES = {
    "watershed":       "wiki/places/watersheds/huc{slug}",
    "bioregion":       "wiki/places/bioregion",
    "monitoring_site": "wiki/places/monitoring/{slug}",
    "named_place":     "wiki/places/named/{slug}",
}
```
Watershed ids are stripped of their level prefix before joining: `_HUC_LEVEL = re.compile(r"^huc\d+-")` (`paths.py:20`), so `watershed/huc10-1019000504` → `wiki/places/watersheds/huc1019000504`. Non-digit remainders return `None` (`paths.py:32-35`). Any other kind → `None` (no shelf, no stub).

Confirmed in the handoff's mapping table (`docs/twin-commons-handoff.md:81-86`) and its 2026-09-05 addendum (`:190-204`): monitoring stubs are `wiki/places/monitoring/<name-slug>` (e.g. `wiki/places/monitoring/boulder-creek-near-orodell-co`), *not* `<agency-id>`; agency ids live in `same_as`. `wiki/places/named/*` has no twin ids today, so the sync never touches that shelf.

### 7.2 Hub / note URL pattern

`twin/commons/paths.py:39-49`:
```python
commons_api_base(base)  # ".../p/<slug>" → ".../api/p/<slug>"  (idempotent)
commons_note_url(base, path) = f"{base.rstrip('/')}/notes/{urllib.parse.quote(path, safe='')}"
```
The path must be **percent-encoded as ONE segment** (`/` → `%2F`); raw multi-segment paths 403 (`docs/twin-commons-handoff.md:41-43`).

```
page: https://prism.omniharmonic.com/p/front-range/notes/wiki%2Fplaces%2Fwatersheds%2Fhuc101900050301
api:  https://prism.omniharmonic.com/api/p/front-range/notes/<same>
map:  GET /api/p/front-range/map      → 527 published features (id, name, kind, geometry), anonymous
also: /api/p/front-range (manifest), /api/p/front-range/graph
```
CORS on `https://prism.omniharmonic.com/api/p/*` returns `Access-Control-Allow-Origin: *` (`:170-173`) — so a browser client (or Kami's) can read the commons directly without a token.

A `commons_url` is emitted into `id/<id>.json` **only when the publication manifest lists that path** (`build.py:838-845`), fetched once per build by `published_paths` (`twin/commons/index.py:14-34`). An unreadable manifest returns `None`, which withholds **every** commons link that cycle rather than asserting nothing is published (`index.py:17-21, 30-34`).

### 7.3 The fence pattern

`twin/commons/stub.py:10-11`:
```
BEGIN = "<!-- twin:auto begin -->"
END   = "<!-- twin:auto end -->"
```
`splice(existing, block)` (`stub.py:135-145`) replaces **only** the region between the markers, prepending the block when markers are absent. "Everything outside the fence is byte-identical afterwards — that is what lets a human's prose below the markers survive every sync run (handoff §5.5)."

Generated block (`stub.py:82-90`):
```markdown
<!-- twin:auto begin -->
**Boulder Creek near Orodell** — a site the [Front Range Bioregional Twin](https://bioregionaltwin.org/front-range/twin?focus=place/boulder-creek-near-orodell-co) measures.
Watershed: [[wiki/places/watersheds/huc101900050301]].
Live readings: https://bioregionaltwin.org/front-range/twin?focus=place/boulder-creek-near-orodell-co
<!-- twin:auto end -->
```
Wikilinks create graph edges **only** as `[[full/vault/path]]` (optionally `[[path|Label]]`); bare titles do not resolve (`docs/twin-commons-handoff.md:112-114`).

### 7.4 `if_updated_at` and conflict handling

`twin/commons/vault.py:96-108`:
```python
def patch(self, path, note, content, metadata):
    r = self._client.patch(self._note_url(path), headers=self._headers,
        json={"content": content, "metadata": metadata, "if_updated_at": note.updated_at})
    if r.status_code in (409, 412, 428):
        fresh = self.get(path); raise Conflict(fresh or note)
```
**No `force` path exists anywhere in this client, deliberately** (`vault.py:1-7`). `PATCH /notes/:id` 428s without `if_updated_at` (`docs/twin-commons-handoff.md:94-99`). The sync re-splices the fresh copy and retries **once**; a second conflict lands in `report["failed"]` rather than looping (`twin/commons/sync.py:137-146`). Writes pace themselves 120 ms apart (`vault.py:60, 71-75`; handoff recommends 100–150 ms, `:122`).

### 7.5 Tags

**`add_tags` on PATCH is a silent no-op** — tags must be set at CREATE (`docs/twin-commons-handoff.md:100-103`; `vault.py:84-86`). A stub is public only if tagged `commons-seed`. The twin creates with `tags=["commons-seed", "place"]` (`stub.py:92`). A matched note that lacks `commons-seed` gets the fence but stays private, and is listed in `report["matched_untagged"]` (`sync.py:124-125`).

### 7.6 `metadata.place_id` and the stamp rule

`stub.py:60-77` writes, on **create**:
```python
{ "name", "place_kind", "containedIn", "geometry", "bbox", "geo": {"lat","lon"},
  "sensing_or_responding": "sense", "sensitivity", "indigenous_governed": False,
  "wikidata_qid": "", "same_as": [twin_url, *same_as],
  "source": f"Front Range Bioregional Twin identity registry (id/{place_id}.json)",
  "confidence": "high"|"medium", "place_id": place_id }
```
`place_kind` maps `watershed→watershed, bioregion→bioregion, monitoring_site→site, named_place→region` (`stub.py:14-19`). `generalized` places drop `geometry` and `geo` but keep the bbox (`stub.py:59, 63-68`). Nones are stripped before sending, because the vault default-fills schema'd fields and a stored `""` against a sent `None` would make every run a PATCH forever (`stub.py:79-80`).

On an **existing** note only three keys may be touched — `STAMP_KEYS = ("place_id", "same_as", "containedIn")` (`stub.py:25`), applied by `merge_metadata` (`stub.py:114-132`): `place_id` stamped; `same_as` a union preserving the note's own order; `containedIn` filled only when empty. "An existing note is the commons' curation: stamp, join, fill — never overwrite" (`sync.py:127`). Name, geometry, bbox, sensitivity, source stay the commons' own (`docs/twin-commons-handoff.md:197-201`).

`containing_path` (`stub.py:96-111`): a monitoring site sits in `wiki/places/watersheds/huc<its huc12>`; a watershed sits in its parent HUC (code shorn of its last two digits); a HUC-8 sits in `wiki/places/bioregion`.

### 7.7 Sensitivity in the commons

Same rule as the publish gate: only `public` and `generalized` get a stub at all (`stub.py:53-54`, mirroring `PUBLISHABLE` from `gate.py:44`); `generalized` → HUC-8-scale bbox at most, no geometry (`docs/twin-commons-handoff.md:123-125`). `plan()` reuses the publisher's own `_Ctx`/gate so a place that would not be published never gets a stub either (`sync.py:1-7, 47-53`).

### 7.8 Token minting / rotation / revocation

From `docs/twin-commons-handoff.md`:
- Mint (write scope): `parachute auth mint-token --scope vault:front-range-bioregion:write` (`:69`).
- Revoke one box without touching the other: `parachute auth revoke-token <jti>` — run on the hub host, ~60 s propagation (`:184`).
- Tokens are hub JWTs, TTL ≤ 1 year (`:68, 184`). A dedicated *remote* token was minted with a separate `jti` so it is independently revocable (`:165-168`).
- Env (compute host `compose/.env` only, chmod 600, gitignored): `COMMONS_BASE_URL=https://prism.omniharmonic.com/p/front-range`, `PARACHUTE_URL` (`http://127.0.0.1:1940` loopback or `https://agent.omniharmonic.com` remote), `PARACHUTE_VAULT=front-range-bioregion`, `PARACHUTE_TOKEN` (`:62-66`, `:159-162`). Mirrored in `twin/config.py:57-59`.
- **The reverse direction needs no secret**: everything the commons consumes from the twin (`id/index.json`, `latest_url`, `geometry_url`) is public static files (`:72-73`). **This is exactly Kami's posture.**
- Never put `PARACHUTE_TOKEN` in a `VITE_*` var — Vite bakes those into the public bundle (`:176-177`).
- Vault REST base: `${PARACHUTE_URL}/vault/${PARACHUTE_VAULT}/api` — GET/POST `/notes`, GET/PATCH/DELETE `/notes/<id-or-encoded-path>`, Bearer auth (`:127-128`; `vault.py:62`).

CLI: `make commons-sync ARGS=--dry-run` → `python -m twin.commons.sync` (`Makefile`; `sync.py:156-215`). It emits a reconciliation report `{matched, created, updated, unchanged, skipped_restricted, by_shelf, matched_untagged, failed, started_at, finished_at, withheld_by_gate, skipped_no_shelf, skipped_inactive, planned, dry_run}` (`sync.py:95-108, 188-193`). `--publish-report` is accepted but **not implemented** (`sync.py:199-212`).

---

## 8. Repo conventions

| Thing | Value | Where |
|---|---|---|
| Node | **22** | `.nvmrc:1` |
| Package manager | **pnpm@10.18.2** | `web/package.json` `packageManager`; pinned again in `.github/workflows/ci.yml:130` |
| Python | **>= 3.12** | `pyproject.toml` `requires-python`; CI `uv python install 3.12` |
| Build tool | uv (`astral-sh/setup-uv@v3`), hatchling backend | `pyproject.toml`, CI |
| Frontend stack | Vite 6.4.3, React 18.3.1, TypeScript 5.9.3, vitest 3.2.7, maplibre-gl 5.24.0, deck.gl 9.3.11, pmtiles 4.5.0, playwright 1.62.1 | `web/package.json` |
| Lint/format | `ruff` (line-length 100, target py312, select `E,F,I,B,UP`) | `pyproject.toml` `[tool.ruff]` |
| Tests | pytest, `asyncio_mode = "auto"`, `testpaths = ["tests"]`, `filterwarnings = ["error::DeprecationWarning:twin.*"]` | `pyproject.toml` `[tool.pytest.ini_options]` |
| **LICENSE** | **Apache-2.0** (full text, `LICENSE`); `pyproject.toml` `license = "Apache-2.0"` | code |
| Facts / prose | CC0 / CC BY-SA 4.0 | `README.md:308-317`, `web/src/ui/About.tsx:147` |

**Commands** (`Makefile`):
```
make sync            uv sync --extra dev
make test            uv run pytest -q
make lint            uv run ruff check . && uv run ruff format --check .
make seed            python -m twin.seed_sources sources/sources.seed.yaml
make publish         python -m twin.publisher --once
make commons-sync    python -m twin.commons.sync $(ARGS)
make web             cd web && pnpm install && pnpm dev
make web-data        pnpm dlx serve ../public -l 8787 --cors      # HTTP Range + CORS; PMTiles needs Range
make web-test        cd web && pnpm test && pnpm typecheck
make e2e             scripts/e2e_smoke.sh --reuse-db --web
make up / down / logs   docker compose -f compose/docker-compose.yml …
```
`web/package.json` scripts: `build = tsc --noEmit && vite build && node scripts/check-css-order.mjs`; `data = pnpm dlx serve ../public -l 8787 --cors`.

**CI** (`.github/workflows/ci.yml`), two jobs, `on: [push, pull_request]`:
- `python`: copies `compose/.env.example` → `.env` verbatim (asserting `PGPORT_HOST=5432`), builds and starts the **real** TimescaleDB+PostGIS+pgvector image via the real compose file, waits for `meta.source_registry` to exist, `uv sync --extra dev`, `make seed`, `ruff check`, `ruff format --check`, `pytest` with `REQUIRE_DB=1` (which turns "no database" from a skip into a failure — `:11-13`).
- `web`: `pnpm/action-setup@v4` **before** `actions/setup-node@v4` (`:120-127` explains why), `node-version-file: .nvmrc`, cache `web/pnpm-lock.yaml`, then `pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm build`.
- Deliberately **not** in CI: `pnpm e2e`, `pnpm design` — they need a running Chromium, a vite server and a published tree (`:145-149`).

**`.claude/00-README.md`** — the process rules: a documentation index plus "The five things to carry in your head" (`:17-33`):
1. *"The architecture is static-first, and that is what makes it cheap and robust. The compute host publishes immutable artifacts to object storage; a CDN serves every public byte. There is no public origin."*
2. *"The four canyon-mouth gauges are CDSS, not USGS… A USGS-only integration loses the four most iconic flow measurements on the Front Range, silently. It is encoded as a test."*
3. *"We mint our own identifiers; external IDs are assertions with a validity interval… This one table (`core.place_identifier`) is what makes the whole system durable, and it is the entire coupling surface with Prism."*
4. *"Imagery stops at z17."*
5. *"BASIN is the ghost in the machine."* — the 2001 Boulder Area Sustainability Information Network went dark in 2009 "not for technical reasons, but because it was one funded project with manual updates, no API, no export, no federation, and no governance that could outlive its champions".

Four non-optional rules from `README.md:223-266`: (1) fetch discipline via `twin/fetch.py` without exception, (2) never hardcode an Esri host, (3) the four canyon-mouth gauges are CDSS, (4) the sensitivity gate runs at publish time.

**`.claude/03-implementation-plan.md` format**: phased plan; `## Phase N — <name> (weeks a–b)` with a bolded **Goal:**, then `### N.M <task title>` sections, each a markdown checkbox list of concrete steps, closed by a bolded **Acceptance:** line stating a falsifiable condition. Risk flags inline (`⚠️ *do this first*`); cross-references of the form `(`02` §10.1)`.

---

## 9. Everything named "entity", "egregore", "mcp", "kami", "agent"

### 9.1 "kami" — zero hits. The twin has no knowledge of Kami by name.

### 9.2 "egregore" — two hits, both in the ecological-entities PRD (`docs/proposals/ecological-entities/01-PRD.md:36, 524`) — the same PRD as `docs/planning/01-PRD.md` here.

### 9.3 "entity" in shipped code — the outbox, not an agent

`core.entity_event` is the Prism-sync outbox (`sql/002_core.sql:102-113`): `id, place_id, event ∈ {created,updated,superseded,deleted}, payload, created_at, published_at`. Written by `twin/ids.py:414`. Unrelated to Kami entities.

### 9.4 "mcp" — the read-only MCP server, fully specified in the twin repo

There is **no `mcp/` directory yet**, but the twin repo holds the same architecture document as `docs/planning/02-technical-architecture.md` under `docs/proposals/ecological-entities/`, so the tool surface (§4.2), the enforced rules (§4.1), the contract tests (§4.3), the versioning policy (§4.4), and the place-set binding contract (§3) are shared verbatim between the two repos. Kami's `packages/twin-mcp` implements that spec (ADR-E15).

### 9.5 "agent" in shipped code — none in the AI sense

Every hit is `USER_AGENT` (`twin/config.py:43, 79-81, 90`; `twin/fetch.py`) or the Parachute hub hostname `https://agent.omniharmonic.com` (`twin/config.py:59`). `twin/fetch.py:7`: the fetcher "sends a `User-Agent` carrying a contact address (api.weather.gov returns 403 without one)".

---

## Appendix — hard rules Kami must not violate

1. **Read-only.** No write path exists into the tree; there is no origin server. The reverse direction (twin → commons) is the only authenticated one, and its token belongs to the twin's compute host alone (`docs/twin-commons-handoff.md:72-74`).
2. **Absent ≠ zero, absent ≠ fresh.** `_compact` drops nulls (`build.py:208-216`); `readingStaleness` returns `unknown: true` when it genuinely cannot tell (`reading.ts:64-66`).
3. **Never re-derive a coordinate for a `generalized` place** and never re-publish a precise point for one; the gate strips coordinate-shaped values by shape, not just by name (`gate.py:121-136`).
4. **Honour the two staleness dialects.** `conditions.json` has `stale`/`staleness_s`; place pages have `staleness_crit_s`. Mixing them silently produces a 26-day-old gauge drawn as current (`build.py:42-54`).
5. **A place page's `generated_at` is not a clock** — hash-skipping means it only moves when the data moves (`backends.py:32-38`).
6. **A 404 is meaningful.** Prune withdraws a place that turned `restricted` (`backends.py:526-573`); a missing `id/<id>.json` with a live `latest/<id>.json` means superseded (`build.py:1240-1244`).
7. **Cite the licence.** Facts CC0, prose (explanations, rationale, boundary reasoning) CC BY-SA 4.0, code Apache-2.0 (`README.md:308-317`). `license_mixable: false` sources must never be blended into a CC0 aggregate (`sources.seed.yaml:2`).
8. **No model-written prose beside a reading.** That rule is the twin's, and the entities architecture inherits it (`docs/proposals/2026-09-06-terrarium-enrichment.md:175, 1013`; `02-technical-architecture.md:106-123`).
