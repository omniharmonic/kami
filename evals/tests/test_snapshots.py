"""Snapshot fixtures: the honesty fields, no geometry, the facts block, the all-stale case."""

from __future__ import annotations

import json

import pytest

from kami_evals.snapshots import (
    HONESTY_FIELDS,
    find_key,
    load_snapshot,
    sheet_for_snapshot,
    tool_result,
    validate_snapshot,
)

REQUIRED_CASES = [
    "2026-09-06-all-stale", "2026-06-12-runoff-healthy", "2026-07-28-monsoon-flood-warning",
    "2026-08-19-smoke-day", "2026-01-17-hard-freeze", "2026-08-30-d3-drought",
    "2026-09-12-gauge-superseded", "2026-09-08-twin-unreachable", "2026-10-03-gross-low-fill",
    "2026-09-20-celebrating",
]


def test_at_least_ten_snapshots(snapshots):
    assert len(snapshots) >= 10


@pytest.mark.parametrize("name", REQUIRED_CASES)
def test_every_required_case_is_present(snapshots, name):
    assert name in snapshots


def test_every_snapshot_validates(snapshots):
    problems = [p for name, doc in snapshots.items() for p in validate_snapshot(doc, name)]
    assert problems == []


def test_every_reading_carries_the_five_honesty_fields(snapshots):
    for name, doc in snapshots.items():
        for n in doc["needs"]:
            missing = [f for f in HONESTY_FIELDS if f not in n]
            assert not missing, f"{name}/{n['need']} missing {missing}"


def test_no_coordinates_key_anywhere(snapshots):
    for name, doc in snapshots.items():
        assert find_key(doc, "coordinates") == [], name


def test_every_snapshot_says_it_is_synthetic(snapshots):
    for name, doc in snapshots.items():
        assert "synthetic" in doc["_comment"].lower(), name
        assert doc["as_of"].endswith("Z"), name


def test_all_stale_snapshot_has_stale_true_on_flow():
    doc = load_snapshot("2026-09-06-all-stale")
    flow = next(n for n in doc["needs"] if n["need"] == "flow")
    assert flow["stale"] is True
    assert flow["value"] == 15.4
    assert flow["time"] == "2026-09-04T20:15:00Z"
    assert flow["staleness_s"] == 118000
    assert flow["source_status"] == "critical"
    assert doc["sources"]["nws.alerts"]["health"] == "critical"
    assert doc["live"]["drought_max_dm"] == 1
    gross = next(n for n in doc["needs"] if n["need"] == "storage")
    assert gross["value"] == 72 and gross["stale"] is False
    swe = next(n for n in doc["needs"] if n["need"] == "snow")
    assert swe["value"] == 0.0


def test_percentile_por_is_always_null(snapshots):
    for name, doc in snapshots.items():
        for n in doc["needs"]:
            assert n["percentile_por"] is None, name


def test_unreachable_snapshot_has_no_needs_and_unknown_sources():
    doc = load_snapshot("2026-09-08-twin-unreachable")
    assert doc["needs"] == []
    assert all(s["health"] == "unknown" for s in doc["sources"].values())
    assert doc["snapshot_hash"] is None


def test_tool_result_drops_fixture_only_keys():
    payload = tool_result(load_snapshot("2026-09-06-all-stale"))
    assert "_comment" not in payload
    assert json.dumps(payload)  # serialisable as a tool message


def test_fact_sheet_is_built_from_the_snapshot():
    sheet = sheet_for_snapshot(load_snapshot("2026-09-06-all-stale"))
    values = {a.value for a in sheet.numbers}
    assert 15.4 in values and 72 in values
    assert any(a.stale for a in sheet.numbers)
    assert any(p.id == "place/boulder-creek-near-orodell-co" for p in sheet.places)
