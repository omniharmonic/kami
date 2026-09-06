import json
from pathlib import Path

from fixture_data import ENTITY_STATUS, ORODELL, messages_for

from factguard import FactSheet
from factguard.atoms import CONFIG_PREFIX

SCHEMA_SRC = Path(__file__).resolve().parents[2] / "facts-schema" / "facts-1.0.json"
SCHEMA_COPY = Path(__file__).resolve().parents[1] / "src" / "factguard" / "schemas" / "facts-1.0.json"


def test_schema_copy_is_byte_identical():
    assert SCHEMA_SRC.read_bytes() == SCHEMA_COPY.read_bytes()


def test_only_tool_messages_after_last_user_are_admissible(sheet_stale):
    # the earlier turn's alert ("old alert", until 2026-09-01) must not be in the sheet
    assert not any(t.value.startswith("2026-09-01") for t in sheet_stale.times)
    assert sheet_stale.as_of == "2026-09-06T05:00:00Z"


def test_atoms_extracted_from_entity_status(sheet_stale):
    discharge = next(a for a in sheet_stale.numbers if a.property == "discharge")
    assert (discharge.value, discharge.unit, discharge.place_id, discharge.time, discharge.stale,
            discharge.staleness_s, discharge.source_id) == (
        15.4, "[ft_i]3/s", ORODELL, "2026-09-04T20:15:00Z", True, 118000, "cdss/BOCOROCO")
    assert {c.of: c.value for c in sheet_stale.counts} == {"needs": 4, "children": 4, "alerts": 0}
    assert {(e.name, e.value) for e in sheet_stale.enums} >= {
        ("dm", 1), ("drought_max_dm", 1), ("source_status", "critical")}
    assert any(t.value == "2026-09-07" and t.role == "valid_until" for t in sheet_stale.times)
    assert {p.id for p in sheet_stale.places} >= {ORODELL, "place/gross-reservoir", "place/niwot"}
    orodell = next(p for p in sheet_stale.places if p.id == ORODELL)
    assert orodell.name == "Boulder Creek near Orodell, CO"
    staleness = [a for a in sheet_stale.numbers if a.property == "staleness_s"]
    assert staleness and all(a.unit == "s" and not a.stale for a in staleness)
    assert not any(hasattr(a, "value") and a.value == 3 for a in sheet_stale.atoms)


def test_facts_document_accepted_verbatim():
    doc = {"schema_version": "1.0", "as_of": "2026-09-06T05:00:00Z", "atoms": [
        {"kind": "number", "value": 15.4, "unit": "[ft_i]3/s", "property": "discharge",
         "place_id": ORODELL, "time": "2026-09-04T20:15:00Z", "stale": True},
        {"kind": "species", "name": "Brown trout", "scientific": "Salmo trutta"},
        {"kind": "count", "value": 4, "of": "children"},
    ]}
    sheet = FactSheet.from_tool_messages([{"role": "user", "content": "x"},
                                          {"role": "tool", "content": json.dumps(doc)}])
    assert len(sheet) == 3 and sheet.species[0].name == "Brown trout"
    assert sheet.to_dict()["atoms"][0]["kind"] == "number"
    assert FactSheet.from_dict(sheet.to_dict()).numbers[0].value == 15.4


def test_config_block_and_mcp_envelope_and_text_parts():
    msgs = [
        {"role": "system", "content": CONFIG_PREFIX + json.dumps(
            {"caps": {"bounty_max_usdc": 25}, "guardians": ["Ana", "Ben"]})},
        {"role": "user", "content": "x"},
        {"role": "tool", "content": [{"type": "text", "text": json.dumps(
            {"content": [{"type": "text", "text": json.dumps(ENTITY_STATUS)}]})}]},
    ]
    sheet = FactSheet.from_tool_messages(msgs)
    assert any(a.property == "bounty_max_usdc" and a.value == 25 for a in sheet.numbers)
    assert any(c.of == "guardians" and c.value == 2 for c in sheet.counts)
    assert any(a.property == "discharge" for a in sheet.numbers)


def test_non_json_tool_content_is_ignored():
    sheet = FactSheet.from_tool_messages(messages_for(ENTITY_STATUS) + [
        {"role": "tool", "content": "plain prose, not JSON"}])
    assert any(a.property == "discharge" for a in sheet.numbers)
