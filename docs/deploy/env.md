# Every environment variable, and what happens without it

Gathered from `.env.example` and by grepping `process.env` / `os.environ` across the
repository. The column that matters is **absent ⇒**: this system is built to say "not
configured" rather than half-work, and most of these degrade to a visible, honest state
rather than an error. Where that is not true, the row says so.

"Checkpoint" refers to [`first-entity.md`](first-entity.md): 1 the plumbing, 2 the creek
speaks, 3 public but unlisted, 4 money on Sepolia. A variable's checkpoint is the first
moment it is genuinely needed — not the first moment it can be set.

**Never put a secret in a `NEXT_PUBLIC_*` variable, a commons note, a status file, or a
profile directory.** There is a CI gate for it (`scripts/checks/no-public-secrets.sh`), and
`kami doctor` masks every credential-shaped value it reads.

---

## The web app (Vercel)

Parsed in `apps/web/src/env.ts` with zod; feature modules parse their own with their own
schemas (`src/lib/signing/env.ts`, `src/lib/donations/env.ts`, `src/lib/privy/env.ts`,
`src/lib/jobs/common.ts`).

| variable | read by | required | absent ⇒ | checkpoint |
|---|---|---|---|---|
| `DATABASE_URL` | `src/env.ts`, `src/db/client.ts` | **in production** | in dev, every DB read falls back to an empty state and pages render from `status.json`; in production the app refuses to boot | 3 |
| `DB_DRIVER` | `src/db/client.ts` | no | auto: `neon` on Vercel or a `*.neon.tech` host, else `pg` | — |
| `BETTER_AUTH_SECRET` | `src/lib/auth.ts`, `src/lib/anon.ts` | **in production** | no sessions, no sign-in; production refuses to boot | 3 |
| `BETTER_AUTH_URL` | `src/env.ts` | no | defaults to `http://localhost:3000`; magic links point at the wrong host once you have a domain | 3 |
| `RESEND_API_KEY` | `src/lib/auth.ts` | no | magic links are **printed to the server log** instead of emailed — usable, and obviously not for the public | 3 |
| `RESEND_FROM` | `src/lib/auth.ts` | no | `Kami <hello@kami.local>`, which real mail servers will reject | 3 |
| `CHAT_COOKIE_SECRET` | `src/lib/anon.ts` | no | falls back to `BETTER_AUTH_SECRET` | — |
| `CAPTURE_TOKEN_SECRET` | `src/lib/evidence/capture-token.ts` | no | falls back to `CHAT_COOKIE_SECRET`, then `BETTER_AUTH_SECRET`; **throws in production if all three are unset** | 3 |
| `TRUSTED_PROXY_HOPS` | `src/lib/anon.ts` | no | 1 — correct for Vercel's single proxy. Wrong values let a client spoof its IP past the 60/day limit | 3 |
| `KAMI_DATA_DIR` | `src/lib/status.ts`, `src/lib/publish/` | no | outside production, `src/fixtures/status/` (the all-stale Boulder Creek build); in production, no local fallback | 1 |
| `KAMI_DATA_BASE_URL` | `src/lib/status.ts` | no | pages read the local dir instead of the bucket | 3 |
| `HERMES_GATEWAY_URL` | `src/lib/gateway.ts` | no | `fake:` — a canned guarded reply, which is why the UI runs with no box at all. Variants `fake:asleep`, `fake:busy`, `fake:paused`, `fake:fast` | 2 |
| `HERMES_API_SERVER_KEY` | `src/lib/gateway.ts` | **in production** | the gateway answers 401 and chat renders "I'm asleep" | 2 |
| `CRON_SECRET` | `src/lib/jobs/common.ts` | **in production** | in dev, cron routes run unauthenticated; in production they answer **503 `cron_secret_unset`** — a job that cannot authenticate must not run | 3 |
| `PLATFORM_ADMIN_TOKEN` | `src/lib/jobs/common.ts` | no | the admin/box endpoints (`/api/admin/*`, pause) reject every caller | 2 |
| `GATE_ADMIN_SECRET` | `src/lib/jobs/common.ts` | no | `/api/gate/pause-set` and `/api/gate/heartbeat` answer 401 to the gate; **a guardian's pause never reaches the box** | 2 |
| `GATE_ADMIN_URL` | `src/lib/jobs/pause.ts` | no | the platform records the pause but does not push it to the gate; the gate picks it up on its next poll instead | 2 |
| `HERMES_WEBHOOK_SECRET` | `src/app/api/webhooks/hermes/route.ts` | no | cron deliveries from the box are rejected unsigned | 2 |
| `TWIN_BASE_URL` | `src/lib/jobs/twin.ts` | no | the needs job has no tree to read | 2 |
| `TWIN_TREE_DIR` | `src/lib/jobs/twin.ts` | no | reads the live tree instead of the fixtures | 1 |
| `KAMI_PULSE_CONTACT` | `src/lib/jobs/common.ts` | no | `hello@kami.invalid` in the twin `User-Agent` — set it; the twin's operator should be able to reach you | 2 |
| `PLATFORM_URL` | `src/proxy.ts`, provisioning | no | provisioning plans use `http://127.0.0.1:3000` | 2 |
| `KAMI_BOX_HOST` | `src/app/api/admin/profiles/route.ts` | no | the admin profile route produces a plan and never shells out to deploy | 2 |
| `PARACHUTE_HUB_URL`, `PARACHUTE_ENTITIES_VAULT`, `PARACHUTE_ENTITIES_TOKEN` | `src/lib/commons/client.ts` | no | the weekly commons job answers **503 `commons_unconfigured`** and writes nothing | 3 |
| `COMMONS_FRONT_RANGE_BASE_URL` | `src/lib/commons/sync.ts` | no | `https://prism.omniharmonic.com/p/front-range` | 3 |
| `KAMI_EVIDENCE_BASE_URL` | `src/lib/reports/donor-report.ts`, `treasury/proposal-page.ts` | no | evidence links are omitted from the donor report and the proposal page | 4 |
| `SKIP_ENV_VALIDATION` | `src/env.ts` | no | validation runs; set it for CI builds without secrets | — |

