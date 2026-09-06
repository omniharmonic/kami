#!/usr/bin/env bash
# X.1 — the security hardening checks, run before each phase gate and in CI.
#
#   bash scripts/security-check.sh              run everything
#   bash scripts/security-check.sh --list       list the checks and exit
#   bash scripts/security-check.sh no-chain-keys  run one by name
#
# Each check is a standalone script under scripts/checks/ and can be run on its own; each exits
# non-zero on a violation. This runner runs them all, never stops at the first failure, and exits
# non-zero if any of them failed. Exit 2 from a check means "could not run" and is reported as a
# failure too — a check that cannot run has not passed.
#
# The one report-only member is `verify-markers`: it never edits docs/verify.md and never fails a
# build; run it with --strict yourself if you want it as a gate.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKS="$ROOT/scripts/checks"

# name | how to run | what it enforces
run_check() {
  case "$1" in
    no-public-secrets)    bash "$CHECKS/no-public-secrets.sh" ;;
    no-chain-keys)        bash "$CHECKS/no-chain-keys.sh" ;;
    no-tracked-env)       bash "$CHECKS/no-tracked-env.sh" ;;
    treasury-mcp-keyless) node "$CHECKS/treasury-mcp-keyless.mjs" ;;
    profiles-no-chain-keys) bash "$ROOT/infra/box/tests/test_no_chain_keys.sh" ;;
    verify-markers)       node "$CHECKS/verify-markers.mjs" ;;
    *) echo "unknown check: $1" >&2; return 2 ;;
  esac
}

ALL="no-public-secrets no-chain-keys no-tracked-env treasury-mcp-keyless profiles-no-chain-keys verify-markers"

describe() {
  case "$1" in
    no-public-secrets)      echo "no secret in a NEXT_PUBLIC_* variable or under any public/ dir (§10.2)" ;;
    no-chain-keys)          echo "no chain-key-shaped string outside .env.example and declared-ephemeral fixtures (X.1)" ;;
    no-tracked-env)         echo "no .env file tracked or staged by git (X.1)" ;;
    treasury-mcp-keyless)   echo "the treasury MCP declares no signing dependency and has three tools (ADR-E05)" ;;
    profiles-no-chain-keys) echo "no chain key in profiles/ or on the box — infra/box/tests/test_no_chain_keys.sh, reused not copied" ;;
    verify-markers)         echo "every docs/planning *verify* marker has a docs/verify.md row (REPORT ONLY, never fails)" ;;
  esac
}

if [ "${1:-}" = "--list" ]; then
  for c in $ALL; do printf '%-24s %s\n' "$c" "$(describe "$c")"; done
  exit 0
fi

SELECTED="${*:-$ALL}"
FAILED=""
REPORT_ONLY="verify-markers"

for check in $SELECTED; do
  echo ""
  echo "── $check ──────────────────────────────────────────────"
  echo "   $(describe "$check")"
  run_check "$check"
  rc=$?
  case " $REPORT_ONLY " in
    *" $check "*) [ "$rc" -ne 0 ] && echo "   (report-only; not counted as a failure)" ;;
    *) [ "$rc" -ne 0 ] && FAILED="$FAILED $check" ;;
  esac
done

echo ""
echo "════════════════════════════════════════════════════════"
if [ -n "$FAILED" ]; then
  echo "SECURITY CHECK FAILED:$FAILED" >&2
  exit 1
fi
echo "SECURITY CHECK PASSED — every gate green (verify-markers is report-only; read its list)"
exit 0
