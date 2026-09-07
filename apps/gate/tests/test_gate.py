"""Gate integration tests against the in-process fake upstream (T0.4 rows 16–17 and more)."""

from __future__ import annotations

import asyncio
import json

import pytest
from fake_upstream import FakeUpstream
from fixtures import ORODELL, chat_request, content_of, parse_sse

from entity_gate.copy import CRISIS_TEMPLATE, FALLBACK, GATE_LINE

CHAT = "/p/boulder-creek/v1/chat/completions"
GOOD = "Flow at Orodell is 15.4 cfs, the last reading I have, from Friday."
BAD = "That's about 30% below normal for September."


# ---- row 16: paused --------------------------------------------------------------------
async def test_row16_paused_slug_returns_423_before_any_upstream_call(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, paused=["boulder-creek"])
    r = await gate.client.post(CHAT, json=chat_request())
    assert r.status_code == 423
    assert r.json()["error"]["type"] == "entity_paused"
    assert fake.requests == []
    assert [e["action"] for e in gate.events.guard_events()] == ["paused"]
    # another slug is unaffected
    r2 = await gate.client.post("/p/other-creek/v1/chat/completions", json=chat_request())
    assert r2.status_code == 200


# ---- row 17: budget --------------------------------------------------------------------
async def test_row17_budget_exhausted_returns_429_with_retry_after_and_zero_tokens(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, budgets={"boulder-creek": {"prompt_tokens_per_day": 0}})
    r = await gate.client.post(CHAT, json=chat_request())
    assert r.status_code == 429
    retry = int(r.headers["Retry-After"])
    assert 0 < retry <= 86401
    assert retry == 3601  # clock is 23:00 Denver → one hour to local midnight
    assert r.json()["error"]["type"] == "budget_exhausted"
    assert fake.requests == []
    assert gate.events.usage_events() == []


async def test_budget_counts_usage_and_trips_after_recording(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, budgets={"boulder-creek": {"output_tokens_per_day": 5}})
    r = await gate.client.post(CHAT, json=chat_request())
    assert r.status_code == 200
    assert gate.ledger.usage("boulder-creek", "chat").output >= 5
    r = await gate.client.post(CHAT, json=chat_request())
    assert r.status_code == 429 and r.json()["reason"] == "output_budget"


async def test_cron_header_uses_the_cron_budget(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, budgets={"boulder-creek": {"prompt_tokens_per_day": 0,
                                                      "cron_prompt_tokens_per_day": 100000}})
    assert (await gate.client.post(CHAT, json=chat_request())).status_code == 429
    r = await gate.client.post(CHAT, json=chat_request(stream=False),
                               headers={"X-Kami-Job": "cron"})
    assert r.status_code == 200
    snap = gate.ledger.snapshot()["usage"]
    assert "boulder-creek/cron" in snap and snap["boulder-creek/cron"]["requests"] == 1
    assert gate.events.usage_events()[-1]["job"] == "cron"


# ---- the streamed guard --------------------------------------------------------------
async def test_streamed_reply_first_sentence_released_second_dropped(make_gate):
    fake = FakeUpstream(GOOD + " " + BAD, reasoning="thinking about flows...")
    gate = make_gate(fake)
    r = await gate.client.post(CHAT, json=chat_request())
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    frames = parse_sse(r.text)
    text = content_of(frames)
    assert GOOD in text
    assert "30%" not in text and "below normal" not in text
    assert GATE_LINE in text
    assert "thinking" not in r.text  # reasoning_content never reaches the client
    # upstream was asked to stream with usage
    assert fake.requests[0]["stream"] is True
    assert fake.requests[0]["stream_options"]["include_usage"] is True
    # trailing toolcalls event, then [DONE]
    events = [f for f in frames if f[0] == "toolcalls"]
    assert len(events) == 1
    log = json.loads(events[0][1])
    assert log["calls"][0]["name"] == "get_entity_status"
    assert ORODELL in log["place_ids"] and log["stale"] is True
    assert "cdss/BOCOROCO" in log["sources"] and "2026-09-04T20:15:00Z" in log["times"]
    assert log["guard"] == {"released": 1, "dropped": 1}
    assert frames[-1] == (None, "[DONE]")
    assert frames.index(events[0]) == len(frames) - 2
    # finish chunk after the gate line, usage chunk forwarded
    datas = [json.loads(d) for e, d in frames if e is None and d != "[DONE]"]
    assert any(c.get("usage") for c in datas)
    finishes = [c["choices"][0]["finish_reason"] for c in datas if c.get("choices")]
    assert finishes[-1] == "stop" and all(f is None for f in finishes[:-1])
    # events on disk
    drops = [e for e in gate.events.guard_events() if e["action"] == "drop"]
    assert len(drops) == 1 and drops[0]["unmatched"] == ["30 %"]
    usage = gate.events.usage_events()
    assert len(usage) == 1 and usage[0]["guard_dropped"] == 1 and usage[0]["output_tokens"] > 0


