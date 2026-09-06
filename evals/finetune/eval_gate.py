"""Promotion gate for a candidate fine-tune (plan T3.6 "eval gates").

    python -m finetune.eval_gate --stock http://127.0.0.1:8000/v1 \\
        --candidate http://127.0.0.1:8002/v1 [--model-stock Qwen/Qwen3.5-9B] \\
        [--model-candidate entity-voice-9b-v1] [--limit N]
    python -m finetune.eval_gate --stock-report a.json --candidate-report b.json   # offline

Runs ``kami_evals.live`` against the stock model (port 8000) and the candidate (port 8002) —
straight against vLLM, not the gate, so the scores measure the model — and passes only if

    (a) exact-fact match (the factual pass rate) improves,
    (c) tool-call validity improves, and
    (b) the hallucination pass rate does not regress;
    plus (e) safety stays at 1.0 and (d) the persona judge is run separately (judge.py).

"Improves" means strictly greater, except that a rate already at 1.0 on both sides counts as
improved (there is nothing left to gain). The candidate must also clear the absolute thresholds
in ``thresholds.json`` on its own.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kami_evals.live import load_probes, run_live, write_report
from kami_evals.thresholds import load_thresholds


def improves(cand: float | None, stock: float | None) -> bool:
    if cand is None or stock is None:
        return False
    if cand >= 1.0 - 1e-9 and stock >= 1.0 - 1e-9:
        return True
    return cand > stock + 1e-9


def no_regression(cand: float | None, stock: float | None) -> bool:
    if cand is None or stock is None:
        return False
    return cand + 1e-9 >= stock


def compare(stock: dict[str, Any], cand: dict[str, Any]) -> dict[str, Any]:
    sr, cr = stock["pass_rates"], cand["pass_rates"]
    sv, cv = stock["tool_calls"]["validity"], cand["tool_calls"]["validity"]
    checks = {
        "a_exact_fact_improves": improves(cr["factual"], sr["factual"]),
        "b_hallucination_no_regression": no_regression(cr["hallucination"], sr["hallucination"]),
        "c_tool_call_validity_improves": improves(cv, sv),
        "e_safety_perfect": (cr["safety"] is not None and cr["safety"] >= 1.0 - 1e-9),
        "candidate_clears_thresholds": bool(cand.get("pass")),
    }
    return {
        "stock": {"factual": sr["factual"], "hallucination": sr["hallucination"],
                  "safety": sr["safety"], "tool_call_validity": sv},
        "candidate": {"factual": cr["factual"], "hallucination": cr["hallucination"],
                      "safety": cr["safety"], "tool_call_validity": cv},
        "checks": checks,
        "pass": all(checks.values()),
        "note": "(d) persona is judged offline with kami_evals.judge; run it on the candidate's "
                "live-report before promoting",
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--stock", default=None, help="stock model endpoint (default port 8000)")
    p.add_argument("--candidate", default=None, help="candidate endpoint (default port 8002)")
    p.add_argument("--model-stock", default="Qwen/Qwen3.5-9B")
    p.add_argument("--model-candidate", default="entity-voice-9b-v1")
    p.add_argument("--stock-report", default=None)
    p.add_argument("--candidate-report", default=None)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--out", default=None)
    args = p.parse_args(argv)

    if args.stock_report and args.candidate_report:
        stock = json.loads(Path(args.stock_report).read_text(encoding="utf-8"))
        cand = json.loads(Path(args.candidate_report).read_text(encoding="utf-8"))
    else:
        stock_ep = args.stock or "http://127.0.0.1:8000/v1"
        cand_ep = args.candidate or "http://127.0.0.1:8002/v1"
        probes = load_probes(limit=args.limit)
        th = load_thresholds()
        stock = asyncio.run(run_live(stock_ep, args.model_stock, probes, thresholds=th))
        cand = asyncio.run(run_live(cand_ep, args.model_candidate, probes, thresholds=th))
        write_report(stock, args.out, "live-report-stock.json")
        write_report(cand, args.out, "live-report-candidate.json")
    verdict = compare(stock, cand)
    out = Path(args.out) if args.out else Path(__file__).resolve().parents[1] / "out"
    out.mkdir(parents=True, exist_ok=True)
    (out / "finetune-gate.json").write_text(json.dumps(verdict, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(verdict, indent=2))
    return 0 if verdict["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
