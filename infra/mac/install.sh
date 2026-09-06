#!/usr/bin/env bash
# install.sh — put the two launchd agents in place and start them, and say what it did.
#
#   bash infra/mac/install.sh                 # install and start both
#   bash infra/mac/install.sh --only gate     # one of them
#   bash infra/mac/install.sh --dry-run       # print the plan, touch nothing
#
# What it changes, and nothing else:
#   ~/Library/LaunchAgents/com.kami.{gate,hermes}.plist   (copied from this directory,
#                                                          __KAMI_REPO__/__KAMI_HOME__ filled in)
#   ~/Library/Logs/kami/                                   (created)
#   ~/.kami/kami.env                                       (created from kami.env.example if absent,
#                                                           chmod 600, never overwritten)
#
# It does not install Python, uv, Hermes or cloudflared, and it never writes a secret.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/kami"
ENV_DIR="$HOME/.kami"
ENV_FILE="$ENV_DIR/kami.env"
DRY_RUN=0
WHICH="both"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --only) shift; WHICH="${1:-both}" ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "install.sh is for macOS (launchd). On Linux the box runbook applies: infra/box/README.md" >&2
  exit 2
fi

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then say "would: $*"; else eval "$@"; fi; }

say "kami · installing launchd agents from $HERE"
say "  repo      $REPO"
say "  agents    $AGENTS"
say "  logs      $LOGS"
say "  env file  $ENV_FILE (read at start by bin/run-*.sh; never baked into a plist)"
say ""

run "mkdir -p '$AGENTS' '$LOGS' '$ENV_DIR'"
run "chmod 700 '$ENV_DIR'"

if [ ! -f "$ENV_FILE" ]; then
  run "cp '$HERE/kami.env.example' '$ENV_FILE'"
  run "chmod 600 '$ENV_FILE'"
  say "created $ENV_FILE from kami.env.example — fill in the keys before this will work."
else
  say "kept  $ENV_FILE (already there; nothing was overwritten)"
fi

install_agent() {
  local label="$1"
  local src="$HERE/$label.plist"
  local dst="$AGENTS/$label.plist"
  [ -f "$src" ] || { echo "missing $src" >&2; exit 1; }

  if [ "$DRY_RUN" = 1 ]; then
    say "would: write $dst (with __KAMI_REPO__=$REPO, __KAMI_HOME__=$HOME)"
  else
    sed -e "s|__KAMI_REPO__|$REPO|g" -e "s|__KAMI_HOME__|$HOME|g" "$src" > "$dst"
    if command -v plutil >/dev/null 2>&1; then
      plutil -lint "$dst" >/dev/null || { echo "plutil says $dst is not a valid plist" >&2; exit 1; }
    fi
    say "wrote $dst"
  fi

  local domain="gui/$(id -u)"
  # bootout first so a re-run is an upgrade, not an error. `|| true`: not being loaded is fine.
  run "launchctl bootout '$domain/$label' >/dev/null 2>&1 || true"
  run "launchctl bootstrap '$domain' '$dst'"
  run "launchctl enable '$domain/$label'"
  run "launchctl kickstart -k '$domain/$label'"
  say "loaded and started $label  (logs: $LOGS/${label#com.kami.}.err.log)"
}

case "$WHICH" in
  gate)   install_agent com.kami.gate ;;
  hermes) install_agent com.kami.hermes ;;
  both)   install_agent com.kami.gate; install_agent com.kami.hermes ;;
  *) echo "--only takes gate, hermes or both" >&2; exit 2 ;;
esac

say ""
say "done. What just happened:"
say "  · the gate runs as com.kami.gate and restarts if it crashes (KeepAlive)"
say "  · Hermes runs as com.kami.hermes and waits for the gate's /healthz before starting"
say "  · both read $ENV_FILE at start; edit it and re-run:"
say "      launchctl kickstart -k gui/\$(id -u)/com.kami.gate"
say "  · neither starts before you log in. A Mac mini that must survive a reboot unattended"
say "    needs automatic login (System Settings → Users & Groups) — see power.md"
say ""
say "check it: bash $REPO/scripts/kami-doctor --only gate,hermes"
