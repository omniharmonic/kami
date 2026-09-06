from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures import GAZETTEER

from entity_gate.app import create_app
from entity_gate.config import GateConfig
from entity_gate.telemetry import NullTelemetry

NOW = datetime(2026, 9, 6, 5, 0, tzinfo=UTC)  # Saturday 23:00 in Denver


class Gate:
    def __init__(self, app, client: httpx.AsyncClient, config: GateConfig) -> None:
        self.app = app
        self.client = client
        self.config = config
        self.events = app.state.events
        self.ledger = app.state.ledger
        self.pause_set = app.state.pause_set


@pytest.fixture
def make_gate(tmp_path):
    clients: list[httpx.AsyncClient] = []

    def _make(fake, *, env: dict[str, str] | None = None, telemetry=None,
              **overrides) -> Gate:
        gaz = tmp_path / "gazetteer.json"
        gaz.write_text(json.dumps(GAZETTEER))
        cfg = {"upstream_url": "http://upstream", "events_dir": str(tmp_path / "events"),
               "gazetteer_path": str(gaz),
               "provenance": {"placement": "owned", "provider": "the in-process fake"}}
        cfg.update(overrides)
        config = GateConfig.model_validate(cfg)
        up = httpx.AsyncClient(transport=httpx.ASGITransport(app=fake.app),
                               base_url="http://upstream")
        app = create_app(config, upstream_client=up, clock=lambda: NOW,
                         telemetry=telemetry or NullTelemetry(),
                         env=env if env is not None else {})
        client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 40000)),
            base_url="http://gate")
        clients.extend([up, client])
        return Gate(app, client, config)

    yield _make


@pytest.fixture
def admin_secret(monkeypatch):
    monkeypatch.setenv("GATE_ADMIN_SECRET", "s3cret")
    return {"X-Gate-Admin": "s3cret"}
