"""One test per row 1–15 of the T0.4 guard test table (rows 16–17 live in apps/gate)."""

from __future__ import annotations

from datetime import UTC, datetime

from factguard import STALE_TEMPLATE, guard_text, match_sentence
from factguard.guard import render_time

NOW = datetime(2026, 9, 6, 5, 0, tzinfo=UTC)


def values(result):
    return [c.value for c in result.unmatched]


def test_row01_flow_matches_discharge(sheet_fresh, gazetteer):
    r = match_sentence("Flow at Orodell is 15.4 cfs.", sheet_fresh, gazetteer=gazetteer)
    assert r.ok, r.to_dict()
    assert any(getattr(a, "property", None) == "discharge" for a in r.used_atoms)


def test_row02_wrong_flow_dropped(sheet_fresh, gazetteer):
    r = match_sentence("Flow at Orodell is 18 cfs.", sheet_fresh, gazetteer=gazetteer)
    assert not r.ok
    assert r.reason == "unmatched"
    assert values(r) == [18]


def test_row03_unit_converted_cubic_metres(sheet_fresh, gazetteer):
    # 15.4 cfs = 0.436 m³/s; "0.44" has d=2 → tolerance 0.005, rel. err 0.9 %
    r = match_sentence("That's about 0.44 cubic metres a second.", sheet_fresh,
                       gazetteer=gazetteer)
    assert r.ok, r.to_dict()


def test_row04_celsius_from_fahrenheit(sheet_fresh, gazetteer):
    r = match_sentence("Water is 12 °C.", sheet_fresh, gazetteer=gazetteer)
    assert r.ok, r.to_dict()


def test_row05_stale_with_weekday_passes(sheet_stale, gazetteer):
    # 2026-09-04T20:15Z is a Friday in America/Denver (the planning table says "Thursday";
    # the calendar disagrees — see the report). Weekday resolves against as_of.
    r = match_sentence("The last reading I have from Orodell is 15.4 cfs, from Friday.",
                       sheet_stale, gazetteer=gazetteer)
    assert r.ok, r.to_dict()


def test_row05b_stale_with_wrong_weekday_fails(sheet_stale, gazetteer):
    r = match_sentence("The last reading I have from Orodell is 15.4 cfs, from Thursday.",
                       sheet_stale, gazetteer=gazetteer)
    assert not r.ok
    assert r.reason == "unmatched" and [c.text for c in r.unmatched] == ["Thursday"]


def test_row06_stale_without_time_dropped_and_asleep_line(sheet_stale, gazetteer):
    r = match_sentence("Flow at Orodell is 15.4 cfs.", sheet_stale, gazetteer=gazetteer)
    assert not r.ok
    assert r.reason == "stale_without_time"
    assert r.stale_times == ["2026-09-04T20:15:00Z"]
    g = guard_text("Flow at Orodell is 15.4 cfs.", sheet_stale, gazetteer=gazetteer)
    assert g.released == [] and len(g.dropped) == 1
    line = STALE_TEMPLATE.format(time="Friday afternoon (2026-09-04 20:15Z)")
    assert g.stale_lines == [line]
    assert g.final_text == "I don't have a reading for that. " + line
    assert render_time("2026-09-04T20:15:00Z") == "Friday afternoon (2026-09-04 20:15Z)"


def test_row07_reservoir_percent(sheet_fresh, gazetteer):
    r = match_sentence("Gross Reservoir is at 72 % of normal.", sheet_fresh, gazetteer=gazetteer)
    assert r.ok, r.to_dict()


def test_row08_percentile_claim_dropped(sheet_fresh, gazetteer):
    r = match_sentence("That's about 30 % below normal for September.", sheet_fresh,
                       gazetteer=gazetteer)
    assert not r.ok
    assert values(r) == [30]
    assert r.unmatched[0].unit == "%"


def test_row09_count_atom_four_gauges(sheet_fresh, gazetteer):
    r = match_sentence("I'm listening through four gauges.", sheet_fresh, gazetteer=gazetteer)
    assert r.ok, r.to_dict()
    assert any(getattr(a, "of", None) == "children" for a in r.used_atoms)


def test_row10_count_mismatch_dropped(sheet_stale, gazetteer):
    r = match_sentence("Three of my gauges are quiet.", sheet_stale, gazetteer=gazetteer)
    assert not r.ok
    assert values(r) == [3]


def test_row11_echo_of_user_number_passes(sheet_fresh, gazetteer):
    r = match_sentence("20 cfs would be a lot for September.", sheet_fresh,
                       last_user_message="is 20 cfs a lot?", gazetteer=gazetteer)
    assert r.ok, r.to_dict()
    assert r.candidates and r.candidates[0].echo
    # without the echo the same sentence is dropped
    assert not match_sentence("20 cfs would be a lot for September.", sheet_fresh,
                              gazetteer=gazetteer).ok


def test_row12_species_not_from_commons_this_turn(sheet_fresh, gazetteer):
    r = match_sentence("Brown trout need more oxygen than this.", sheet_fresh,
                       gazetteer=gazetteer)
    assert not r.ok
    assert [c.kind for c in r.unmatched] == ["species"]
    # the same sentence passes when a commons species note was returned this turn
    sheet_fresh.ingest({"species": [{"name": "Brown trout", "scientific": "Salmo trutta",
                                     "note_path": "wiki/species/brown-trout.md"}]})
    assert match_sentence("Brown trout need more oxygen than this.", sheet_fresh,
                          gazetteer=gazetteer).ok


def test_row13_gazetteer_place_not_in_tool_result(sheet_fresh, gazetteer):
    r = match_sentence("Left Hand Creek is my neighbour.", sheet_fresh, gazetteer=gazetteer)
    assert not r.ok
    assert [c.text for c in r.unmatched] == ["Left Hand Creek"]


def test_row14_drought_class_and_valid_until(sheet_fresh, gazetteer):
    r = match_sentence("The Drought Monitor puts my watershed in D1 through the 7th.",
                       sheet_fresh, gazetteer=gazetteer)
    assert r.ok, r.to_dict()
    assert not match_sentence("The Drought Monitor puts my watershed in D2 through the 7th.",
                              sheet_fresh, gazetteer=gazetteer).ok
    assert not match_sentence("The Drought Monitor puts my watershed in D1 through the 9th.",
                              sheet_fresh, gazetteer=gazetteer).ok


def test_row15_relative_hours_since_reading(sheet_stale, gazetteer):
    # staleness_s 118000 = 32.8 h; "about 33 hours since" is within ±1 h
    r = match_sentence("It's been about 33 hours since my gauge reported.", sheet_stale,
                       now=NOW, gazetteer=gazetteer)
    assert r.ok, r.to_dict()
    # 50 h is more than 1 h from every reading time and every staleness atom in the sheet
    assert not match_sentence("It's been about 50 hours since my gauge reported.", sheet_stale,
                              now=NOW, gazetteer=gazetteer).ok
