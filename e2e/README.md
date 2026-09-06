# `@kami/e2e` — the end-to-end suite

Playwright, Chromium only, phone viewport (390 × 844). It runs the **production build** of
`@kami/web` against a fixture `status.json`, a fake gateway, and **no database at all** — so what
it proves is not "the app works when everything is up" but "the app is honest when nothing is".

Plan §1.1 (the `e2e` CI job), T1.3 and T1.5 (the five required tests), X.5 (accessibility).

## Run it

```bash
pnpm install
pnpm --filter @kami/e2e exec playwright install --with-deps chromium   # once
pnpm --filter @kami/e2e test                                          # builds, then runs
```

`test` does three things, in order: checks a Chromium exists (and exits 0 with instructions if it
does not, so the root `pnpm test` does not fail on machines with no browsers), runs
`pnpm build:packages` and `next build`, then `playwright test`. Extra arguments pass straight
through:

```bash
pnpm --filter @kami/e2e test -- --workers=1               # a loaded machine
pnpm --filter @kami/e2e test -- chat.spec.ts              # one file
pnpm --filter @kami/e2e test -- --headed --project=chromium
KAMI_E2E_SKIP_BUILD=1 pnpm --filter @kami/e2e test        # the build is already current
pnpm --filter @kami/e2e run test:no-build                 # playwright only, never builds
```

The CI job runs `playwright install --with-deps chromium` and then `pnpm --filter @kami/e2e test`;
nothing else is needed, because the build is inside the `test` script.

| variable | default | what |
|---|---|---|
| `KAMI_E2E_PORT` | `3100` | the normal server |
| `KAMI_E2E_PAUSED_PORT` | `3101` | the paused server |
| `KAMI_E2E_SKIP_BUILD` | unset | skip `build:packages` + `next build` |
| `CI` | unset | 1 retry, 1 worker, HTML report, no server reuse |

## What the harness is made of

Two servers, one build, one fixture directory:

| port | `HERMES_GATEWAY_URL` | used by |
|---|---|---|
| 3100 | `fake:` | everything except `paused.spec.ts` |
| 3101 | `fake:paused` | `paused.spec.ts` (Playwright project `chromium-paused`) |

Both get `SKIP_ENV_VALIDATION=1`, `CHAT_COOKIE_SECRET` (a fixture value, not a secret), and
`KAMI_DATA_DIR=e2e/fixtures/data`. Neither gets `DATABASE_URL`: Neon is unreachable by
construction, which is exactly the ADR-E14 condition `offline.spec.ts` asserts.

### The gateway fixture modes

`apps/web/src/lib/gateway.ts` treats a `HERMES_GATEWAY_URL` beginning `fake:` as an in-process
stand-in for the Hermes gateway on the GPU box. No network, no GPU, no model.

| mode | what it does | what it is for |
|---|---|---|
| `fake:` | streams three canned sentences 40 ms apart, then `event: toolcalls` with two tool calls (one stale at Orodell, one fresh at Gross Reservoir), then `[DONE]` | the default; the chat, disclosure, a11y and no-token specs |
| `fake:fast` | the same with no delays | unit tests; not used here, because the 40 ms gaps are part of what `chat.spec.ts` measures |
| `fake:paused` | every completion is 423 | `paused.spec.ts` — the gate refusing, ADR-E12 |
| `fake:busy` | 429 with `people_ahead: 3` and `Retry-After: 30` | the over-budget path; covered by `apps/web` unit tests |
| `fake:asleep` | a connection failure → the app streams the "asleep" system line with `X-Kami-State: asleep` | the tunnel-down path; covered by `apps/web` unit tests |

The canned sentences and tool calls are duplicated as constants in `tests/helpers.ts`. If the fake
gateway changes, that file is the one to update — the duplication is deliberate, so a change to the
fixture cannot silently change what the tests assert.

### The status fixture

