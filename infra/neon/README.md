# `infra/neon` — Postgres branches

Neon holds every operational row (Appendix B; `apps/web/src/db/schema/`). Migrations are Drizzle SQL
committed under `apps/web/src/db/migrations/` — the database is never edited by hand, on any branch.

## Branches (architecture §12.1)

| branch | who | data |
|---|---|---|
| `main` | production | the real thing; point-in-time restore 30 d (*verify* the plan) plus a nightly `pg_dump` to R2 |
| `staging` | the `staging` Vercel deployment | schema + seed rows, **no chat data** |
| `pr-<n>` | one Vercel preview | created by `branch-for-pr.sh`, deleted when the PR closes |
| `dev-<name>` | one developer | same script with a different name, or the Neon console |

A branch is copy-on-write: creating one costs seconds and no storage until it diverges. **A branch of
`main` carries production `chat_messages` and `users.email`.** Preview URLs are not private places, so
branch previews from `staging` (`NEON_PARENT_BRANCH=staging`) unless a specific debugging need says
otherwise, and delete the branch when the PR closes.

## Usage

```bash
export NEON_API_KEY=…            # a personal or project API key
export NEON_PROJECT_ID=…         # from the Neon console URL
export NEON_PARENT_BRANCH=staging

eval "$(./branch-for-pr.sh 42)"  # sets DATABASE_URL and branch_id in the shell
pnpm --filter @kami/web db:migrate
pnpm --filter @kami/web test

./branch-for-pr.sh 42 --delete   # when the PR closes
```

The script needs `curl` and `jq`, is idempotent (an existing branch is reused), prints
`branch_id=` / `DATABASE_URL=` on stdout and everything else on stderr, and exits non-zero on any
API failure.

Optional environment: `NEON_DATABASE` (default `neondb`), `NEON_ROLE` (default `neondb_owner`),
`NEON_API_BASE`.

## What the app expects of a branch

- Every migration in `apps/web/src/db/migrations/` applied (`db:migrate`, idempotent).
- Migration `0002` creates the `kami_app` role if the owner may `CREATE ROLE` (*verify*,
  docs/verify.md #37) and revokes `UPDATE/DELETE/TRUNCATE` on `entity_events`; the append-only
  trigger holds regardless of role, so a branch where the role could not be created is still safe.
- `DATABASE_URL` pooled. `src/db/client.ts` picks the Neon serverless driver on Vercel or for a
  `*.neon.tech` host and node-postgres otherwise; both are in `serverExternalPackages`.
- Nothing else: with no `DATABASE_URL` at all the app still renders from the last `status.json`
  (ADR-E14), which is what a preview without a branch does.

## CI

The sandbox has no Postgres server: `pnpm --filter @kami/web test` runs the whole schema, the hash
chain, the jobs and the MCP against PGlite (`src/db/test-utils.ts`). A Neon branch is only needed to
exercise a preview deployment against real Neon behaviour (advisory locks, the pooler, RLS-free role
grants) — the tests do not require one.

## Backups (§12.4)

Nightly `pg_dump` of `main` to the platform R2 bucket under a separate prefix with a 90-day
lifecycle, plus Neon's own PITR. The restore is rehearsed before phase 2. Neither is automated here
yet — *verify* and add the job beside the cron table in `infra/vercel.crons.md` when it lands.
