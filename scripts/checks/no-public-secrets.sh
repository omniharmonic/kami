#!/usr/bin/env bash
# X.1 / architecture §10.2 — "No secret is ever in a NEXT_PUBLIC_* variable, a commons note,
# a status file, or a profile directory."
#
# Two rules, both fail-closed:
#   1. No NEXT_PUBLIC_* variable anywhere whose name looks like a secret, and no
#      NEXT_PUBLIC_* assignment whose *value* looks like a credential.
#   2. Nothing under any app's public/ directory that looks like a credential.
#
# Exit 0 = clean, 1 = a violation, 2 = the check could not run.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

FAIL=0
note() { printf '  %s\n' "$*" >&2; }

EXCLUDES=(
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=dist
  --exclude-dir=.venv --exclude-dir=__pycache__ --exclude-dir=.pytest_cache --exclude-dir=.ruff_cache
  --exclude-dir=coverage --exclude-dir=state --exclude-dir=test-results --exclude-dir=playwright-report
  --exclude-dir=.turbo --exclude-dir=.wrangler --exclude-dir=.vercel
)

# 1a. A NEXT_PUBLIC_* name that itself claims to hold a secret.
#     Assembled from parts so this file is not its own first hit.
S1='SECRET'; S2='PASSWORD'; S3='PRIVATE'; S4='TOKEN'; S5='API_KEY'; S6='MNEMONIC'; S7='CREDENTIAL'
NAME_RE="NEXT_PUBLIC_[A-Z0-9_]*(${S1}|${S2}|${S3}|${S4}|${S5}|${S6}|${S7})"
HITS=$(grep -rInE "$NAME_RE" . "${EXCLUDES[@]}" --exclude="$(basename "${BASH_SOURCE[0]}")" 2>/dev/null)
if [ -n "$HITS" ]; then
  echo "FAIL: a NEXT_PUBLIC_* variable is named like a secret:" >&2
  note "$HITS"
  FAIL=1
fi

# 1b. A NEXT_PUBLIC_* assignment whose value looks like a real credential
#     (a long opaque string, a known key prefix, or a URL with a password in it).
VALUE_RE='NEXT_PUBLIC_[A-Z0-9_]+[[:space:]]*[:=][[:space:]]*["'"'"']?(sk_|rk_|pk_live|whsec_|re_[A-Za-z0-9]{16}|xox[baprs]-|ghp_|gho_|github_pat_|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}|0x[0-9a-fA-F]{64}|postgres(ql)?://[^:]+:[^@]+@)'
HITS=$(grep -rInE "$VALUE_RE" . "${EXCLUDES[@]}" --exclude="$(basename "${BASH_SOURCE[0]}")" 2>/dev/null)
if [ -n "$HITS" ]; then
  echo "FAIL: a NEXT_PUBLIC_* variable is assigned something credential-shaped:" >&2
  note "$HITS"
  FAIL=1
fi

# 2. Anything credential-shaped served from a public/ directory.
CRED_RE='(sk_live_|sk_test_[A-Za-z0-9]{16}|whsec_|re_[A-Za-z0-9]{16}|xox[baprs]-|ghp_|github_pat_|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|0x[0-9a-fA-F]{64}|"?(client_secret|api_key|apiKey|access_token|secret_access_key)"?[[:space:]]*[:=])'
while IFS= read -r dir; do
  [ -d "$dir" ] || continue
  HITS=$(grep -rInE "$CRED_RE" "$dir" 2>/dev/null)
  if [ -n "$HITS" ]; then
    echo "FAIL: something credential-shaped is inside a public/ directory ($dir):" >&2
    note "$HITS"
    FAIL=1
  fi
  # A .env of any kind has no business being published.
  ENVS=$(find "$dir" -name '.env*' -not -name '.env.example' 2>/dev/null)
  if [ -n "$ENVS" ]; then
    echo "FAIL: an .env file is inside a public/ directory ($dir):" >&2
    note "$ENVS"
    FAIL=1
  fi
done < <(find . -type d -name public -not -path '*/node_modules/*' -not -path './.git/*' 2>/dev/null)

if [ "$FAIL" -eq 0 ]; then
  echo "OK: no secret in a NEXT_PUBLIC_* variable and nothing credential-shaped under public/"
fi
exit "$FAIL"
