from datetime import date

import pytest

from factguard import Gazetteer, extract_candidates


def by_kind(cands, kind):
    return [c for c in cands if c.kind == kind]


def test_numerals_decimals_percent_negative_thousands():
    c = extract_candidates("It fell from 1,250 cfs to 15.4 cfs, -3 °C, 72% and 0.44 m³/s.")
    nums = by_kind(c, "number")
    assert [(n.value, n.unit, n.decimals) for n in nums] == [
        (1250.0, "[ft_i]3/s", 0), (15.4, "[ft_i]3/s", 1), (-3.0, "Cel", 0), (72.0, "%", 0),
        (0.44, "m3/s", 2)]


def test_spelled_out_numbers_and_tens():
    c = extract_candidates("I have four gauges, twenty members and thirty-two days of record.")
    assert [(n.value, n.unit) for n in by_kind(c, "number")] == [
        (4.0, None), (20.0, None), (32.0, "d")]


def test_dates_weekdays_and_relative_forms():
    c = extract_candidates(
        "On 2026-09-04 and September 4th, last Friday, about 33 hours ago, at 14:15, the 7th.",
        as_of_date=date(2026, 9, 6))
    kinds = [(x.kind, x.value) for x in c]
    assert ("date", date(2026, 9, 4)) in kinds
    assert kinds.count(("date", date(2026, 9, 4))) == 2
    assert ("weekday", 4) in kinds
    assert ("relative", 33 * 3600.0) in kinds
    assert ("clock", (14, 15, "")) in kinds
    assert ("date", date(2026, 9, 7)) in kinds
    # the numerals inside dates / relative forms are not double-counted as numbers
    assert by_kind(c, "number") == []


def test_numbers_inside_ids_are_ignored():
    c = extract_candidates("See place/boulder-cu-2102-athens-st and huc10-1019000504.")
    assert by_kind(c, "number") == []


def test_gazetteer_proper_nouns_multiword_case_insensitive():
    g = Gazetteer.from_dict({"places": [{"id": "place/left-hand-creek", "name": "Left Hand Creek"},
                                        {"id": "place/x", "name": "Boulder Creek",
                                         "aliases": ["Orodell"]}],
                             "species": ["Brown trout"]})
    c = extract_candidates("left hand creek joins Boulder Creek near ORODELL; brown trout live there.",
                           gazetteer=g)
    assert [(x.kind, x.text) for x in c] == [
        ("place", "left hand creek"), ("place", "Boulder Creek"), ("place", "ORODELL"),
        ("species", "brown trout")]
    assert c[0].entries[0].id == "place/left-hand-creek"


def test_echo_tag_from_last_user_message():
    c = extract_candidates("20 cfs would be a lot; 15.4 cfs is normal, and Niwot is dry.",
                           last_user_message="Is 20 cfs a lot at Niwot?",
                           gazetteer=Gazetteer.from_dict({"places": [{"id": "place/niwot",
                                                                      "name": "Niwot"}]}))
    flags = {x.text: x.echo for x in c}
    assert flags["20 cfs"] is True
    assert flags["15.4 cfs"] is False
    assert flags["Niwot"] is True


def test_drought_class_candidate():
    c = extract_candidates("We are in D1, not D3.")
    assert [(x.kind, x.value) for x in c] == [("enum", 1), ("enum", 3)]


# --- licence identifiers are proper nouns, not measurements -------------------


@pytest.mark.parametrize(
    "sentence",
    [
        "That explanation comes from the Front Range Knowledge Commons, CC BY-SA 4.0.",
        "The prose is CC BY-SA 4.0 and the facts are CC0 1.0.",
        "My code is Apache-2.0.",
        "Attribution: Front Range Bioregional Twin, CC BY 4.0.",
    ],
)
def test_licence_version_is_not_a_candidate(sentence: str) -> None:
    cands = extract_candidates(sentence)
    assert [c for c in cands if c.kind == "number"] == []


def test_a_real_number_beside_a_licence_is_still_read() -> None:
    cands = extract_candidates("Flow is 15.4 cfs; the prose is CC BY-SA 4.0.")
    numbers = [c.value for c in cands if c.kind == "number"]
    assert numbers == [15.4]
