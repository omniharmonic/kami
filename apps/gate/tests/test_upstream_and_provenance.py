"""Hosted upstreams and honest provenance.

Two things are being protected here. One: a hosted API needs a key, and a key in a config
file is a key in git — so a literal key in ``gate.yaml`` is refused, and the key never
reaches a log line, an event row or an error body. Two: PRD §3 says no cloud model on the
hot path and the public page says inference is local; running hosted makes that page false
unless the page is rendered from what the gate *reports*. Hence ``placement`` with no
default, provenance on ``/healthz``, and the test at the bottom of this file that the guard
does not care where the model runs.
"""

from __future__ import annotations

import json

import httpx
import pytest
import yaml
from fake_upstream import FakeUpstream
from fixtures import chat_request, content_of, parse_sse

from entity_gate import check_upstream
from entity_gate.config import GateConfig, Platform, load_config
from entity_gate.copy import GATE_LINE
from entity_gate.provenance import ProvenanceReporter
from entity_gate.telemetry import Telemetry

CHAT = "/p/boulder-creek/v1/chat/completions"
GOOD = "Flow at Orodell is 15.4 cfs, the last reading I have, from Friday."
BAD = "That's about 30% below normal for September."
KEY = "sk-or-v1-DO-NOT-LEAK-0123456789"

HOSTED = {"placement": "hosted", "provider": "OpenRouter", "model": "qwen/qwen3.5-9b-instruct"}


def _cfg(**overrides) -> GateConfig:
    base = {"upstream_url": "http://upstream", "provenance": {"placement": "owned"}}
    base.update(overrides)
    return GateConfig.model_validate(base)


# ---- the Authorization header ----------------------------------------------------------
async def test_authorization_header_is_sent_when_the_env_var_is_set(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, upstream_api_key_env="OPENROUTER_API_KEY",
                     upstream_headers={"HTTP-Referer": "https://kami.example"},
                     provenance=HOSTED, env={"OPENROUTER_API_KEY": KEY})
    r = await gate.client.post(CHAT, json=chat_request(stream=False))
    assert r.status_code == 200
    sent = fake.request_headers[0]
    assert sent["authorization"] == f"Bearer {KEY}"
    assert sent["http-referer"] == "https://kami.example"


async def test_no_authorization_header_when_no_key_env_var_is_configured(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake)  # the default: local vLLM, no auth
    r = await gate.client.post(CHAT, json=chat_request(stream=False))
    assert r.status_code == 200
    assert "authorization" not in fake.request_headers[0]


async def test_named_env_var_that_is_unset_sends_no_header(make_gate):
    """An unset key must not become the literal string "Bearer None"."""
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, upstream_api_key_env="OPENROUTER_API_KEY", provenance=HOSTED, env={})
    await gate.client.post(CHAT, json=chat_request(stream=False))
    assert "authorization" not in fake.request_headers[0]


async def test_authorization_header_is_sent_on_the_streaming_path_too(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, upstream_api_key_env="K", provenance=HOSTED, env={"K": KEY})
    r = await gate.client.post(CHAT, json=chat_request(stream=True))
    assert r.status_code == 200
    assert fake.request_headers[0]["authorization"] == f"Bearer {KEY}"


# ---- a literal key in yaml is refused ----------------------------------------------------
def test_literal_api_key_in_yaml_is_rejected(tmp_path):
    path = tmp_path / "gate.yaml"
    path.write_text(yaml.safe_dump({"upstream_url": "https://openrouter.ai/api",
                                    "upstream_api_key": KEY,
                                    "provenance": {"placement": "hosted"}}))
    with pytest.raises(ValueError) as exc:
        load_config(path)
    message = str(exc.value)
    assert "upstream_api_key" in message and "upstream_api_key_env" in message
    assert KEY not in message  # the error must not echo the secret it is refusing


def test_literal_key_smuggled_through_upstream_headers_is_rejected(tmp_path):
    path = tmp_path / "gate.yaml"
    path.write_text(yaml.safe_dump({"upstream_headers": {"Authorization": f"Bearer {KEY}"},
                                    "provenance": {"placement": "hosted"}}))
    with pytest.raises(ValueError) as exc:
        load_config(path)
    assert "upstream_api_key_env" in str(exc.value)
    assert KEY not in str(exc.value)


