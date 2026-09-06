#!/usr/bin/env bash
# branch-for-pr.sh — create (or reuse) a Neon branch for a pull request and print
# its pooled connection string (architecture §12.1: "Neon branch per developer,
# from the prod schema, no chat data"; §12.6 CI).
#
#   NEON_API_KEY=… NEON_PROJECT_ID=… ./branch-for-pr.sh 42
#   NEON_API_KEY=… NEON_PROJECT_ID=… ./branch-for-pr.sh 42 --delete
#
# Idempotent: a branch that already exists is reused, and its endpoint is reused.
# Prints two lines to stdout — `branch_id=…` and `DATABASE_URL=…` — so CI can do
# `eval "$(./branch-for-pr.sh "$PR")"`. Everything else goes to stderr.
#
# The branch is created from `NEON_PARENT_BRANCH` (default `main`), which copies
# the schema and the data at that point. Copy PRODUCTION data only into branches
# nobody outside the team can reach: `chat_messages` holds people's words, and a
# preview URL is not a private place. For a schema-only branch set
# NEON_PARENT_BRANCH to a `staging` branch that carries no chat rows.
set -euo pipefail

API="${NEON_API_BASE:-https://console.neon.tech/api/v2}"
PARENT="${NEON_PARENT_BRANCH:-main}"
DB_NAME="${NEON_DATABASE:-neondb}"
ROLE="${NEON_ROLE:-neondb_owner}"

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required"

PR="${1:-}"
[ -n "$PR" ] || die "usage: $0 <pr-number> [--delete]"
[ -n "${NEON_API_KEY:-}" ] || die "NEON_API_KEY is not set"
[ -n "${NEON_PROJECT_ID:-}" ] || die "NEON_PROJECT_ID is not set"
case "$PR" in (*[!0-9a-zA-Z._-]*) die "pr must be a slug-safe token";; esac

BRANCH="pr-${PR}"

api() { # api <method> <path> [body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "${API}/projects/${NEON_PROJECT_ID}${path}" \
      -H "Authorization: Bearer ${NEON_API_KEY}" -H "Content-Type: application/json" -d "$body"
  else
    curl -fsS -X "$method" "${API}/projects/${NEON_PROJECT_ID}${path}" \
      -H "Authorization: Bearer ${NEON_API_KEY}" -H "Accept: application/json"
  fi
}

find_branch() { api GET "/branches" | jq -r --arg n "$BRANCH" '.branches[] | select(.name == $n) | .id' | head -1; }

if [ "${2:-}" = "--delete" ]; then
  id="$(find_branch)"
  if [ -z "$id" ]; then log "no branch ${BRANCH}; nothing to delete"; exit 0; fi
  api DELETE "/branches/${id}" >/dev/null
  log "deleted ${BRANCH} (${id})"
  exit 0
fi

branch_id="$(find_branch)"
if [ -n "$branch_id" ]; then
  log "reusing branch ${BRANCH} (${branch_id})"
else
  parent_id="$(api GET "/branches" | jq -r --arg n "$PARENT" '.branches[] | select(.name == $n) | .id' | head -1)"
  [ -n "$parent_id" ] || die "parent branch ${PARENT} not found"
  body="$(jq -n --arg name "$BRANCH" --arg parent "$parent_id" \
    '{branch: {name: $name, parent_id: $parent}, endpoints: [{type: "read_write"}]}')"
  branch_id="$(api POST "/branches" "$body" | jq -r '.branch.id')"
  [ -n "$branch_id" ] && [ "$branch_id" != "null" ] || die "branch creation returned no id"
  log "created ${BRANCH} (${branch_id}) from ${PARENT}"
fi

# The pooled URI is what @kami/web wants (the Neon serverless Pool; see src/db/client.ts).
uri="$(api GET "/connection_uri?branch_id=${branch_id}&database_name=${DB_NAME}&role_name=${ROLE}&pooled=true" | jq -r '.uri')"
[ -n "$uri" ] && [ "$uri" != "null" ] || die "no connection URI for ${BRANCH} (check NEON_DATABASE / NEON_ROLE)"

printf 'branch_id=%s\n' "$branch_id"
printf 'DATABASE_URL=%s\n' "$uri"
log "next: pnpm --filter @kami/web db:migrate   # applies src/db/migrations to this branch"
