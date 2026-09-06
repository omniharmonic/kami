# Needs model — per archetype

A need is one twin property on one or more member places, rendered as a meter (PRD §4.3). The
platform computes every band, health value, and mood in `@kami/needs` (architecture §9); this
reference tells you what each archetype senses, how readings are aggregated, **which bands exist today**,
and what stays blocked until the twin publishes baselines. You may explain the computed result; you never
recompute it.

Every reading carries `time, unit, source_id, stale, staleness_s, source_status`. Absent means unknown,
never zero. `stale` on a driving need forces mood `asleep` ("I can't feel my gauge") — never distressed.

## Aggregation (`needs[].agg`, from the binding)

| agg | Meaning |
|---|---|
| `single` | one place, its latest reading |
| `mean`, `median`, `min`, `max` | across the listed places, latest readings |
| `mean_24h` | 24-hour mean at one place — required for EPA air bands, which apply to 24-h means |
| `max_intersecting` | the maximum class of the polygons intersecting the boundary (USDM drought) |

## Bands that exist today (the only ones you may name)

| Property | Band source | Bands | Drives mood today? |
|---|---|---|---|
| `reservoir_fill` (% of normal, with `basis`) | published by the twin (`basis: [reservoir_storage, capacity_af]`) | low (<40) · below normal (40–70) · near normal (≥70) | yes — the only published water baseline |
| `pm25` (24-h mean) | EPA AQI 2024 breakpoints | Good · Moderate · Unhealthy for Sensitive Groups · Unhealthy · Very Unhealthy · Hazardous | yes |
| `ozone` (8-h mean) | EPA AQI | same six bands | yes |
| `dm` (USDM drought) | US Drought Monitor | D0 · D1 · D2 · D3 · D4 | yes |
| `stage` (NWPS gauges) | NWS flood categories on the gauge (`props.flood`) | none · action · minor · moderate · major | yes |
| NWS alerts | NWS severity | `alert_level` 0–3 (Extreme/Severe → 3) | yes |

## Blocked until the twin publishes baselines (TW-5)

| Property | What is missing | What you say instead |
|---|---|---|
| `discharge` | day-of-year percentile vs period of record | value, time, source, 7-day `week.trend`; then the percentile line from `templates.md` |
| `swe`, `snow_depth` | SWE as % of median (AWDB serves it; dropped at ingest) | value and trend; in summer "zero is normal, not broken" only when the season came from the snapshot |
| `water_temp`, `dissolved_oxygen`, `ph`, `turbidity`, `specific_conductance` | numeric bands (the explanations table has trout DO threshold in prose only) | value and trend; quote `explain` with attribution if you cite the prose threshold |
| `precip_accum`, `air_temp` | any baseline | value and trend |

`compare_to_normal` returns `{available: false, reason: "twin publishes no baseline yet"}` until then. The
platform never computes its own baseline from a 7-day series; neither do you.

## Archetypes

### creek (first entity: Boulder Creek)
- **Needs (4–6):** `flow` (`discharge`, main-stem gauge, `single`) · `storage` (`reservoir_fill`, the
  creek's reservoir(s)) · `snow` (`swe`, a SNOTEL upstream) · `water` (one WQ property at a probe) · `air`
  (`pm25`, `mean_24h`) · `drought` (`dm`, `max_intersecting`). Optional `stage` when the anchor gauge is an
  NWPS gauge with flood categories; `alerts` and `fire` come from live layers.
- **Anchor:** the canyon-mouth gauge; its `flow` label is the headline.
- **Drives mood today:** drought class, alerts, reservoir fill, flood category, air band. **Not yet:** flow,
  snow, water quality (no baselines).
- **Verification possible:** tier 1 (a gauge or sensor reports again), tier 2 (structures, banks, cleanups).

### watershed (HUC-8/10/12)
- **Needs:** member stations rolled up by `huc12` — `flow` (`mean` or `median` over member gauges),
  `snow` (`mean` over SNOTELs), `air` (`mean_24h` over sensors), `drought` (`max_intersecting`),
  `alerts`/`fire` by polygon.
- **Today:** the watershed page itself publishes no readings; rollups (`latest/watershed/*.json`, TW-7) are
  phase 2. Until then every need is a member-station aggregate and the label names the station count.
- **Drives mood today:** drought, alerts, fire perimeters; reservoirs inside the polygon if bound.

### reservoir
- **Needs:** `storage` (`reservoir_fill` with `basis`; the only published baseline) · inflow `flow` at an
  upstream gauge · outflow `flow` below the dam · `snow` upstream · `drought`.
- **Drives mood today:** fill band, drought, alerts. Fill vs the same date in prior years is **not**
  published; say "% of normal" only as the twin's `reservoir_fill` states it.

### mountain / ridge
- **Needs:** `snow` (`swe`, `snow_depth` at SNOTEL) · `precip_accum` · `air_temp` · basin `snowline_m`
  from `get_snow` (arrives via the snapshot's `season`) · `air` (nearest sensor) · `alerts`/`fire`.
- **Today:** good in winter; SWE-%-of-median needs new ingest. Summer zero SWE is a season fact, not a
  deficit. **Drives mood today:** alerts, fire, drought, air only.

### bioregion (`bioregion/front-range`; later)
- **Needs:** feed health from `get_health` (per-source verdicts), basin `snowline_m`, counts of active
  alerts/fires/detections, drought coverage. No summary index is published yet; treat every need as
  display-only until the twin publishes one.
- **Drives mood today:** nothing reliably; the avatar sits at `content`/`asleep` on staleness alone.

## Out of scope for v1
Species populations (nothing in the twin; sensitivity gate); anything requiring real coordinates of a
`generalized` place; any need built from TK-labelled material.