# ---- upstream_model rewrites the model and nothing else ------------------------------------
async def test_upstream_model_rewrites_the_body_model_and_nothing_else(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, upstream_model="qwen/qwen3.5-9b-instruct", provenance=HOSTED)
    sent_by_caller = chat_request(stream=False)
    r = await gate.client.post(CHAT, json=json.loads(json.dumps(sent_by_caller)))
    assert r.status_code == 200
    forwarded = fake.requests[0]
    assert forwarded["model"] == "qwen/qwen3.5-9b-instruct"
    assert forwarded == {**sent_by_caller, "model": "qwen/qwen3.5-9b-instruct"}


async def test_without_upstream_model_the_body_is_untouched(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake)
    sent_by_caller = chat_request(stream=False)
    await gate.client.post(CHAT, json=json.loads(json.dumps(sent_by_caller)))
    assert fake.requests[0] == sent_by_caller


# ---- provenance is a reported fact ---------------------------------------------------------
async def test_provenance_appears_on_healthz(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, provenance=HOSTED, upstream_api_key_env="OPENROUTER_API_KEY",
                     env={"OPENROUTER_API_KEY": KEY})
    doc = (await gate.client.get("/healthz")).json()["provenance"]
    assert doc["placement"] == "hosted"
    assert doc["provider"] == "OpenRouter"
    assert doc["model"] == "qwen/qwen3.5-9b-instruct"
    assert doc["authenticated"] is True
    assert doc["api_key_env"] == "OPENROUTER_API_KEY"
    assert doc["guard"] == "factguard"
    assert KEY not in json.dumps(doc)


async def test_provenance_model_falls_back_to_upstream_model_then_the_request(make_gate):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, provenance={"placement": "rented", "provider": "a rented 4090"},
                     upstream_model="qwen/qwen3.5-9b-instruct")
    assert (await gate.client.get("/healthz")).json()["provenance"]["model"] \
        == "qwen/qwen3.5-9b-instruct"

    gate2 = make_gate(fake, provenance={"placement": "rented"})
    assert (await gate2.client.get("/healthz")).json()["provenance"]["model"] is None
    await gate2.client.post(CHAT, json=chat_request(stream=False))
    assert (await gate2.client.get("/healthz")).json()["provenance"]["model"] == "Qwen/Qwen3.5-9B"


async def test_admin_provenance_reports_where_it_publishes(make_gate, admin_secret):
    fake = FakeUpstream(GOOD)
    gate = make_gate(fake, provenance=HOSTED,
                     platform={"base_url": "https://kami.example/", "token": "tok"})
    r = await gate.client.get("/admin/provenance", headers=admin_secret)
    assert r.status_code == 200
    doc = r.json()
    assert doc["provenance"]["placement"] == "hosted"
    assert doc["reporting_to"] == "https://kami.example/api/gate/provenance"
    assert doc["last_publish_ok"] is None  # the lifespan does not run under ASGITransport
    assert (await gate.client.get("/admin/provenance")).status_code == 401


def test_a_config_without_placement_does_not_load(tmp_path):
    path = tmp_path / "gate.yaml"
    path.write_text(yaml.safe_dump({"upstream_url": "http://127.0.0.1:8000"}))
    with pytest.raises(ValueError, match="placement"):
        load_config(path)

    path.write_text(yaml.safe_dump({"provenance": {"provider": "OpenRouter"}}))
    with pytest.raises(ValueError, match="placement"):
        load_config(path)

    path.write_text(yaml.safe_dump({"provenance": {"placement": "somewhere"}}))
    with pytest.raises(ValueError, match="placement"):
        load_config(path)


def test_the_shipped_gate_yaml_names_its_placement():
    from pathlib import Path
    cfg = load_config(Path(__file__).resolve().parents[1] / "gate.yaml")
    assert cfg.provenance.placement == "owned"
    assert cfg.timeout_s == 300


def test_legacy_upstream_timeout_s_still_wins_over_the_new_default():
    assert _cfg(upstream_timeout_s=120).timeout_s == 120
    assert _cfg().timeout_s == 300


