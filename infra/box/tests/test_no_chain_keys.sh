#!/usr/bin/env bash
# X.1 — no chain key, ever, in a profile directory or on the GPU box (CLAUDE.md invariants; architecture §10.2).
# Greps profiles/ and infra/box/ for anything that looks like one and fails if found. Excludes this file and
# generated/vendored dirs. The pattern is assembled from parts so the script does not match itself.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
P1='PRIVATE_'; P2='KEY'; P3='MNEMONIC'; P4='SAFE_PROPOSER_'
PATTERN="(${P1}${P2}|${P3}|${P4}${P2}|0x[0-9a-fA-F]{64})"

set +e
HITS=$(grep -rInE "$PATTERN" "$ROOT/profiles" "$ROOT/infra/box" \
  --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=__pycache__ --exclude-dir=.pytest_cache \
  --exclude-dir=dist --exclude-dir=state --exclude-dir=coverage \
  --exclude=test_no_chain_keys.sh 2>/dev/null)
RC=$?
set -e
if [ "$RC" -eq 0 ] && [ -n "$HITS" ]; then
  echo "FAIL: something that looks like a chain key is in profiles/ or infra/box/:" >&2
  echo "$HITS" >&2
  exit 1
fi
echo "OK: no chain-key-shaped strings in profiles/ or infra/box/"
