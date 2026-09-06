# The first deploy — what is done, and the two things only you can do

Written 2026-09-06, during the deploy. This is the live state of the hosted half,
not a plan. `vercel.md` is the general procedure; this is the specific one.

---

## Done

**Neon.** Project `kami` (`ancient-block-09757951`), Postgres 17, `aws-us-west-2`.
All three migrations are applied — 38 tables, 12 enums, 64 indexes, the evaluator
independence trigger and the two `entity_events` append-only triggers. Drizzle's
`__drizzle_migrations` is populated with the real file hashes, so
`pnpm --filter @kami/web db:migrate` from your machine is a no-op rather than a
re-run.

**Boulder Creek is seeded.** One `entities` row, binding v1
(`6f30dff8fe18…`, review `pending_review`), soul v1 on hard rules v1, and one
hash-chained `entity_events` row (`entity.seeded`). It is **paused** and
**not consulted** — which means its page 404s for the public and shows the
preview banner to role-holders, exactly as PRD §13 #4 requires. Nothing about the
consultation was faked; you have not had it yet.

**`vercel.json` moved** to `apps/web/vercel.json`, the deployed project root,
which is the only directory Vercel reads it from. In `infra/` it was read by
nobody and the twelve crons would silently not have existed.

---

## What only you can do

### 1. Create the Vercel project (about a minute)

The Vercel connector in this session can read your team and your 38 projects, but
`POST /projects` comes back **403 `forbidden`**. The grant is read-and-deploy, not
create. So:

* **New Project** → import `omniharmonic/kami`
* **Framework** Next.js (auto-detected)
* **Root Directory** `apps/web` — this matters; it is why `vercel.json` lives there
* **Production Branch** `claude/kami-platform-setup-rqz7nf` (the only branch that
  exists; change it when you cut a `main`)
* Node 22

Once it exists I can deploy to it, read its build logs and its runtime errors
through the connector — creation is the only blocked verb.

### 2. Paste the environment

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
