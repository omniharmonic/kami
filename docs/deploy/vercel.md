# Vercel, Neon, R2, Resend — the hosted half

Everything the public sees runs here. The Mac mini in `infra/mac/` (and later the DGX Spark
with `infra/box/`) only supplies the voice; the site keeps working without it, rendering
`status.json` and saying "I'm asleep — my thinking machine is off". Set this half up so that
remains true.

Order: Vercel project → Neon → migrations → R2 → Resend → crons → domain. Each step ends with
something you can check.

---

## 1. The Vercel project

The repo is a pnpm monorepo; the deployable app is `apps/web`.

* **Framework preset** Next.js. **Root Directory** `apps/web`.
* **Install command** `pnpm install --frozen-lockfile` (run from the repo root — Vercel does
  this when the root directory is set and `pnpm-workspace.yaml` is detected).
* **Build command** `pnpm -w run build:packages && pnpm run build`, declared in
  `apps/web/vercel.json` so it is committed rather than typed into a dashboard.
  The first half is not optional: the five `@kami/*` workspace packages resolve
  to `./dist/index.js`, `dist/` is gitignored, and `pnpm install` links workspace
  packages without building them — so on a fresh clone `next build` cannot resolve
  `@kami/binding` and friends. It works locally only because `dist/` is already
  there. For a build without secrets, `SKIP_ENV_VALIDATION=1`.
* **Node version** 22 — set by `engines.node` in `package.json`, which Vercel reads and
  which **overrides the project setting**. It must be written in Vercel's form,
  `"22.x"`; a semver range like `">=22 <23"` is not recognised, so Vercel falls
  through to the build image's default (Node 24 as of this writing) and then pnpm —
  which *does* understand the range — refuses the install with
  `ERR_PNPM_UNSUPPORTED_ENGINE`. Both the repo root and `apps/web` declare it,
  since Vercel reads the manifest at the root directory and pnpm installs from
  the workspace root. **Vercel does not read `.nvmrc`** (it reads `.node-version`),
  so the `.nvmrc` here is for nvm and CI only.

**`vercel.json` lives at `apps/web/vercel.json`** — the deployed project root, which is where
Vercel reads it. It used to sit in `infra/`, where nothing read it; a `vercel.json` Vercel
cannot find means the crons silently do not exist, and the site looks fine while never waking.
A malformed one **fails the deployment**, which is the better failure. There is nothing to
copy at deploy time.

Check: a preview deployment builds, and `https://<preview>/e/boulder-creek` renders — from
the fixture status file, with no database, no gateway and no bucket.

## 2. Neon

1. Create the project (region close to the Vercel one; `us-east` unless you have a reason).
2. Take the **pooled** connection string — its host contains `-pooler`. The app uses
   `@neondatabase/serverless` over WebSocket for interactive transactions (the entity-event
   hash chain needs them), and the pooled endpoint is what that expects.
3. Set `DATABASE_URL` in the Vercel project.
4. Apply the migrations from your machine:

```bash
DATABASE_URL='postgres://…-pooler…/kami' pnpm --filter @kami/web db:migrate
```

