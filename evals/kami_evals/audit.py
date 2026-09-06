"""Weekly 50-reply audit: re-run the guard on released replies against their stored tool calls.

    python -m kami_evals.audit --input chat_messages.jsonl [--sample 50] [--seed 7]

Input records (one JSON object per line) in any of these shapes:

* ``chat_messages`` rows (`apps/web/src/db/schema/records.ts`): ``{id, session_id, at, role,
  content, toolcalls, guard_dropped}`` where ``toolcalls`` is the turn's tool-call log **with
  the tool results** — either ``toolcalls.results: [{name, content}]`` or
  ``toolcalls.messages: [...]`` (the full request). Rows whose ``toolcalls`` carry only the
  footer log (place_ids/times/sources, no content) cannot be re-guarded and are reported as
  ``unauditable``;
* gate ``guard_events.jsonl`` rows — ``action: "drop"`` rows are summarised (they are
  sentences the guard already withheld), and any row carrying ``final_text`` + ``messages`` is
  re-guarded;
* replay-corpus turns ``{turn_id, question, tool_results, model_reply}``.

Only ``role: assistant`` (or shape-less) records are audited. The audit strips the gate-authored
tail lines, rebuilds the fact sheet exactly as the gate does, runs ``factguard.guard_text`` and
prints every unmatched atom. Exit status is non-zero when any audited reply contains one
(``thresholds.json.unguarded_published_max`` is 0) or, with ``--strict``, when any sampled row
was unauditable.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from factguard import FALLBACK, GATE_LINE, STALE_TEMPLATE, Gazetteer, guard_text

from .paths import OUT_DIR
from .replay import resolve_tool_results
from .snapshots import fact_sheet, load_gazetteer, turn_messages
from .thresholds import load_thresholds

_STALE_PREFIX = STALE_TEMPLATE.split("{time}")[0]


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def strip_gate_tail(text: str) -> str:
    kept = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s == GATE_LINE or s == FALLBACK or s.startswith(_STALE_PREFIX):
            continue
        kept.append(line)
    out = "\n".join(kept)
    return out.replace(GATE_LINE, "").replace(FALLBACK, "").strip()


def normalise(row: dict[str, Any], snapshots_dir: str | Path | None = None
              ) -> tuple[str, list[dict] | None, str, str]:
    """→ (record_id, messages | None, reply_text, note)."""
    rid = str(row.get("id") or row.get("turn_id") or row.get("ts") or "?")
    # gate guard_events
    if "action" in row:
        if row["action"] == "drop":
            return rid, None, row.get("sentence", ""), "guard_event:drop"
        if row.get("final_text") and row.get("messages"):
            return rid, row["messages"], row["final_text"], "guard_event"
        return rid, None, "", f"guard_event:{row['action']}"
    # replay corpus turn
    if "model_reply" in row and "tool_results" in row:
        results = resolve_tool_results(row, snapshots_dir)
        return rid, turn_messages(row["question"], results), row["model_reply"], "replay_turn"
    # chat_messages row
    if row.get("role", "assistant") != "assistant":
        return rid, None, "", "not_assistant"
    reply = row.get("content") or ""
    tc = row.get("toolcalls") or {}
    if isinstance(tc, str):
        try:
            tc = json.loads(tc)
        except ValueError:
            tc = {}
    if isinstance(tc, dict) and isinstance(tc.get("messages"), list):
        return rid, tc["messages"], reply, "chat_message"
    if isinstance(tc, dict) and isinstance(tc.get("results"), list):
        results = [(r.get("name") or "tool", r.get("content")) for r in tc["results"]]
        return rid, turn_messages(row.get("question") or row.get("user") or "", results), \
            reply, "chat_message"
    if isinstance(row.get("messages"), list):
        return rid, row["messages"], reply, "chat_message"
    return rid, None, reply, "unauditable:no tool results stored"


def audit(rows: list[dict[str, Any]], *, sample: int = 50, seed: int = 7,
          gazetteer: Gazetteer | None = None, snapshots_dir: str | Path | None = None,
          tz: str = "America/Denver") -> dict[str, Any]:
    rng = random.Random(seed)
    candidates = [r for r in rows if r.get("action") != "drop" and
                  r.get("role", "assistant") == "assistant"]
    drops = Counter(r.get("reason", "unmatched") for r in rows if r.get("action") == "drop")
    picked = candidates if len(candidates) <= sample else rng.sample(candidates, sample)
    audited: list[dict[str, Any]] = []
    unauditable: list[dict[str, str]] = []
    for row in picked:
        rid, messages, reply, note = normalise(row, snapshots_dir)
        if messages is None:
            unauditable.append({"id": rid, "why": note})
            continue
        sheet = fact_sheet(messages)
        last_user = next((m.get("content") for m in reversed(messages)
                          if m.get("role") == "user" and isinstance(m.get("content"), str)), "")
        text = strip_gate_tail(reply)
        if not text:
            audited.append({"id": rid, "kind": note, "ok": True, "unmatched": [],
                            "note": "empty after removing gate lines"})
            continue
        res = guard_text(text, sheet, last_user, tz=tz, gazetteer=gazetteer)
        audited.append({
            "id": rid, "kind": note, "ok": res.ok,
            "unmatched": [v for v in res.violations],
        })
    bad = [a for a in audited if not a["ok"]]
    return {
        "rows": len(rows), "candidates": len(candidates), "sampled": len(picked),
        "audited": len(audited), "unauditable": unauditable,
        "guard_event_drops_by_reason": dict(drops),
        "replies_with_unmatched_atoms": len(bad),
        "findings": bad,
        "pass": not bad,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="kami-evals audit", description=__doc__.split("\n\n")[0])
    p.add_argument("--input", required=True, action="append",
                   help="JSONL (chat_messages export, guard_events.jsonl or a replay corpus)")
    p.add_argument("--sample", type=int, default=50)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--gazetteer", default=None)
    p.add_argument("--snapshots", default=None)
    p.add_argument("--thresholds", default=None)
    p.add_argument("--strict", action="store_true", help="also fail when a sampled row is unauditable")
    p.add_argument("--out", default=None)
    args = p.parse_args(argv)

    rows: list[dict[str, Any]] = []
    for path in args.input:
        rows.extend(read_jsonl(path))
    gaz = Gazetteer.from_file(args.gazetteer) if args.gazetteer else load_gazetteer()
    report = audit(rows, sample=args.sample, seed=args.seed, gazetteer=gaz,
                   snapshots_dir=args.snapshots)
    max_unguarded = int(load_thresholds(args.thresholds)["unguarded_published_max"])
    out = Path(args.out) if args.out else OUT_DIR
    out.mkdir(parents=True, exist_ok=True)
    path = out / "audit-report.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"audit: {report['audited']} of {report['sampled']} sampled replies re-guarded "
          f"({len(report['unauditable'])} unauditable); "
          f"{report['replies_with_unmatched_atoms']} with unmatched atoms")
    for f in report["findings"]:
        print(f"  {f['id']}:")
        for v in f["unmatched"]:
            print(f"    - {v}")
    for u in report["unauditable"][:10]:
        print(f"  unauditable {u['id']}: {u['why']}")
    print(f"report: {path}")
    failed = report["replies_with_unmatched_atoms"] > max_unguarded or (
        args.strict and report["unauditable"])
    return 1 if failed else 0


__all__ = ["audit", "main", "normalise", "read_jsonl", "strip_gate_tail"]

if __name__ == "__main__":
    sys.exit(main())
