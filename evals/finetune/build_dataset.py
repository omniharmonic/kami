"""Build ``train.jsonl`` for the QLoRA run (plan T3.6; PRD §8.4).

    python -m finetune.build_dataset --transcripts exports/*.jsonl \\
        --synthetic synth.jsonl --out train.jsonl [--voice-quota 300] [--min-toolcall-share 0.25]

Sources, in order:

1. **Opted-in real transcripts** — ``--transcripts`` JSONL, one session per line:
   ``{"session": {"contribute_opt_in": true, "archetype": "creek"}, "messages": [...]}`` (or the
   flat ``{"contribute_opt_in": ..., "archetype": ..., "messages": [...]}``). Sessions without
   ``contribute_opt_in: true`` are dropped, always.
2. **Synthetic reasoning transcripts** — output of ``synth.py`` (real snapshots, ground truth
   attached, guard-clean).
3. **Plain tool-call transcripts in Hermes format** — ``<tool_call>{...}</tool_call>`` in the
   assistant turn and a ``<tool_response>`` turn — at least ``--min-toolcall-share`` (25 %) of the
   final set so function calling does not degrade. If the inputs do not reach the share, the
   builder synthesises plain tool-call examples from the real snapshots under
   ``evals/fixtures/snapshots`` until it does (``--no-fill`` turns that off and fails instead).

Voice examples are capped per archetype (``--voice-quota``, 200–500 per PRD §8.4); the builder
warns when an archetype has fewer than 200.
"""

from __future__ import annotations

import argparse
import glob
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kami_evals.snapshots import hard_rules, load_snapshots, tool_result  # noqa: E402

ARCHETYPES = ("creek", "watershed", "reservoir", "mountain", "bioregion")
TOOLCALL_QUESTIONS = [
    ("How is the creek right now?", "get_entity_status", {}),
    ("Any alerts touching you?", "get_alerts", {}),
    ("How has flow moved this week?", "get_reading_history",
     {"place_id": "place/boulder-creek-near-orodell-co", "property": "discharge", "window": "7d"}),
    ("Is that low for the season?", "compare_to_normal",
     {"place_id": "place/boulder-creek-near-orodell-co", "property": "discharge"}),
    ("What does dissolved oxygen mean?", "explain", {"property": "dissolved_oxygen"}),
    ("Are your feeds healthy?", "get_health", {}),
]