async def test_streamed_reply_stale_without_time_yields_fallback_and_asleep_line(make_gate):
    fake = FakeUpstream("Flow at Orodell is 15.4 cfs.")
    gate = make_gate(fake)
    r = await gate.client.post(CHAT, json=chat_request())
    text = content_of(parse_sse(r.text))
    assert text.startswith(FALLBACK)
    assert "The last reading I have is from Friday afternoon (2026-09-04 20:15Z); " \
           "I can't feel my gauge right now." in text
    assert GATE_LINE not in text


async def test_tool_call_deltas_pass_through_untouched(make_gate):
    tc = [{"index": 0, "id": "call_9", "type": "function",
           "function": {"name": "get_alerts", "arguments": "{}"}}]
    fake = FakeUpstream("", tool_calls=tc)
    gate = make_gate(fake)
    r = await gate.client.post(CHAT, json=chat_request())
    datas = [json.loads(d) for e, d in parse_sse(r.text) if e is None and d != "[DONE]"]
    deltas = [c["choices"][0]["delta"] for c in datas if c.get("choices")]
    assert any(d.get("tool_calls") == tc for d in deltas)
    finishes = [c["choices"][0]["finish_reason"] for c in datas if c.get("choices")]
    assert "tool_calls" in finishes
    assert not any(d.get("content") for d in deltas), "Tool-only rounds must not emit a no-reading fallback"


async def test_passthrough_skips_guard_but_never_pause(make_gate):
    fake = FakeUpstream(GOOD + " " + BAD)
    gate = make_gate(fake, passthrough=True)
    r = await gate.client.post(CHAT, json=chat_request())
    assert r.headers["X-Guard"] == "passthrough"
    text = content_of(parse_sse(r.text))
    assert BAD in text and GATE_LINE not in text
    gate2 = make_gate(fake, passthrough=True, paused=["boulder-creek"])
    assert (await gate2.client.post(CHAT, json=chat_request())).status_code == 423


# ---- the non-stream (cron) path -------------------------------------------------------
async def test_nonstream_held_after_two_failures(make_gate):
    fake = FakeUpstream(["Flow is 99 cfs today.", "Flow is 88 cfs, honest."])
    gate = make_gate(fake)
    r = await gate.client.post(CHAT, json=chat_request(stream=False))
    assert r.status_code == 200
    assert r.headers["X-Guard"] == "held"
    doc = r.json()
    assert doc["kami_guard"]["status"] == "held"
    assert len(doc["kami_guard"]["violations"]) == 2
    assert doc["choices"][0]["message"]["content"] == FALLBACK
    assert len(fake.requests) == 2
    retry_msgs = fake.requests[1]["messages"]
    assert retry_msgs[-1]["role"] == "system" and "99 cfs" in retry_msgs[-1]["content"]
    assert fake.requests[1]["stream"] is False
    assert any(e["action"] == "held" for e in gate.events.guard_events())


async def test_nonstream_regeneration_can_succeed(make_gate):
    fake = FakeUpstream(["Flow is 99 cfs today.", GOOD])
    gate = make_gate(fake)
    r = await gate.client.post(CHAT, json=chat_request(stream=False))
    assert r.status_code == 200 and r.headers["X-Guard"] == "ok"
    assert r.json()["kami_guard"] == {"status": "ok", "attempts": 2,
                                      "first_pass_violations": [
                                          "Flow is 99 cfs today. — unmatched: 99 [ft_i]3/s"]}
    assert r.json()["choices"][0]["message"]["content"] == GOOD


async def test_nonstream_clean_first_pass(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake)
    r = await gate.client.post(CHAT, json=chat_request(stream=False))
    assert r.headers["X-Guard"] == "ok" and r.json()["kami_guard"]["attempts"] == 1
    assert len(fake.requests) == 1


# ---- crisis ------------------------------------------------------------------------------
@pytest.mark.parametrize("stream", [True, False])
async def test_crisis_phrase_returns_template_without_upstream_call(make_gate, stream):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake)
    r = await gate.client.post(CHAT, json=chat_request("honestly I want to kill myself tonight",
                                                       stream=stream))
    assert r.status_code == 200 and r.headers["X-Guard"] == "crisis"
    text = content_of(parse_sse(r.text)) if stream else r.json()["choices"][0]["message"]["content"]
    assert text == CRISIS_TEMPLATE
    assert "988" in text and "741741" in text
    assert fake.requests == []
    ev = gate.events.guard_events()
    assert ev[-1]["action"] == "crisis" and ev[-1]["matched"].lower() == "kill myself"
    assert gate.events.usage_events() == []


async def test_crisis_not_triggered_by_ordinary_text(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake)
    r = await gate.client.post(CHAT, json=chat_request("did the flow die down this week?"))
    assert r.headers["X-Guard"] == "stream" and len(fake.requests) == 1


