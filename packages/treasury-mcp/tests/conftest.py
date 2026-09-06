from __future__ import annotations

import json

import httpx
import pytest

from treasury_mcp import Settings, build_server

TOKEN = "tok-secret-9f8e7d6c5b4a"


class FakePlatform:
    """Records every request; serves balance / pending / state / propose."""

    def __init__(self, paused: bool = False):
        self.paused = paused
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.headers.get("authorization") != f"Bearer {TOKEN}":
            return httpx.Response(401, json={"error": "bad token"})
        path = request.url.path
        if path == "/api/treasury/boulder-creek/balance":
            return httpx.Response(200, json={"usdc": "120.50", "safe": "0x2000000000000000000000000000000000000002"})
        if path == "/api/treasury/boulder-creek/pending":
            return httpx.Response(200, json={"pending": [{"safe_tx_hash": "0xaa", "confirmations": 1, "required": 2}]})
        if path == "/api/entities/boulder-creek/state":
            return httpx.Response(200, json={"paused": self.paused, "reason": "guardian pause" if self.paused else None})
        if path == "/api/treasury/propose" and request.method == "POST":
            body = json.loads(request.content)
            assert body == {"entity": "boulder-creek", "submission_id": "sub_1"}
            return httpx.Response(201, json={"safe_tx_hash": "0x" + "ab" * 32, "status": "pending"})
        return httpx.Response(404, json={"error": "no route"})


@pytest.fixture
def platform() -> FakePlatform:
    return FakePlatform()


@pytest.fixture
def settings() -> Settings:
    return Settings(platform_url="https://kami.example", token=TOKEN, entity="boulder-creek")


@pytest.fixture
def server(settings: Settings, platform: FakePlatform):
    return build_server(settings, transport=httpx.MockTransport(platform.handler))
