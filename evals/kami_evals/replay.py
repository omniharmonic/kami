"""The CI gate: replay recorded model replies through the fact-sheet guard (plan T0.9, X.4).

    python -m kami_evals.replay --ci [--corpus fixtures/replays/*.jsonl] [--out evals/out]

Each corpus line is one recorded turn::

    {"turn_id": "...", "snapshot": "<fixture name>", "question": "...",
     "tool_results": [{"name": "get_entity_status", "snapshot_ref": "<fixture name>"} |
                      {"name": "get_alerts", "content": {...}}],
     "model_reply": "...", "category": "...", "expect": "release_all|drop_some|fallback",
     "forbidden_in_release": ["30 %", "Thursday"]}

For every turn the runner rebuilds the request the gate would have seen (system → user →
assistant tool_calls → tool results), builds the fact sheet exactly as the gate does, runs the
reply through ``factguard.guard_text`` and then — independently of the guard's own verdict —
re-matches every *released* sentence and searches the released body for the planted
``forbidden_in_release`` strings. The gate is green only when

* no released sentence contains an unmatched atom (``unguarded_published_max``, i.e. 0) — a hit
  here is a guard bug, not a model bug;
* no planted forbidden string was released;
* the sentence-drop rate is at or below ``thresholds.json.replay_max_drop_rate``. The checked-in
  corpus is deliberately adversarial (over half of its turns plant something the guard must
  strike), so that ceiling is 0.35 — a canary for a broken or over-blocking guard, not the
  production target (``guard_drop_rate_max_prod``).
"""

from __future__ import annotations

import argparse
import copy
import glob
import json
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from factguard import FALLBACK, GATE_LINE, Gazetteer, guard_text, match_sentence

from .paths import OUT_DIR, REPLAYS_DIR
from .snapshots import fact_sheet, load_gazetteer, load_snapshot, tool_result, turn_messages
from .thresholds import load_thresholds

EXPECTATIONS = ("release_all", "drop_some", "fallback")


@dataclass
class TurnResult:
    turn_id: str
    category: str
    expect: str
    sentences: int
    dropped: int
    reasons: list[str]
    released_text: str
    unmatched_in_release: list[str] = field(default_factory=list)
    forbidden_released: list[str] = field(default_factory=list)
    expectation_met: bool = True
    observed: str = ""

    @property
    def published_unguarded(self) -> bool:
        return bool(self.unmatched_in_release or self.forbidden_released)


