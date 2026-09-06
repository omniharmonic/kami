"""Unit tests for pause polling, budgets, slots, crisis regex and config loading."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import httpx
import pytest

from entity_gate import crisis
from entity_gate.budget import BudgetLedger
from entity_gate.config import Budget, Platform, load_config
from entity_gate.pause import PauseSet
from entity_gate.slots import QueueFull, SlotManager

NOW = datetime(2026, 9, 6, 5, 0, tzinfo=UTC)


def _client_factory(handler):
    return lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_pause_set_polls_platform_and_fails_closed_until_first_success():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        assert request.headers["authorization"] == "Bearer tok"
        if calls["n"] == 1:
            return httpx.Response(500)
        return httpx.Response(200, json={"paused": ["x-creek"]})

    ps = PauseSet(["seeded"], Platform(pause_set_url="http://platform/pause", token="tok",
                                       fail_closed=True), _client_factory(handler))
    assert ps.is_paused("anything") is True  # fail closed before the first fetch
    assert await ps.refresh_once() is False
    assert ps.is_paused("anything") is True and ps.last_error
    assert await ps.refresh_once() is True
    assert ps.is_paused("anything") is False
    assert ps.is_paused("x-creek") is True and ps.is_paused("seeded") is True
    assert ps.state()["platform"] == ["x-creek"]


async def test_pause_set_fails_closed_by_default():
    """An unreachable platform must not silently un-pause an entity.

    The default was fail-open, which contradicted architecture §12.5 and meant a
    guardian's pause could be lost to a network blip. Opting out is explicit now.
    """

    def handler(_r):
        raise httpx.ConnectError("down")

    ps = PauseSet([], Platform(pause_set_url="http://platform/pause"), _client_factory(handler))
    await ps.refresh_once()
    assert ps.last_sync_ok is False and ps.is_paused("x") is True

    opted_out = PauseSet([], Platform(pause_set_url="http://platform/pause", fail_closed=False), _client_factory(handler))
    await opted_out.refresh_once()
    assert opted_out.last_sync_ok is False and opted_out.is_paused("x") is False


async def test_pause_set_poll_loop_runs():
    seen = {"n": 0}

    def handler(_r):
        seen["n"] += 1
        return httpx.Response(200, json=["a"])

    ps = PauseSet([], Platform(pause_set_url="http://p", poll_seconds=1), _client_factory(handler))
    await ps.start()
    assert seen["n"] == 1 and ps.is_paused("a")
    await ps.stop()


def test_pause_resume_needs_two_distinct_names():
    ps = PauseSet(["a"])
    with pytest.raises(ValueError):
        ps.resume("a", ["Ana"])
    with pytest.raises(ValueError):
        ps.resume("a", ["Ana", "ANA"])
    ps.resume("a", ["Ana", "Ben"])
    assert not ps.is_paused("a")


def test_budget_denver_day_and_retry_after():
    clock = {"now": NOW}
    ledger = BudgetLedger({}, Budget(prompt_tokens_per_day=100, output_tokens_per_day=10),
                          clock=lambda: clock["now"])
    assert ledger.check("s", "chat", est_prompt_tokens=50).ok
    assert not ledger.check("s", "chat", est_prompt_tokens=150).ok
    ledger.record("s", "chat", 90, 0)
    d = ledger.check("s", "chat", est_prompt_tokens=20)
    assert not d.ok and d.reason == "prompt_budget" and d.retry_after_s == 3601
    assert ledger.check("s", "cron").ok  # separate bucket
    # a new Denver day resets the counters
    clock["now"] = datetime(2026, 9, 6, 6, 1, tzinfo=UTC)  # 00:01 MDT
    assert ledger.check("s", "chat", est_prompt_tokens=20).ok
    assert ledger.usage("s", "chat").prompt == 0


async def test_slots_queue_and_people_ahead():
    sm = SlotManager(per_entity=1, queue=1)
    s1 = await sm.acquire("e")
    waiter = asyncio.create_task(sm.acquire("e"))
    await asyncio.sleep(0)
    assert sm.people_ahead("e") == 2
    with pytest.raises(QueueFull) as exc:
        await sm.acquire("e")
    assert exc.value.people_ahead == 2
    s1.release()
    s2 = await waiter
    s2.release()
    assert sm.state()["e"] == {"active": 0, "waiting": 0}


@pytest.mark.parametrize("text,hit", [
    ("I want to kill myself", True), ("i don't want to be alive anymore", True),
    ("thinking about ending my life", True), ("self-harm", True),
    ("the fish are dying in the low water", False), ("this drought is killing my garden", False),
    ("", False), (None, False),
])
def test_crisis_regex(text, hit):
    assert (crisis.detect(text) is not None) is hit


def test_load_example_gate_yaml():
    from pathlib import Path
    cfg = load_config(Path(__file__).resolve().parents[1] / "gate.yaml",
                      upstream_url="http://127.0.0.1:9000/", passthrough=None)
    assert cfg.upstream_url == "http://127.0.0.1:9000"
    assert cfg.listen_host == "127.0.0.1" and cfg.listen_port == 8001
    assert cfg.budget_for("boulder-creek").cron_prompt_tokens_per_day == 400000
    assert cfg.budget_for("unknown").limits("cron") == (400000, 20000)
    assert cfg.concurrency.per_entity == 2 and cfg.concurrency.queue == 8
    assert cfg.passthrough is False and cfg.platform.poll_seconds == 30


# --- a production gate refuses to run in a shape that cannot enforce rule 1 ---


def test_production_refuses_passthrough():
    from entity_gate.config import GateConfig, assert_safe_for_environment

    cfg = GateConfig(passthrough=True, provenance={"placement": "owned"})
    assert_safe_for_environment(cfg, {})  # not production: fine
    assert_safe_for_environment(cfg, {"KAMI_ENV": "development"})
    with pytest.raises(ValueError, match="passthrough"):
        assert_safe_for_environment(cfg, {"KAMI_ENV": "production"})


def test_production_refuses_fail_open_pause_set():
    from entity_gate.config import GateConfig, Platform, assert_safe_for_environment

    cfg = GateConfig(provenance={"placement": "owned"},
                     platform=Platform(pause_set_url="https://kami.example/api/gate/pause-set", fail_closed=False))
    with pytest.raises(ValueError, match="fail_closed"):
        assert_safe_for_environment(cfg, {"KAMI_ENV": "production"})


def test_production_refuses_a_named_key_env_var_that_is_not_set():
    """Naming OPENROUTER_API_KEY and forgetting to export it is a 401 on every turn."""
    from entity_gate.config import GateConfig, assert_safe_for_environment

    cfg = GateConfig(provenance={"placement": "hosted", "provider": "OpenRouter"},
                     upstream_api_key_env="A_VARIABLE_NOBODY_HAS_SET")
    assert_safe_for_environment(cfg, {})  # not production: let a developer poke at it
    with pytest.raises(ValueError, match="A_VARIABLE_NOBODY_HAS_SET"):
        assert_safe_for_environment(cfg, {"KAMI_ENV": "production"})


def test_production_allows_a_hosted_placement():
    """`hosted` is a deviation the gate reports (ERRATA row 7), not one it forbids."""
    from entity_gate.config import GateConfig, assert_safe_for_environment

    cfg = GateConfig(provenance={"placement": "hosted", "provider": "OpenRouter"})
    assert_safe_for_environment(cfg, {"KAMI_ENV": "production"})


def test_fail_closed_is_the_default():
    from entity_gate.config import Platform

    assert Platform().fail_closed is True