# ---- publishing to the platform ---------------------------------------------------------
async def test_reporter_posts_provenance_with_the_shared_secret():
    seen: list[httpx.Request] = []
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    config = _cfg(provenance=HOSTED, upstream_api_key_env="K",
                  platform=Platform(base_url="https://kami.example", token="tok"))
    reporter = ProvenanceReporter(config, lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(handler)), host="box-1")
    assert await reporter.publish_once() is True
    assert str(seen[0].url) == "https://kami.example/api/gate/provenance"
    assert seen[0].headers["authorization"] == "Bearer tok"
    assert seen[0].headers["x-gate-admin"] == "tok"
    body = bodies[0]
    assert body["host"] == "box-1" and body["at"]
    assert body["provenance"]["placement"] == "hosted"
    assert reporter.last_publish_ok is True


async def test_reporter_survives_an_unreachable_platform_and_never_echoes_the_key(monkeypatch):
    monkeypatch.setenv("K", KEY)

    def handler(_r):
        raise httpx.ConnectError(f"no route (tried with {KEY})")

    config = _cfg(provenance=HOSTED, upstream_api_key_env="K",
                  platform=Platform(base_url="https://kami.example", token="tok"))
    reporter = ProvenanceReporter(config, lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(handler)))
    assert await reporter.publish_once() is False
    assert reporter.last_publish_ok is False
    assert KEY not in (reporter.last_error or "")
    assert "[redacted]" in reporter.last_error


async def test_reporter_is_a_noop_without_a_platform_url():
    reporter = ProvenanceReporter(_cfg())
    assert reporter.url is None
    assert await reporter.publish_once() is True
    await reporter.start()
    assert reporter._task is None


# ---- the guard does not care where the model runs -------------------------------------------
async def test_guard_still_drops_an_unmatched_sentence_when_the_model_is_hosted(make_gate):
    """The point of the whole exercise.

    Placement changes what the public page says; it changes nothing about enforcement.
    A hosted model gets exactly the same fact sheet, the same sentence-by-sentence
    release, the same gate line and the same guard_event as a local one.
    """
    fake = FakeUpstream(GOOD + " " + BAD)
    hosted = make_gate(fake, provenance=HOSTED, upstream_api_key_env="K",
                       upstream_model="qwen/qwen3.5-9b-instruct", env={"K": KEY})
    r = await hosted.client.post(CHAT, json=chat_request())
    assert r.headers["X-Guard"] == "stream"
    text = content_of(parse_sse(r.text))
    assert GOOD in text
    assert "30%" not in text and "below normal" not in text
    assert GATE_LINE in text
    drops = [e for e in hosted.events.guard_events() if e["action"] == "drop"]
    assert len(drops) == 1 and drops[0]["unmatched"] == ["30 %"]

    # ... and identically on the non-stream (cron) path
    fake2 = FakeUpstream(["Flow is 99 cfs today.", "Flow is 88 cfs, honest."])
    hosted2 = make_gate(fake2, provenance=HOSTED)
    r2 = await hosted2.client.post(CHAT, json=chat_request(stream=False))
    assert r2.headers["X-Guard"] == "held"


# ---- the key never appears anywhere a human or a database will read ---------------------------
async def test_the_upstream_key_never_reaches_a_log_line_event_or_error(make_gate, admin_secret):
    spans: list[dict] = []
    fake = FakeUpstream(GOOD + " " + BAD)
    gate = make_gate(fake, provenance=HOSTED, upstream_api_key_env="K",
                     upstream_headers={"HTTP-Referer": "https://kami.example"},
                     upstream_model="qwen/qwen3.5-9b-instruct", env={"K": KEY},
                     telemetry=Telemetry(exporter=spans.append))
    bodies = [
        (await gate.client.post(CHAT, json=chat_request())).text,
        (await gate.client.post(CHAT, json=chat_request(stream=False))).text,
        (await gate.client.get("/healthz")).text,
        (await gate.client.get("/admin/state", headers=admin_secret)).text,
        (await gate.client.get("/admin/provenance", headers=admin_secret)).text,
    ]
    for body in bodies:
        assert KEY not in body
    assert KEY not in json.dumps(spans)
    for path in (gate.events.usage_path, gate.events.guard_path):
        assert path.exists()
        assert KEY not in path.read_text()

    # and when the upstream itself is unreachable, the 502 body carries no key either
    broken = create_broken_gate(gate.config)
    r = await broken.post(CHAT, json=chat_request(stream=False))
    assert r.status_code == 502
    assert KEY not in r.text and "[redacted]" in r.json()["error"]["message"]


