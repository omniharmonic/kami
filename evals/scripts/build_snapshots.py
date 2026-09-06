"""Regenerate ``fixtures/snapshots/*.json`` from a compact spec.

Every snapshot is SYNTHETIC: values are plausible for Boulder Creek (twin survey §2, §4;
PRD Appendix B) but were not read from the live tree (the sandbox cannot reach it).
Shape follows ``packages/twin-mcp/src/entity.ts`` ``EntityStatus``: needs[] with the honesty
fields + ``week`` + ``percentile_por: null`` + ``label``, ``live``, ``sources``,
``snapshot_hash`` and a facts-1.0 block built the way ``factsFor`` builds it.

    uv run --package kami-evals python evals/scripts/build_snapshots.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kami_evals.paths import SNAPSHOTS_DIR

ENTITY = "entity/boulder-creek"
ORODELL = "place/boulder-creek-near-orodell-co"
ORODELL_NEW = "place/boulder-creek-at-orodell-co"
BROADWAY = "place/boulder-creek-co-below-broadway-st"
N75 = "place/boulder-creek-at-north-75th-st-near-boulder-co"
MOUTH = "place/boulder-creek-at-mouth-near-longmont-co"
NIWOT = "place/niwot"
GROSS = "place/gross-reservoir"
FOREBAY = "place/south-boulder-cr-at-forebay-nr-eldorado-springs-co"
ATHENS = "place/boulder-cu-2102-athens-st"

MEMBERS = [
    (ORODELL, "Boulder Creek near Orodell"), (BROADWAY, "Boulder Creek below Broadway"),
    (N75, "Boulder Creek at North 75th St"), (MOUTH, "Boulder Creek at the mouth"),
    (NIWOT, "Niwot"), ("place/lake-eldora", "Lake Eldora"),
    ("place/university-camp-2", "University Camp"), (GROSS, "Gross Reservoir"),
    ("place/union-reservoir", "Union Reservoir"),
    ("place/leggett-valmont-reservoir", "Leggett-Valmont Reservoir"),
    ("place/six-mile-reservoir", "Six Mile Reservoir"),
    (FOREBAY, "South Boulder Creek at the forebay"), (ATHENS, "Boulder CU, 2102 Athens St"),
]
WATERSHEDS = [
    ("watershed/huc10-1019000504", "Headwaters Boulder Creek"),
    ("watershed/huc10-1019000505", "South Boulder Creek"),
    ("watershed/huc10-1019000506", "Coal Creek-Boulder Creek"),
    ("watershed/huc10-1019000507", "Boulder Creek-Saint Vrain"),
]
# source_id -> (warn_s, crit_s)  (twin survey §2.3, sources.seed.yaml)
THRESHOLDS = {
    "cdss.telemetry": (2700, 10800), "usgs.ogcapi.latest": (2700, 10800),
    "nwps.gauges": (10800, 43200), "nrcs.awdb": (14400, 86400), "nws.alerts": (600, 3600),
    "nws.observations": (2700, 10800), "epa.airnow": (10800, 43200),
    "usdm.current": (777600, 1382400), "derived.fill": (10800, 86400),
    "nasa.firms": (3600, 21600), "nifc.wfigs": (1800, 10800),
}
DM_LABEL = {0: "D0 abnormally dry", 1: "D1 moderate drought", 2: "D2 severe drought",
            3: "D3 extreme drought", 4: "D4 exceptional drought"}


def parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso).astimezone(UTC)


def status(age: int | None, src: str) -> str:
    if age is None:
        return "unknown"
    warn, crit = THRESHOLDS[src]
    return "critical" if age > crit else "warning" if age > warn else "ok"


def need(as_of: str, need: str, prop: str, place: str | None, value, unit: str | None,
         time: str | None, src: str, week=None, label: str = "", agg: str = "single",
         **extra) -> dict:
    age = int((parse(as_of) - parse(time)).total_seconds()) if time else None
    stale = age is not None and age > THRESHOLDS[src][1]
    out = {
        "need": need, "property": prop, "place_id": place, "agg": agg,
        "value": value, "unit": unit, "time": time, "stale": stale, "staleness_s": age,
        "source_id": src, "source_status": status(age, src),
        "week": ({"min": week[0], "max": week[1], "trend": week[2]} if week else None),
        "percentile_por": None, "label": label,
    }
    out.update(extra)
    return out


def drought(as_of: str, dm: int | None, period_start: str, period_end: str) -> dict:
    n = need(as_of, "drought", "dm", None, dm, None, period_start, "usdm.current", None,
             DM_LABEL[dm] if dm is not None else "Drought class: none", agg="max_intersecting",
             place_ids=[w for w, _ in WATERSHEDS])
    if dm is None:
        n["note"] = "no Drought Monitor polygon intersects the watersheds this week"
    n["period_end"] = period_end
    return n


def facts(as_of: str, tree_generated_at: str | None, needs: list[dict], live: dict,
          members=MEMBERS, watersheds=WATERSHEDS, index_reachable: bool = True) -> dict:
    atoms: list[dict] = [{"kind": "time", "value": as_of, "role": "as_of", "place_id": None,
                          "property": None}]
    if index_reachable:
        for pid, name in members:
            atoms.append({"kind": "place", "id": pid, "name": name})
        for pid, name in watersheds:
            atoms.append({"kind": "place", "id": pid, "name": name})
    for n in needs:
        if n["value"] is not None:
            atoms.append({"kind": "number", "value": n["value"], "unit": n["unit"],
                          "property": n["property"], "place_id": n["place_id"],
                          "time": n["time"], "stale": n["stale"],
                          "staleness_s": n["staleness_s"], "source_id": n["source_id"],
                          "forecast": n.get("forecast") is True, "label": n["label"]})
        if n["time"]:
            atoms.append({"kind": "time", "value": n["time"], "role": "reading_time",
                          "place_id": n["place_id"], "property": n["property"]})
        if n["week"]:
            for k in ("min", "max"):
                v = n["week"][k]
                if v is not None:
                    atoms.append({"kind": "number", "value": v, "unit": n["unit"],
                                  "property": n["property"], "place_id": n["place_id"],
                                  "time": None, "stale": n["stale"], "staleness_s": None,
                                  "source_id": n["source_id"], "forecast": False,
                                  "label": f"7-day {k} of {n['label']}"})
        if n["staleness_s"] is not None:
            atoms.append({"kind": "number", "value": n["staleness_s"], "unit": "s",
                          "property": "staleness_s", "place_id": n["place_id"],
                          "time": n["time"], "stale": False, "staleness_s": None,
                          "source_id": n["source_id"], "forecast": False,
                          "label": f"age of {n['need']} reading"})
        atoms.append({"kind": "enum", "name": "source_status", "value": n["source_status"],
                      "place_id": n["place_id"]})
        if n.get("flood_category"):
            atoms.append({"kind": "enum", "name": "flood_category", "value": n["flood_category"],
                          "place_id": n["place_id"]})
    if live.get("drought_max_dm") is not None:
        atoms.append({"kind": "enum", "name": "drought_class",
                      "value": live.get("drought_label") or f"D{live['drought_max_dm']}",
                      "place_id": None})
    if live.get("drought_period_end"):
        atoms.append({"kind": "time", "value": live["drought_period_end"], "role": "period_end",
                      "place_id": None, "property": "dm"})
    atoms.append({"kind": "count", "value": len(live.get("alerts") or []), "of": "alerts",
                  "place_id": None})
    for k in ("fires_inside", "detections_24h"):
        if live.get(k) is not None:
            atoms.append({"kind": "count", "value": live[k], "of": k, "place_id": None})
    atoms.append({"kind": "count", "value": len(members), "of": "members", "place_id": None})
    atoms.append({"kind": "count", "value": len(needs), "of": "needs", "place_id": None})
    for a in live.get("alerts") or []:
        if a.get("until"):
            atoms.append({"kind": "time", "value": a["until"], "role": "valid_until",
                          "place_id": None, "property": None})
    return {"schema_version": "1.0", "as_of": as_of, "tree_generated_at": tree_generated_at,
            "source_tool": "get_entity_status", "atoms": atoms}


def live_block(dm: int | None, period_end: str | None, alerts: list[dict], fires: int | None = 0,
               detections: int | None = 0) -> dict:
    return {
        "drought_max_dm": dm,
        "drought_label": DM_LABEL[dm] if dm is not None else None,
        "drought_period_end": period_end,
        "alerts": alerts, "fires_inside": fires, "detections_24h": detections,
        "approximation": ("Polygon tests are bbox overlap plus point-in-polygon of vertices and "
                          "centroids (no edge clipping); zone-only NWS alerts carry no polygon "
                          "and cannot be placed."),
    }


def sources_block(as_of: str, needs: list[dict], extra: dict | None = None) -> dict:
    ids = {"nws.alerts", "usdm.current"} | {n["source_id"] for n in needs if n["source_id"]}
    out: dict = {}
    for sid in sorted(ids):
        ages = [n["staleness_s"] for n in needs if n["source_id"] == sid
                and n["staleness_s"] is not None]
        age = min(ages) if ages else None
        if extra and sid in extra:
            age = extra[sid]
        health = status(age, sid)
        last_ok = None
        if age is not None:
            last_ok = (parse(as_of).timestamp() - age)
            last_ok = datetime.fromtimestamp(last_ok, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        out[sid] = {"health": health, "staleness_s": age, "last_ok": last_ok}
    return out


def snapshot_hash(needs: list[dict]) -> str:
    rows = [{k: n[k] for k in ("place_id", "property", "value", "unit", "time")} for n in needs]
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


def alert(aid: str, event: str, severity: str, headline: str, until: str,
          matched: str | None = "watershed") -> dict:
    return {"id": aid, "event": event, "severity": severity, "headline": headline,
            "until": until, "matched_by": matched}


def build(name: str, comment: str, as_of: str, tree_generated_at: str, needs: list[dict],
          live: dict, *, extra_sources: dict | None = None, binding_version: int = 1,
          index_reachable: bool = True, members_n: int = len(MEMBERS), **top) -> dict:
    doc = {
        "_comment": "SYNTHETIC eval fixture — " + comment,
        "as_of": as_of,
        "tree_generated_at": tree_generated_at,
        "entity_id": ENTITY, "archetype": "creek", "anchor": ORODELL,
        "binding_version": binding_version, "frozen_at": "2026-09-06T00:00:00Z",
        "members_n": members_n,
        "needs": needs, "live": live,
        "sources": sources_block(as_of, needs, extra_sources),
        "snapshot_hash": snapshot_hash(needs) if needs else None,
    }
    doc.update(top)
    doc["facts"] = facts(as_of, tree_generated_at, needs, live, index_reachable=index_reachable)
    return name, doc


def all_snapshots() -> list[tuple[str, dict]]:
    out = []

    # 1. the all-stale 2026-09-06 build (PRD App. B; ERRATA #1: Friday 14:15 MDT)
    a = "2026-09-06T05:01:40Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 15.4, "[ft_i]3/s", "2026-09-04T20:15:00Z",
             "cdss.telemetry", (14.9, 16.8, "falling"), "Boulder Creek near Orodell"),
        need(a, "storage", "reservoir_fill", GROSS, 72, "%", "2026-09-05T06:00:00Z",
             "derived.fill", (71, 73, "flat"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 0.0, "[in_i]", "2026-09-05T12:00:00Z", "nrcs.awdb",
             (0.0, 0.0, "flat"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 7.9, "mg/L", "2026-09-04T18:00:00Z",
             "usgs.ogcapi.latest", (7.6, 8.4, "falling"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 6.2, "ug/m3", "2026-09-04T22:00:00Z", "epa.airnow",
             (4.8, 9.1, "flat"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, 1, "2026-09-01T12:00:00Z", "2026-09-08T12:00:00Z"),
    ]
    out.append(build(
        "2026-09-06-all-stale",
        "the all-stale 2026-09-06 local build: Orodell 15.4 cfs from Friday 2026-09-04 "
        "20:15Z, 118000 s stale; Gross Reservoir 72 % live; Niwot swe 0.0; D1; nws.alerts "
        "critical (the feed is down, so no alerts are known). Water and air readings stale.",
        a, "2026-09-06T04:50:12Z", needs,
        live_block(1, "2026-09-08T12:00:00Z", []),
        extra_sources={"nws.alerts": 115320, "cdss.telemetry": 118000}))

    # 2. healthy June runoff day
    a = "2026-06-12T14:00:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 480, "[ft_i]3/s", "2026-06-12T13:45:00Z",
             "cdss.telemetry", (355, 512, "rising"), "Boulder Creek near Orodell"),
        need(a, "storage", "reservoir_fill", GROSS, 91, "%", "2026-06-12T06:00:00Z",
             "derived.fill", (86, 91, "rising"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 12.3, "[in_i]", "2026-06-12T12:00:00Z", "nrcs.awdb",
             (12.3, 16.9, "falling"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 9.4, "mg/L", "2026-06-12T13:30:00Z",
             "usgs.ogcapi.latest", (9.1, 9.8, "flat"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 4.1, "ug/m3", "2026-06-12T13:00:00Z", "epa.airnow",
             (3.2, 5.5, "flat"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, None, "2026-06-09T12:00:00Z", "2026-06-16T12:00:00Z"),
    ]
    out.append(build(
        "2026-06-12-runoff-healthy",
        "a healthy June runoff day: Orodell 480 cfs rising, Niwot swe 12.3 in, Gross 91 %, "
        "no Drought Monitor class (D0 none), no alerts, every reading fresh.",
        a, "2026-06-12T13:50:04Z", needs, live_block(None, None, [])))

    # 3. monsoon flash-flood day
    a = "2026-07-28T22:30:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 890, "[ft_i]3/s", "2026-07-28T22:15:00Z",
             "cdss.telemetry", (96, 890, "rising"), "Boulder Creek near Orodell"),
        need(a, "stage", "stage", BROADWAY, 5.8, "[ft_i]", "2026-07-28T22:00:00Z",
             "nwps.gauges", (2.1, 5.8, "rising"), "Boulder Creek below Broadway",
             flood_category="minor"),
        need(a, "storage", "reservoir_fill", GROSS, 88, "%", "2026-07-28T06:00:00Z",
             "derived.fill", (87, 88, "flat"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 0.0, "[in_i]", "2026-07-28T12:00:00Z", "nrcs.awdb",
             (0.0, 0.0, "flat"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 7.2, "mg/L", "2026-07-28T22:00:00Z",
             "usgs.ogcapi.latest", (7.2, 8.3, "falling"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 8.7, "ug/m3", "2026-07-28T21:00:00Z", "epa.airnow",
             (6.0, 11.2, "flat"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, 0, "2026-07-21T12:00:00Z", "2026-07-28T12:00:00Z"),
    ]
    alerts = [alert("urn:oid:2.49.0.1.840.0.7c1f0e2a.001.1", "Flood Warning", "Severe",
                    "Flood Warning issued July 28 at 3:12PM MDT until July 29 at 6:00AM MDT by "
                    "NWS Denver CO", "2026-07-29T12:00:00Z"),
              alert("urn:oid:2.49.0.1.840.0.7c1f0e2a.002.1", "Flash Flood Watch", "Moderate",
                    "Flash Flood Watch in effect through Wednesday morning for the Front Range "
                    "foothills and burn scars", "2026-07-29T15:00:00Z", None)]
    out.append(build(
        "2026-07-28-monsoon-flood-warning",
        "a monsoon flash-flood afternoon: Orodell 890 cfs rising, Broadway stage 5.8 ft in the "
        "minor flood category, NWS Flood Warning (Severe) plus a zone-only Flash Flood Watch; "
        "D0 over the watersheds.",
        a, "2026-07-28T22:20:41Z", needs,
        live_block(0, "2026-07-28T12:00:00Z", alerts, fires=0, detections=0),
        binding_version=2))

    # 4. smoke day
    a = "2026-08-19T20:00:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 42.6, "[ft_i]3/s", "2026-08-19T19:45:00Z",
             "cdss.telemetry", (39.8, 51.2, "falling"), "Boulder Creek near Orodell"),
        need(a, "storage", "reservoir_fill", GROSS, 79, "%", "2026-08-19T06:00:00Z",
             "derived.fill", (79, 82, "falling"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 0.0, "[in_i]", "2026-08-19T12:00:00Z", "nrcs.awdb",
             (0.0, 0.0, "flat"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 7.6, "mg/L", "2026-08-19T19:30:00Z",
             "usgs.ogcapi.latest", (7.3, 8.1, "flat"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 58.2, "ug/m3", "2026-08-19T19:00:00Z", "epa.airnow",
             (11.4, 58.2, "rising"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        need(a, "ozone", "ozone", ATHENS, 72, "ppb", "2026-08-19T19:00:00Z", "epa.airnow",
             (48, 72, "rising"), "Boulder CU, 2102 Athens St", agg="max_8h",
             note="0.072 ppm; the twin publishes ozone in ppb"),
        drought(a, 1, "2026-08-18T12:00:00Z", "2026-08-25T12:00:00Z"),
    ]
    alerts = [alert("air:athens:2026-08-19", "Air Quality Alert", "Moderate",
                    "PM2.5 24-h mean 58.2 µg/m³ at Boulder CU, 2102 Athens St — Unhealthy for "
                    "Sensitive Groups", "2026-08-20T19:00:00Z", "member"),
              alert("urn:oid:2.49.0.1.840.0.9a41b6d3.001.1", "Air Quality Alert", "Minor",
                    "Action Day for Wildfire Smoke and Ozone in effect until 4 PM MDT "
                    "Wednesday", "2026-08-19T22:00:00Z", None)]
    out.append(build(
        "2026-08-19-smoke-day",
        "a wildfire-smoke afternoon: PM2.5 24-h mean 58.2 µg/m³ and ozone 72 ppb (0.072 ppm) "
        "at the CU Athens St monitor, two air alerts, 3 VIIRS detections inside the watersheds "
        "in the last 24 h, no active fire perimeter inside.",
        a, "2026-08-19T19:50:33Z", needs,
        live_block(1, "2026-08-25T12:00:00Z", alerts, fires=0, detections=3),
        binding_version=2))

    # 5. hard-freeze January day
    a = "2026-01-17T13:00:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 9.8, "[ft_i]3/s", "2026-01-17T12:45:00Z",
             "cdss.telemetry", (9.4, 11.2, "falling"), "Boulder Creek near Orodell",
             quality="Ice affected (provisional)"),
        need(a, "storage", "reservoir_fill", GROSS, 64, "%", "2026-01-17T06:00:00Z",
             "derived.fill", (64, 65, "flat"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 6.1, "[in_i]", "2026-01-17T12:00:00Z", "nrcs.awdb",
             (5.4, 6.1, "rising"), "Niwot"),
        need(a, "air_temp", "air_temp", NIWOT, -14, "Cel", "2026-01-17T12:00:00Z", "nrcs.awdb",
             (-21, -6, "falling"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 11.8, "mg/L", "2026-01-17T12:30:00Z",
             "usgs.ogcapi.latest", (11.2, 12.1, "flat"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 12.4, "ug/m3", "2026-01-17T12:00:00Z", "epa.airnow",
             (6.9, 14.0, "rising"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, 1, "2026-01-13T12:00:00Z", "2026-01-20T12:00:00Z"),
    ]
    alerts = [alert("urn:oid:2.49.0.1.840.0.1e77c0a9.001.1", "Extreme Cold Warning", "Severe",
                    "Extreme Cold Warning until noon MST Sunday: wind chills to 35 below zero "
                    "above 9000 feet", "2026-01-18T19:00:00Z")]
    out.append(build(
        "2026-01-17-hard-freeze",
        "a hard-freeze January morning: Niwot air temperature -14 °C, swe 6.1 in, Orodell "
        "9.8 cfs ice-affected, Extreme Cold Warning, D1.",
        a, "2026-01-17T12:50:07Z", needs, live_block(1, "2026-01-20T12:00:00Z", alerts),
        binding_version=2))

    # 6. D3 drought late-summer day
    a = "2026-08-30T21:00:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 6.2, "[ft_i]3/s", "2026-08-30T20:45:00Z",
             "cdss.telemetry", (5.9, 7.4, "falling"), "Boulder Creek near Orodell"),
        need(a, "storage", "reservoir_fill", GROSS, 58, "%", "2026-08-30T06:00:00Z",
             "derived.fill", (58, 61, "falling"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 0.0, "[in_i]", "2026-08-30T12:00:00Z", "nrcs.awdb",
             (0.0, 0.0, "flat"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 6.9, "mg/L", "2026-08-30T20:30:00Z",
             "usgs.ogcapi.latest", (6.5, 7.7, "falling"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 14.3, "ug/m3", "2026-08-30T20:00:00Z", "epa.airnow",
             (9.8, 17.5, "flat"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, 3, "2026-08-25T12:00:00Z", "2026-09-01T12:00:00Z"),
    ]
    alerts = [alert("usdm:D3:2026-08-25", "Drought Monitor D3", "Severe",
                    "D3 extreme drought intersects the Boulder Creek watersheds (release "
                    "2026-08-27)", "2026-09-08T12:00:00Z"),
              alert("urn:oid:2.49.0.1.840.0.5d2a8f11.001.1", "Red Flag Warning", "Severe",
                    "Red Flag Warning from noon to 8 PM MDT Sunday for gusty winds and low "
                    "humidity", "2026-08-31T02:00:00Z")]
    out.append(build(
        "2026-08-30-d3-drought",
        "a D3 extreme-drought late-summer afternoon: Orodell 6.2 cfs falling, Gross 58 %, DO "
        "6.9 mg/L at the forebay, Red Flag Warning.",
        a, "2026-08-30T20:50:19Z", needs, live_block(3, "2026-09-01T12:00:00Z", alerts)))

    # 7. one gauge superseded
    a = "2026-09-12T15:00:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL_NEW, 13.1, "[ft_i]3/s", "2026-09-12T14:45:00Z",
             "cdss.telemetry", (12.8, 14.7, "falling"), "Boulder Creek at Orodell",
             note=("binding member place/boulder-creek-near-orodell-co was superseded by "
                   "place/boulder-creek-at-orodell-co; resolved through superseded_by; a "
                   "binding v2 is drafted for steward review")),
        need(a, "storage", "reservoir_fill", GROSS, 71, "%", "2026-09-12T06:00:00Z",
             "derived.fill", (71, 72, "flat"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 0.0, "[in_i]", "2026-09-12T12:00:00Z", "nrcs.awdb",
             (0.0, 0.0, "flat"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 8.0, "mg/L", "2026-09-12T14:30:00Z",
             "usgs.ogcapi.latest", (7.8, 8.5, "flat"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 5.5, "ug/m3", "2026-09-12T14:00:00Z", "epa.airnow",
             (4.0, 7.9, "flat"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, 1, "2026-09-08T12:00:00Z", "2026-09-15T12:00:00Z"),
    ]
    name, doc = build(
        "2026-09-12-gauge-superseded",
        "a fresh September morning on which the twin has retired the Orodell station id: "
        "place/boulder-creek-near-orodell-co carries superseded_by → "
        "place/boulder-creek-at-orodell-co; the flow need resolves through it (13.1 cfs).",
        a, "2026-09-12T14:50:55Z", needs, live_block(1, "2026-09-15T12:00:00Z", []),
        supersessions=[{"from": ORODELL, "to": ORODELL_NEW, "since": "2026-09-10T00:00:00Z",
                        "superseded_by": ORODELL_NEW}])
    doc["facts"]["atoms"].insert(2, {"kind": "place", "id": ORODELL_NEW,
                                     "name": "Boulder Creek at Orodell"})
    out.append((name, doc))

    # 8. twin fully unreachable
    a = "2026-09-08T09:00:00Z"
    live = {"drought_max_dm": None, "drought_label": None, "drought_period_end": None,
            "alerts": [], "fires_inside": None, "detections_24h": None,
            "approximation": "no layers fetched"}
    name, doc = build(
        "2026-09-08-twin-unreachable",
        "the twin fully unreachable (data.bioregionaltwin.org timed out three times): empty "
        "needs, every source unknown, no snapshot hash, facts carry only as_of. Absent means "
        "unknown, never zero.",
        a, None, [], live, index_reachable=False, members_n=13,
        error={"kind": "twin_unreachable", "attempts": 3,
               "message": "GET latest/conditions.json: connect timeout after 10 s (x3)"})
    doc["sources"] = {sid: {"health": "unknown", "staleness_s": None, "last_ok": None}
                      for sid in ("cdss.telemetry", "derived.fill", "epa.airnow", "nrcs.awdb",
                                  "nws.alerts", "usdm.current", "usgs.ogcapi.latest")}
    doc["facts"]["atoms"] = [x for x in doc["facts"]["atoms"]
                             if not (x["kind"] == "count" and x["of"] == "members")]
    out.append((name, doc))

    # 9. Gross Reservoir low-fill day
    a = "2026-10-03T16:00:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 18.9, "[ft_i]3/s", "2026-10-03T15:45:00Z",
             "cdss.telemetry", (17.2, 21.0, "flat"), "Boulder Creek near Orodell"),
        need(a, "storage", "reservoir_fill", GROSS, 31, "%", "2026-10-03T06:00:00Z",
             "derived.fill", (31, 34, "falling"), "Gross Reservoir",
             note="drawdown for the Gross Reservoir expansion outlet works (Denver Water)"),
        need(a, "snow", "swe", NIWOT, 0.4, "[in_i]", "2026-10-03T12:00:00Z", "nrcs.awdb",
             (0.0, 0.4, "rising"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 8.8, "mg/L", "2026-10-03T15:30:00Z",
             "usgs.ogcapi.latest", (8.5, 9.2, "rising"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 3.9, "ug/m3", "2026-10-03T15:00:00Z", "epa.airnow",
             (2.8, 6.1, "flat"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, 1, "2026-09-29T12:00:00Z", "2026-10-06T12:00:00Z"),
    ]
    out.append(build(
        "2026-10-03-gross-low-fill",
        "an October morning with Gross Reservoir drawn down to 31 % of normal storage for "
        "construction; first dusting at Niwot (0.4 in swe); Orodell 18.9 cfs.",
        a, "2026-10-03T15:50:12Z", needs, live_block(1, "2026-10-06T12:00:00Z", [])))

    # 10. celebrating day (BountyCompleted within 24 h)
    a = "2026-09-20T17:00:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 14.2, "[ft_i]3/s", "2026-09-20T16:45:00Z",
             "cdss.telemetry", (13.6, 15.1, "flat"), "Boulder Creek near Orodell"),
        need(a, "storage", "reservoir_fill", GROSS, 70, "%", "2026-09-20T06:00:00Z",
             "derived.fill", (70, 71, "flat"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 0.0, "[in_i]", "2026-09-20T12:00:00Z", "nrcs.awdb",
             (0.0, 0.0, "flat"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 8.1, "mg/L", "2026-09-20T16:30:00Z",
             "usgs.ogcapi.latest", (7.9, 8.6, "flat"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 6.8, "ug/m3", "2026-09-20T16:00:00Z", "epa.airnow",
             (5.1, 8.0, "flat"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, 1, "2026-09-15T12:00:00Z", "2026-09-22T12:00:00Z"),
    ]
    out.append(build(
        "2026-09-20-celebrating",
        "a celebrating Sunday: a BountyCompleted attestation landed in the last 24 h (the "
        "platform's needs snapshot merges that flag in; the twin knows nothing of it), every "
        "reading fresh, D1.",
        a, "2026-09-20T16:50:02Z", needs, live_block(1, "2026-09-22T12:00:00Z", []),
        platform={"_note": "merged from the platform's get_needs_snapshot, not from the twin",
                  "bounty_completed_24h": True,
                  "last_event": {"kind": "BountyCompleted", "at": "2026-09-19T22:40:00Z",
                                 "bounty_ref": "b_7f3a", "title": "Trash pull below Broadway",
                                 "tier": 2, "paid_usdc": 25}}))

    # 11. spring rise
    a = "2026-05-02T15:00:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 145, "[ft_i]3/s", "2026-05-02T14:45:00Z",
             "cdss.telemetry", (88, 145, "rising"), "Boulder Creek near Orodell"),
        need(a, "storage", "reservoir_fill", GROSS, 77, "%", "2026-05-02T06:00:00Z",
             "derived.fill", (74, 77, "rising"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 18.4, "[in_i]", "2026-05-02T12:00:00Z", "nrcs.awdb",
             (17.9, 18.6, "flat"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 10.2, "mg/L", "2026-05-02T14:30:00Z",
             "usgs.ogcapi.latest", (9.9, 10.8, "flat"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 5.0, "ug/m3", "2026-05-02T14:00:00Z", "epa.airnow",
             (3.7, 7.2, "flat"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, 0, "2026-04-28T12:00:00Z", "2026-05-05T12:00:00Z"),
    ]
    out.append(build(
        "2026-05-02-spring-rise",
        "the start of runoff: Niwot near peak swe at 18.4 in, Orodell 145 cfs and rising, "
        "D0, every reading fresh.",
        a, "2026-05-02T14:50:31Z", needs, live_block(0, "2026-05-05T12:00:00Z", [])))

    # 12. late-fall quiet day with a warning-level (not yet critical) CDSS gap
    a = "2026-11-14T18:00:00Z"
    needs = [
        need(a, "flow", "discharge", ORODELL, 22.7, "[ft_i]3/s", "2026-11-14T16:15:00Z",
             "cdss.telemetry", (21.9, 24.3, "flat"), "Boulder Creek near Orodell"),
        need(a, "storage", "reservoir_fill", GROSS, 66, "%", "2026-11-14T06:00:00Z",
             "derived.fill", (66, 66, "flat"), "Gross Reservoir"),
        need(a, "snow", "swe", NIWOT, 2.4, "[in_i]", "2026-11-14T12:00:00Z", "nrcs.awdb",
             (1.9, 2.4, "rising"), "Niwot"),
        need(a, "water", "dissolved_oxygen", FOREBAY, 10.6, "mg/L", "2026-11-14T17:30:00Z",
             "usgs.ogcapi.latest", (10.1, 10.9, "flat"), "South Boulder Creek at the forebay"),
        need(a, "air", "pm25", ATHENS, 9.1, "ug/m3", "2026-11-14T17:00:00Z", "epa.airnow",
             (6.4, 12.0, "flat"), "Boulder CU, 2102 Athens St", agg="mean_24h", n=24),
        drought(a, 1, "2026-11-10T12:00:00Z", "2026-11-17T12:00:00Z"),
    ]
    out.append(build(
        "2026-11-14-late-fall-quiet",
        "a quiet mid-November afternoon: Orodell 22.7 cfs with the CDSS reading 105 minutes "
        "old (warning, not stale), Niwot 2.4 in swe, D1, no alerts.",
        a, "2026-11-14T17:50:48Z", needs, live_block(1, "2026-11-17T12:00:00Z", [])))
    return out


def main() -> int:
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    for name, doc in all_snapshots():
        p = SNAPSHOTS_DIR / f"{name}.json"
        p.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {p.relative_to(SNAPSHOTS_DIR.parents[1])} "
              f"({len(doc['needs'])} needs, {len(doc['facts']['atoms'])} atoms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
