"""Synthesise reasoning transcripts from REAL twin snapshots with the ground truth attached
(plan T3.6; PRD §8.4). Offline only; a frontier endpoint is called ONLY when ``--endpoint`` and
``--api-key`` are given — the default is a dry run that prints the prompts. No network in tests.

    python -m finetune.synth --out synth.jsonl                       # dry run: prints prompts
    python -m finetune.synth --endpoint https://api.anthropic.com --api-key $KEY \\
        --provider anthropic --model claude-opus-5 --per-snapshot 20 --out synth.jsonl

Every generated transcript is run through ``factguard`` against its snapshot before it is kept:
a synthetic reply that utters an atom the snapshot cannot back is discarded and counted.
Curation by someone with hydrology literacy happens after this step (PRD §8.4).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from factguard import guard_text

from kami_evals.judge import call_anthropic, call_openai_compatible
from kami_evals.snapshots import (
    hard_rules,
    load_gazetteer,
    load_snapshots,
    sheet_for_snapshot,
    tool_result,
)

QUESTIONS = [
    "How is the creek today?", "Is the flow low for this time of year?", "Any snow left?",
    "How full is Gross Reservoir?", "Should I be worried about the drought?",
    "Is the air okay for a run along the path?", "When was your last reading?",
    "What can I do to help?", "Is the water safe for my dog?", "What are you, exactly?",
]

PROMPT = """You are writing ONE training example for a small model that speaks FOR a creek.
Below are the hard rules it must follow, a REAL sensor snapshot (its only knowledge for this
turn), and a visitor's question. Write the assistant's reply and a short reasoning trace.

Constraints on the reply:
- Every number, time, place name and species must appear in the snapshot's `facts.atoms`.
  Anything else is forbidden. If the answer is not there, the reply says exactly
  "I don't have a reading for that."
- A `stale: true` reading is given with its time and the words "the last reading I have".
- No percentile or "normal" claim (percentile_por is null): use the percentile refusal line.
- Plain, curious Front Range voice; speak for the creek, never as it; no urgency about money.

Answer with strict JSON: {{"reasoning": "...", "reply": "..."}}.

HARD RULES:
{rules}

SNAPSHOT (ground truth):
{snapshot}

QUESTION: {question}"""


def build_prompt(doc: dict[str, Any], question: str) -> str:
    return PROMPT.format(rules=hard_rules(), snapshot=json.dumps(tool_result(doc), indent=1,
                                                                ensure_ascii=False),
                         question=question)


def parse(text: str) -> dict[str, Any] | None:
    import re
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        doc = json.loads(m.group(0))
    except ValueError:
        return None
    return doc if isinstance(doc, dict) and "reply" in doc else None


def transcript(doc: dict[str, Any], question: str, reply: str, reasoning: str) -> dict[str, Any]:
    payload = tool_result(doc)
    return {
        "kind": "synthetic", "archetype": doc.get("archetype", "creek"),
        "snapshot_hash": doc.get("snapshot_hash"),
        "ground_truth": doc.get("facts"),
        "messages": [
            {"role": "system", "content": hard_rules()},
            {"role": "user", "content": question},
            {"role": "assistant", "content": "<tool_call>\n"
             + json.dumps({"name": "get_entity_status", "arguments": {}}) + "\n</tool_call>"},
            {"role": "tool", "content": "<tool_response>\n" + json.dumps(payload, ensure_ascii=False)
             + "\n</tool_response>"},
            {"role": "assistant", "reasoning_content": reasoning, "content": reply},
        ],
    }


def synthesise(*, per_snapshot: int = 3, provider: str = "openai", endpoint: str | None = None,
               api_key: str | None = None, model: str | None = None, dry_run: bool = True,
               snapshots: dict[str, dict] | None = None, client=None) -> dict[str, Any]:
    snapshots = snapshots or load_snapshots()
    gaz = load_gazetteer()
    prompts = []
    for name, doc in sorted(snapshots.items()):
        if not doc.get("needs"):
            continue  # nothing to teach from an unreachable twin except the fallback
        for q in QUESTIONS[:per_snapshot]:
            prompts.append((name, doc, q, build_prompt(doc, q)))
    if dry_run or not (endpoint and api_key):
        return {"dry_run": True, "n": len(prompts),
                "prompts": [{"snapshot": n, "question": q, "prompt": p} for n, _, q, p in prompts]}
    import httpx
    model = model or ("claude-opus-5" if provider == "anthropic" else "gpt-oss")
    client = client or httpx.Client(timeout=180)
    kept, rejected = [], []
    call = call_anthropic if provider == "anthropic" else call_openai_compatible
    for name, doc, q, prompt in prompts:
        raw = call(client, endpoint, api_key, model, prompt)
        out = parse(raw)
        if not out:
            rejected.append({"snapshot": name, "question": q, "why": "unparseable"})
            continue
        res = guard_text(out["reply"], sheet_for_snapshot(doc, q), q, gazetteer=gaz)
        if not res.ok:
            rejected.append({"snapshot": name, "question": q, "why": res.violations})
            continue
        kept.append(transcript(doc, q, out["reply"], out.get("reasoning", "")))
    return {"dry_run": False, "model": model, "kept": kept, "rejected": rejected,
            "n": len(prompts)}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--per-snapshot", type=int, default=3)
    p.add_argument("--provider", choices=["openai", "anthropic"], default="openai")
    p.add_argument("--endpoint", default=None)
    p.add_argument("--api-key", default=None)
    p.add_argument("--model", default=None)
    p.add_argument("--out", default="synth.jsonl")
    p.add_argument("--dry-run", action="store_true", default=None)
    args = p.parse_args(argv)
    dry = True if args.dry_run else not (args.endpoint and args.api_key)
    report = synthesise(per_snapshot=args.per_snapshot, provider=args.provider,
                        endpoint=args.endpoint, api_key=args.api_key, model=args.model,
                        dry_run=dry)
    if report["dry_run"]:
        print(f"synth: dry run — {report['n']} prompts built, none sent")
        print(report["prompts"][0]["prompt"][:1200] + "\n...")
        return 0
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.writelines(json.dumps(t, ensure_ascii=False) + "\n" for t in report["kept"])
    print(f"synth: kept {len(report['kept'])}, rejected {len(report['rejected'])} → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
