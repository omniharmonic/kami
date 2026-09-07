"""`kami doctor` — one command that checks the whole chain, in dependency order.

Run it through the wrapper: `bash scripts/kami-doctor` (add `--json` for a
machine, `--only gate` for one link). The wrapper picks an interpreter; this
module does the work.

The order is the dependency order — upstream, gate, twin, platform, hermes,
tunnel, storage — because a failure early makes the later answers meaningless,
and a tool that keeps answering after it has started guessing is worse than no
tool. When a check cannot run, it says `skipped (not configured)` and names
what is missing. Exit code 1 if anything failed, 0 otherwise.
"""

from __future__ import annotations

import argparse
import sys
import time
import traceback
from typing import Dict, List, Tuple

import report
from context import build_context
from report import CheckResult, Report, fail, now_iso

CHECKS: List[Tuple[str, str, str]] = [
    ("agent", "checks.agent", "read-only agent onboarding: token, binding, needs and public twin observations"),
    ("upstream", "checks.upstream", "the model API: reachable, tool calls, streaming, usage"),
    ("gate", "checks.gate", "the gate: running, guard on, provenance, budgets, and a live guard drop"),
    ("twin", "checks.twin", "the twin: tree reachable, anchor present, latest reading and its age"),
    ("platform", "checks.platform", "the web app: entity token, gate secret, status.json age"),
    ("hermes", "checks.hermes", "the agent runtime: gateway, profile, cron doctor, five jobs"),
    ("tunnel", "checks.tunnel", "is the gateway reachable from outside this Mac, not just from it"),
    ("storage", "checks.storage", "Neon and R2 (or the local data dir), written and read back"),
]

VALID = [c[0] for c in CHECKS]


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="kami doctor",
        description="Check the whole chain, in dependency order, and say exactly what is wrong.",
        epilog="checks: " + ", ".join(VALID),
    )
    parser.add_argument("--slug", default="boulder-creek", help="entity slug (default boulder-creek)")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--only", action="append", default=[], metavar="CHECK", help="run only these (repeatable, comma-separated)")
    parser.add_argument("--skip", action="append", default=[], metavar="CHECK", help="skip these (repeatable, comma-separated)")
    parser.add_argument("--timeout", type=float, default=20.0, help="per-request timeout in seconds (default 20)")
    parser.add_argument("--no-color", action="store_true", help="plain text, no ANSI")
    parser.add_argument("--list", action="store_true", help="list the checks and exit")
    parser.add_argument("--self-test", action="store_true", help="prove the redactor: run with a fake secret and assert it never appears")
    return parser.parse_args(argv)


def _split(values: List[str]) -> List[str]:
    out: List[str] = []
    for value in values:
        out.extend(part.strip() for part in value.split(",") if part.strip())
    return out


def selected(args: argparse.Namespace) -> Tuple[List[str], List[str]]:
    only = _split(args.only)
    skip = _split(args.skip)
    unknown = [name for name in only + skip if name not in VALID]
    chosen = [name for name in VALID if (not only or name in only) and name not in skip]
    return chosen, unknown


def run_checks(slug: str, chosen: List[str], timeout: float) -> Report:
    ctx = build_context(slug=slug, timeout=timeout)
    rep = Report(slug=slug, started_at=now_iso())
    started = time.time()
    if ctx.env_files_read:
        rep.notes.append("config read from the environment and " + ", ".join(ctx.env_files_read))
    else:
        rep.notes.append("config read from the environment only (no .env file found)")
    if ctx.gate_yaml_path:
        rep.notes.append(f"gate config: {ctx.gate_yaml_path}")
    rep.notes.extend(ctx.notes)

    prior: Dict[str, CheckResult] = {}
    for check_id, module_name, _ in CHECKS:
        if check_id not in chosen:
            continue
        module = __import__(module_name, fromlist=["run"])
        began = time.time()
        try:
            result = module.run(ctx, prior)
        except Exception:  # a crashing check is a finding about the check, not a silent gap
            tail = traceback.format_exc().strip().splitlines()[-3:]
            result = CheckResult(id=check_id, title=f"{check_id} (this check crashed)")
            result.steps.append(
                fail(
                    f"{check_id}.internal",
                    "the check itself raised: " + " | ".join(line.strip() for line in tail),
                    fix="please report this — the other checks below still ran",
                    doc="scripts/doctor/README.md",
                )
            )
        result.duration_s = time.time() - began
        prior[check_id] = result
        rep.checks.append(result)

    rep.duration_s = time.time() - started
    # The renderer redacts, but bind the redactor to this run's secrets here.
    rep.notes.append(f"{len(ctx.secrets.known())} secret values are masked in this output")
    return _attach_redactor(rep, ctx)


def _attach_redactor(rep: Report, ctx) -> Report:
    rep.redact = ctx.secrets.redact  # type: ignore[attr-defined]
    return rep


def main(argv: List[str]) -> int:
    args = parse_args(argv)

    if args.list:
        for check_id, _, description in CHECKS:
            print(f"{check_id:9} {description}")
        return 0

    if args.self_test:
        import selftest

        return selftest.main()

    chosen, unknown = selected(args)
    if unknown:
        print(f"unknown check(s): {', '.join(unknown)}; valid: {', '.join(VALID)}", file=sys.stderr)
        return 2
    if not chosen:
        print("nothing selected — --only and --skip cancelled each other out", file=sys.stderr)
        return 2

    rep = run_checks(args.slug, chosen, args.timeout)
    redact = getattr(rep, "redact", lambda s: s)
    if args.json:
        print(report.render_json(rep, redact))
    else:
        color = sys.stdout.isatty() and not args.no_color
        print(report.render_text(rep, redact, color=color))
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
