#!/usr/bin/env python3
"""Start the local beings Hermes chat after MCP discovery has completed.

Run with the installed Hermes virtualenv's Python. Credentials are supplied by
the private beings-agent launcher, never read from this repository.
"""
import os
from pathlib import Path
import sys


def main() -> None:
    source = Path(os.environ.get("HERMES_SOURCE", Path.home() / ".hermes/hermes-agent"))
    if not (source / "hermes_cli/main.py").is_file():
        raise SystemExit("Set HERMES_SOURCE to the installed Hermes checkout.")
    sys.path.insert(0, str(source))
    sys.argv[0] = "hermes"

    # This import applies --profile and loads the selected profile before any
    # tool module snapshots configuration. Stock CLI discovery is backgrounded
    # with a short join, which can leave the first model turn without tools.
    from hermes_cli.main import main as hermes_main
    from tools.mcp_tool import discover_mcp_tools

    tools = discover_mcp_tools()
    required = ("list_datasets", "get_entity_config")
    missing = [name for name in required if not any(tool.endswith("_" + name) for tool in tools)]
    if missing:
        raise SystemExit("Agent not started: MCP discovery missing " + ", ".join(missing))
    hermes_main()


if __name__ == "__main__":
    main()
