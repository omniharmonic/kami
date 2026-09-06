"""``python -m entity_gate --config gate.yaml --upstream http://127.0.0.1:8000 --listen 127.0.0.1:8001``"""

from __future__ import annotations

import argparse
import sys

import uvicorn

from .app import create_app
from .config import assert_safe_for_environment, load_config


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="entity-gate")
    p.add_argument("--config", default=None, help="gate.yaml")
    p.add_argument("--upstream", default=None, help="vLLM base URL, e.g. http://127.0.0.1:8000")
    p.add_argument("--listen", default=None, help="host:port, e.g. 127.0.0.1:8001")
    p.add_argument("--passthrough", action="store_true", default=None,
                   help="skip the guard (UI dev); never skips pause")
    p.add_argument("--events-dir", default=None)
    args = p.parse_args(argv)
    config = load_config(args.config, upstream_url=args.upstream, listen=args.listen,
                         passthrough=args.passthrough, events_dir=args.events_dir)
    assert_safe_for_environment(config)
    app = create_app(config)
    uvicorn.run(app, host=config.listen_host, port=config.listen_port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
