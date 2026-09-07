# Where Kami is

**As of 2026-09-07, commit `b9ac73b`, branch `main`.**
**Live at https://kami-web-one.vercel.app.**

This is the top of the documentation. It says what exists, what is proven, what is
deployed, and what is not true yet. For the row-by-row audit against the PRD — every
goal, rule and phase criterion mapped to code and to the test that proves it — read
[`traceability.md`](traceability.md), which is the authority when this file and that
one disagree.

One sentence before anything else, because it governs how to read the rest:

> **No language model has ever spoken as a kami.** Every chat path in every test runs
> against `HERMES_GATEWAY_URL=fake:`. The guard, the gate, the governance and the money
> are all built and tested; the thing they exist to guard has not yet said a word.

---

## 1. What the platform is

A website where each **kami** is an AI voice *for* one place — a creek, a watershed, a
reservoir, a mountain, a bioregion — grounded in the Front Range Bioregional Twin's
public sensor readings.

Each kami has:

| | |
|---|---|
| **a dashboard** | `/e/<slug>` — mood, meters per need, pulse log, strategy, board, treasury, people, siblings |
| **a chat** | `/e/<slug>/chat` — streaming, every number checked against a tool result from the same turn |
| **an avatar** | Rive state machine driven by measured conditions, with an SVG fallback per archetype × mood |
| **an external brain** | any MCP-capable agent, wired up at `/e/<slug>/connect` |
| **a body** | a *binding*: the twin place ids it speaks for, and which readings drive which needs |
| **a soul** | platform-owned hard rules (never editable) plus a ≤3-sentence voice block |
| **guardians** | ≥2 humans who hold the money, can pause it in one gateway tick, and sign every payout |

Anyone can create one at `/summon` — five resumable steps, no wallet or crypto knowledge
required — differing in their place binding, their voice, their strategy and their
avatar, but never in the hard rules or the guard.

## 2. The five rules everything else serves

1. **Every reading carries its own honesty.** `time, unit, source_id, stale, staleness_s,
   source_status` cross every boundary. Absent means unknown, never zero. Nothing is
   interpolated.
2. **Stale is not sad.** A stale driving need forces `mood: asleep`, never `distressed`.
   A kami whose gauge goes quiet says so; it does not grieve a dead feed.
3. **No geometry ever reaches a model.** No `coordinates` key enters a tool output or a
   prompt. Boundaries travel as URLs.
4. **Numbers must be earned.** Every number a kami utters must match an atom from a tool
   result in the same turn, or the sentence is dropped and the drop is counted in public.
5. **The agent never signs.** It proposes; two humans sign. The treasury MCP has exactly
   three tools and no signing dependency, enforced by a test that reads the dependency
   tree.

## 3. What is deployed, right now

| Piece | State |
|---|---|
| **Web app** | Live on Vercel (`kami-web`, root directory `apps/web`). Every push to the branch deploys. |
| **Database** | Neon Postgres 17 (`kami`, `aws-us-west-2`). 38 tables, 12 enums, 64 indexes, 3 triggers. All three migrations applied and recorded in `__drizzle_migrations`. |
| **Crons** | Twelve declared in `apps/web/vercel.json`. Verified running — `safe-poll` returns 200, which requires the cron secret to match, a database client to exist, and a query to succeed. |
| **First entity** | Boulder Creek seeded: binding v1 (`pending_review`), soul v1 on hard rules v1, first link of its hash chain. **Paused and not consulted**, so its page 404s and the landing page says "No kami are public yet". That is correct, not a bug. |
| **Agent** | Not connected. `HERMES_GATEWAY_URL` is unset, so chat says "I'm asleep — my thinking machine is off". |
| **Email** | Resend not wired; magic links print to the Vercel function log. Treat the URL as unlisted until it is. |
| **Storage** | R2 not wired; pages render from the database and the fixture, and the hourly needs job publishes nothing. |
| **Chain / money** | Dark. No Safe, no EAS attestations, no Stripe. Every UID in `infra/chain/state/config.example.json` is still `0x<uid>`. |

Set-up detail and the exact next steps are in [`deploy/first-deploy.md`](deploy/first-deploy.md).

## 4. The PRD's goals, in one line each

Verdicts are from [`traceability.md`](traceability.md), where each is justified against the
assertions in the named test rather than the test's name.

