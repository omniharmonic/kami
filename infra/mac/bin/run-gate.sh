#!/usr/bin/env bash
# Loads the environment and execs the entity-gate. launchd runs this, not the gate itself,
# so that no secret is ever written into a plist (a plist is world-readable and shows up in
# `launchctl print`).
#
# Environment: KAMI_ENV_FILE (set by the plist; default ~/.kami/kami.env). The file is plain
# KEY=value lines, chmod 600, and is NOT in this repository.
set -euo pipefail

ENV_FILE="${KAMI_ENV_FILE:-$HOME/.kami/kami.env}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
else
  echo "run-gate: no env file at $ENV_FILE — starting with what launchd gave us" >&2
fi

GATE_CONFIG="${KAMI_GATE_YAML:-$REPO/apps/gate/gate.yaml}"
LISTEN="${KAMI_GATE_LISTEN:-127.0.0.1:8001}"

# Prefer the repo's uv environment; fall back to an entity-gate on PATH.
if command -v uv >/dev/null 2>&1 && [ -f "$REPO/pyproject.toml" ]; then
  cd "$REPO"
  echo "run-gate: uv run --package kami-gate entity-gate --config $GATE_CONFIG --listen $LISTEN"
  exec uv run --package kami-gate entity-gate --config "$GATE_CONFIG" --listen "$LISTEN"
elif command -v entity-gate >/dev/null 2>&1; then
  echo "run-gate: entity-gate --config $GATE_CONFIG --listen $LISTEN"
  exec entity-gate --config "$GATE_CONFIG" --listen "$LISTEN"
else
  echo "run-gate: neither uv nor entity-gate is on PATH ($PATH)" >&2
  exit 127
fi
