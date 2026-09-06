#!/usr/bin/env bash
# Loads the environment, waits for the gate, and execs the Hermes gateway.
#
# Why the wait: a profile's model.base_url is the gate (ADR-E04), so Hermes is useless until
# the gate answers. launchd has no ordering, so we do it here — up to 60 seconds, then start
# anyway and let KeepAlive sort it out.
set -euo pipefail

ENV_FILE="${KAMI_ENV_FILE:-$HOME/.kami/kami.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
else
  echo "run-hermes: no env file at $ENV_FILE — starting with what launchd gave us" >&2
fi

GATE_URL="${KAMI_GATE_URL:-http://127.0.0.1:8001}"
for _ in $(seq 1 30); do
  if curl -fsS -m 2 "$GATE_URL/healthz" >/dev/null 2>&1; then
    echo "run-hermes: gate is up at $GATE_URL"
    break
  fi
  sleep 2
done

# verify (docs/verify.md #25): the exact command that starts the gateway on a native install.
# `hermes gateway start` is the name this repo assumes; check `hermes --help` on the real
# build and change HERMES_START_CMD in the env file rather than editing this script.
CMD="${HERMES_START_CMD:-hermes gateway start}"
echo "run-hermes: $CMD"
# shellcheck disable=SC2086
exec $CMD
