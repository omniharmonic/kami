#!/usr/bin/env bash
# uninstall.sh — stop and remove the launchd agents, and say exactly what it left behind.
#
#   bash infra/mac/uninstall.sh                # stop and remove both agents
#   bash infra/mac/uninstall.sh --only hermes
#   bash infra/mac/uninstall.sh --purge-logs   # also delete ~/Library/Logs/kami
#
# It never deletes ~/.kami/kami.env (your keys), ~/.hermes (your profiles and their memory),
# or anything in the repo. Removing the agents stops the voice; it does not delete the entity.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/kami"
WHICH="both"
PURGE_LOGS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --only) shift; WHICH="${1:-both}" ;;
    --purge-logs) PURGE_LOGS=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "uninstall.sh is for macOS (launchd)." >&2
  exit 2
fi

remove_agent() {
  local label="$1"
  local dst="$AGENTS/$label.plist"
  local domain="gui/$(id -u)"
  if launchctl print "$domain/$label" >/dev/null 2>&1; then
    launchctl bootout "$domain/$label" || true
    echo "stopped and unloaded $label"
  else
    echo "not running: $label"
  fi
  if [ -f "$dst" ]; then
    rm -f "$dst"
    echo "removed $dst"
  else
    echo "no plist at $dst"
  fi
}

case "$WHICH" in
  gate)   remove_agent com.kami.gate ;;
  hermes) remove_agent com.kami.hermes ;;
  both)   remove_agent com.kami.hermes; remove_agent com.kami.gate ;;
  *) echo "--only takes gate, hermes or both" >&2; exit 2 ;;
esac

if [ "$PURGE_LOGS" = 1 ] && [ -d "$LOGS" ]; then
  rm -rf "$LOGS"
  echo "deleted $LOGS"
fi

echo ""
echo "left alone on purpose:"
echo "  · ~/.kami/kami.env       — your keys"
echo "  · ~/.hermes/             — profiles, cron state and the agent's memory"
[ "$PURGE_LOGS" = 1 ] || echo "  · $LOGS  — the logs (--purge-logs deletes them)"
echo "  · the cloudflared tunnel, if you installed one (cloudflared service uninstall)"
echo ""
echo "The site does not need this Mac: pages keep rendering from status.json and chat says"
echo "\"I'm asleep — my thinking machine is off\". You stopped the voice, not the service."
