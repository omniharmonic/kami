#!/usr/bin/env bash
# No source file is silently excluded from the repository by .gitignore.
#
# The bug this exists for: `.gitignore` carried an unanchored `state/`, meant for
# `infra/chain/state/`. It also matched
# `apps/web/src/app/api/entities/[slug]/state/route.ts` — a live API route the
# treasury MCP calls to check whether an entity is paused before proposing a
# payout. The file was on every developer's disk and in no clone, so it worked
# locally, passed every test, built fine, and 404'd in production. Nothing else
# in the repository could notice: tests run against the working tree, not
# against what git would hand a fresh checkout.
#
# So this check asks git the one question nobody was asking — "is any file under
# a source directory ignored?" — and names it.
#
# Directories are checked, not just files: `git status --ignored` collapses an
# ignored directory to its name, which is exactly how the route disappeared
# without a single filename ever being printed.
#
# Exit 0 = clean, 1 = a violation, 2 = the check could not run.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
command -v git >/dev/null 2>&1 || { echo "SKIP: git is not available" >&2; exit 2; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "SKIP: not a git work tree" >&2; exit 2; }

# Where source lives. Build output, caches and virtualenvs are legitimately
# ignored and live under these too, so they are subtracted below.
ROOTS="apps packages infra evals e2e profiles scripts"

# Legitimately ignored, by name or by path fragment. Anything not on this list
# that is both ignored and source-shaped is the failure this check is for.
ALLOWED='node_modules|/dist/|/dist$|\.next|__pycache__|\.ruff_cache|\.pytest_cache|\.venv|/coverage|test-results|playwright-report|tsbuildinfo|/out/|\.turbo|/state/$|next-env\.d\.ts'

# Source, by extension. A file with one of these that git will not hand a fresh
# clone is the bug.
SOURCE_EXT='\.(ts|tsx|js|jsx|mjs|cjs|py|sh|sql|json|ya?ml|md|css|svg|toml)$'

FAIL=0
FOUND=""

for r in $ROOTS; do
  [ -d "$r" ] || continue
  # --directory collapses a wholly-ignored directory to one entry; that is the
  # shape the original bug had, so expand those and look inside.
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "$entry" in
      */) files=$(find "$entry" -type f 2>/dev/null) ;;
      *)  files="$entry" ;;
    esac
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      echo "$f" | grep -qE "$ALLOWED" && continue
      echo "$f" | grep -qE "$SOURCE_EXT" || continue
      FOUND="$FOUND$f"$'\n'
    done <<< "$files"
  done <<< "$(git ls-files --others --ignored --exclude-standard --directory -- "$r" 2>/dev/null)"
done

if [ -n "$FOUND" ]; then
  echo "FAIL: .gitignore is excluding source files — they exist on this machine and in no clone:" >&2
  printf '%s' "$FOUND" | sed 's/^/  /' >&2
  echo "" >&2
  echo "  Each would work locally and be absent in production. Anchor or scope the" >&2
  echo "  .gitignore rule that matches them (\`git check-ignore -v <path>\` names it)," >&2
  echo "  then \`git add\` the files." >&2
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "OK: no source file under [$ROOTS] is excluded by .gitignore"
fi
exit "$FAIL"
