# Fixture trees

Two pruned trees shaped exactly like `https://data.bioregionaltwin.org`, built by
`pnpm refresh-fixtures` (`scripts/refresh-fixtures.ts`) from the twin's checked-in
`web/src/__fixtures__/conditions.json` (a real build of 2026-09-04T08:22:38Z) plus
hand-authored identity, geometry, live-layer and boundary files.

| dir | build | what it is for |
|---|---|---|
| `public/` | **all-stale** `2026-09-06T05:00:00Z` — every Tier-A feed but USGS `critical`; Orodell discharge 15.4 cfs at `2026-09-04T20:15:00Z` (117 900 s old — "118 000 s" in the ADRs), Niwot SWE 0.0 stale, Athens PM2.5 stale; Gross Reservoir storage + derived fill 72 % live; the South Boulder forebay WQ site live (water_temp 12 °C) | the contract tests; the "can't feel my gauge" case (ADR-E11) |
| `public-live/` | the same tree with fresh timestamps at `2026-09-06T04:45:00Z`, nothing stale, every source `ok` | tests that need a healthy creek |
| `bindings/boulder-creek.yaml` | architecture §3 verbatim, plus three more members (two snotel, one reservoir, one weather) | `--binding` for stdio; `get_entity_status` |

## What is real and what is synthetic

**Real** (from the twin's fixture or its code): station ids, names (verbatim, including
`"Gross Reservoir "` with its trailing space), coordinates, readings, units, quality flags,
source ids; source thresholds and health-board titles (`sources/sources.seed.yaml`);
the six HUC-8 codes of boundary v1; the snow rule; the CDSS `props` block on Orodell
(`cdwr_stream_gnis_id: "00178354"`); URL templates; the two staleness dialects.

**Synthetic, and labelled so here:**
- The four HUC-10 watersheds `huc10-1019000504…507` are **rectangles**, named
  "Middle Boulder Creek", "South Boulder Creek", "Boulder Creek-Fourmile Creek",
  "Lower Boulder Creek". Their 24 HUC-12 children are six longitude bands each.
  Stations are assigned a `huc12` by which rectangle contains them. The real WBD codes
  and shapes differ; the binding's watershed ids are the ones the architecture uses.
- `bioregion/front-range` and `boundary/v1.geojson` are a simplified pentagon around the
  real bbox; `boundary/v1.md` is a short stand-in for the real rationale (CC BY-SA 4.0).
- 7-day `series` on every place page are generated (seeded, hourly, ending at the
  reading's time, last point equal to the reading).
- Series keys are plausible (`BOCOROCO/DISCHRG` is real; others are made up).
- `place/private-headgate-generalized` is an invented `generalized` place (rule-4 test).
- `place/boulder-creek-co-near-orodell` carries an added `flow_forecast` (NWPS does
  publish forecasts there; the value is made up).
- Drought: a D0 polygon over all four watersheds and a D1 polygon over the eastern two;
  one zone-only Red Flag Warning with `geometry: null`; fires/detections/quakes empty.
- `Gross Reservoir` storage is set to 30 104 acre-ft against `capacity_af` 41 811 so the
  derived fill is exactly 72.0 %.

Sidecar `.headers.json` files sit next to `latest/conditions.json`, `id/index.json`,
`boundary/v1.geojson` and Orodell's place page, as the twin's local backend writes them.

Not published (so 404 → `null`, deliberately): `network/`, `latest/flow_network.json`,
`briefings/`, `normals/`, HUC-12 `geom/` files, `tiles/`.
