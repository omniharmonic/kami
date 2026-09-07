# @kami/web

The public Kami platform: Next.js 16 App Router (Node runtime everywhere), Neon Postgres via Drizzle, Better Auth magic links, and the streaming chat relay to the Hermes gateway. Architecture: `docs/planning/02-technical-architecture.md` §6; data model: Appendix B (implemented in full under `src/db/schema/`).

## Run it with no database, no GPU

```bash
pnpm install
pnpm --filter @kami/web dev
# open http://localhost:3000/e/boulder-creek
```

With no `.env.local` at all the app runs from two fakes:

- **Status**: `KAMI_DATA_DIR` defaults (outside production) to `src/fixtures/status/`, which holds `boulder-creek.json` — the all-stale 2026-09-06 build (mood `asleep`, "I can't feel my gauge", flow stale at Orodell, storage 72 % live, drought D1). The page renders from it with a visible "as of"; every DB read falls back to an empty state.
- **Gateway**: An unset `HERMES_GATEWAY_URL` returns an explicit asleep state. Set `HERMES_GATEWAY_URL=fake:` only for development/testing to stream a canned reply plus the trailing `event: toolcalls`. Variants: `fake:asleep` (tunnel down → the asleep line as a system message, `X-Kami-State: asleep`), `fake:busy` (429 with `people_ahead`), `fake:paused` (423), `fake:fast` (no delays; used by tests).

Add `DATABASE_URL` and `BETTER_AUTH_SECRET` to get sessions, roles and chat persistence; add `RESEND_API_KEY` to actually send magic links (without it the link is printed to the server log).

## Commands

| command | what |
|---|---|
| `pnpm --filter @kami/web dev` / `build` / `start` | Next.js |
| `pnpm --filter @kami/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @kami/web test` | Vitest: PGlite migrations + hash chain + triggers, auth against PGlite, chat handler with the fake gateway, component render tests (jsdom) |
| `pnpm --filter @kami/web db:generate` | `drizzle-kit generate` → `src/db/migrations/` (commit the SQL) |
| `pnpm --filter @kami/web db:migrate` | apply migrations to `DATABASE_URL` (idempotent) |
| `pnpm --filter @kami/web db:migrate:pglite` | apply migrations to a throwaway in-memory PGlite |
| `SKIP_ENV_VALIDATION=1 pnpm --filter @kami/web build` | CI build without secrets |

## Environment

Parsed once in `src/env.ts` with zod. `SKIP_ENV_VALIDATION=1` skips validation (CI builds); in production `DATABASE_URL` and `BETTER_AUTH_SECRET` are required. Nothing here is `NEXT_PUBLIC_*`.

| variable | required | purpose |
|---|---|---|
| `DATABASE_URL` | prod | Neon pooled URL (or local Postgres) |
| `DB_DRIVER` | no | `neon` \| `pg`; auto: neon on Vercel / `*.neon.tech`, else pg |
| `BETTER_AUTH_SECRET` | prod | session signing (≥ 16 chars) |
| `BETTER_AUTH_URL` | no | canonical origin, default `http://localhost:3000` |
| `RESEND_API_KEY`, `RESEND_FROM` | no | magic-link mail; without a key the link is logged |
| `KAMI_DATA_DIR` | no | local dir with `entity/<slug>/status.json` or `<slug>.json`; dev default `src/fixtures/status` |
| `KAMI_DATA_BASE_URL` | no | R2 public base URL; read with `cache: "no-store"` |
| `HERMES_GATEWAY_URL` | no | `http://gw:8642` in prod; default unset (asleep) |
| `HERMES_API_SERVER_KEY` | prod | bearer for the gateway |
| `CHAT_COOKIE_SECRET` | no | HMAC key for the anonymous chat cookie (falls back to `BETTER_AUTH_SECRET`) |

## Layout

```
src/app/                  routes: /, /sign-in, /e/[slug], /e/[slug]/chat, /e/[slug]/how-i-work, /api/auth/[...all], /api/e/[slug]/chat
src/proxy.ts              Next 16 proxy: rewrites POST /e/[slug]/chat → /api/e/[slug]/chat (a page and a route cannot share a segment)
src/components/           EntityShell (disclosure invariant), Avatar (SVG fallback; Rive lands later), Meters, PulseLog, Strategy, Board, Treasury, People, Siblings, HowIWorkLink, Chat (client), Reminder
src/copy/index.ts         every user-facing string
src/db/schema/            Appendix B in Drizzle; src/db/migrations/ generated SQL + 0001 (evaluator independence trigger) + 0002 (entity_events append-only)
src/db/events.ts          appendEntityEvent / verifyEventChain (sha256 hash chain)
src/db/test-utils.ts      PGlite + migrator for tests
src/lib/                  auth (Better Auth + magic link + age gate), session (getSession/requireRole/requireAdmin), status (status.json loader), gateway (Hermes client + fake), chat-handler (the relay, DI'd), chat-deps (Neon/memory), ratelimit, anon (signed cookie), entities (page reads)
src/fixtures/status/      boulder-creek.json
public/rigs/fallback/     <archetype>-<mood>.svg placeholders
```

## Invariants this app enforces

- The disclosure label is rendered by `EntityShell` on every `/e/*` route and again at the top of every chat session (ADR-E13); `Chat` marks reply nodes `data-generated="ai"` and renders the "what I looked at" footer from the gate's `toolcalls` event (place id, time, source, stale).
- The SB 243 reminder is counted by the web app (`chat_sessions.turns`, `config.reminder_every_turns`, default 12) and injected as `event: reminder`, never by the model.
- `entities.paused_at` → `POST /e/[slug]/chat` answers 423 `{reason:"paused"}` before anything reaches the gateway (ADR-E12).
- Stale readings render a grey ring labelled "can't feel it" with their last value and time; nothing is interpolated (ADR-E11).
- `entity_events` is append-only by trigger and by role grants; the hash chain is verifiable by anyone with SELECT.
- No password field exists; sign-in requires the "I am 13 or older" declaration server-side.

## Deviations from the planning docs (see the report)

- Chat handler lives at `src/app/api/e/[slug]/chat/route.ts` with a `proxy.ts` rewrite, because Next forbids `route.ts` next to `page.tsx`.
- `users` gains `email_verified`, `image`, `updated_at` (Better Auth requirements); `email` is `text` with a lowercase CHECK instead of `citext`; `chat_sessions.ip_hash` added for the 60/day/IP limit; `reputation_scores.entity_id` is NOT NULL (it is in the PK).
- The status file may carry an optional `entity: {name, archetype, anchor}` block so a page can render with no DB at all.