It is idempotent. Migration `0002` tries `CREATE ROLE kami_app` and is guarded with
`IF NOT EXISTS`; if the Neon owner role lacks `CREATEROLE` it is skipped, and the append-only
trigger on `entity_events` holds regardless (docs/verify.md #37).

**Branching for previews.** `infra/neon/branch-for-pr.sh` creates a branch per pull request
so a preview never writes to production data. It needs `NEON_API_KEY` and `NEON_PROJECT_ID`
(neither is in `.env.example`; see [`env.md`](env.md)). Wire it into the preview deployment
or run it by hand before opening a PR that touches the schema.

Check: `bash scripts/kami-doctor --only storage` — it reports the database reachable and the
applied migration count against the `.sql` files in the repo.

## 3. R2

One bucket holds the published tree: `entity/<slug>/status.json` (hourly, `latest` cache
class), `entity/<slug>/binding.json`, and evidence uploads.

1. Create the bucket (`kami-data`, or whatever you set `R2_BUCKET` to — the code's default is
   `entities-data`, and `.env.example` suggests `kami-data`; pick one and set the variable,
   docs/verify.md #72).
2. Create an **API token** scoped to that bucket with *Object Read & Write*. Set
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (and
   `R2_ENDPOINT` if you are not using the default `https://<account>.r2.cloudflarestorage.com`).
3. Give the bucket a public read path: either the r2.dev subdomain (fine before a domain) or
   a custom domain (`data.<your-domain>`). Set `KAMI_DATA_BASE_URL` to it.
4. **CORS.** The pages fetch `status.json` from the browser, so the bucket needs a CORS rule
   allowing `GET` from your site's origins:

```json
[
  {
    "AllowedOrigins": ["https://<your-domain>", "https://*.vercel.app"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Cache-Control"],
    "MaxAgeSeconds": 3600
  }
]
```

Narrow `https://*.vercel.app` to your project's preview domain once you know it.

R2 is expected to serve the object's own `Cache-Control` verbatim on the public URL — the
publisher sets it per cache class, and the twin's own conventions depend on it holding
(docs/verify.md #72). The doctor reports the header it actually got back.

Check: `bash scripts/kami-doctor --only storage` writes a probe object, reads it back,
deletes it, and then reads the real `status.json` the way a browser would, reporting its
`as_of` age and `Cache-Control`.

## 4. Resend

Magic links are the only way to sign in — there is no password field anywhere.

1. Add your domain in Resend and create the DNS records it gives you (DKIM `CNAME`s, an SPF
   `TXT`, and the return-path record). Verification usually takes minutes; it can take a day.
2. Set `RESEND_API_KEY` and `RESEND_FROM` (e.g. `Kami <hello@your-domain>`). The default
   `hello@kami.local` will be rejected by every mail server.
3. Until the domain verifies, Resend will only send to your own address — which is enough for
   checkpoint 3, since the site is unlisted anyway.

**Without `RESEND_API_KEY` the app does not break**: the magic link is printed to the server
log. That is a genuine dev convenience and an obvious hazard in production — the link is a
credential, and Vercel logs are readable by everyone on the team.

Which Resend tier is needed is *verify* (docs/verify.md #16).

## 5. The crons — and the Pro requirement

`infra/vercel.json` declares **twelve** cron entries. Vercel's Hobby plan allows two, at
day-granularity only, so **this table needs Pro**. A `vercel.json` the plan cannot satisfy
fails the deployment.

| path | schedule (UTC) | what it does |
|---|---|---|
| `/api/cron/needs` | `0 * * * *` | hourly: read the twin, compute the snapshot, publish `status.json` |
| `/api/cron/safe-poll` | `* * * * *` | poll the Safe Transaction Service for confirmations (it has no webhooks) |
| `/api/cron/eas-timestamp` | `20 3 * * *` | `multiTimestamp` the day's attestation UIDs on Base |
| `/api/cron/reconcile` | `40 3 * * *` | Safe transfers vs `payouts` vs `donations` |
| `/api/cron/reputation` | `10 4 * * *` | recompute `reputation/v1` over published UIDs |
| `/api/cron/passport` | `50 4 * * *` | refresh Human Passport scores |
| `/api/cron/tier4-followup` | `15 5 * * *` | tier-4 bounty follow-up |
| `/api/cron/donor-report` | `0 6 1 * *` | monthly: assemble the donor report's numbers |
| `/api/cron/commons` | `20 8 * * 1` | weekly: splice notes into the commons vault |
| `/api/cron/binding-check` | `30 9 * * *` | nightly: supersession check per entity |
| `/api/cron/retention` | `45 9 * * *` | nightly: delete old chat messages, aggregate usage |
| `/api/cron/verify-chain` | `0 10 * * *` | nightly: verify the entity-event hash chain |

Every route authenticates with `Authorization: Bearer $CRON_SECRET` and a constant-time
compare. **In production a route with no `CRON_SECRET` set answers 503, not 200** — a job
that cannot authenticate must not run. Set it before the first production deploy.

`safe-poll` alone is 1,440 invocations a day; check the invocation budget on the plan as well
as the cron count. Details and the queue of not-yet-shipped entries: `infra/vercel.crons.md`.

Run one by hand:

```bash
curl -s -X POST "$PLATFORM_URL/api/cron/needs?slug=boulder-creek" \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

## 6. The environment matrix

Three stages. "dev" is your Mac; "staging" is a Vercel preview (or a second project);
"prod" is the deployment the public will eventually see. Full definitions and what each
absence causes: [`env.md`](env.md).

| variable | dev | staging | prod |
|---|---|---|---|
| `DATABASE_URL` | optional (pages render from fixtures) | Neon **branch** | Neon primary, pooled |
| `BETTER_AUTH_SECRET` | any ≥16 chars | own value | own value, never shared with staging |
| `BETTER_AUTH_URL` | `http://localhost:3000` | the preview URL | the real domain |
| `CRON_SECRET` | unset (routes run open) | set | **set** — unset means 503 |
| `PLATFORM_ADMIN_TOKEN` | optional | set | set |
| `GATE_ADMIN_SECRET` | optional | set, same value as the Mac's | set, same value as the Mac's |
| `HERMES_GATEWAY_URL` | `fake:` | `fake:` or the tunnel | the tunnel hostname |
| `HERMES_API_SERVER_KEY` | — | matches the Mac | matches the Mac |
| `KAMI_DATA_DIR` | `./data-local` | — | — |
| `KAMI_DATA_BASE_URL` | — | the r2.dev URL | the custom domain |
| `R2_*` | unset (local dir) | a staging prefix or bucket | set |
| `RESEND_API_KEY` | unset (links to the log) | set | set |
| `TWIN_BASE_URL` | live tree | live tree | live tree |
| `TWIN_TREE_DIR` | fixtures, when you want them | unset | unset |
| `PARACHUTE_*` | unset (503 `commons_unconfigured`) | unset | set when the vault is ready |
| `STRIPE_*`, `PRIVY_*`, `SAFE_API_KEY`, `RPC_URL_BASE`, `SIGNING_BACKEND` | unset | test keys, Base Sepolia | checkpoint 4 |

Two rules for the matrix itself: **staging never shares a secret with production** (a preview
URL is effectively public), and **`GATE_ADMIN_SECRET` and `HERMES_API_SERVER_KEY` must be
byte-identical** between the Vercel project and `~/.kami/kami.env` on the Mac. When they
drift, the failure is quiet: pauses stop propagating and chat renders asleep.
`kami doctor --only platform,tunnel` catches exactly that.

## 7. Once you have a domain

Nothing above needs a domain; all of it works on `*.vercel.app`. When one exists, do these
seven things together, because they reference each other:

1. **DNS + Vercel.** Add the domain to the project; create the `A`/`CNAME` records Vercel
   asks for. Decide `www` versus apex and redirect the other.
2. **`BETTER_AUTH_URL`** → `https://<domain>`. Magic links are minted against it; leaving it
   on the preview URL sends people to the wrong host with a valid token.
3. **Resend** → verify the domain (§4) and set `RESEND_FROM` to an address on it.
4. **R2 public domain** → `data.<domain>` in front of the bucket; set `KAMI_DATA_BASE_URL`,
   and update the bucket's CORS `AllowedOrigins` to the real origin.
5. **The tunnel** → `gw.<domain>`, created with `cloudflared tunnel route dns` (see
   `infra/mac/cloudflared/README.md`). Set `HERMES_GATEWAY_URL` in Vercel and
   `KAMI_PUBLIC_GATEWAY_URL` on the Mac to the same value.
6. **Stripe** (checkpoint 4) → add the domain in the Stripe dashboard, point the webhook
   endpoint at `https://<domain>/api/webhooks/stripe`, and set `STRIPE_WEBHOOK_SECRET` from
   that endpoint. A webhook secret from a different endpoint fails silently in exactly the
   way that loses donation records.
7. **Re-run the doctor** with the production values loaded:

```bash
PLATFORM_URL=https://<domain> KAMI_PUBLIC_GATEWAY_URL=https://gw.<domain> \
  bash scripts/kami-doctor
```

Then re-read the consultation gate. A domain makes the site findable; the publication gate
(Nederland's Boulder Creek guardians and the relevant Tribal offices, docs/verify.md #22) is
what decides whether it *should* be found. The platform enforces that gate in code — it is
not a reminder, and a domain does not lift it.
