"""The offline judge (never on the hot path) and the weekly 50-reply audit."""

from __future__ import annotations

import json

import httpx

from kami_evals import audit as audit_mod
from kami_evals import judge as judge_mod
from kami_evals.audit import audit, normalise, strip_gate_tail
from kami_evals.judge import (
    DEFAULT_ANTHROPIC_MODEL,
    RUBRIC,
    build_prompt,
    judge,
    load_transcripts,
    parse_verdict,
)
from kami_evals.replay import load_corpus

ROW = {"id": "x1", "question": "how is the creek?",
       "reply": "Flow at Orodell is 15.4 cfs, the last reading I have, from Friday."}


# ---- judge ------------------------------------------------------------------------------
def test_the_rubric_covers_the_four_named_criteria():
    for key in ("voice_consistency", "for_not_as", "no_urgency", "disclosure_present"):
        assert key in RUBRIC


def test_docstring_says_it_is_never_on_the_hot_path():
    assert "NEVER ON THE HOT PATH" in judge_mod.__doc__


def test_dry_run_is_the_default_and_sends_nothing(monkeypatch):
    def explode(*a, **k):
        raise AssertionError("the judge must not call an endpoint in a dry run")

    monkeypatch.setattr(judge_mod, "call_openai_compatible", explode)
    monkeypatch.setattr(judge_mod, "call_anthropic", explode)
    report = judge([ROW])
    assert report["dry_run"] is True
    assert report["n"] == 1
    assert "how is the creek?" in report["prompts"][0]["prompt"]


def test_dry_run_when_only_one_credential_is_given(monkeypatch):
    monkeypatch.setattr(judge_mod, "call_anthropic",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("called")))
    assert judge([ROW], provider="anthropic", endpoint="https://api.anthropic.com",
                 dry_run=False)["dry_run"] is True


def test_anthropic_model_id_default():
    assert DEFAULT_ANTHROPIC_MODEL == "claude-opus-5"


