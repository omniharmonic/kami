"""The Boulder Creek all-stale ``get_entity_status`` fixture (mirrors packages/factguard/tests)."""

from __future__ import annotations

import json

ORODELL = "place/boulder-creek-near-orodell-co"
GROSS = "place/gross-reservoir"
NIWOT = "place/niwot"
FOREBAY = "place/south-boulder-cr-at-forebay-nr-eldorado-springs-co"
AS_OF = "2026-09-06T05:00:00Z"

ENTITY_STATUS = {
    "as_of": AS_OF, "schema_version": "2026-08", "tree_generated_at": "2026-09-06T04:50:12Z",
    "entity": "entity/boulder-creek", "anchor": ORODELL,
    "needs": [
        {"need": "flow", "property": "discharge", "place_id": ORODELL, "value": 15.4,
         "unit": "[ft_i]3/s", "time": "2026-09-04T20:15:00Z", "stale": True,
         "staleness_s": 118000, "source_status": "critical", "source_id": "cdss/BOCOROCO",
         "week": {"min": 14.9, "max": 16.8, "trend": "falling"}, "percentile_por": None,
         "label": "Boulder Creek near Orodell"},
        {"need": "storage", "property": "reservoir_fill", "place_id": GROSS, "value": 72,
         "unit": "%", "time": "2026-09-04T06:00:00Z", "stale": True, "staleness_s": 169200,
         "source_status": "critical", "source_id": "cdss/GROSRECO",
         "week": {"min": 72, "max": 74, "trend": "falling"}, "percentile_por": None,
         "label": "Gross Reservoir"},
        {"need": "snowpack", "property": "swe", "place_id": NIWOT, "value": 0.0,
         "unit": "[in_i]", "time": "2026-09-04T12:00:00Z", "stale": True, "staleness_s": 147600,
         "source_status": "critical", "source_id": "snotel/663",
         "week": {"min": 0.0, "max": 0.0, "trend": "flat"}, "percentile_por": None,
         "label": "Niwot SNOTEL"},
        {"need": "water_quality", "property": "water_temp", "place_id": FOREBAY, "value": 53.6,
         "unit": "[degF]", "time": "2026-09-04T19:45:00Z", "stale": True, "staleness_s": 119700,
         "source_status": "critical", "source_id": "usgs/06729450",
         "week": {"min": 51.8, "max": 55.4, "trend": "falling"}, "percentile_por": None,
         "label": "South Boulder Creek forebay"},
    ],
    "children": [
        {"id": ORODELL, "name": "Boulder Creek near Orodell, CO", "kind": "station"},
        {"id": "place/boulder-creek-co-below-broadway-st", "name": "Boulder Creek below Broadway",
         "kind": "station"},
        {"id": "place/boulder-creek-at-north-75th-st-near-boulder-co",
         "name": "Boulder Creek at North 75th St", "kind": "station"},
        {"id": "place/boulder-creek-at-mouth-near-longmont-co",
         "name": "Boulder Creek at mouth near Longmont", "kind": "station"},
    ],
    "live": {"drought": {"dm": 1, "valid_until": "2026-09-07"}, "drought_max_dm": 1,
             "alerts": [], "fires_inside": 0, "detections_24h": 0},
    "summary": {"readings": 4, "stale_readings": 4},
    "sources": {"cdss": {"health": "critical", "staleness_s": 118000}},
    "snapshot_hash": "9f1c0c9a3d3d0a5f6f0e2c4c1b7f8a9d",
}

GAZETTEER = {
    "places": [
        {"id": ORODELL, "name": "Boulder Creek near Orodell, CO", "aliases": ["Orodell"]},
        {"id": GROSS, "name": "Gross Reservoir"},
        {"id": NIWOT, "name": "Niwot"},
        {"id": "place/left-hand-creek", "name": "Left Hand Creek"},
    ],
    "species": ["Brown trout"],
}

CONFIG_BLOCK = "KAMI_ENTITY_CONFIG:" + json.dumps(
    {"slug": "boulder-creek", "caps": {"bounty_max_usdc": 25}, "guardians": ["Ana", "Ben"]})


def chat_request(user_text: str = "how is the creek?", *, stream: bool = True,
                 tool_doc: dict | None = None) -> dict:
    return {
        "model": "Qwen/Qwen3.5-9B", "stream": stream,
        "messages": [
            {"role": "system", "content": "You are an AI voice for Boulder Creek."},
            {"role": "system", "content": CONFIG_BLOCK},
            {"role": "user", "content": user_text},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call_1", "type": "function",
                 "function": {"name": "get_entity_status",
                              "arguments": json.dumps({"entity": "entity/boulder-creek"})}}]},
            {"role": "tool", "tool_call_id": "call_1",
             "content": json.dumps(tool_doc if tool_doc is not None else ENTITY_STATUS)},
        ],
    }


def parse_sse(text: str) -> list[tuple[str | None, str]]:
    """[(event, data)] for every frame in an SSE body."""
    frames = []
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        event, data = None, []
        for line in block.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].lstrip())
        frames.append((event, "\n".join(data)))
    return frames


def content_of(frames: list[tuple[str | None, str]]) -> str:
    out = []
    for event, data in frames:
        if event or data == "[DONE]":
            continue
        doc = json.loads(data)
        for ch in doc.get("choices") or []:
            c = (ch.get("delta") or {}).get("content")
            if c:
                out.append(c)
    return "".join(out)
