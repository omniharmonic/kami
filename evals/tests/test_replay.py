"""The replay CI gate: the checked-in corpus loads and passes; a bypassed guard makes it fail."""

from __future__ import annotations

import json

import pytest

from kami_evals import replay
from kami_evals.paths import REPLAYS_DIR
from kami_evals.replay import load_corpus, main, run_corpus, run_turn


@pytest.fixture(scope="module")
def corpus():
    return load_corpus()


def test_corpus_has_at_least_200_turns(corpus):
    assert len(corpus) >= 200


def test_corpus_covers_the_required_categories(corpus):
    cats = {t["category"] for t in corpus}
    for required in ("honest", "one_number_wrong", "invented_percentile", "invented_species",
                     "stale_without_time", "echo_user_number", "spelled_out", "count_claims",
                     "weekday_words"):
        assert required in cats, required


def test_corpus_uses_every_snapshot(corpus, snapshots):
    used = {t["snapshot"] for t in corpus}
    assert used <= set(snapshots)
    assert len(used) >= 10


def test_ci_run_passes_on_the_checked_in_corpus(corpus, gazetteer, thresholds):
    report = run_corpus(corpus, gazetteer=gazetteer, thresholds=thresholds)
    assert report["unguarded_published"] == 0
    assert report["failures"] == []
    assert report["pass"] is True
    assert report["drop_rate"] <= thresholds["replay_max_drop_rate"]
    assert report["dropped"] > 0, "an adversarial corpus that drops nothing is not exercising it"


def test_every_turn_matches_its_recorded_expectation(corpus, gazetteer):
    report = run_corpus(corpus, gazetteer=gazetteer)
    assert report["expectation_mismatches"] == []


def test_the_friday_turn_is_released_and_the_thursday_turn_is_dropped(corpus, gazetteer):
    friday = next(t for t in corpus if "from Friday." in t["model_reply"]
                  and t["category"] == "weekday_words")
    thursday = next(t for t in corpus if "from Thursday." in t["model_reply"])
    assert run_turn(friday, gazetteer=gazetteer).dropped == 0
    r = run_turn(thursday, gazetteer=gazetteer)
    assert r.dropped == 1 and "Thursday" not in r.released_text


def test_cli_writes_a_report_and_exits_zero(tmp_path, capsys):
    code = main(["--ci", "--out", str(tmp_path)])
    out = capsys.readouterr().out
    assert code == 0
    assert "RESULT: PASS" in out
    report = json.loads((tmp_path / "replay-report.json").read_text())
    assert report["turns"] >= 200
    assert report["by_category"] and report["by_reason"]
    assert report["thresholds"]["guard_drop_rate_max_prod"] == 0.02


def test_corpus_flag_points_at_another_file(tmp_path, capsys, corpus):
    small = tmp_path / "small.jsonl"
    small.write_text("\n".join(json.dumps(t) for t in corpus[:5]) + "\n", encoding="utf-8")
    code = main(["--ci", "--corpus", str(small), "--out", str(tmp_path)])
    assert code == 0
    assert json.loads((tmp_path / "replay-report.json").read_text())["turns"] == 5
    assert "RESULT: PASS" in capsys.readouterr().out


def test_a_guard_that_releases_everything_makes_the_gate_fail(monkeypatch, tmp_path, capsys,
                                                              gazetteer):
    """Simulate a guard bug: release every sentence. The independent re-check must catch it."""
    from factguard import GuardResult
    from factguard.sentences import split_sentences

    def bypassed(text, sheet, last_user="", now=None, tz="America/Denver", gazetteer=None):
        res = GuardResult()
        res.released = [s + " " for s in split_sentences(text)]
        res.final_text = text
        return res

    monkeypatch.setattr(replay, "guard_text", bypassed)
    code = main(["--ci", "--out", str(tmp_path)])
    out = capsys.readouterr().out
    assert code == 1
    assert "RESULT: FAIL" in out
    report = json.loads((tmp_path / "replay-report.json").read_text())
    assert report["unguarded_published"] > 0
    assert report["dropped"] == 0
    assert any("unmatched atom" in f for f in report["failures"])
    assert any("forbidden string released" in f for f in report["failures"])


def test_drop_rate_over_the_threshold_fails(corpus, gazetteer, thresholds):
    tight = dict(thresholds, replay_max_drop_rate=0.001)
    report = run_corpus(corpus, gazetteer=gazetteer, thresholds=tight)
    assert report["pass"] is False
    assert any("drop rate" in f for f in report["failures"])


def test_duplicate_turn_ids_are_rejected(tmp_path, corpus):
    p = tmp_path / "dupe.jsonl"
    p.write_text("\n".join(json.dumps(corpus[0]) for _ in range(2)) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate turn_id"):
        load_corpus([p])


def test_corpus_file_is_where_ci_expects_it():
    assert sorted(p.name for p in REPLAYS_DIR.glob("*.jsonl")) == ["boulder-creek-200.jsonl"]