| | Goal | Verdict |
|---|---|---|
| **G1** | Guard re-scans every reply; 0 unguarded facts over 200 turns; ≥95 % correct refusals | **partial** — the 0-unguarded half is proven over a 204-turn corpus; the corpus is templated, not model output, and the ≥95 % probe has never met a real model |
| **G2** | A bounty closes with evidence → evaluator attestation → 2-of-3 Safe signature → `BountyCompleted` | **partial** — every link is unit-tested against a fake; none has run against a chain |
| **G3** | Landing to a live homepage in 20 minutes, no crypto knowledge | **partial** — the flow exists and the server's share is under a minute; the human 20 minutes is unmeasured |
| **G4** | `stale=true` forces the asleep state 100 % of the time | **proven** — a 1,000-case property test |
| **G5** | Zero on-chain value movement without ≥2 human signatures | **partial** — structurally enforced and unit-proven; never verified against a real Safe log |
| **G6** | Every donor gets a report within 31 days, 100 % coverage | **implemented, untested against the world** — coverage is asserted; the 31-day clock is implied by a cron schedule |
| **G7** | Persistent "AI voice for …" label, reminder cadence, a "how I work" page naming model, guard and guardians | **met** — the page reads the serving model from the gate's own report and lists accepted guardians |
| **G8** | Open source; ≥2 non-founder guardians; a pause halts everything within 60 s | **partial** — three enforcement points, each tested; the 60 s is unmeasured and no pause drill has been run |

**Phase position.** The PRD's phase 1 and 2 machinery is built. Phase 3 (self-serve
summoning) is built and untested by anyone but its author. What separates the project
from phase 1 *complete* is not code: it is a model that has spoken, a pause drill that
has been run, and a bounty that has closed.

## 5. What is built

Seventeen work packages, 45 commits, 1,333 tracked files.

| Area | Where | Tests |
|---|---|---|
| Twin MCP server (15 tools, 4 resources) | `packages/twin-mcp` | 73 unit + 25 contract |
| Twin client + place-set binding | `packages/twin-client`, `packages/binding` | 25 + 19 |
| Needs, mood, bands, season, Rive inputs | `packages/needs` | 144 |
| Fact guard (atoms, units, tolerance) | `packages/factguard` | part of 297 Python |
| Entity gate (pause → crisis → budget → slot → guard) | `apps/gate` | part of 297 Python |
| Treasury MCP (keyless, 3 tools) | `packages/treasury-mcp` | part of 297 Python |
| Evals (replay, live probe, judge, fine-tune skeleton) | `evals` | part of 297 Python |
| Web app — pages, jobs, governance, money, connect | `apps/web` | 761 across 84 files |
| Chain scripts (EAS, Hats, Safe, Roles) | `infra/chain` | 53 |
| Hermes profiles, deploy and pause scripts | `profiles` | 38 |
| Reputation v1 + recompute CLI | `packages/reputation` | 58 |
| Browser end-to-end | `e2e` | 41 |

**Totals: 1,493 automated tests** — 1,196 TypeScript across the packages and the web app
(including the twin server's 25 contract tests, which run as a separate suite against the
checked-in fixture tree) and 297 Python — plus 41 Playwright specs. Sixteen ADRs record the decisions that were not
obvious. Every unresolved uncertainty has a numbered row in [`verify.md`](verify.md); every
place the build deviates from the planning docs is named in `traceability.md` §4.

## 6. What changed after the audit

`traceability.md` was written against commit `1c1370d`. Since then:

**The audit's five findings were fixed**, not filed — the consultation gate that gated
nothing, the CI job that matched no package, the gate defaulting to fail-open, the
passthrough flag with nothing stopping it in production, and the "how I work" page that
named neither the model nor the guardians. `traceability.md` §6 has the detail.

**Model provenance became reported rather than asserted.** The gate can point at a hosted
OpenAI-compatible API, which is what happens while the DGX Spark is pending — so the page
that exists to be checkable can no longer carry a hardcoded claim about local weights. It
renders what the gate last reported, and withholds the claim entirely when that report is
older than 24 hours.

**`kami doctor` was written** — seven checks in dependency order, saying which piece is
broken rather than that something is. Its best check sends a fabricated tool result and a
wrong number through the guard and asserts the sentence is dropped.

**The connect flow was built** — `/e/<slug>/connect`, the in-product walkthrough for
wiring any MCP-capable agent to a kami: the endpoint, a bearer token minted and shown
once, the generated tool catalogue read out of the running MCP server, a downloadable
profile bundle, and six live status signals that say *waiting* rather than pretending.

**It was deployed**, which taught three things nothing local could have:

1. Vercel reads `engines.node` only in `<major>.x` form; a semver range silently fell
   through to Node 24 and pnpm refused the install. Both tools were right.
2. `pnpm install` links workspace packages without building them, so `next build` could
   not resolve a single `@kami/*` import on a fresh clone. It worked locally only because
   `dist/` was already on disk.
3. A layout's `notFound()` does not stop a page from rendering. The consultation gate
   returned 404 with the entity's whole RSC payload — the People section included — in the
   response body. Every segment now gates itself.

**And a repository cleanup found a file that was in no clone.** An unanchored `state/` in
`.gitignore` excluded `apps/web/src/app/api/entities/[slug]/state/route.ts`, the endpoint
the treasury MCP calls to check whether an entity is paused. It worked locally, passed
every test, and 404'd in production. The same rule silenced a second file by excluding the
directory a nested `.gitignore` was trying to make an exception in.
`scripts/checks/no-ignored-source.sh` now fails the build on the next one.

## 7. What is not true yet

Ordered by how much it matters, and all of it is in `traceability.md` §4 with citations.

1. **No model has spoken.** Everything about voice, guarding and cost is theory until one
   does. This is checkpoint 2 of [`deploy/first-entity.md`](deploy/first-entity.md).
2. **The guard has never guarded a real reply.** The 204-turn replay corpus is composed by
   template — honest turns honest by construction, adversarial turns planting exactly one
   thing the guard must strike. It proves the matcher, not the model.
3. **Nothing has touched a chain.** No Safe, no hat, no attestation. Every UID in the
   chain config example is a placeholder.
4. **The twin's live tree has never been read.** The sandbox cannot reach
   `data.bioregionaltwin.org`, so every fixture is synthetic, built from the twin's own
   checked-in fixtures and a close reading of its publisher. `refresh-fixtures` against the
   live tree is the first thing to run once it is reachable — see
   [`handoff/twin-mcp.md`](handoff/twin-mcp.md).
5. **No percentiles.** Until the twin publishes baselines, a kami cannot say "low for
   September". It can give a number and a trend, and it says so plainly rather than
   guessing. This is the single change that would most improve what a kami can honestly
   tell someone.
6. **No pause drill has been run.** `docs/drills/` holds a README and nothing else, and
   the 60-second criterion in G8 depends on a drill.
7. **Rive files are not commissioned.** Every avatar is the SVG fallback. The
   commissioning brief and a dev rig at `/dev/rig` are ready for an artist.
8. **The 20-minute summon is unmeasured** and **the 31-day donor clock is a cron
   schedule**, not an assertion.

## 8. What happens next

**To make the first kami speak** — the whole point, and four checkpoints in
[`deploy/first-entity.md`](deploy/first-entity.md), each gated on `kami doctor`:

1. `BETTER_AUTH_URL`, sign in, become platform admin and steward of Boulder Creek.
2. Hold the Boulder Creek consultation and record it. Until then its page is private,
   which is the design.
3. Point the gate at a hosted OpenAI-compatible API, run the Mac mini as the Hermes
   host, tunnel it, set `HERMES_GATEWAY_URL`. Chat wakes up.
4. Run the hallucination probe against that model. G1's second half becomes real, or it
   does not and we learn something.

**To make it say something worth hearing** — the twin needs to publish baselines. That is
ask #3 in [`handoff/twin-mcp.md`](handoff/twin-mcp.md), and it is the biggest one.

**Before anyone else is invited** — run a pause drill, wire Resend, commission the Rive
files, and close one tier-1 bounty end to end on a testnet.

---

## Reading order

| If you want | Read |
|---|---|
| the five rules and how to run it | [`../README.md`](../README.md) |
| what is true against the PRD, row by row | [`traceability.md`](traceability.md) |
| every open uncertainty, numbered | [`verify.md`](verify.md) |
| why a non-obvious decision was made | [`adr/`](adr/) — 16 records |
| how to deploy, and what the first deploy taught | [`deploy/`](deploy/) |
| how to get the first kami speaking | [`deploy/first-entity.md`](deploy/first-entity.md) |
| what the twin needs to do | [`handoff/twin-mcp.md`](handoff/twin-mcp.md) |
| what a kami may never do | `profiles/templates/SOUL.hard-rules.md` |
| what to do when something breaks | [`runbooks/`](runbooks/) |
| columns the schema wants | [`schema-gaps.md`](schema-gaps.md) |

Built by Benjamin Life ([@omniharmonic](https://github.com/omniharmonic)). Apache-2.0.
