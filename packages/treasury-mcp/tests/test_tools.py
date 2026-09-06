from __future__ import annotations

import json
import logging

import httpx
import pytest

from treasury_mcp import TOOL_NAMES, MissingTokenError, Settings, build_server
from tests.conftest import TOKEN, FakePlatform


def payload(result):
    if getattr(result, "structured_content", None):
        sc = result.structured_content
        return sc.get("result", sc) if isinstance(sc, dict) and set(sc) == {"result"} else sc
    return json.loads(result.content[0].text)


async def test_tool_list_is_exactly_three(server):
    tools = await server.list_tools()
    assert sorted(t.name for t in tools) == sorted(TOOL_NAMES) == ["get_balance", "list_pending", "propose_bounty_payout"]
    assert not any(k in t.name for t in tools for k in ("sign", "execute", "approve"))


async def test_get_balance_and_list_pending(server, platform):
    bal = payload(await server.call_tool("get_balance", {}))
    assert bal["usdc"] == "120.50"
    pend = payload(await server.call_tool("list_pending", {}))
    assert pend["pending"][0]["required"] == 2
    assert [r.url.path for r in platform.requests] == [
        "/api/treasury/boulder-creek/balance",
        "/api/treasury/boulder-creek/pending",
    ]
    assert all(r.headers["authorization"] == f"Bearer {TOKEN}" for r in platform.requests)


async def test_propose_posts_expected_body_and_returns_hash(server, platform):
    out = payload(await server.call_tool("propose_bounty_payout", {"submission_id": "sub_1"}))
    assert out["ok"] is True
    assert out["safe_tx_hash"] == "0x" + "ab" * 32
    assert out["status"] == "pending"
    methods = [(r.method, r.url.path) for r in platform.requests]
    assert methods == [("GET", "/api/entities/boulder-creek/state"), ("POST", "/api/treasury/propose")]
    assert json.loads(platform.requests[1].content) == {"entity": "boulder-creek", "submission_id": "sub_1"}


async def test_paused_entity_refuses_before_any_post(settings):
    platform = FakePlatform(paused=True)
    server = build_server(settings, transport=httpx.MockTransport(platform.handler))
    out = payload(await server.call_tool("propose_bounty_payout", {"submission_id": "sub_1"}))
    assert out["ok"] is False
    assert out["status"] == "refused"
    assert "paused" in out["message"]
    assert [r.method for r in platform.requests] == ["GET"]


async def test_token_never_appears_in_logs(server, capsys, caplog):
    caplog.set_level(logging.DEBUG)
    await server.call_tool("get_balance", {})
    await server.call_tool("propose_bounty_payout", {"submission_id": "sub_1"})
    captured = capsys.readouterr()
    assert TOKEN not in caplog.text
    assert TOKEN not in captured.out + captured.err
    assert "GET /api/treasury/boulder-creek/balance" in caplog.text


def test_missing_token_is_a_clear_error():
    with pytest.raises(MissingTokenError, match="PLATFORM_MCP_TOKEN"):
        Settings.from_env(env={"PLATFORM_URL": "https://kami.example"})
    with pytest.raises(MissingTokenError, match="PLATFORM_URL"):
        Settings.from_env(env={})
    s = Settings.from_env(env={"PLATFORM_URL": "https://kami.example/", "PLATFORM_MCP_TOKEN": "t", "KAMI_ENTITY_SLUG": "boulder-creek"})
    assert s.platform_url == "https://kami.example"
    assert s.entity == "boulder-creek"


def test_missing_token_exits_with_message(monkeypatch, capsys):
    from treasury_mcp.__main__ import main

    monkeypatch.delenv("PLATFORM_MCP_TOKEN", raising=False)
    monkeypatch.setenv("PLATFORM_URL", "https://kami.example")
    assert main(["--entity", "boulder-creek"]) == 2
    assert "PLATFORM_MCP_TOKEN" in capsys.readouterr().err