# ---------------------------------------------------------------------------------------
# corpus
# ---------------------------------------------------------------------------------------
def load_corpus(paths: list[str | Path] | str | Path | None = None) -> list[dict[str, Any]]:
    """Load one or more JSONL corpora (globs allowed). Default: fixtures/replays/*.jsonl."""
    if paths is None:
        files = sorted(REPLAYS_DIR.glob("*.jsonl"))
    else:
        if isinstance(paths, (str, Path)):
            paths = [paths]
        files = []
        for p in paths:
            expanded = sorted(glob.glob(str(p)))
            files.extend(Path(x) for x in expanded) if expanded else files.append(Path(p))
    turns: list[dict[str, Any]] = []
    seen: set[str] = set()
    for f in files:
        if not f.exists():
            raise FileNotFoundError(f"replay corpus not found: {f}")
        with open(f, encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                if not line.strip():
                    continue
                try:
                    turn = json.loads(line)
                except ValueError as exc:
                    raise ValueError(f"{f}:{lineno}: bad JSON ({exc})") from exc
                for k in ("turn_id", "snapshot", "question", "tool_results", "model_reply"):
                    if k not in turn:
                        raise ValueError(f"{f}:{lineno}: turn lacks {k!r}")
                if turn["turn_id"] in seen:
                    raise ValueError(f"{f}:{lineno}: duplicate turn_id {turn['turn_id']!r}")
                seen.add(turn["turn_id"])
                if turn.get("expect", "release_all") not in EXPECTATIONS:
                    raise ValueError(f"{f}:{lineno}: expect must be one of {EXPECTATIONS}")
                turns.append(turn)
    return turns


def resolve_tool_results(turn: dict[str, Any], snapshots_dir: str | Path | None = None,
                         cache: dict[str, dict] | None = None) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    for tr in turn["tool_results"]:
        name = tr.get("name") or "get_entity_status"
        if "content" in tr:
            out.append((name, tr["content"]))
            continue
        ref = tr.get("snapshot_ref") or turn["snapshot"]
        if cache is not None and ref in cache:
            doc = cache[ref]
        else:
            doc = load_snapshot(ref, snapshots_dir)
            if cache is not None:
                cache[ref] = doc
        payload = tool_result(doc)
        if tr.get("patch"):  # a per-turn overlay (e.g. an injected instruction in a note)
            payload = copy.deepcopy(payload)
            payload.update(tr["patch"])
        out.append((name, payload))
    return out


# ---------------------------------------------------------------------------------------
# one turn
# ---------------------------------------------------------------------------------------
def _observed(result) -> str:
    survived = any(s.strip() for s in result.released)
    if not survived:
        return "fallback"
    return "drop_some" if result.dropped else "release_all"


def _contains(haystack: str, needle: str) -> bool:
    return needle.lower() in " ".join(haystack.lower().split())


def run_turn(turn: dict[str, Any], *, gazetteer: Gazetteer | None = None,
             snapshots_dir: str | Path | None = None, cache: dict | None = None,
             tz: str = "America/Denver") -> TurnResult:
    results = resolve_tool_results(turn, snapshots_dir, cache)
    messages = turn_messages(turn["question"], results)
    sheet = fact_sheet(messages)
    user = turn["question"]
    # the guard under test (module attribute so tests can monkeypatch it)
    result = guard_text(turn["model_reply"], sheet, user, tz=tz, gazetteer=gazetteer)
    released_segments = [s for s in result.released if s.strip()]
    released_text = "".join(result.released).strip()

    # independent re-check of what was released
    unmatched: list[str] = []
    for seg in released_segments:
        mr = match_sentence(seg.strip(), sheet, user, tz=tz, gazetteer=gazetteer)
        if not mr.ok:
            if mr.reason == "stale_without_time":
                unmatched.append(f"{seg.strip()!r}: stale reading without its time")
            else:
                unmatched.append(f"{seg.strip()!r}: " + ", ".join(c.describe() for c in mr.unmatched))
    forbidden = [f for f in (turn.get("forbidden_in_release") or []) if _contains(released_text, f)]

    expect = turn.get("expect", "release_all")
    observed = _observed(result)
    return TurnResult(
        turn_id=turn["turn_id"], category=turn.get("category", "uncategorised"), expect=expect,
        sentences=len(released_segments) + len(result.dropped), dropped=len(result.dropped),
        reasons=[e["reason"] for e in result.events], released_text=released_text,
        unmatched_in_release=unmatched, forbidden_released=forbidden,
        expectation_met=(observed == expect), observed=observed,
    )


# ---------------------------------------------------------------------------------------
# the corpus
# ---------------------------------------------------------------------------------------
def run_corpus(turns: list[dict[str, Any]], *, gazetteer: Gazetteer | None = None,
               snapshots_dir: str | Path | None = None, thresholds: dict | None = None,
               corpus_label: str = "") -> dict[str, Any]:
    thresholds = thresholds or load_thresholds()
    cache: dict[str, dict] = {}
    results = [run_turn(t, gazetteer=gazetteer, snapshots_dir=snapshots_dir, cache=cache)
               for t in turns]
    sentences = sum(r.sentences for r in results)
    dropped = sum(r.dropped for r in results)
    by_cat: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"turns": 0, "sentences": 0, "dropped": 0, "expectation_met": 0,
                 "published_unguarded": 0})
    for r in results:
        c = by_cat[r.category]
        c["turns"] += 1
        c["sentences"] += r.sentences
        c["dropped"] += r.dropped
        c["expectation_met"] += int(r.expectation_met)
        c["published_unguarded"] += int(r.published_unguarded)
    by_reason = Counter(reason for r in results for reason in r.reasons)
    unguarded = [r for r in results if r.published_unguarded]
    drop_rate = dropped / sentences if sentences else 0.0
    max_drop = thresholds["replay_max_drop_rate"]
    max_unguarded = int(thresholds["unguarded_published_max"])
    failures: list[str] = []
    for r in unguarded:
        for u in r.unmatched_in_release:
            failures.append(f"{r.turn_id}: released sentence with unmatched atom — {u}")
        for f in r.forbidden_released:
            failures.append(f"{r.turn_id}: planted forbidden string released — {f!r}")
    if len(unguarded) > max_unguarded:
        failures.append(f"{len(unguarded)} turn(s) published unguarded atoms "
                        f"(max {max_unguarded})")
    if drop_rate > max_drop:
        failures.append(f"sentence-drop rate {drop_rate:.3f} exceeds replay_max_drop_rate "
                        f"{max_drop}")
    return {
        "corpus": corpus_label,
        "turns": len(results),
        "sentences": sentences,
        "dropped": dropped,
        "drop_rate": round(drop_rate, 4),
        "released_sentences": sentences - dropped,
        "unguarded_published": len(unguarded),
        "expectation_mismatches": [
            {"turn_id": r.turn_id, "expected": r.expect, "observed": r.observed}
            for r in results if not r.expectation_met],
        "by_category": dict(sorted(by_cat.items())),
        "by_reason": dict(by_reason),
        "thresholds": {"replay_max_drop_rate": max_drop,
                       "unguarded_published_max": max_unguarded,
                       "guard_drop_rate_max_prod": thresholds["guard_drop_rate_max_prod"]},
        "failures": failures,
        "pass": not failures,
        "turn_results": [asdict(r) for r in results],
    }