def create_broken_gate(config: GateConfig) -> httpx.AsyncClient:
    """A gate whose upstream refuses connections, with the key in the exception text."""
    from entity_gate.app import create_app

    def handler(_r):
        raise httpx.ConnectError(f"connection refused (Bearer {KEY})")

    up = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://upstream")
    app = create_app(config, upstream_client=up, telemetry=Telemetry(exporter=lambda _r: None),
                     env={"K": KEY})
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 40000)),
                             base_url="http://gate")


def test_redact_is_a_noop_without_a_key():
    assert _cfg().redact("nothing to hide") == "nothing to hide"
    cfg = _cfg(upstream_api_key_env="K")
    assert cfg.redact(f"Bearer {KEY}", {"K": KEY}) == "Bearer [redacted]"


# ---- the smoke check ---------------------------------------------------------------------
def _check_client(fake: FakeUpstream) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fake.app),
                             base_url="http://upstream")


TOOL_CALLS = [{"index": 0, "id": "call_1", "type": "function",
               "function": {"name": "get_entity_status",
                            "arguments": '{"entity": "entity/boulder-creek"}'}}]


async def test_check_upstream_passes_a_provider_that_calls_tools():
    fake = FakeUpstream("", tool_calls=TOOL_CALLS)
    report = await check_upstream.run_check(_cfg(provenance=HOSTED), _check_client(fake),
                                            model="qwen/qwen3.5-9b-instruct")
    assert report.exit_code == 0
    assert report.get("answers").status == "PASS"
    assert report.get("tool_call").status == "PASS"
    assert "get_entity_status" in report.get("tool_call").detail
    assert report.get("streams").status == "PASS"
    assert report.get("usage").status == "PASS"
    # the tool schema really was offered, and the model name really was sent
    assert fake.requests[0]["tools"][0]["function"]["name"] == "get_entity_status"
    assert fake.requests[0]["model"] == "qwen/qwen3.5-9b-instruct"


async def test_check_upstream_fails_a_provider_that_answers_in_prose():
    fake = FakeUpstream("Sure! The creek is doing great.")
    report = await check_upstream.run_check(_cfg(provenance=HOSTED), _check_client(fake),
                                            model="m")
    assert report.exit_code == 1
    assert report.get("answers").status == "PASS"
    assert report.get("tool_call").status == "FAIL"
    assert "prose" in report.get("tool_call").detail


async def test_check_upstream_fails_when_the_upstream_will_not_answer():
    def handler(_r):
        return httpx.Response(401, json={"error": "no credit"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://upstream")
    report = await check_upstream.run_check(_cfg(provenance=HOSTED), client, model="m")
    assert report.exit_code == 1
    assert report.get("answers").status == "FAIL" and "401" in report.get("answers").detail
    assert report.get("tool_call").status == "FAIL"
    assert report.get("streams").detail == "not attempted — it did not answer"


async def test_check_upstream_warns_when_usage_is_missing():
    fake = FakeUpstream("", tool_calls=TOOL_CALLS, usage=False)
    report = await check_upstream.run_check(_cfg(provenance=HOSTED), _check_client(fake),
                                            model="m")
    assert report.exit_code == 0  # usable, less well
    assert report.get("usage").status == "WARN"


def test_check_upstream_main_renders_plain_language_and_exits_non_zero(tmp_path, capsys):
    path = tmp_path / "gate.yaml"
    path.write_text(yaml.safe_dump({"upstream_url": "http://127.0.0.1:59999",
                                    "provenance": {"placement": "hosted",
                                                   "provider": "OpenRouter"},
                                    "request_timeout_s": 2}))
    lines: list[str] = []
    code = check_upstream.main(["--config", str(path)], write=lines.append)
    assert code == 1
    text = "\n".join(lines)
    assert "answers at all" in text and "returns a tool call" in text
    assert "Not usable as a kami's upstream" in text
    assert "hosted, OpenRouter" in text


def test_check_upstream_main_passes_a_good_upstream():
    fake = FakeUpstream("", tool_calls=TOOL_CALLS)
    lines: list[str] = []
    from pathlib import Path
    code = check_upstream.main(
        ["--config", str(Path(__file__).resolve().parents[1] / "gate.yaml"), "--model", "m"],
        write=lines.append, client=_check_client(fake))
    assert code == 0
    text = "\n".join(lines)
    assert "Usable." in text
    assert "owned, vLLM on the GPU box" in text
