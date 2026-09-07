#!/usr/bin/env bash
# Loads the environment, waits for the gate, and execs the Hermes gateway.
#
# Why the wait: a profile's model.base_url is the gate (ADR-E04), so Hermes is useless until
# the gate answers. launchd has no ordering, so we do it here — up to 60 seconds, then fail closed
# and let KeepAlive retry.
set -euo pipefail

ENV_FILE="${KAMI_ENV_FILE:-$HOME/.kami/kami.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
else
  echo "run-hermes: no env file at $ENV_FILE — starting with what launchd gave us" >&2
fi

# Hermes runs one profile per foreground process. `gateway start` controls an
# already-installed service and must not be nested under this launchd service.
: "${KAMI_HERMES_PROFILE:?Set KAMI_HERMES_PROFILE to the dedicated being profile}"
case "$KAMI_HERMES_PROFILE" in
  *[!a-z0-9-]*|"") echo "Invalid KAMI_HERMES_PROFILE" >&2; exit 2 ;;
esac
: "${API_SERVER_KEY:?Set API_SERVER_KEY to a strong private gateway key}"
export API_SERVER_ENABLED=true
export API_SERVER_HOST=127.0.0.1
export API_SERVER_PORT="${API_SERVER_PORT:-8642}"

GATE_URL="${KAMI_GATE_URL:-http://127.0.0.1:8001}"
for _ in $(seq 1 30); do
  if curl -fsS -m 2 "$GATE_URL/healthz" >/dev/null 2>&1; then
    echo "run-hermes: gate is up at $GATE_URL"
    break
  fi
  sleep 2
done

# A missing gate must not leave an apparently ready agent service behind.
curl -fsS -m 2 "$GATE_URL/healthz" >/dev/null || {
  echo "run-hermes: gate unavailable; refusing to start" >&2
  exit 1
}
exec hermes --profile "$KAMI_HERMES_PROFILE" gateway run