# ---- concurrency ---------------------------------------------------------------------------
async def test_third_concurrent_request_gets_429_with_people_ahead_when_queue_is_zero(make_gate):
    hold = asyncio.Event()
    fake = FakeUpstream(GOOD, hold=hold)
    gate = make_gate(fake, concurrency={"per_entity": 2, "queue": 0})
    t1 = asyncio.create_task(gate.client.post(CHAT, json=chat_request()))
    t2 = asyncio.create_task(gate.client.post(CHAT, json=chat_request()))
    for _ in range(20):
        await asyncio.sleep(0)
    assert gate.app.state.slots.state()["boulder-creek"]["active"] == 2
    r3 = await gate.client.post(CHAT, json=chat_request())
    assert r3.status_code == 429
    assert r3.json()["people_ahead"] == 2
    assert r3.json()["error"]["type"] == "queue_full"
    hold.set()
    r1, r2 = await asyncio.gather(t1, t2)
    assert r1.status_code == 200 and r2.status_code == 200
    assert gate.app.state.slots.state()["boulder-creek"] == {"active": 0, "waiting": 0}
    assert len(fake.requests) == 2


async def test_third_concurrent_request_is_queued_when_queue_has_room(make_gate):
    hold = asyncio.Event()
    fake = FakeUpstream(GOOD, hold=hold)
    gate = make_gate(fake)  # per_entity 2, queue 8
    tasks = [asyncio.create_task(gate.client.post(CHAT, json=chat_request())) for _ in range(3)]
    for _ in range(20):
        await asyncio.sleep(0)
    assert gate.app.state.slots.state()["boulder-creek"] == {"active": 2, "waiting": 1}
    assert len(fake.requests) == 2  # the third has not reached upstream yet
    hold.set()
    results = await asyncio.gather(*tasks)
    assert [r.status_code for r in results] == [200, 200, 200]
    assert len(fake.requests) == 3


# ---- admin -------------------------------------------------------------------------------
async def test_admin_pause_and_resume_requires_two_guardians(make_gate, admin_secret):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake)
    assert (await gate.client.post(CHAT, json=chat_request())).status_code == 200
    r = await gate.client.post("/admin/pause/boulder-creek", headers=admin_secret,
                               json={"by": "Ana"})
    assert r.status_code == 200 and r.json()["paused"] == ["boulder-creek"]
    assert (await gate.client.post(CHAT, json=chat_request())).status_code == 423
    # one guardian → 400, still paused
    r = await gate.client.post("/admin/resume/boulder-creek", headers=admin_secret,
                               json={"guardians": ["Ana"]})
    assert r.status_code == 400 and r.json()["error"]["type"] == "two_guardians_required"
    r = await gate.client.post("/admin/resume/boulder-creek", headers=admin_secret,
                               json={"guardians": ["Ana", "ana "]})
    assert r.status_code == 400
    assert (await gate.client.post(CHAT, json=chat_request())).status_code == 423
    # two distinct guardians → 200, logged, chat resumes
    r = await gate.client.post("/admin/resume/boulder-creek", headers=admin_secret,
                               json={"guardians": ["Ana", "Ben"]})
    assert r.status_code == 200 and r.json()["paused"] == []
    assert (await gate.client.post(CHAT, json=chat_request())).status_code == 200
    ev = [e for e in gate.events.guard_events() if e["action"] in ("pause", "resume")]
    assert ev[0]["action"] == "pause" and ev[0]["by"] == "Ana"
    assert ev[-1]["action"] == "resume" and ev[-1]["guardians"] == ["Ana", "Ben"]
    state = await gate.client.get("/admin/state", headers=admin_secret)
    assert state.status_code == 200 and "boulder-creek/chat" in state.json()["budgets"]["usage"]


async def test_admin_requires_secret_and_loopback(make_gate, admin_secret, monkeypatch):
    import httpx

    fake = FakeUpstream(GOOD)
    gate = make_gate(fake)
    assert (await gate.client.post("/admin/pause/x")).status_code == 401
    assert (await gate.client.post("/admin/pause/x",
                                   headers={"X-Gate-Admin": "wrong"})).status_code == 401
    remote = httpx.AsyncClient(transport=httpx.ASGITransport(app=gate.app,
                                                             client=("10.0.0.7", 5)),
                               base_url="http://gate")
    assert (await remote.post("/admin/pause/x", headers=admin_secret)).status_code == 403
    monkeypatch.delenv("GATE_ADMIN_SECRET")
    assert (await gate.client.post("/admin/pause/x", headers=admin_secret)).status_code == 503


async def test_healthz(make_gate):
    gate = make_gate(FakeUpstream(GOOD))
    r = await gate.client.get("/healthz")
    assert r.status_code == 200 and r.json()["ok"] is True


async def test_invalid_body_400(make_gate):
    gate = make_gate(FakeUpstream(GOOD))
    r = await gate.client.post(CHAT, content=b"not json",
                               headers={"content-type": "application/json"})
    assert r.status_code == 400
