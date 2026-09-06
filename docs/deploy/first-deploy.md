# The first deploy

Written 2026-09-06, during the deploy, and updated when it went live. This is
the state of the hosted half, not a plan. `vercel.md` is the general procedure;
this is the specific one.

**Live: https://kami-web-one.vercel.app** — Vercel project `kami-web`
(`prj_fSbKysNQvRIsM9lYA0JL6k6BJiLx`), production branch
`claude/kami-platform-setup-rqz7nf`, root directory `apps/web`. Every push to
that branch deploys.

---

## Done

**Neon.** Project `kami` (`ancient-block-09757951`), Postgres 17, `aws-us-west-2`.
All three migrations are applied — 38 tables, 12 enums, 64 indexes, the evaluator
independence trigger and the two `entity_events` append-only triggers. Drizzle's
`__drizzle_migrations` is populated with the real file hashes, so
`pnpm --filter @kami/web db:migrate` from your machine is a no-op rather than a
re-run. Reachability is proven end to end: the every-minute `safe-poll` cron
returns 200, which it can only do after `authorizeCron` matches `CRON_SECRET`,
`getDb()` returns a client, and a query against `safe_proposals` succeeds.

**Boulder Creek is seeded.** One `entities` row, binding v1
(`6f30dff8fe18…`, review `pending_review`), soul v1 on hard rules v1, and one
hash-chained `entity_events` row (`entity.seeded`). It is **paused** and
**not consulted** — so its page 404s for the public and shows the preview
banner to role-holders, exactly as PRD §13 #4 requires. Nothing about the
consultation was faked; you have not had it yet. This is why the landing page
says "No kami are public yet".

**The crons exist.** `apps/web/vercel.json` is at the deployed project root,
which is the only directory Vercel reads it from. In `infra/` it was read by
nobody.

## Three things the first deploy taught us

1. **Node.** Vercel reads `engines.node` and it overrides the project setting,
   but only in `<major>.x` form. `">=22 <23"` was not recognised, Vercel used
   Node 24, and pnpm — which does understand the range — refused the install.
   Both tools were right. Vercel does not read `.nvmrc` at all.
2. **Workspace packages.** The five `@kami/*` packages resolve to
   `./dist/index.js`, `dist/` is gitignored, and `pnpm install` links workspace
   packages without building them. The build command is now
   `pnpm -w run build:packages && pnpm run build`, declared in `vercel.json`.
   This never failed locally because `dist/` was already on disk.
3. **The consultation gate leaked.** `GET /e/boulder-creek` answered 404 with
   the page's whole RSC payload in the body — a layout's `notFound()` does not
   stop a concurrently streaming page from rendering. Fixed in
   `lib/entity-access.ts`; every segment now gates itself.

---

## What only you can do

### ~~1. Create the Vercel project~~ — done

The Vercel MCP connector cannot create a project (`POST /projects` returns
**403 `forbidden`**; the grant is read-and-deploy). It was created by hand. The
connector can deploy to it, read its build logs and its runtime errors, so
creation is the only blocked verb and it is now behind us.

### ~~2. Paste the environment~~ — done

Project → Settings → Environment Variables → paste the block below into the bulk
editor, all three environments. Every value here is real: the database is
provisioned, the secrets were generated for this deployment and exist nowhere
else.

```
DATABASE_URL=<the Neon pooled string — in the handed-over env file>
BETTER_AUTH_SECRET=<generated for this deployment>
CHAT_COOKIE_SECRET=<generated for this deployment>
CRON_SECRET=<generated for this deployment>
HERMES_API_SERVER_KEY=<generated for this deployment>
```

The filled-in block was handed over out of band, not committed. **No secret goes
into this repository** — not here, not in `.env.example`, not in a commons note.
If you lose it: the Neon string is in the Neon console under project `kami`, and
the four generated secrets can be replaced with any 32 random bytes
(`openssl rand -base64url 32`) as long as you change them everywhere at once.

Then, once Vercel has given the project a URL, one more:

```
BETTER_AUTH_URL=https://<the-url-vercel-gives-you>
```

**Not yet set, and the site is designed to work without them:**

| variable | what stays off until it is set |
|---|---|
| `RESEND_API_KEY`, `RESEND_FROM` | Magic links are **printed to the Vercel function log** instead of emailed. That is enough to sign in as the first user, and it is a credential in a log — treat the deployment as unlisted until Resend is wired. |
| `R2_*`, `KAMI_DATA_BASE_URL` | No published `status.json`. Pages render from the database and the fixture; the hourly needs cron will write nothing. |
| `HERMES_GATEWAY_URL` | Chat says "I'm asleep — my thinking machine is off". This is the correct state until your Mac mini is tunnelled. |
| `STRIPE_*`, `PRIVY_*`, chain keys | Donations and the treasury are dark. Nothing in the pages depends on them. |

`BETTER_AUTH_SECRET` and `DATABASE_URL` are the only two the production build
refuses to start without (`src/env.ts`).

### 3. Become the platform admin

Sign in once at `/sign-in` with your email; the magic link will be in the Vercel
function log for `/api/auth/*`. Then tell me the address and I will run:

```sql
UPDATE users SET platform_admin = true WHERE email = '<your address>';
INSERT INTO entity_roles (entity_id, user_id, role, invited_at, accepted_at)
SELECT 'entity/boulder-creek', id, 'steward', now(), now() FROM users WHERE email = '<your address>';
```

That is what makes `/e/boulder-creek` visible to you — as an unconsulted entity
with the preview banner, which is the honest state — and gives you `/admin` and
the guardian screens.

---

## Then: checkpoint 1 of `first-entity.md`

```bash
bash scripts/kami-doctor --only storage
```

against the deployed URL. It will report the database reachable and the applied
migration count matching the `.sql` files in the repo. Everything after that is
the Mac mini, and `docs/deploy/first-entity.md` takes over.

---

## Seeding another entity

`scripts/seed-entity.ts` is the tool, and it does not fake consultation:

```bash
DATABASE_URL='…' pnpm --filter @kami/web seed:entity -- --slug <slug> --name '<Name>'
pnpm --filter @kami/web seed:entity -- --slug <slug> --print-sql   # when your shell cannot reach the database
```

It reads `profiles/<slug>/binding.yaml` and `profiles/<slug>/voice.md`, validates
the binding's shape, and writes the entity, its binding, its soul and the first
event of its hash chain. `--consultation <file>` records a real conversation and
publishes the page; without it the entity stays private, which is the default for
a reason.
