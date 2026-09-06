"""`kami-evals replay|live|judge|audit` dispatch."""

from __future__ import annotations

import json

import pytest

from kami_evals import cli


def test_help_lists_every_command(capsys):
    assert cli.main([]) == 2
    out = capsys.readouterr().out
    for c in ("replay", "live", "judge", "audit"):
        assert c in out
    assert cli.main(["--help"]) == 0


def test_unknown_command_exits_two(capsys):
    assert cli.main(["nope"]) == 2
    assert "unknown command" in capsys.readouterr().err


def test_replay_dispatch_runs_the_gate(tmp_path, capsys):
    assert cli.main(["replay", "--ci", "--out", str(tmp_path)]) == 0
    assert "RESULT: PASS" in capsys.readouterr().out
    assert json.loads((tmp_path / "replay-report.json").read_text())["pass"] is True


def test_judge_dispatch_dry_runs(tmp_path, capsys):
    src = tmp_path / "t.jsonl"
    src.write_text(json.dumps({"id": "a", "question": "q", "reply": "Flow is fine."}) + "\n")
    assert cli.main(["judge", "--transcripts", str(src), "--out", str(tmp_path)]) == 0
    assert "dry run" in capsys.readouterr().out
    assert json.loads((tmp_path / "judge-report.json").read_text())["dry_run"] is True


def test_audit_dispatch_runs(tmp_path, capsys):
    from kami_evals.replay import load_corpus
    rows = [t for t in load_corpus() if t["category"] == "honest"][:4]
    src = tmp_path / "rows.jsonl"
    src.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    assert cli.main(["audit", "--input", str(src), "--out", str(tmp_path)]) == 0
    assert "re-guarded" in capsys.readouterr().out


def test_live_dispatch_requires_an_endpoint():
    with pytest.raises(SystemExit):
        cli.main(["live"])


def test_console_script_entry_point_resolves():
    import tomllib
    from pathlib import Path
    doc = tomllib.loads((Path(__file__).resolve().parents[1] / "pyproject.toml")
                        .read_text(encoding="utf-8"))
    assert doc["project"]["scripts"]["kami-evals"] == "kami_evals.cli:main"
    assert doc["project"]["name"] == "kami-evals"
    assert doc["tool"]["uv"]["sources"]["kami-factguard"] == {"workspace": True}
