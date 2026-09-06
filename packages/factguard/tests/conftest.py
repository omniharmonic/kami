"""pytest fixtures for kami-factguard (data lives in fixture_data.py)."""

from __future__ import annotations

import copy

import pytest
from fixture_data import ENTITY_STATUS, FOREBAY, GROSS, NIWOT, ORODELL, fresh_variant, messages_for

from factguard import FactSheet, Gazetteer


@pytest.fixture
def status_doc() -> dict:
    return copy.deepcopy(ENTITY_STATUS)


@pytest.fixture
def sheet_stale(status_doc) -> FactSheet:
    return FactSheet.from_tool_messages(messages_for(status_doc))


@pytest.fixture
def sheet_fresh(status_doc) -> FactSheet:
    return FactSheet.from_tool_messages(messages_for(fresh_variant(status_doc)))


@pytest.fixture
def gazetteer() -> Gazetteer:
    return Gazetteer.from_dict({
        "places": [
            {"id": ORODELL, "name": "Boulder Creek near Orodell, CO", "aliases": ["Orodell"]},
            {"id": GROSS, "name": "Gross Reservoir"},
            {"id": NIWOT, "name": "Niwot", "aliases": ["Niwot Ridge"]},
            {"id": FOREBAY, "name": "South Boulder Creek at forebay",
             "aliases": ["South Boulder forebay"]},
            {"id": "place/boulder-creek", "name": "Boulder Creek"},
            {"id": "place/left-hand-creek", "name": "Left Hand Creek"},
            {"id": "place/boulder-cu-2102-athens-st", "name": "CU Boulder Athens St"},
        ],
        "species": ["Brown trout", "Greenback cutthroat trout",
                    {"name": "American dipper", "scientific": "Cinclus mexicanus"}],
    })