def test_judge_calls_the_endpoint_when_both_credentials_are_given():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["model"] = json.loads(request.content)["model"]
        return httpx.Response(200, json={"content": [{"type": "text", "text": json.dumps({
            "voice_consistency": 4, "for_not_as": True, "no_urgency": True,
            "disclosure_present": None, "measured_or_unknown": 5, "notes": "none"})}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    report = judge([ROW], provider="anthropic", endpoint="https://api.anthropic.com",
                   api_key="k", dry_run=False, client=client)
    assert report["dry_run"] is False
    assert seen["url"].endswith("/v1/messages")
    assert seen["model"] == DEFAULT_ANTHROPIC_MODEL
    assert report["summary"]["voice_consistency_mean"] == 4
    assert report["summary"]["for_not_as_rate"] == 1.0


def test_verdict_parsing_tolerates_surrounding_prose():
    assert parse_verdict('here you go {"voice_consistency": 3} thanks')["voice_consistency"] == 3
    assert parse_verdict("no json here") is None


def test_transcripts_load_from_a_replay_report(tmp_path):
    p = tmp_path / "replay-report.json"
    p.write_text(json.dumps({"turn_results": [
        {"turn_id": "t1", "question": "q", "released_text": "Flow is 15.4 cfs."},
        {"turn_id": "t2", "question": "q", "released_text": ""}]}))
    rows = load_transcripts(p)
    assert [r["id"] for r in rows] == ["t1"]
    assert "Flow is 15.4 cfs." in build_prompt(rows[0])


# ---- audit ------------------------------------------------------------------------------
def test_gate_lines_are_stripped_before_re_guarding():
    from factguard import FALLBACK, GATE_LINE
    text = f"Flow at Orodell is 15.4 cfs, from Friday.\n\n{GATE_LINE}"
    assert strip_gate_tail(text) == "Flow at Orodell is 15.4 cfs, from Friday."
    assert strip_gate_tail(FALLBACK) == ""


def test_audit_of_clean_replies_passes(gazetteer):
    corpus = [t for t in load_corpus() if t["category"] == "honest"][:12]
    report = audit(corpus, sample=50, gazetteer=gazetteer)
    assert report["audited"] == 12
    assert report["replies_with_unmatched_atoms"] == 0
    assert report["pass"] is True


def test_audit_catches_an_unmatched_atom(gazetteer):
    corpus = [t for t in load_corpus() if t["category"] == "one_number_wrong"][:5]
    report = audit(corpus, sample=50, gazetteer=gazetteer)
    assert report["replies_with_unmatched_atoms"] == 5
    assert report["pass"] is False
    assert report["findings"][0]["unmatched"]


def test_audit_samples_exactly_fifty(gazetteer):
    report = audit(load_corpus(), sample=50, seed=7, gazetteer=gazetteer)
    assert report["sampled"] == 50
    assert report["audited"] + len(report["unauditable"]) == 50


def test_audit_reads_chat_messages_shaped_rows(gazetteer, snapshots):
    from kami_evals.snapshots import tool_result
    doc = tool_result(snapshots["2026-09-06-all-stale"])
    rows = [{
        "id": 41, "session_id": "s1", "role": "assistant",
        "question": "what's the flow?",
        "content": "Flow at Orodell is 15.4 cfs, the last reading I have, from Friday.",
        "toolcalls": {"results": [{"name": "get_entity_status", "content": doc}]},
        "guard_dropped": 0,
    }, {
        "id": 42, "session_id": "s1", "role": "user", "content": "hi", "toolcalls": None,
    }, {
        "id": 43, "session_id": "s1", "role": "assistant",
        "question": "is that low?",
        "content": "That's about 30% below normal for September.",
        "toolcalls": {"results": [{"name": "get_entity_status", "content": doc}]},
    }]
    report = audit(rows, gazetteer=gazetteer)
    assert report["audited"] == 2
    assert report["replies_with_unmatched_atoms"] == 1
    assert "30 %" in report["findings"][0]["unmatched"][0]


def test_rows_without_stored_tool_results_are_unauditable(gazetteer):
    rows = [{"id": 9, "role": "assistant", "content": "Flow is 15.4 cfs.",
             "toolcalls": {"place_ids": ["place/x"], "times": [], "sources": []}}]
    report = audit(rows, gazetteer=gazetteer)
    assert report["audited"] == 0
    assert report["unauditable"][0]["why"].startswith("unauditable")


def test_guard_events_drop_rows_are_summarised(gazetteer):
    rows = [{"ts": "2026-09-06T05:00:00Z", "action": "drop", "reason": "unmatched",
             "sentence": "That's about 30% below normal.", "slug": "boulder-creek"},
            {"ts": "2026-09-06T05:01:00Z", "action": "drop", "reason": "stale_without_time",
             "sentence": "Flow is 15.4 cfs.", "slug": "boulder-creek"}]
    report = audit(rows, gazetteer=gazetteer)
    assert report["guard_event_drops_by_reason"] == {"unmatched": 1, "stale_without_time": 1}
    assert report["audited"] == 0 and report["pass"] is True


def test_audit_cli_exits_non_zero_on_a_finding(tmp_path, capsys):
    corpus = [t for t in load_corpus() if t["category"] == "invented_percentile"][:3]
    p = tmp_path / "rows.jsonl"
    p.write_text("\n".join(json.dumps(t) for t in corpus) + "\n", encoding="utf-8")
    code = audit_mod.main(["--input", str(p), "--out", str(tmp_path)])
    assert code == 1
    assert "with unmatched atoms" in capsys.readouterr().out
    assert json.loads((tmp_path / "audit-report.json").read_text())["pass"] is False


def test_normalise_handles_a_replay_turn():
    turn = load_corpus()[0]
    _rid, messages, reply, note = normalise(turn)
    assert note == "replay_turn"
    assert any(m["role"] == "tool" for m in messages)
    assert reply == turn["model_reply"]
