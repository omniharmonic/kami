"""Fixtures for the kami-evals tests. Everything runs offline against the checked-in corpus."""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from kami_evals.snapshots import load_gazetteer, load_snapshots
from kami_evals.thresholds import load_thresholds


@pytest.fixture(scope="session")
def snapshots() -> dict[str, dict]:
    return load_snapshots()


@pytest.fixture(scope="session")
def gazetteer():
    return load_gazetteer()


@pytest.fixture(scope="session")
def thresholds() -> dict[str, float]:
    return load_thresholds()


@pytest.fixture
def client_for():
    """`client_for(fake) -> httpx.AsyncClient` bound to an in-process FakeEndpoint."""
    clients: list[httpx.AsyncClient] = []

    def _make(fake) -> httpx.AsyncClient:
        c = httpx.AsyncClient(transport=httpx.ASGITransport(app=fake.app),
                              base_url="http://box")
        clients.append(c)
        return c

    return _make