`fixtures/data/entity/boulder-creek/status.json` is a copy of
`apps/web/src/fixtures/status/boulder-creek.json`: the all-stale 2026-09-06 build. Flow at Orodell
is stale (`source_status: critical`, last read 2026-09-04 20:15Z) and so is air at Athens St;
storage, snow, water quality and drought are fresh. Because a driving need is stale the snapshot's
mood is `asleep` and its reason is "I can't feel my gauge" — never distressed (G4, ADR-E11).

It lives here rather than being imported so the harness can be pointed at other fixtures later;
`stale.spec.ts` and `offline.spec.ts` read the file itself and assert the page against it, so the
two can never drift apart silently.

Each test gets its own `X-Forwarded-For`, because the app limits anonymous chat to 60 turns per day
per IP; without that, the twelve-turn reminder test would poison every later test in the run.

## The specs

| file | what it proves | doc |
|---|---|---|
| `disclosure.spec.ts` | the label is on **every** `/e/*` route, names the place, says "not the creek, not a legal person", and is above the fold on a phone | ADR-E13, PRD §6.6, G7 |
| `chat.spec.ts` | the reply streams sentence by sentence, the "what I looked at" footer names place id / time / source / stale, reply nodes are `data-generated="ai"`, the SB 243 reminder is rendered by the app on turn 12 | T1.5, §11 |
| `paused.spec.ts` | the gate's 423 becomes "I'm paused by my guardians" and **no** reply text is rendered | ADR-E12, G8 |
| `stale.spec.ts` | grey "can't feel it" rings on stale needs, the avatar's `aria-label` says it cannot feel its gauge, mood `asleep` and never distressed, every meter's value/unit/time/source as text | ADR-E11, G4, T1.3 |
| `reduced-motion.spec.ts` | the static SVG pose renders, no Rive canvas is created, no `.riv` is fetched | PRD §6.3, X.5 |
| `no-token.spec.ts` | the landing page states the policy; no route offers, prices or governs by a token; donation copy has no urgency language | PRD §13 #2, #8 |
| `a11y.spec.ts` | axe-core with zero serious/critical, no information by colour alone, 44 px targets, ordered headings | X.5 |
| `offline.spec.ts` | with no database the entity page still renders from `status.json` with a visible "as of" | ADR-E14, PRD §6.5 |

### Three tests are skipped, each with its reason in its own name

1. `disclosure.spec.ts` — `/e/<slug>/proposals/<id>` needs a bounty row, and there is no database
   here. The other four `/e/*` routes are covered.
2. `chat.spec.ts` — **gzip buffers the chat stream.** `next start` compresses `text/event-stream`,
   which holds the whole reply until the end; a browser therefore sees one lump, not three
   sentences. The identity-encoding test beside it proves the relay itself streams. The fix is in
   `apps/web`, which this package does not own.
3. `a11y.spec.ts` — **`--ink-faint` (#8a8176) fails WCAG AA contrast**: 3.43:1 on `--bg`, 3.77:1 on
   `--bg-raised`, 3.12:1 on `--bg-sunken`, against a 4.5:1 requirement at these sizes; 43 nodes on
   the entity page alone. The axe pass still runs with that one rule disabled, so nothing else can
   regress behind it. The fix is one design token in `apps/web/src/app/globals.css`.

## When something fails

- **`429` from the chat route** — the per-IP daily budget. Use `useFreshIp(page)` in any new test
  that sends a turn.
- **Chunk or hydration errors after a rebuild** — a `next start` from the previous build is still
  running. `pnpm --filter @kami/e2e test` kills anything on 3100/3101 after building; if you
  started a server by hand, stop it.
- **`Executable doesn't exist`** — run `pnpm --filter @kami/e2e exec playwright install chromium`.
- **A timeout under load** — re-run once with `--workers=1` before believing it.
- **`The destination stream closed early`** in the server log is a page navigating away mid-stream;
  it is the browser, not the app.

Traces are kept on the first retry (`trace: "on-first-retry"`); `pnpm --filter @kami/e2e run report`
opens the HTML report after a CI-style run.
