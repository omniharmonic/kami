"""``kami-evals replay|live|judge|audit`` — one entry point over the four runners."""

from __future__ import annotations

import sys

COMMANDS = ("replay", "live", "judge", "audit")
USAGE = (
    "usage: kami-evals <command> [options]\n\n"
    "commands:\n"
    "  replay   CI gate: recorded replies through the guard (python -m kami_evals.replay --ci)\n"
    "  live     nightly runner against the gate on the box (--endpoint ... --model ...)\n"
    "  judge    offline persona judge (dry-run by default; never on the hot path)\n"
    "  audit    weekly 50-reply re-guard of released replies (--input ...)\n"
)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(USAGE)
        return 0 if argv else 2
    cmd, rest = argv[0], argv[1:]
    if cmd == "replay":
        from .replay import main as run
    elif cmd == "live":
        from .live import main as run
    elif cmd == "judge":
        from .judge import main as run
    elif cmd == "audit":
        from .audit import main as run
    else:
        print(f"kami-evals: unknown command {cmd!r}\n\n{USAGE}", file=sys.stderr)
        return 2
    return run(rest)


if __name__ == "__main__":
    sys.exit(main())