def read_jsonl(paths: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for pattern in paths:
        files = sorted(glob.glob(pattern)) or [pattern]
        for f in files:
            with open(f, encoding="utf-8") as fh:
                rows.extend(json.loads(line) for line in fh if line.strip())
    return rows


def is_toolcall_example(messages: list[dict[str, Any]]) -> bool:
    return any(m.get("role") == "assistant" and isinstance(m.get("content"), str)
               and "<tool_call>" in m["content"] for m in messages)


def opted_in(row: dict[str, Any]) -> bool:
    sess = row.get("session") or {}
    return bool(sess.get("contribute_opt_in") or row.get("contribute_opt_in"))


def archetype_of(row: dict[str, Any]) -> str:
    return (row.get("session") or {}).get("archetype") or row.get("archetype") or "creek"


def hermes_toolcall_example(question: str, name: str, args: dict[str, Any],
                            result: dict[str, Any], final: str) -> list[dict[str, str]]:
    """Hermes ``<tool_call>`` / ``<tool_response>`` transcript shape."""
    return [
        {"role": "system", "content": hard_rules()},
        {"role": "user", "content": question},
        {"role": "assistant", "content": "<tool_call>\n"
         + json.dumps({"name": name, "arguments": args}) + "\n</tool_call>"},
        {"role": "tool", "content": "<tool_response>\n" + json.dumps(result, ensure_ascii=False)
         + "\n</tool_response>"},
        {"role": "assistant", "content": final},
    ]


def synth_toolcall_examples(n: int, rng: random.Random,
                            snapshots: dict[str, dict] | None = None) -> list[dict[str, Any]]:
    snapshots = snapshots or load_snapshots()
    names = sorted(snapshots)
    out = []
    for i in range(n):
        snap = names[i % len(names)]
        doc = tool_result(snapshots[snap])
        q, tool, args = TOOLCALL_QUESTIONS[i % len(TOOLCALL_QUESTIONS)]
        if tool == "get_entity_status":
            result = doc
        elif tool == "get_alerts":
            result = {"entity_id": doc.get("entity_id"), "alerts": doc["live"]["alerts"],
                      "total": len(doc["live"]["alerts"])}
        elif tool == "compare_to_normal":
            result = {**args, "available": False, "reason": "twin publishes no baseline yet"}
        else:
            result = {"available": False, "reason": f"{tool} not synthesised"}
        final = "I've looked; let me tell you only what came back."
        out.append({"kind": "toolcall", "archetype": rng.choice(ARCHETYPES[:1]),
                    "snapshot": snap,
                    "messages": hermes_toolcall_example(q, tool, args, result, final)})
    return out


def build(*, transcripts: list[dict[str, Any]], synthetic: list[dict[str, Any]],
          toolcalls: list[dict[str, Any]] | None = None, voice_quota: int = 300,
          min_toolcall_share: float = 0.25, fill: bool = True, seed: int = 0,
          snapshots: dict[str, dict] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rng = random.Random(seed)
    stats: dict[str, Any] = {"dropped_not_opted_in": 0, "voice_by_archetype": {},
                             "voice_capped": {}, "warnings": []}
    voice: dict[str, list[dict[str, Any]]] = defaultdict(list)
    tool_rows: list[dict[str, Any]] = list(toolcalls or [])
    for row in transcripts:
        if not opted_in(row):
            stats["dropped_not_opted_in"] += 1
            continue
        msgs = row.get("messages") or []
        rec = {"kind": "voice", "archetype": archetype_of(row), "messages": msgs,
               "source": "transcript"}
        (tool_rows if is_toolcall_example(msgs) else voice[rec["archetype"]]).append(rec)
    for row in synthetic:
        msgs = row.get("messages") or []
        rec = {"kind": "synthetic", "archetype": archetype_of(row), "messages": msgs,
               "source": "synth", "ground_truth": row.get("ground_truth")}
        (tool_rows if is_toolcall_example(msgs) else voice[rec["archetype"]]).append(rec)
    for r in tool_rows:
        r.setdefault("kind", "toolcall")
    kept: list[dict[str, Any]] = []
    for arch, rows in voice.items():
        rng.shuffle(rows)
        stats["voice_by_archetype"][arch] = len(rows)
        if len(rows) > voice_quota:
            stats["voice_capped"][arch] = len(rows) - voice_quota
            rows = rows[:voice_quota]
        if len(rows) < 200:
            stats["warnings"].append(f"archetype {arch!r} has {len(rows)} voice examples (< 200)")
        kept.extend(rows)
    # tool-call quota
    n_voice = len(kept)
    needed = 0
    if min_toolcall_share > 0:
        # share = t / (t + v) >= s  →  t >= s v / (1 - s)
        import math
        target = math.ceil(min_toolcall_share * n_voice / (1 - min_toolcall_share))
        needed = max(0, target - len(tool_rows))
    if needed and not fill:
        raise ValueError(f"tool-call share below {min_toolcall_share:.0%}: have {len(tool_rows)}, "
                         f"need {len(tool_rows) + needed}; pass --fill or add transcripts")
    if needed:
        tool_rows.extend(synth_toolcall_examples(needed, rng, snapshots))
        stats["toolcall_filled"] = needed
    dataset = kept + tool_rows
    rng.shuffle(dataset)
    total = len(dataset)
    stats.update({
        "total": total, "voice": n_voice, "toolcall": len(tool_rows),
        "toolcall_share": (len(tool_rows) / total) if total else 0.0,
        "kinds": dict(Counter(r["kind"] for r in dataset)),
    })
    return dataset, stats


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--transcripts", nargs="*", default=[], help="opted-in transcript JSONL (globs)")
    p.add_argument("--synthetic", nargs="*", default=[], help="synth.py output JSONL")
    p.add_argument("--toolcalls", nargs="*", default=[], help="extra Hermes tool-call JSONL")
    p.add_argument("--out", default="train.jsonl")
    p.add_argument("--voice-quota", type=int, default=300)
    p.add_argument("--min-toolcall-share", type=float, default=0.25)
    p.add_argument("--no-fill", action="store_true",
                   help="fail instead of synthesising tool-call examples to meet the share")
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args(argv)
    dataset, stats = build(transcripts=read_jsonl(args.transcripts),
                           synthetic=read_jsonl(args.synthetic),
                           toolcalls=read_jsonl(args.toolcalls), voice_quota=args.voice_quota,
                           min_toolcall_share=args.min_toolcall_share, fill=not args.no_fill,
                           seed=args.seed)
    with open(args.out, "w", encoding="utf-8") as fh:
        for r in dataset:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps(stats, indent=2))
    print(f"wrote {args.out} ({len(dataset)} examples)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
