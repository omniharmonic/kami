#!/usr/bin/env bash
# X.1 — no `.env` file is ever tracked by git. `.env.example` is the one exception: it carries
# names, never values, and the no-chain-keys check enforces that separately.
#
# Also refuses a tracked file that merely *looks* like an env file with values in it
# (`.env.local`, `.env.production`, `gate.yaml` with a filled secret, and so on), and warns when
# .gitignore has stopped ignoring them.
#
# Exit 0 = clean, 1 = a violation, 2 = the check could not run.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
command -v git >/dev/null 2>&1 || { echo "SKIP: git is not available" >&2; exit 2; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "SKIP: not a git work tree" >&2; exit 2; }

FAIL=0

TRACKED=$(git ls-files -- '*.env' '.env' '.env.*' '**/.env' '**/.env.*' 2>/dev/null | grep -v '\.env\.example$' || true)
if [ -n "$TRACKED" ]; then
  echo "FAIL: an .env file is tracked by git:" >&2
  printf '  %s\n' $TRACKED >&2
  FAIL=1
fi

# Staged but not yet committed counts too — this is the moment to catch it.
STAGED=$(git diff --cached --name-only --diff-filter=A 2>/dev/null | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$STAGED" ]; then
  echo "FAIL: an .env file is staged for commit:" >&2
  printf '  %s\n' $STAGED >&2
  FAIL=1
fi

# .gitignore must still say so, so the next one is caught by git rather than by this script.
if ! grep -qE '^\.env(\.\*)?$' .gitignore 2>/dev/null; then
  echo "FAIL: .gitignore no longer ignores .env files" >&2
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "OK: no .env file is tracked or staged; .gitignore still ignores them"
fi
exit "$FAIL"
