#!/usr/bin/env bash
# X.1 / CLAUDE.md / architecture §10.2 — no chain key anywhere in the tree, and above all none
# in profiles/, on the box, or under any public/ directory.
#
# What counts as a violation:
#   1. A key-shaped identifier (PRIVATE_KEY, MNEMONIC, SAFE_PROPOSER_KEY, SEED_PHRASE) that is
#      *assigned a value*. Naming one in prose or in another check's pattern is fine; giving it
#      a value is not.
#   2. A 32-byte hex string (0x + 64 hex) used as key material — on a line that also says
#      privateKey / privateKeyToAccount / mnemonic / --key-env.
#   3. Any 32-byte hex string at all under profiles/, infra/box/ or a public/ directory.
#   4. A 32-byte hex string outside test paths that is not obviously a hash constant.
#
# Allowed, and only these:
#   - .env.example: variable names, never values.
#   - A line (or the line above it) carrying the marker `kami:ephemeral-test-key`, or a file
#     whose first ten lines carry `kami:ephemeral-test-file`.
#   - Inside a test path, one of Anvil's published default keys (public, funded on nobody's
#     network) — reported as a NOTE every run so it never becomes invisible.
#   - Inside a test path, a 32-byte hex constant that is not used as key material: EAS schema
#     UIDs, EIP-712 type hashes and attestation UIDs are hashes, not secrets — also NOTEd.
#
# Exit 0 = clean, 1 = a violation, 2 = the check could not run.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

SELF="$(basename "${BASH_SOURCE[0]}")"

# Anvil / Hardhat published defaults from the "test test … junk" mnemonic. These are the only
# key values that may appear, and only inside a test path.
PUBLIC_TEST_KEYS='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'

EXCLUDES=(
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=dist
  --exclude-dir=.venv --exclude-dir=__pycache__ --exclude-dir=.pytest_cache --exclude-dir=.ruff_cache
  --exclude-dir=coverage --exclude-dir=state --exclude-dir=test-results --exclude-dir=playwright-report
  --exclude-dir=.turbo --exclude-dir=.wrangler --exclude-dir=.vercel
  --exclude=pnpm-lock.yaml --exclude=uv.lock --exclude=".env.example"
  --exclude="$SELF" --exclude=test_no_chain_keys.sh --exclude=no-public-secrets.sh
)

FAIL=0
NOTES=""
VIOLATIONS=""

is_test_path() {
  case "$1" in
    */test/*|*/tests/*|*/__tests__/*|*.test.ts|*.test.tsx|*.spec.ts|test_*.py|*_test.py|*/fixtures/*|*/e2e/*) return 0 ;;
    *) return 1 ;;
  esac
}

marked() { # file lineno text
  local file="$1" lineno="$2" text="$3" prev
  printf '%s' "$text" | grep -q 'kami:ephemeral-test-key' && return 0
  if [ "$lineno" -gt 1 ] 2>/dev/null; then
    prev=$(sed -n "$((lineno - 1))p" "$file" 2>/dev/null)
    printf '%s' "$prev" | grep -q 'kami:ephemeral-test-key' && return 0
  fi
  head -n 10 "$file" 2>/dev/null | grep -q 'kami:ephemeral-test-file' && return 0
  return 1
}

violation() { VIOLATIONS="${VIOLATIONS}  $1"$'\n'; FAIL=1; }
note() { NOTES="${NOTES}  $1"$'\n'; }

# --- 1. key-shaped identifiers with a value -------------------------------------------------
N1='PRIVATE_'; N2='KEY'; N3='MNEMONIC'; N4='SAFE_PROPOSER_'; N5='SEED_PHRASE'
NAME_RE="(${N1}${N2}|${N3}|${N4}${N2}|${N5})[\"']?[[:space:]]*[:=][[:space:]]*[\"'][^\"']+[\"']"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  file="${line%%:*}"; rest="${line#*:}"; lineno="${rest%%:*}"; text="${rest#*:}"
  marked "$file" "$lineno" "$text" && continue
  # `PRIVATE_KEY: z.string().optional()` and friends are schema declarations, not values.
  printf '%s' "$text" | grep -qE '(z\.|process\.env|os\.environ|getenv|Field\(|: *(string|str)\b)' && continue
  violation "$file:$lineno: $(printf '%s' "$text" | sed 's/^[[:space:]]*//' | cut -c1-120)"
done <<< "$(grep -rInE "$NAME_RE" . "${EXCLUDES[@]}" 2>/dev/null)"

# --- 2, 3, 4. 32-byte hex strings -----------------------------------------------------------
while IFS= read -r line; do
  [ -n "$line" ] || continue
  file="${line%%:*}"; rest="${line#*:}"; lineno="${rest%%:*}"; text="${rest#*:}"
  short="$(printf '%s' "$text" | sed 's/^[[:space:]]*//' | cut -c1-120)"

  marked "$file" "$lineno" "$text" && continue
  printf '%s' "$text" | grep -qE '0x0{64}' && continue                       # the zero hash

  case "$file" in
    ./profiles/*|./infra/box/*|*/public/*)
      violation "$file:$lineno: 32-byte hex on the box / in a profile / under public/: $short"
      continue ;;
  esac

  used_as_key=0
  printf '%s' "$text" | grep -qiE '(privatekey|private_key|privateKeyToAccount|mnemonic|--key-env|signer *= *[\"'"'"']0x)' && used_as_key=1

  hex="$(printf '%s' "$text" | grep -oE '0x[0-9a-fA-F]{64}' | head -1)"
  known=0
  printf '%s\n' "$PUBLIC_TEST_KEYS" | grep -qix -- "$hex" && known=1

  if is_test_path "$file"; then
    if [ "$known" -eq 1 ]; then
      note "$file:$lineno: Anvil published test key (public, unfunded) — add 'kami:ephemeral-test-key' to make it explicit"
    elif [ "$used_as_key" -eq 1 ]; then
      violation "$file:$lineno: an undeclared key in a test: $short"
    else
      note "$file:$lineno: 32-byte hex constant in a test (schema UID / type hash, not a key)"
    fi
  else
    if [ "$used_as_key" -eq 1 ]; then
      violation "$file:$lineno: key material outside a test path: $short"
    else
      note "$file:$lineno: 32-byte hex constant outside a test path — confirm it is a hash, not a key"
    fi
  fi
done <<< "$(grep -rInE '0x[0-9a-fA-F]{64}' . "${EXCLUDES[@]}" 2>/dev/null)"

if [ -n "$NOTES" ]; then
  echo "NOTE (allowed, listed so it stays visible):"
  printf '%s' "$NOTES"
fi

if [ "$FAIL" -ne 0 ]; then
  echo "FAIL: chain-key-shaped material in the tree:" >&2
  printf '%s' "$VIOLATIONS" >&2
  exit 1
fi

echo "OK: no chain key outside .env.example and declared-ephemeral test material"
exit 0
