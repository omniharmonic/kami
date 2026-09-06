"""``python -m factguard check --sheet sheet.json --text "..."``"""

from __future__ import annotations

import argparse
import json
import sys

from .atoms import FactSheet
from .gazetteer import Gazetteer
from .guard import guard_text


def _load_sheet(path: str) -> tuple[FactSheet, str]:
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    last_user = ""
    if isinstance(doc, dict) and isinstance(doc.get("messages"), list):
        msgs = doc["messages"]
        for m in msgs:
            if m.get("role") == "user":
                last_user = m.get("content") if isinstance(m.get("content"), str) else last_user
        return FactSheet.from_tool_messages(msgs), last_user
    if isinstance(doc, list) and doc and isinstance(doc[0], dict) and "role" in doc[0]:
        for m in doc:
            if m.get("role") == "user":
                last_user = m.get("content") if isinstance(m.get("content"), str) else last_user
        return FactSheet.from_tool_messages(doc), last_user
    sheet = FactSheet()
    sheet.ingest(doc)
    return sheet, last_user


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="factguard")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="guard a text against a fact sheet")
    c.add_argument("--sheet", required=True,
                   help="facts-1.0 JSON, a raw tool result, or an OpenAI request with messages")
    c.add_argument("--text", required=True)
    c.add_argument("--user", default=None, help="last user message (for echo)")
    c.add_argument("--gazetteer", default=None, help="gazetteer JSON")
    c.add_argument("--tz", default="America/Denver")
    args = p.parse_args(argv)

    sheet, last_user = _load_sheet(args.sheet)
    if args.user is not None:
        last_user = args.user
    gaz = Gazetteer.from_file(args.gazetteer) if args.gazetteer else None
    res = guard_text(args.text, sheet, last_user, tz=args.tz, gazetteer=gaz)
    json.dump(res.to_dict(), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if res.ok else 1


if __name__ == "__main__":
    sys.exit(main())