## Object storage (R2)

| variable | read by | required | absent ⇒ | checkpoint |
|---|---|---|---|---|
| `R2_ACCOUNT_ID` | `src/lib/publish/r2.ts` | no | with any R2 variable missing, publishing falls back to `KAMI_DATA_DIR` | 3 |
| `R2_ENDPOINT` | `src/lib/publish/r2.ts` | no | derived from the account id (`https://<account>.r2.cloudflarestorage.com`) | 3 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `src/lib/publish/r2.ts`, `evidence/storage.ts` | no | as above — local dir, no bucket | 3 |
| `R2_BUCKET` | same | no | defaults to `entities-data` (*note:* `.env.example` suggests `kami-data`; docs/verify.md #72) | 3 |

## The gate (`apps/gate`, on the Mac or the box)

The gate reads almost nothing from the environment directly: `gate.yaml` *names* the
variables, so a key is never in a config file.

| variable | read by | required | absent ⇒ | checkpoint |
|---|---|---|---|---|
| the variable named by `upstream_api_key_env` (e.g. `OPENAI_API_KEY`) | `config.py` | for a hosted upstream | the provider answers 401 and every completion fails | 1 |
| the variable named by `admin_secret_env` (default `GATE_ADMIN_SECRET`) | `config.py` | no | admin endpoints answer **503 `admin_unavailable`** — pause and resume cannot be driven | 1 |
| the variable named by `platform.token_env` (default `KAMI_PLATFORM_TOKEN`) | `config.py` | no | the platform refuses the pause-set poll; with `fail_closed: true` every slug reads as paused, which is the safe direction | 2 |
| `KAMI_ENV` | `config.py` | no | when set to `production`, the gate **refuses to start** with `passthrough: true` or with `fail_closed: false` alongside a platform URL. Unset, it starts and trusts you | 3 |

## Hermes and the profiles (on the Mac or the box)

| variable | read by | required | absent ⇒ | checkpoint |
|---|---|---|---|---|
| `API_SERVER_KEY` / `HERMES_API_SERVER_KEY` | the Hermes gateway; `pause.ts`; the web app | yes for a reachable gateway | the API port answers 401 (and the platform renders asleep) | 2 |
| `PLATFORM_MCP_TOKEN` | `pulse_precheck.py`, the platform MCP server block, treasury MCP | yes per entity | the precheck cannot ask the platform and falls back to hashing the twin's own slice; the platform MCP tools 401 | 2 |
| `PLATFORM_URL` | `pulse_precheck.py` | no | the precheck skips the platform and uses the twin fallback | 2 |
| `TWIN_BASE_URL` | `pulse_precheck.py`, the twin MCP | no | `https://data.bioregionaltwin.org` | 2 |
| `KAMI_ENTITY_SLUG` | `pulse_precheck.py`, treasury MCP | yes | the pre-script cannot tell which entity it is running for | 2 |
| `KAMI_PROFILE_DIR` | `pulse_precheck.py` | no | derived from the script's own location | 2 |
| `KAMI_PULSE_CONTACT` | `pulse_precheck.py` | no | `hello@kami.invalid` in the `User-Agent` | 2 |
| `HERMES_CMD` | `deploy-profile.ts`, `smoke.sh`, `kami doctor` | no | `hermes` on `PATH`; on the box, the `docker compose exec` form | 2 |
| `BOX_HOST` / `HERMES_HOME` / `REMOTE_HERMES_HOME` | `deploy-profile.ts`, `kami doctor` | no | `box`, `~/.hermes`, `/opt/data` | 2 |
| `GATE_PLATFORM_TOKEN` | expanded **by the gate's own environment** from the `gate.yaml` the platform generates | no | the generated config carries a literal `${GATE_PLATFORM_TOKEN}` that resolves to nothing | 2 |

## Chain, money and identity (checkpoint 4)

| variable | read by | required | absent ⇒ | checkpoint |
|---|---|---|---|---|
| `CHAIN_ID` | `src/lib/signing/env.ts` | no | `84532` (Base Sepolia) | 4 |
| `RPC_URL_BASE` | `src/lib/signing/env.ts` | for any chain call | the treasury and summon flows report themselves unconfigured rather than failing mid-transaction | 4 |
| `SIGNING_BACKEND` | `src/lib/signing/kms.ts` | no | `local` — a development key from `KAMI_LOCAL_KEYS_JSON`. Never in production | 4 |
| `KAMI_LOCAL_KEYS_JSON` | `src/lib/signing/kms.ts` | with `SIGNING_BACKEND=local` | no signer; proposals cannot be created | 4 |
| `AWS_KMS_KEY_IDS_JSON` | `src/lib/signing/kms.ts` | with `SIGNING_BACKEND=aws-kms` | as above | 4 |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | `src/lib/privy/`, `signing/kms.ts` | for embedded wallets | the wallet page says the feature is not configured | 4 |
| `PRIVY_AUTHORIZATION_KEY`, `PRIVY_WALLET_IDS_JSON` | `src/lib/signing/kms.ts` | with `SIGNING_BACKEND=privy` | no server wallet to sign with | 4 |
| `PRIVY_VERIFICATION_KEY` | `src/lib/privy/server.ts` | no | Privy tokens are verified over the network instead of locally | 4 |
| `SAFE_API_KEY` | `src/lib/treasury/deps.ts`, `infra/chain` | for the Safe Transaction Service | proposal polling cannot reach Safe's API (it now requires a key — docs/verify.md #44) | 4 |
| `RELAYER_MIN_ETH` | `src/lib/signing/relayer.ts` | no | a default floor; below it the relayer refuses to execute and says why | 4 |
| `EAS_GRAPHQL_URL` | `src/lib/reconcile/index.ts` | no | reconciliation findings are `unverified` — **never** `error`: an unset endpoint is not a discrepancy | 4 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `src/lib/donations/env.ts` | for card donations | the donate page says donations are not configured | 4 |
| `OFFRAMP_URL` | `src/lib/privy/server.ts` | no | the off-ramp link is omitted | 4 |
| `PASSPORT_API_KEY`, `PASSPORT_SCORER_ID`, `PASSPORT_API_URL` | `src/lib/passport/refresh.ts` | no | the nightly passport job does nothing and says so; no score is invented | 4 |
| `KAMI_CHAIN_STATE` | `infra/chain/src/config.ts` | no | a per-chain JSON file under `infra/chain/state/` | 4 |

## Tooling, not runtime

| variable | read by | notes |
|---|---|---|
| `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_PARENT_BRANCH`, `NEON_ROLE`, `NEON_DATABASE` | `infra/neon/branch-for-pr.sh` | per-PR database branches |
| `TWIN_TREE` | `packages/twin-mcp/src/stdio.ts` | the tree for the stdio MCP server (`--tree` wins) |
| `TREE_BASE_URL` | `packages/twin-mcp/src/worker.ts` | the Worker deployment's tree |
| `TWIN_REPO` | `scripts/refresh-fixtures.ts` | path to the twin checkout when regenerating fixtures |
| `KAMI_DOCTOR_PYTHON` | `scripts/kami-doctor` | force an interpreter |
| `KAMI_GATE_YAML`, `KAMI_GATE_URL`, `KAMI_GATE_LISTEN`, `KAMI_PLATFORM_URL`, `KAMI_HERMES_URL`, `KAMI_PUBLIC_GATEWAY_URL`, `KAMI_UPSTREAM_URL`, `KAMI_UPSTREAM_MODEL`, `KAMI_UPSTREAM_API_KEY` | `scripts/doctor/`, `infra/mac/bin/` | overrides for the doctor and the launchd wrappers; all optional, all degrade to `skipped` |
| `KAMI_E2E_PORT`, `KAMI_E2E_PAUSED_PORT`, `KAMI_E2E_SKIP_BUILD` | `e2e/scripts/run.mjs` | Playwright |
| `KAMI_HARD_RULES_PATH`, `KAMI_CONFIG_TEMPLATE_PATH`, `KAMI_PROFILES_DIR`, `KAMI_DEPLOY_PROFILE_PATH` | profile scripts and their tests | test seams |

---

## Found in code but **not** in `.env.example`

Flagged as asked. None is required for checkpoint 1, but several are needed before the site
is public, and two of them are the kind of omission that produces a silent half-working
system.

**Needed before checkpoint 3, and easy to miss:**

* `PLATFORM_ADMIN_TOKEN` — without it every admin and box endpoint rejects every caller.
* `KAMI_DATA_BASE_URL` — without it the deployed app reads a local directory that does not
  exist on Vercel, and pages render with no status at all.
* `R2_ENDPOINT` — optional in principle (derived from the account id), but needed for any
  non-default R2 setup.
* `CHAT_COOKIE_SECRET` and `CAPTURE_TOKEN_SECRET` — both fall back to `BETTER_AUTH_SECRET`,
  and `CAPTURE_TOKEN_SECRET` **throws in production** if none of the three is set.
* `KAMI_PULSE_CONTACT` — the twin's operator can only reach you through the `User-Agent`.
* `TRUSTED_PROXY_HOPS` — wrong or unset behind more than one proxy lets a client spoof its
  IP past the per-IP chat limit.
* `RESEND_FROM` — the default is `hello@kami.local`, which nothing will deliver.
* `PLATFORM_URL`, `GATE_ADMIN_URL`, `KAMI_BOX_HOST`, `HERMES_CMD`, `BOX_HOST`,
  `REMOTE_HERMES_HOME`, `HERMES_HOME` — deployment plumbing for the box scripts.
* `KAMI_PLATFORM_TOKEN` and `GATE_PLATFORM_TOKEN` — the gate's side of the platform
  handshake; `.env.example` documents `GATE_ADMIN_SECRET` but not these.
* `KAMI_ENV` — the switch that makes the gate refuse an unsafe production configuration.

**Checkpoint 4 and later:** `EAS_GRAPHQL_URL`, `SAFE_API_KEY`, `RELAYER_MIN_ETH`,
`KAMI_LOCAL_KEYS_JSON`, `AWS_KMS_KEY_IDS_JSON`, `PRIVY_AUTHORIZATION_KEY`,
`PRIVY_WALLET_IDS_JSON`, `PRIVY_VERIFICATION_KEY`, `OFFRAMP_URL`, `PASSPORT_API_URL`,
`PASSPORT_SCORER_ID`, `KAMI_EVIDENCE_BASE_URL`, `COMMONS_FRONT_RANGE_BASE_URL`,
`KAMI_CHAIN_STATE`, `DB_DRIVER`, `SKIP_ENV_VALIDATION`.

**Tooling:** `NEON_API_KEY`, `NEON_PROJECT_ID`, `TWIN_TREE`, `TREE_BASE_URL`, `TWIN_REPO`,
the `KAMI_E2E_*` set, and the doctor's own `KAMI_*` overrides.

Also new since `.env.example` was written, from the hosted-upstream work: the variable named
by `upstream_api_key_env` in `gate.yaml` — `OPENAI_API_KEY` for the worked path.

## Found in `.env.example` but read nowhere

* `PLATFORM_MCP_SIGNING_SECRET` — no `process.env` or `os.environ` reference anywhere in the
  repository. Either it is a leftover from an earlier design of the platform MCP auth (which
  now uses per-entity bearer tokens verified in `src/lib/mcp/tokens.ts`), or something that
  was planned and not built. Setting it does nothing today.
