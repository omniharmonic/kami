"""`python -m treasury_mcp --entity boulder-creek` / `treasury-mcp --entity …` — stdio transport."""

from __future__ import annotations

import argparse
import logging
import sys

from .client import MissingTokenError, Settings
from .server import build_server


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="treasury-mcp", description="Kami keyless treasury MCP (stdio)")
    p.add_argument("--entity", help="entity slug (default: $KAMI_ENTITY_SLUG)")
    p.add_argument("--log-level", default="INFO")
    args = p.parse_args(argv)
    # stdout is the MCP transport; logs go to stderr and never include the token
    logging.basicConfig(level=args.log_level, stream=sys.stderr, format="%(name)s %(levelname)s %(message)s")
    try:
        settings = Settings.from_env(entity=args.entity)
    except MissingTokenError as e:
        print(f"treasury-mcp: {e}", file=sys.stderr)
        return 2
    build_server(settings).run(transport="stdio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