def write_report(report: dict[str, Any], out_dir: str | Path | None = None) -> Path:
    d = Path(out_dir) if out_dir else OUT_DIR
    d.mkdir(parents=True, exist_ok=True)
    p = d / "replay-report.json"
    p.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return p


def summarize(report: dict[str, Any]) -> str:
    lines = [
        (f"replay: {report['turns']} turns, {report['sentences']} sentences, "
         f"{report['dropped']} dropped (rate {report['drop_rate']:.3f}, "
         f"max {report['thresholds']['replay_max_drop_rate']}), "
         f"unguarded published: {report['unguarded_published']} "
         f"(max {report['thresholds']['unguarded_published_max']})"),
        "by category:",
    ]
    for cat, c in report["by_category"].items():
        rate = c["dropped"] / c["sentences"] if c["sentences"] else 0.0
        lines.append(f"  {cat:<26} turns={c['turns']:>3} sentences={c['sentences']:>4} "
                     f"dropped={c['dropped']:>3} ({rate:.2f}) expectation_met="
                     f"{c['expectation_met']}/{c['turns']}")
    lines.append("by reason: " + json.dumps(report["by_reason"]))
    if report["expectation_mismatches"]:
        lines.append(f"expectation mismatches: {len(report['expectation_mismatches'])}")
    for f in report["failures"]:
        lines.append("FAIL: " + f)
    lines.append("RESULT: " + ("PASS" if report["pass"] else "FAIL"))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="kami-evals replay", description=__doc__.split("\n\n")[0])
    p.add_argument("--ci", action="store_true",
                   help="exit non-zero on any failure (default when --corpus is not given)")
    p.add_argument("--corpus", action="append", default=None,
                   help="JSONL corpus (repeatable, globs ok); default fixtures/replays/*.jsonl")
    p.add_argument("--snapshots", default=None, help="snapshot directory override")
    p.add_argument("--gazetteer", default=None, help="gazetteer JSON override")
    p.add_argument("--thresholds", default=None, help="thresholds.json override")
    p.add_argument("--out", default=None, help="output directory (default evals/out)")
    p.add_argument("--strict-expectations", action="store_true",
                   help="also fail when a turn's observed outcome differs from its 'expect'")
    args = p.parse_args(argv)

    turns = load_corpus(args.corpus)
    gaz = Gazetteer.from_file(args.gazetteer) if args.gazetteer else load_gazetteer()
    report = run_corpus(turns, gazetteer=gaz, snapshots_dir=args.snapshots,
                        thresholds=load_thresholds(args.thresholds),
                        corpus_label=",".join(args.corpus) if args.corpus else "fixtures/replays")
    if args.strict_expectations and report["expectation_mismatches"]:
        report["failures"].append(
            f"{len(report['expectation_mismatches'])} expectation mismatch(es)")
        report["pass"] = False
    path = write_report(report, args.out)
    print(summarize(report))
    print(f"report: {path}")
    return 0 if report["pass"] else 1


__all__ = ["FALLBACK", "GATE_LINE", "TurnResult", "load_corpus", "main", "resolve_tool_results",
           "run_corpus", "run_turn", "summarize", "write_report"]

if __name__ == "__main__":
    sys.exit(main())
