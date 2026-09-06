"""The fine-tune skeleton: the opt-in filter, the 25 % tool-call quota, the promotion gate,
and the two dry runs that must never touch the network."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from finetune import build_dataset, eval_gate, synth, train
from finetune.build_dataset import build, is_toolcall_example, opted_in


def voice_session(i: int, archetype: str = "creek", opt_in: bool = True) -> dict:
    return {"session": {"contribute_opt_in": opt_in, "archetype": archetype},
            "messages": [{"role": "user", "content": f"q{i}"},
                         {"role": "assistant", "content": f"Flow is fine, answer {i}."}]}


def toolcall_session(i: int) -> dict:
    return {"session": {"contribute_opt_in": True, "archetype": "creek"},
            "messages": [{"role": "user", "content": f"q{i}"},
                         {"role": "assistant",
                          "content": '<tool_call>\n{"name": "get_entity_status", '
                                     '"arguments": {}}\n</tool_call>'},
                         {"role": "tool", "content": "<tool_response>\n{}\n</tool_response>"},
                         {"role": "assistant", "content": "Here is what came back."}]}


def test_sessions_without_opt_in_are_dropped():
    rows = [voice_session(i, opt_in=(i % 2 == 0)) for i in range(10)]
    assert [opted_in(r) for r in rows].count(True) == 5
    _dataset, stats = build(transcripts=rows, synthetic=[])
    assert stats["dropped_not_opted_in"] == 5
    assert stats["voice"] == 5


def test_toolcall_quota_is_enforced_by_filling_from_real_snapshots():
    dataset, stats = build(transcripts=[voice_session(i) for i in range(30)], synthetic=[])
    assert stats["toolcall_share"] >= 0.25
    assert stats["toolcall_filled"] == 10  # ceil(0.25*30/0.75)
    assert all(is_toolcall_example(r["messages"])
               for r in dataset if r["kind"] == "toolcall")
    filled = [r for r in dataset if r["kind"] == "toolcall"]
    assert all(r.get("snapshot") for r in filled)


def test_existing_toolcall_transcripts_count_towards_the_quota():
    rows = [voice_session(i) for i in range(30)] + [toolcall_session(i) for i in range(10)]
    dataset, stats = build(transcripts=rows, synthetic=[])
    assert stats["toolcall"] == 10
    assert stats.get("toolcall_filled") is None
    assert stats["toolcall_share"] >= 0.25
    assert len(dataset) == 40


def test_no_fill_raises_instead_of_synthesising():
    with pytest.raises(ValueError, match="tool-call share"):
        build(transcripts=[voice_session(i) for i in range(30)], synthetic=[], fill=False)


def test_voice_quota_caps_per_archetype_and_warns_under_two_hundred():
    rows = [voice_session(i, "creek") for i in range(320)] + \
           [voice_session(i, "reservoir") for i in range(10)]
    dataset, stats = build(transcripts=rows, synthetic=[], voice_quota=300)
    assert stats["voice_by_archetype"]["creek"] == 320
    assert stats["voice_capped"]["creek"] == 20
    assert stats["voice"] == 310
    assert any("reservoir" in w for w in stats["warnings"])
    assert not any("creek" in w for w in stats["warnings"]), "creek keeps 300, above the floor"
    assert len([r for r in dataset if r["kind"] == "voice"]) == 310


def test_synthetic_rows_join_the_dataset():
    synthetic = [{"archetype": "creek", "messages": [{"role": "user", "content": "q"},
                                                     {"role": "assistant", "content": "a"}],
                  "ground_truth": {"atoms": []}}]
    _dataset, stats = build(transcripts=[voice_session(i) for i in range(10)],
                            synthetic=synthetic)
    assert stats["kinds"]["synthetic"] == 1


def test_builder_cli_writes_train_jsonl(tmp_path, capsys):
    src = tmp_path / "t.jsonl"
    src.write_text("\n".join(json.dumps(voice_session(i)) for i in range(12)) + "\n")
    out = tmp_path / "train.jsonl"
    code = build_dataset.main(["--transcripts", str(src), "--out", str(out)])
    assert code == 0
    rows = [json.loads(x) for x in out.read_text().splitlines()]
    assert len(rows) == 16
    assert sum(r["kind"] == "toolcall" for r in rows) / len(rows) >= 0.25
    assert "toolcall_share" in capsys.readouterr().out


def test_synth_dry_run_builds_prompts_from_real_snapshots_without_network(monkeypatch):
    monkeypatch.setattr(synth, "call_anthropic",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    monkeypatch.setattr(synth, "call_openai_compatible",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    report = synth.synthesise(per_snapshot=2)
    assert report["dry_run"] is True
    assert report["n"] >= 20
    p = report["prompts"][0]["prompt"]
    assert "kami:hard-rules" in p and "facts" in p
    assert "2026-09-08-twin-unreachable" not in {x["snapshot"] for x in report["prompts"]}


def test_synth_cli_dry_run_writes_nothing(tmp_path, capsys):
    out = tmp_path / "synth.jsonl"
    assert synth.main(["--per-snapshot", "1", "--out", str(out)]) == 0
    assert not out.exists()
    assert "dry run" in capsys.readouterr().out


def test_train_dry_run_prints_the_planned_config(capsys):
    assert train.main(["--dry-run"]) == 0
    cfg = json.loads(capsys.readouterr().out)
    assert cfg["lora"]["r"] == 16 and cfg["lora"]["lora_alpha"] == 32
    assert cfg["train"]["num_train_epochs"] == 2
    assert cfg["train"]["learning_rate"] == 2e-4
    assert cfg["max_seq_length"] == 8192
    assert cfg["load_in_4bit"] is True


def test_train_without_unsloth_explains_itself(monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "unsloth", None)
    code = train.main([])
    assert code == 2
    assert "unsloth" in capsys.readouterr().err


def _report(factual, halluc, safety, validity, passed=True) -> dict:
    return {"pass_rates": {"factual": factual, "hallucination": halluc, "safety": safety,
                           "toolcall": 1.0},
            "tool_calls": {"validity": validity}, "pass": passed}


def test_promotion_gate_passes_only_when_facts_and_tool_calls_improve():
    stock = _report(0.90, 0.96, 1.0, 0.95)
    better = _report(0.94, 0.97, 1.0, 0.97)
    assert eval_gate.compare(stock, better)["pass"] is True

    same_facts = eval_gate.compare(stock, _report(0.90, 0.97, 1.0, 0.97))
    assert same_facts["pass"] is False
    assert same_facts["checks"]["a_exact_fact_improves"] is False

    worse_halluc = eval_gate.compare(stock, _report(0.94, 0.93, 1.0, 0.97))
    assert worse_halluc["checks"]["b_hallucination_no_regression"] is False

    same_tools = eval_gate.compare(stock, _report(0.94, 0.97, 1.0, 0.95))
    assert same_tools["checks"]["c_tool_call_validity_improves"] is False

    unsafe = eval_gate.compare(stock, _report(0.94, 0.97, 0.97, 0.97))
    assert unsafe["checks"]["e_safety_perfect"] is False

    below_threshold = eval_gate.compare(stock, _report(0.94, 0.97, 1.0, 0.97, passed=False))
    assert below_threshold["checks"]["candidate_clears_thresholds"] is False


def test_a_perfect_rate_on_both_sides_counts_as_improved():
    assert eval_gate.improves(1.0, 1.0) is True
    assert eval_gate.improves(0.9, 0.9) is False


def test_gate_cli_compares_two_saved_reports(tmp_path, capsys):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    a.write_text(json.dumps(_report(0.90, 0.96, 1.0, 0.95)))
    b.write_text(json.dumps(_report(0.94, 0.97, 1.0, 0.97)))
    code = eval_gate.main(["--stock-report", str(a), "--candidate-report", str(b),
                           "--out", str(tmp_path)])
    assert code == 0
    verdict = json.loads((tmp_path / "finetune-gate.json").read_text())
    assert verdict["pass"] is True
    assert "persona" in verdict["note"]
    assert "pass" in capsys.readouterr().out


def test_model_card_names_what_the_model_will_hallucinate():
    card = (Path(__file__).resolve().parents[1] / "finetune" / "MODEL_CARD.md").read_text()
    assert "WILL hallucinate" in card
    for topic in ("Plausible readings", "Species", "Counts", "Neighbouring places"):
        assert topic in card


def test_finetune_readme_documents_the_rollback_rehearsal():
    readme = (Path(__file__).resolve().parents[1] / "finetune" / "README.md").read_text()
    assert "rollback rehearsal" in readme.lower()
    assert "8002" in readme and "8000" in readme
