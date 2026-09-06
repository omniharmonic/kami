# `apps/web/vercel.json` — the cron table

Vercel invokes each `path` with `Authorization: Bearer $CRON_SECRET`; every route in
`apps/web/src/app/api/cron/*` checks it with a constant-time compare and answers 401 otherwise
(503 in production when `CRON_SECRET` is unset — a job that cannot authenticate must not run).
Schedules are **UTC**. Times are staggered so two jobs never contend for the same Neon branch.

`vercel.json` must sit at the deployed project root. This repo keeps the source of truth here;
copy or symlink it into `apps/web/` (or set the Vercel project's root directory to `apps/web` and
copy this file there) at deploy time — *verify* which the project settings end up using.

## Shipped now

| path | schedule (UTC) | what it does | work package |
|---|---|---|---|
| `/api/cron/needs` | `0 * * * *` (hourly) | Per non-retired entity: read the twin through `@kami/twin-client`, resolve each need per its `agg`, `computeSnapshot`, insert `need_snapshots` when the snapshot hash moved, publish `entity/<slug>/status.json` with the twin's `latest` cache class. ADR-E14, T1.4. | this one |
| `/api/cron/commons` | `20 8 * * 1` (Mondays) | Fence-splice `entity/page`, the weekly `entity/state` roll-up, `entity/memo`, `entity/report` and `entity/bounty` notes into the `entities` vault; index them in `commons_notes`. ADR-E08, T1.9. Answers 503 `commons_unconfigured` until `PARACHUTE_HUB_URL`/`PARACHUTE_ENTITIES_TOKEN` are set (TW-11). | this one |
| `/api/cron/binding-check` | `30 9 * * *` (nightly) | `checkSupersession` per entity → a `pending_review` successor binding version, findings into `config.binding_findings.<slug>` so the next `status.json` marks the need superseded. Architecture §3. | this one |
| `/api/cron/retention` | `45 9 * * *` (nightly) | Delete `chat_messages` older than 90 days unless the session opted in; aggregate `usage_events` older than 90 days into `config.usage_daily.<slug>`. §11, X.7. | this one |
| `/api/cron/verify-chain` | `0 10 * * *` (nightly) | `verifyEventChain` per entity; head hash into `config.event_chain_head.<slug>`, published in `status.json`. §10.5. | this one |
| `/api/cron/safe-poll` | `* * * * *` (every minute) | Poll the Safe Transaction Service for confirmations on pending proposals (it has no webhooks, *verify*) and execute at threshold via the relayer. §7.3, T2.5. | signing/treasury |
| `/api/cron/eas-timestamp` | `20 3 * * *` (nightly) | `multiTimestamp` the day's offchain attestation UIDs on Base; write `attestations.timestamped_tx/at`. §8.2, T2.9. | signing/treasury |
| `/api/cron/reconcile` | `40 3 * * *` (nightly) | Compare Safe transfers, `payouts` and `donations` → `reconciliations`; block the donor report when unclean. §7.7, T2.12. | signing/treasury |
| `/api/cron/reputation` | `10 4 * * *` (nightly) | Recompute `reputation/v1` over published UIDs → `reputation_runs` + `reputation_scores`. §8.3, T2.13. | signing/treasury |

## Placeholders — later packages add the route, then the entry

`vercel.json` is JSON and cannot carry comments, so the queue lives here. Add the row to
`vercel.json` in the same change that adds the route, and move it up into the table above.

The last four rows above belong to the signing/treasury package; their routes landed in
`apps/web/src/app/api/cron/` and authenticate through the same `authorizeCron` helper, and the
schedules are that package's own (`safe-poll` runs every minute because a pending Safe proposal is
polled until it reaches threshold, §7.3).

| path | proposed schedule (UTC) | what it will do | work package |
|---|---|---|---|
| `/api/cron/donor-report` | `0 13 1 * *` (monthly) | Assemble the month's numbers into `donor_reports.data`, hand the agent its one paragraph, then send. §7.7, T2.11. Note the agent's own `donor-report` cron runs on the box (Hermes, §5.2) and its delivery arrives at `/api/webhooks/hermes`; this route owns the numbers. | money |
| `/api/cron/hermes-doctor` | `10 * * * *` (hourly) | Scrape `hermes cron doctor` through the tunnel into the healthcheck; `failure_streak ≥ 3` pages a steward. §5.2, T1.12. *verify* the Hermes API (docs/verify.md #1). | observability |

## Vercel plan limits

Hobby allows 2 cron jobs at day-granularity; Pro allows 40 at minute-granularity. This table needs
Pro — `/api/cron/safe-poll` alone is minute-granularity and 1,440 invocations a day, so check the
invocation budget too. *verify* against the account's plan before the first deploy — a rejected
`vercel.json` fails the deployment, not just the crons.

## Running one by hand

```bash
curl -s -X POST "$PLATFORM_URL/api/cron/needs?slug=boulder-creek" -H "Authorization: Bearer $CRON_SECRET" | jq
curl -s -X POST "$PLATFORM_URL/api/cron/commons?dry=1"           -H "Authorization: Bearer $CRON_SECRET" | jq '.counts'
```

`?slug=` narrows `needs`, `binding-check`, `verify-chain` and `commons` to one entity; `?dry=1`
makes the commons job render into memory and write nothing.
