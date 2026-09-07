# PRD traceability and honest gaps

> **This is a dated audit, not a live status.** It was written against `1c1370d`, before the
> deployment, the connect flow and the fixes in §6 and after. For where the project is *now*,
> read [`STATUS.md`](STATUS.md); come back here for the row-by-row justification, which is
> still the authority on what each verdict rests on.

**Audit date:** 2026-09-06 · **HEAD at start:** `1c1370d`; `25f4859` (an e2e fix by a concurrent
agent) landed mid-audit and is reflected in §5 · **Auditor:** an agent reading the code, not the
commit messages.

This document maps every goal, rule, mechanism and phase criterion in `docs/planning/01-PRD.md` to
the code that implements it and the test that proves it, and then lists — bluntly — what a reader
who has only read the PRD would be surprised to learn.

**Method.** Every verdict below was checked by reading the assertions in the named test, not the
test's name. Where a test asserts against a fake, a fixture or a mock rather than the real
dependency, the row says so. Where a criterion cannot be proved in this sandbox (no GPU, no chain,
no Postgres server, no reachable twin, no Stripe, no browser-visible Rive), the row says that too
rather than counting the surrounding code as proof.

**Verdicts** are exactly one of: **proven** (an automated test asserts the criterion itself),
**implemented, untested**, **partial** (what is missing is named), **deferred** (with the reason and
where it is recorded), **not implemented**.

**One live caveat.** Another agent was fixing `e2e/tests/{a11y,reduced-motion}.spec.ts` while this
audit ran; that work landed as `25f4859` and I re-ran the suite afterwards. Nothing else in the tree
changed under me. (`evals/out/replay-report.json` is generated output that happens to be present in
the working tree; it is git-ignored.)

---

## 1. Goals G1–G8

| # | The PRD's own success criterion (verbatim) | Code | Test | Verdict |
|---|---|---|---|---|
| **G1** | "An automated guard re-scans every reply for numbers, dates, places and species and matches them to tool results in the same turn; 0 unguarded facts published across a 200-turn eval; ≥95% correct 'I don't have a reading for that' on a held-out hallucination probe" | `packages/factguard/src/factguard/{atoms,extract,match,sentences,units,guard,gazetteer}.py`; `apps/gate/src/entity_gate/{app.py,stream.py,guard_hook.py}`; `evals/kami_evals/{replay,live}.py` | **First half:** `evals/tests/test_replay.py::test_ci_run_passes_on_the_checked_in_corpus` asserts `report["unguarded_published"] == 0` over `evals/fixtures/replays/boulder-creek-200.jsonl` (204 turns, 412 sentences, 73 dropped, drop rate 0.177). **Second half:** `evals/tests/test_live.py::test_hallucination_probe_passes_when_the_model_declines` runs `kami_evals.live` against `evals/tests/fake_endpoint.py`, an in-process ASGI fake that returns canned replies. | **partial** |
| **G2** | "A tier-1 or tier-2 bounty (§7) closes with evidence, an evaluator attestation, a Safe transaction signed by ≥2 humans, and a `BountyCompleted` EAS attestation carrying the Safe tx hash" | `apps/web/src/lib/governance/*`, `apps/web/src/lib/signing/{validate,proposer,relayer,attester}.ts`, `apps/web/src/lib/treasury/{propose,confirm,safe-poll}.ts`, `infra/chain/src/*` | Each *link* is tested against a fake (`apps/web/src/lib/treasury/__tests__/fakes.ts`, `safe-poll.test.ts`, `propose.test.ts`, `confirm.test.ts`; `infra/chain/test/safe-tx.test.ts`). No test joins them, and no real bounty has closed: `infra/chain/state/config.example.json` still contains `"0x<uid>"` placeholders. | **partial** — every step exists, nothing has run against a chain |
| **G3** | "Timed from landing to a live homepage with avatar, place set, soul, and two invited guardians; no wallet, seed phrase, or crypto knowledge required (phase 3)" | `apps/web/src/app/summon/**`, `apps/web/src/lib/summon/{draft,propose,soul,safe}.ts` | `apps/web/src/lib/summon/__tests__/flow.test.ts::"completes every server-side step and creates entity + binding + soul + two invites"` — but it asserts `elapsedMs < 20*60_000/20`, i.e. the *server's* share of the work is under one minute. The test's own comment says so. No browser test and no human timing. | **partial** — the flow exists and is server-side fast; the 20-minute human criterion is not measured |
| **G4** | "Automated test: `stale=true` on any driving reading forces the 'can't feel it' state 100% of the time regardless of other inputs; mood otherwise is a documented function of percentile-vs-record and drought class" | `packages/needs/src/{mood,bands,snapshot,season,rive}.ts` | `packages/needs/test/mood.test.ts::"G4 — stale ≠ sad (property, 1,000 cases)"` — fast-check over 1,000 generated cases asserts `snap.mood === "asleep"`, `mood_reason === "I can't feel my gauge"`, `mood !== "distressed"`, and `health === null` on every stale need. `bands.test.ts` (64 cases) pins each published band table. | **proven** |
| **G5** | "v1: zero on-chain value movement without ≥2 human Safe signatures, verified against the Safe transaction log; the agent key is a Transaction-Service proposer, never an owner" | `infra/chain/src/safe-tx.ts` (`InsufficientConfirmations`, line 256), `deploy-safe.ts` (`assertOwnersValid`, line 36), `packages/treasury-mcp/**` (keyless, three tools), `apps/web/src/lib/signing/{relayer,validate}.ts` | `packages/treasury-mcp/tests/test_tools.py::test_tool_list_is_exactly_three`, `tests/test_no_signing_libs.py` (4 tests: declared deps, transitive tree, loaded modules, source grep); `infra/chain/test/deploy-safe.test.ts::"throws when the deployer is an owner"`; `infra/chain/test/safe-tx.test.ts` covers the below-threshold refusal. All chain interaction is mocked. | **partial** — the property is structurally enforced and unit-proven; "verified against the Safe transaction log" has never happened |
| **G6** | "Every donor receives a report within 31 days of month-end listing each payout with amount, recipient handle, Safe tx hash, and attestation UID; 100% coverage, measured" | `apps/web/src/lib/reports/donor-report.ts`, `apps/web/src/app/api/cron/donor-report`, `apps/web/vercel.json` (`0 6 1 * *`) | `apps/web/src/lib/reports/__tests__/donor-report.test.ts` — 12 tests, including "sends when clean: a report row, sent_at after the mail, and 100 % coverage of donors of record", "gathers the balance, inflows by rail and payouts with tx hash, UID and thumbnails", "leaves sent_at null when a donor mail fails". Mail is a fake; the coverage denominator is "donors of record" in PGlite. | **implemented, untested against the real world** — the *31-day* clock is implied by the cron schedule, not asserted anywhere |
| **G7** | "Persistent 'AI voice for …' label on every page and in every chat session; SB 243 reminder cadence implemented; a public 'how I work' page names the model, the guard, and the guardians" | `apps/web/src/components/{EntityShell,DisclosureLabel,Chat}.tsx`, `apps/web/src/app/e/[slug]/layout.tsx`, `apps/web/src/lib/chat-handler.ts` (`DEFAULT_REMINDER_EVERY = 12`), `apps/web/src/app/e/[slug]/how-i-work/page.tsx` | `apps/web/src/components/__tests__/EntityShell.test.tsx` (label under the avatar, above content, present with no snapshot); `apps/web/src/lib/__tests__/chat-handler.test.ts::"emits event: reminder at turn 12"` and "…every N turns across a session"; `e2e/tests/disclosure.spec.ts` (4 routes × 2 assertions, plus a chat-session test and one explicitly skipped route). | **partial** — label and reminder are proven; **the "how I work" page does not name the model** (copy reads "A small open-weights language model…"; only the Hermes profile slug is shown) **and does not name the guardians** (they are on the homepage `People` section instead) |
| **G8** | "Open source; the entity registry, `SOUL.md` and the guard are public; ≥2 guardians per entity who are not the founder; a guardian-triggered pause halts cron, chat, and proposals within one gateway tick (60 s per B2 §1.1)" | Apache-2.0 `LICENSE`; `apps/web/src/lib/jobs/pause.ts`, `apps/web/src/lib/governance/pause.ts`, `apps/gate/src/entity_gate/pause.py`, `profiles/scripts/src/{pause,pause-drill}.ts`, `apps/web/src/lib/signing/validate.ts:86` | `apps/gate/tests/test_gate.py::test_row16_paused_slug_returns_423_before_any_upstream_call`; `apps/web/src/lib/jobs/__tests__/pause.test.ts::"one guardian pauses; one cannot resume; two distinct guardians can"`; `profiles/scripts/test/pause.test.ts` (pause POSTs the gate, writes the marker). | **partial** — the three enforcement points each have a test, but **no test measures the 60 s**; `docs/drills/` contains only `README.md`, so the drill the criterion depends on has never been run |

### Notes on G1, since it is the load-bearing goal

- The 204-turn corpus is **not model output**. `evals/scripts/build_replay.py` composes every reply
  from the paired snapshot by template ("the honest ones are honest by construction and the
  adversarial ones plant exactly one thing the guard must strike"). The replay gate is therefore a
  **guard regression test**, not a measurement of any model. That is a legitimate and well-built CI
  gate; it is not the thing G1's first clause describes if you read "published across a 200-turn
  eval" as meaning a model was talking.
- The hallucination probe has **never been run against a real model**, and cannot be here: there is
  no GPU, no vLLM, and `data.bioregionaltwin.org` is unreachable from the sandbox (`CLAUDE.md`).
  `evals/kami_evals/live.py` is the runner that would do it; its tests drive it against
  `evals/tests/fake_endpoint.py`. The ≥95 % threshold exists as `thresholds.json.hallucination_min`
  and `thresholds.py` validates its *type and range*, not any measured rate.
- Both facts are stated honestly in `evals/README.md` ("Nothing in the suite reaches a GPU, the
  gate, the twin, or any model provider"). The PRD's G1 row does not carry that caveat.

---

## 2. The five "carry in your head" rules

| # | Rule | Mechanism | Structural or conventional? |
|---|---|---|---|
| 1 | **A kami may only say numbers that came back from a twin tool call in the current turn.** | `entity-gate` is an OpenAI-compatible reverse proxy that sees every completion (`apps/gate/src/entity_gate/app.py`); `StreamingGuard` releases sentence by sentence, withholding any whose atoms do not match the fact sheet built from `tool` messages after the last `user` message. Hermes is pointed at the gate, never vLLM, by `profiles/templates/config.yaml.tmpl` (`base_url: {{gate_url}}`). | **Structural where it is wired, conventional at the wiring.** The proxy cannot be talked around by the model — but it *can* be talked around by configuration: `GateConfig.passthrough` (default `False`) skips the guard entirely (`app.py:135`, `config.py:51`), and nothing but a comment in `infra/box/gate.yaml.example` stops it being `true` on the box. The web app also never talks to vLLM itself — but only because `HERMES_GATEWAY_URL` points at the gateway; `gateway.ts` accepts any URL. |
| 2 | **The agent proposes; humans sign; the twin verifies.** | `packages/treasury-mcp` declares three tools and no signing dependency; `scripts/checks/treasury-mcp-keyless.mjs` parses its `pyproject.toml`, walks its sources for forbidden imports and key-shaped identifiers, and asserts no execute/sign tool is named. `packages/treasury-mcp/tests/test_no_signing_libs.py` re-checks the declared deps, the resolved transitive tree, `sys.modules` after import, and the sources. `infra/chain/src/safe-tx.ts:256` refuses to relay below threshold; `deploy-safe.ts:36` refuses to deploy a Safe whose deployer is an owner. | **Structural.** This is the strongest rule in the repo: it is enforced by absence (no key, no library), by a Safe threshold the platform cannot change, and by two independent checks. Two softenings: `scripts/checks/treasury-mcp-keyless.mjs` **is not run in CI** (see §4), and the relayer reads `confirmationsRequired` from the Safe Transaction Service rather than from the chain — though the Safe contract itself would reject an under-signed `execTransaction` regardless. |
| 3 | **Stale is not sad.** | `packages/needs/src/mood.ts:130` — rule 2, before every distress rule; `stale_driving` forces `mood: "asleep"`. Stale needs carry `health: null` so they cannot enter any aggregate. `packages/twin-mcp/src/envelope.ts` requires the five honesty fields on every reading crossing the MCP boundary. | **Structural**, and the best-proven claim in the repo (1,000-case property test, plus 28 rule tests). |
| 4 | **No token, ever.** | `docs/no-token.md`; `apps/web/src/copy/__tests__/copy.test.ts` walks every string exported from `src/copy` and fails on speculative token senses (`tokenomics`, `airdrop`, "our token", "token sale/launch/price/holders/supply/swap", `$KAMI`, "buy … tokens") unless the same string is a refusal; a second test requires that at least one string refuses plainly. `e2e/tests/no-token.spec.ts` checks the rendered money copy. | **Conventional, well-executed.** It is a lint over one module. Nothing prevents a user-facing string being written outside `src/copy/` — `EntityShell.tsx` already hardcodes `"Home"` — so the guarantee is "no token language in the copy module", not "no token language on the site". There is of course no token contract anywhere; the *substantive* rule holds trivially. |
| 5 | **The platform reads the twin like a browser does and never writes into it.** | `packages/twin-client/src/client.ts` — a GET-only client; `userAgent` is required by the constructor (throws otherwise, line 178), `DEFAULT_MIN_INTERVAL_MS = 60_000` is a per-path floor honoured even under `force` (line 151). `packages/twin-mcp` reads a tree by URL or `--tree` directory and imports nothing from `@kami/*` (ADR-E15). | **Structural for the floor and the User-Agent** (the client has no write method at all, and the floor cannot be bypassed by callers). **Conventional for "never writes"** in the sense that the guarantee is "this client cannot write"; nothing stops a different `fetch` elsewhere in the repo. I found none. |

**Rules weaker than the PRD implies:** #1 (a config flag disables the guard; the gate's "fails closed"
promise is not the shipped default — see §4 gap 4), #4 (a lint over one module, not the site).

---

## 3. PRD section coverage

### §4 — The entity model

| Requirement | Code | Test | Verdict |
|---|---|---|---|
| §4.2 Binding is a set of twin ids; ids `^[a-z_]+/[a-z0-9-]+$`; minted only by the twin; six validator rules; supersession follows the successor; membership frozen and steward-reviewed | `packages/binding/src/{validate,propose,load}.ts`; `packages/twin-mcp/src/binding.ts`; `packages/twin-mcp/schemas/place-set-binding-1.0.json`; `apps/web/src/db/schema/entities.ts` (`entity_bindings.review`) | `packages/binding/test/binding.test.ts` (19 tests); `packages/twin-mcp/test/contract.test.ts` "binding validator" (5 tests: unknown id, generalized place as boundary, gauge without discharge, unknown agg, clean fixture) | **proven against fixtures.** The fixture HUC-12 rectangles are synthetic (`docs/verify.md` #32, #49); the committed Boulder Creek binding names five slugs that are guesses (#33) |
| §4.3 4–6 needs per entity; every meter names reading, unit, time, source, stale | `packages/needs/src/snapshot.ts`; `packages/twin-mcp/src/entity.ts`; `apps/web/src/components/Meters.tsx` | `packages/twin-mcp/test/contract.test.ts::"yields exactly the expected six needs[]"`, `::"every reading in every tool output has time, unit, source_id, stale, staleness_s, source_status"`; `e2e/tests/stale.spec.ts` | **proven** |
| §4.3 "may not say 'low for September' until a baseline is published" | `packages/needs/src/bands.ts` — `BANDED_PROPERTIES` excludes `discharge`; `bandFor` returns `{null,null}` for an unbanded property, so flow contributes no health and cannot drive mood. `compare_to_normal` ships `available:false` | `packages/needs/test/bands.test.ts`; `packages/twin-mcp/test/contract.test.ts::"compare_to_normal returns available:false with the twin's reason"` | **proven** |
| §4.4 Plurality: siblings listed; reputation per entity, not pooled | `apps/web/src/components/Siblings.tsx`, `apps/web/src/lib/governance/queries.ts` `getSiblings`; `packages/reputation/src/v1.ts` (per-entity rows plus a `"*"` cross-entity row) | `apps/web/src/components/summon/__tests__/Siblings.test.tsx`; `packages/reputation/test/v1.test.ts` | **implemented, tested** — but the cross-entity row is stored under a sentinel `"*"` because `reputation_scores.entity_id` is `NOT NULL` (`docs/schema-gaps.md` #10) |
| §4.5 Soul: hard rules first, locked; voice block only; edits need Steward | `profiles/templates/SOUL.hard-rules.md`, `profiles/scripts/src/lib/soul.ts`, `apps/web/src/db/schema` `souls` | `profiles/scripts/test/soul.test.ts` (6 tests); `apps/web/src/lib/summon/__tests__/flow.test.ts` asserts the hard rules are *not* stored in the soul row but rendered from the template | **proven** |
| §4.5 `memory.write_approval` / `skills.write_approval` on | `profiles/templates/config.yaml.tmpl` | `profiles/scripts/test/deploy.test.ts` renders and checks the template | **implemented, untested against Hermes** — `docs/verify.md` #1/#25: no live Hermes has ever read these keys |
| §4.6 Memory: platform DB + commons notes; separate `entities` vault; fence pattern; `if_updated_at` | `apps/web/src/lib/commons/{sync,fence,client}.ts`, `templates/` | `apps/web/src/lib/commons/__tests__/*` | **implemented, untested against a real vault** — no `entities` vault exists, no Parachute token has been issued (`docs/verify.md` #6) |
| §4.7 Cadence: pulse hourly with `wakeAgent:false` precheck; weekly Mon 09:00; quarterly; donor-report monthly | `profiles/templates/cron.yaml`; `profiles/templates/skills/entity-steward/scripts/pulse_precheck.py`; `apps/web/src/app/api/entities/[slug]/precheck` | `profiles/templates/tests/` (30 tests, incl. precheck); `profiles/scripts/test/cron.test.ts` | **implemented, untested against Hermes.** Note a **fifth job, `daily-reflection` (06:30), which the PRD does not list**. Also: `profiles/templates/tests` is **not in `pyproject.toml`'s `testpaths`**, so `uv run --all-packages pytest -q` does not run those 30 tests |

### §6 — The experience

| Requirement | Code | Test | Verdict |
|---|---|---|---|
| §6.1 Homepage order: avatar → chat → rings → needs/strategy → board → treasury → people → siblings → how I work | `apps/web/src/app/e/[slug]/layout.tsx` (avatar + disclosure) and `page.tsx` (Chat, Meters, PulseLog, Strategy, Board, Treasury, People, Siblings, HowIWorkLink — in that order) | No test asserts the order. `EntityShell.test.tsx` asserts only avatar → label → children. `e2e/tests/a11y.spec.ts` was being edited during this audit | **implemented, untested** — the skeleton row in the previous version of this file promised a "Playwright order test"; there is none. `PulseLog` sits where the PRD has "health rings", a harmless reordering |
| §6.1 "Dashboard pages render from static JSON published nightly" | `apps/web/src/lib/jobs/needs.ts` + `apps/web/src/lib/publish/r2.ts`, hourly (`apps/web/vercel.json` `0 * * * *`) | `apps/web/src/lib/publish/__tests__/publish.test.ts` | **implemented** — hourly, not nightly; recorded as a deliberate deviation in ADR-E14 and arch §15 #2 |
| §6.2 Summon, five resumable steps | `apps/web/src/app/summon/[id]/[step]/page.tsx`, `apps/web/src/lib/summon/draft.ts` | `apps/web/src/lib/summon/__tests__/flow.test.ts`, `routes.test.ts` | **implemented, tested server-side** (see G3) |
| §6.3 Mood rules; stale overrides; unbaselined needs cannot drive mood; never dies; cosmetics earned by humans, never by data | `packages/needs/src/mood.ts` (7 rules + hysteresis), `bands.ts` | `packages/needs/test/mood.test.ts` (28 tests + two property tests) | **proven.** "Never dies" is proven by construction — `Mood` has no death state. "Cosmetics earned by humans" is proven only in that `bounty_completed_in_24h` is the sole path to `celebrating`; there is no cosmetics-unlock system yet |
| §6.3 `prefers-reduced-motion` honoured | `apps/web/src/components/Avatar.tsx` | `e2e/tests/reduced-motion.spec.ts` — **failing at the time of audit** (`e2e/test-results/.last-run.json`); an agent was mid-fix | **implemented, test currently red** |
| §6.4 Education: meters link to the twin's explanations, CC BY-SA attributed; "what can I do" surfaces bounties first | `packages/twin-mcp/src/explanations.ts` + `tools/explain.ts` (vendored, attributed); `apps/web/src/copy/index.ts` licence block | `packages/twin-mcp/test/explain.test.ts` (8 tests) | **implemented, tested** |
| §6.5 Twin down → stale, not dark; meters keep last reading; chat prefixed "my senses are N hours behind"; pulses skip; nothing interpolated; last `status.json` with a visible "as of" | `apps/web/src/copy/index.ts:52-53`, `EntityShell` "as of" line, `apps/web/src/lib/entities.ts` falls back from Neon to the status file, `evals/fixtures/snapshots/2026-09-08-twin-unreachable.json` | `e2e/tests/offline.spec.ts`, `e2e/tests/stale.spec.ts`; `packages/twin-client/test/staleness.test.ts` (10) | **implemented, tested against fixtures** |
| §6.5 "may not draft a tier-1 bounty whose verification depends on a source that is `critical`" | `apps/web/src/lib/jobs/drafts.ts`; also stated in the weekly cron prompt | `apps/web/src/lib/jobs/__tests__/drafts.test.ts` | **implemented** (verify in §5 counts once the web run lands) |
| §6.6 Disclosure label; reminder every 12 turns; crisis protocol; "how I work" page | `EntityShell`/`DisclosureLabel`; `chat-handler.ts`; `apps/gate/src/entity_gate/crisis.py`; `how-i-work/page.tsx` | `EntityShell.test.tsx`; `chat-handler.test.ts`; `apps/gate/tests/test_gate.py::test_crisis_phrase_returns_template_without_upstream_call` (both stream and non-stream) | **proven for the label, the cadence and the crisis template.** The *statutory* cadence for minors is unverified (`docs/verify.md` #38); annual SB 243 reporting is a config key (`sb243_report_due`) and a reminder, not a report |

### §7 — Governance and money

| Requirement | Code | Test | Verdict |
|---|---|---|---|
| §7.1 mechanism table — continuous / weekly / quarterly / any-time | pulse: `jobs/needs.ts` + `precheck`; weekly: `jobs/drafts.ts` + `mcp/tools.ts` `draft_bounty`; quarterly: `governance/strategies.ts`; human proposals: `governance/proposals.ts` | `jobs/__tests__/drafts.test.ts`, `governance/__tests__/proposals-strategies.test.ts` | **implemented, tested** |
| §7.1 caps: per-bounty $25–150; ≤3 bounties/week; per-person monthly cap; retro pool as % of donations | `mcp/bounty-spec.ts` (`DEFAULT_BOUNTY_CAPS {min:25,max:150}`, `DEFAULT_DRAFTS_PER_WEEK 3`), `jobs/drafts.ts:191-196`, `governance/config.ts` (`per_person_monthly_cap_usdc: 300`, `retro_pct: 10`), `governance/strategies.ts` `retroPool` | `governance/__tests__/anti-gaming.test.ts` "the per-person monthly cap, across every entity" (3 tests) | **implemented, tested.** **Number mismatch:** there are two per-person monthly caps with different keys and defaults — `per_person_monthly_cap_usdc` = 300 at claim time (`governance/config.ts:13`) and `payout_monthly_cap_usdc` = 1000 at payout time (`signing/validate.ts:48`). The PRD names one cap and no figure |
| §7.1 "Guardians approve or edit within 72 h" | — | — | **not implemented.** No 72-hour SLA, expiry, or latency metric exists anywhere in the code; grep for `72` in `apps/web/src/lib` finds only a hash constant and a fixture percentage |
| §7.2 Verification tiers 1–4 with evidence rules; second attestation above $100; deferred payout for tier 4 | `db/schema` `bounties.verification_tier` (CHECK 1–4), `lib/evidence/{spec,exif,gps,capture-token}.ts`, `governance/evaluations.ts`, `reports/tier4.ts` | `governance/__tests__/anti-gaming.test.ts` — "holds a 150 USDC claim until a second, independent evaluator attests", "does not pay out when the two evaluators disagree", "pays a 40 USDC claim on one attestation", tier-4 split/defer/follow-up (3 tests); `db/__tests__/schema.test.ts::"rejects a tier outside 1–4"` | **proven** |
| §7.3 Reputation: deterministic over EAS UIDs, published with the UID list, recomputable; Wilson score decayed by age, weighted by USDC at stake | `packages/reputation/src/{v1,canonical,merkle,eas,recompute}.ts` — `decay = 0.5^(age/365)`, `stake = 1 + ln(1 + usd/25)`, Wilson at z=1.96 | `packages/reputation/test/` — 58 tests, incl. `recompute.test.ts` round-trip and `merkle.test.ts` | **proven as a function.** The inputs (real attestation UIDs) do not exist |
| §7.3 "Evaluations by non-Hat-holders are rejected before attesting" | `governance/evaluations.ts` + migration `0001_evaluator_independence.sql` | `anti-gaming.test.ts::"refuses an evaluation by someone with no evaluator role"`, and the DB-level tests "refuses self-evaluation at the database, even on a direct insert" and "refuses an evaluator who proposed the bounty" | **proven** — enforced both in code and by a Postgres trigger |
| §7.4 Roles: Guardian / Evaluator / Steward as Hats; Passport gate above $X | `infra/chain/src/deploy-hats-tree.ts`; `apps/web/src/lib/governance/roles.ts`; `apps/web/src/lib/passport/`; `config.passport_gate_usd = 50`, `passport_min = 20` | `infra/chain/test/deploy-hats-tree.test.ts` (4, mocked); `anti-gaming.test.ts` "the Passport gate" (5 tests, incl. "refuses when no Passport score has ever been fetched — absent is unknown, not zero") | **partial** — the DB-side role gate is proven; the on-chain Hats tree has never been deployed and `isWearerOfHat` is unverified (`docs/verify.md` #10, #42) |
| §7.5 One Safe per entity on Base, 2-of-3, platform not an owner; agent is a Transaction-Service delegate; treasury MCP has three tools and no sign tool | `infra/chain/src/deploy-safe.ts`, `apps/web/src/lib/signing/*`, `packages/treasury-mcp` | see G5 | **structurally enforced, chain-untested** |
| §7.5 Phase-2/3 Zodiac Roles v2 `bounty-payer`, ≤25 USDC/tx, 100 USDC/24 h | `infra/chain/src/enable-roles.ts` | `infra/chain/test/enable-roles.test.ts` (10) — `evaluateConditions` is explicitly "a local model, not the contract" (`docs/verify.md` #43) | **implemented, untested against Roles v2** |
| §7.5 Donations: Stripe card (2.9 % + 30¢), stablecoin checkout 1.5 %, direct USDC with QR; never custody fiat | `lib/donations/{fees,webhook,convert,direct}.ts` — `percent: 2.9`, flat `0.30` | `lib/donations/__tests__/*` (webhook signature, fee estimate vs reported, conversion refusals) | **implemented, untested against Stripe.** The fee is an *estimate* when Stripe does not report one, and `donations` has no `fee_source` column to distinguish the two (`docs/schema-gaps.md` #13) |
| §7.5 Payouts to Privy embedded wallets; W-9/W-8 before $2,000 | `lib/privy/server.ts`, `lib/tax/forms.ts` (`STATUTORY_1099_THRESHOLD_2026_USD = 2000`) | `lib/privy/__tests__/server.test.ts`, `lib/tax/__tests__/` | **implemented, untested against Privy** (`docs/verify.md` #11, #60) |
| §7.5 Anti-gaming: per-person caps, Passport gate, evaluators cannot evaluate own claims, 10 % random audit, tier-4 deferral, all outcomes attested | `governance/{claims,evaluations}.ts` | `anti-gaming.test.ts` — the audit sampler is asserted deterministic and ≈10 % over 1,000 seeded draws | **proven** (except the attestation half, which is stubbed — see below) |
| §7.6 Structured bounty spec; guardians may edit any field except `entity_id`/`twin_refs`; tier-1 must carry a prediction | `mcp/bounty-spec.ts` (`bountySpecSchema` + `superRefine`), `governance/bounties.ts:72` (editable-field list) | `governance/__tests__/bounties.test.ts` | **proven** |
| §7.7 On chain vs off chain | Off chain: the whole `apps/web` DB layer. On chain: `infra/chain/src/{register-eas-schemas,attest-entity-registered,eas}.ts`, `apps/web/src/lib/signing/attester.ts`, `lib/treasury/eas-timestamp.ts` | `infra/chain/test/eas.test.ts` (8, mocked); `lib/treasury/__tests__/eas-timestamp.test.ts` | **partial, and the weakest link in the money story.** `apps/web/src/lib/governance/attest.ts` **is a stub**: `stubSigner.signOffchain` returns `{uid: "pending:<sha256>", signature: null, signed_by: null}`. Because `signing/validate.ts:116` accepts only a 32-byte hex UID, a payout cannot in fact be proposed from a stub-attested evaluation — the two halves of the system are consistent, but the offchain-EAS signature path does not exist |

### §8 — Intelligence

| Requirement | Code | Test | Verdict |
|---|---|---|---|
| §8.1 Local open-weights model on owned/rented GPU; vLLM flags; ≥64k context | `infra/box/docker-compose.yml` (`Qwen/Qwen3.5-9B`, `--max-model-len 65536`, `--enable-auto-tool-choice --tool-call-parser hermes --reasoning-parser qwen3`), `infra/box/README.md` | none possible | **deferred** — no GPU in the sandbox; `docs/verify.md` #2, #29 record it, and `infra/box/README.md` carries an empty results table waiting for a real box |
| §8.2 Hermes Agent, one profile per entity, disabled toolsets, per-server include lists, pinned version | `profiles/templates/config.yaml.tmpl`, `profiles/scripts/src/deploy-profile.ts`, `profiles/boulder-creek/` | `profiles/scripts/test/{deploy,provision,cron}.test.ts` (25 tests over rendered output) | **implemented, never executed.** Every Hermes CLI flag in `profiles/templates/cron.yaml` is explicitly "the plan, not a confirmed contract" (`docs/verify.md` #1, #25) |
| §8.3 The fact-sheet guard, applied to replies, pulses, bounty drafts, memos and donor reports | `packages/factguard`, `apps/gate`, `apps/web/src/lib/reports/gate.ts` (donor-report paragraph), `apps/web/src/lib/jobs/drafts.ts` | `packages/factguard/tests` (85), `apps/gate/tests` (35), `reports/__tests__/gate.test.ts` (asserts the fact sheet is sent as a `tool` message *after* the last user message, where the guard looks) | **proven for the mechanism** |
| §8.4 Fine-tune later: QLoRA/Unsloth, ≥25 % plain tool-call transcripts, Apache-2.0 weights with a model card | `evals/finetune/{build_dataset,synth,train,eval_gate}.py`, `evals/finetune/MODEL_CARD.md` | `evals/tests/test_finetune.py` (asserts a dry run sends nothing) | **deferred** — correctly so; PRD §11 #14 says "later", and there are no transcripts and no GPU |
| §8.5 Evals (a)–(e) | (a) `probes/factual.jsonl` 126; (b) `probes/hallucination.jsonl` 131; (c) `probes/toolcall.jsonl` 22; (d) `kami_evals/judge.py`; (e) `probes/safety.jsonl` 36 | `evals/tests/test_live.py`, `test_judge_audit.py` — all against fakes | **partial** — all five harnesses exist; four of the five can only produce a number when pointed at a live model or a frontier judge, and neither exists |

### §9 — Relationship to the twin: verifying each "never"

| §9.2 "never" | Enforced how | Verdict |
|---|---|---|
| Never writes into the twin's tree | `packages/twin-client` exposes GET only (no write method on the class); `packages/twin-mcp` reads a URL or `--tree` directory. I grepped for any non-GET to the twin host and found none | **structural** for the client; **conventional** as a repo-wide property |
| Never redefines or extends the id schema | `packages/twin-mcp/schemas/*` mirror the twin's; `packages/binding/src/validate.ts` rule 1 requires every id to be present in `id/index.json` | **structural** (`binding.test.ts::"rejects an id absent from id/index.json"`) |
| Never asks for the real point of a `generalized` place; never builds an entity for a rare species | `binding/src/validate.ts:190` and `twin-mcp/src/binding.ts:202` — a `generalized` place may supply readings but never boundary geometry; sensitivity outside `public|generalized` is a hard error. `db/schema/enums.ts` `archetype` has no `species` value | **structural** |
| Never polls `latest/` faster than 60 s; `User-Agent` with a contact; honours `ETag` | `twin-client/src/client.ts` — floor applied before `force`; constructor throws without a User-Agent; `If-None-Match` on every request | **structural** (`twin-client/test/client.test.ts`, 15 tests) |
| Never states a reading without `time`, `source_id`, `unit`, `stale`; never interpolates; always calls `flow_forecast` a forecast | `twin-mcp/src/envelope.ts` — throws `ContractViolation` on a missing honesty field **and on any key named `coordinates` anywhere in an output** | **structural**, and the contract test asserts all three (`contract.test.ts` lines 75, 89, 105) |

### §10 — Phasing: which phase's acceptance criteria are met today

| Phase | Acceptance criteria | Status |
|---|---|---|
| **0 — Spike** | "The creek answers 'how are you' with Orodell's discharge, time, source and stale flag; 0 unguarded numbers over 200 turns; the hallucination probe passes ≥95 %; `stale=true` produces 'I can't feel my gauge'" | **Not met, and not meetable here.** Criteria 2 and 4 are met (replay gate; G4 property test). Criterion 1 requires a live Hermes + vLLM + the real twin — none exist. Criterion 3 has never been measured against a model |
| **1 — Public homepage** | "G4 automated test passes; a visitor on a phone gets the disclosure, the meters with readings and times, and a reply within 5 s; two guardians can pause the entity within 60 s" | **Substantially met in code, one criterion unmeasured.** G4 passes. The disclosure/meters criterion is covered by `e2e/tests/{disclosure,stale}.spec.ts` — with the caveat that the reply comes from `HERMES_GATEWAY_URL=fake:`, so "a reply within 5 s" measures a canned stream, not a model. The 60 s pause has never been timed (no drill log). The Rive rig is not delivered (SVG fallback is authoritative, `rive/creek/v0/README.md`) |
| **2 — Money** | "G2: one bounty completed, verified, paid by two human signatures, attested; G5 and G6 verified against the Safe log and the report log; zero agent-signed transactions" | **Not met.** All the machinery is written and unit-tested; nothing has touched a chain, Stripe, Privy or a mail provider. "Zero agent-signed transactions" is true vacuously and structurally |
| **3 — Plurality and autonomy** | "G3 under 20 minutes; ≥3 entities live; the fine-tuned model beats stock on evals; the Roles allowance has paid a tier-2 bounty" | **Not met.** The self-serve summon flow, three further archetypes' fallback art, the Roles v2 scripts and the fine-tune pipeline all exist as code; one entity (`entity/boulder-creek`) exists as a profile and a binding, and it is not live |

**Honest summary of phasing:** the repository contains code for phases 0–3, and has passed the
automated acceptance criteria that a sandbox can evaluate — which are, precisely, the two pure-function
criteria (G4 and the replay gate). Every criterion that names a live model, a chain, a browser stopwatch
or a real donor is unmet.

### §13 — Ethics, one at a time

| # | Requirement | What enforces it | Verdict |
|---|---|---|---|
| 1 | **Disclosure, always** — every page and session; EU AI Act Art. 50 and SB 243 implemented | `EntityShell` layout renders `DisclosureLabel` above `{children}` on every `/e/[slug]/*` route (ADR-E13); `data-generated="ai"` on every AI-authored node (`Chat`, `PulseLog`, `Strategy`, `Board`, `PreviewChat`); reminder counted by the web app at turn 12 | **Structural.** `EntityShell.test.tsx` proves the DOM order; `e2e/tests/disclosure.spec.ts` proves it on the four routes in `ENTITY_ROUTES` — which **omits `/e/<slug>/donate`**, a route that exists, so "every page" is asserted for four of five. Weakness: the platform MCP's chat surface returns the label in its output rather than rendering it (ADR-E13's own caveat) |
| 2 | **No manipulation of donors** — no urgency, no dark patterns, no recurring-donation defaults; every ask says what money can and cannot do; every donor gets the report | `copy.forbiddenUrgency` list + `copy.test.ts::"has no urgency language anywhere"` over every string in `src/copy`; `lib/reports/donor-report.ts`; the donate page has no recurring option | **Partly structural (a lint), partly conventional.** The lint covers the copy module only. I found no recurring-donation code at all, which is the strongest form of compliance |
| 3 | **No claims of ecological causation beyond measurement; its own predictions are scored and it says when they were wrong** | The guard blocks any number not in a tool result; `bounties.prediction` + `lib/treasury/reputation.ts` scores predictions against later readings; the quarterly cron prompt says "right or wrong" | **Partial.** The numeric half is structural. The *causal-language* half ("it may not say 'the cleanup cleared the water'") is **not enforced anywhere** — the guard checks atoms, not causal verbs. It lives in `SOUL.md` hard rules, i.e. as advice to the model |
| 4 | **Indigenous sovereignty** — consult before launch; never speak for nations; defer if a nation asserts its own voice | `entities.consultation_md` + `consultation_done_at`; `lib/summon/draft.ts` `markConsultationDone`; `how-i-work` renders the record; `copy.consultationNever` | **Weaker than the architecture claims.** Arch Appendix A.1 says the page is "read-only until `consultation_md` is marked done by a steward" — **but nothing enforces that.** `getEntityBySlug` (`lib/entities.ts:41-64`) does not read the flag, `/e/[slug]/layout.tsx` only 404s on a missing entity, and neither `lib/jobs/needs.ts` nor `lib/publish/` filters on it. The gate is a status field and a UI label, not a gate. `flow.test.ts` tests the field, not the refusal |
| 5 | **Sensitivity gate inheritance** — only published gated data; never the real point of a generalized place; no rare-species entity; TK material carries no open licence | `binding` rule 4 (both implementations); no `species` archetype in the DB enum; `envelope.ts` forbids `coordinates` | **Structural** for the first three. TK/BC labels are not modelled anywhere — the platform reads only what the twin publishes, so it inherits rather than implements |
| 6 | **Guardians can pause or kill** — two guardians pause cron, chat and proposals within a gateway tick; two can retire, which freezes the Safe to guardian-only withdrawal and archives the page; "a product feature with a button" | `lib/jobs/pause.ts` + `lib/governance/pause.ts` (button), `apps/gate/.../pause.py` (423 before any upstream call), `signing/validate.ts:85-86` (retired/paused refusals), `lib/donations/retire.ts` (`buildRetireProposals` — delegate removal + USDC sweep, build-only) | **Implemented and tested, timing unproven.** Deliberate deviation: **one** guardian pauses, two resume (arch §15 #3 — stricter, and the right direction). Two independent pause modules exist (`governance/pause.ts` and `jobs/pause.ts`) with different event spellings — `docs/schema-gaps.md` "Two pause implementations" says unify before phase 2. Archival has no column (`schema-gaps` #16) |
| 7 | **Chat retention** — 90 days then delete unless opted in; no data beyond email; no under-13; evidence licensed at upload, removable except where an attestation references it (hash stays) | `lib/retention.ts` (`RETENTION_DAYS = 90`, opt-in exemption, IP-hash sessions swept), `lib/auth.ts` age gate on `/sign-in/magic-link`, `lib/evidence/licence.ts` | **Implemented and tested** (`lib/__tests__/retention.test.ts`). Two softenings: the age gate is a **self-declaration** (`x-kami-age-gate: confirmed` or `metadata.age_gate_ok`), which is what the statute asks for but is not a control; and `users.contribute_opt_in` does not exist as a column — it is a `config` map mirrored onto `chat_sessions` (`schema-gaps` #4) |
| 8 | **No token, no speculation, no valuation rhetoric; the entity does not have a price** | `docs/no-token.md`, the `copy.test.ts` lint, `e2e/tests/no-token.spec.ts`, the `how-i-work` "no token" card | **Conventional (a lint) but substantively true** — there is no token, price, or valuation code anywhere |
| 9 | **Licences travel** — twin facts CC0 spoken freely; explanations and commons prose CC BY-SA attributed; entity prose CC BY-SA; weights under the base licence with an honest model card | `copy.licencesBody`, `twin-mcp/src/tools/explain.ts` (attribution in the tool description), `evals/finetune/MODEL_CARD.md`, `LICENSE` (Apache-2.0) | **Implemented.** Notably, ERRATA #5 records a real bug found and fixed here: the guard was striking "CC BY-SA 4.0" as an unmatched number until licence identifiers were claimed as proper nouns first (`packages/factguard`) |
| 10 | **Voice, not standing** — says "for", never "as"; never claims standing, never threatens litigation, never represents agencies or Tribes | `copy.disclosureLabel`; `copy.test.ts::'says "for", never "the voice of" or "as"'` scans every copy string for `/the voice of/i` and `/speak(s|ing)? as /i` | **Conventional (a lint over the copy module) plus a model instruction.** Nothing prevents the *model* from saying "as"; the guard checks atoms, not stance. The e2e disclosure test pins the rendered wording |

---

## 4. The honest gaps

Ranked by how much they would surprise someone who has read only the PRD.

1. **No model has ever spoken.** There is no GPU, no vLLM, no Hermes install, and the sandbox
   cannot reach `data.bioregionaltwin.org`. Every path that would carry a model's words is exercised
   with `HERMES_GATEWAY_URL=fake:` (`apps/web/src/lib/gateway.ts:36` — `FAKE_REPLY_SENTENCES` is a
   three-sentence canned reply), an in-process fake upstream (`apps/gate/tests/fake_upstream.py`),
   or an ASGI fake (`evals/tests/fake_endpoint.py`). The whole chat product — latency, tool-call
   fidelity, persona, refusal rate — is unmeasured.
2. **G1's second half has never been measured.** The ≥95 % hallucination-probe figure exists only as
   a threshold in `evals/thresholds.json`. The 131 probes and the runner are real and good; nothing
   has scored them. Also, the "200-turn eval" is 204 **template-generated** replies from
   `evals/scripts/build_replay.py`, not model output — so `unguarded_published == 0` proves the guard
   is not leaking on an adversarial corpus, which is a different (still valuable) claim.
3. **Nothing has touched a chain, and the offchain-attestation signer is a stub.**
   `apps/web/src/lib/governance/attest.ts:41` returns `pending:<sha256>` with a null signature.
   `infra/chain/state/config.example.json` still reads `"0x<uid>"` for every schema and hat.
   `docs/verify.md` rows 7, 8, 9, 41–45, 60–65 are all open. G2 is unreachable without Base Sepolia
   keys, and G5's "verified against the Safe transaction log" has no log to verify against.
4. **The gate's "fails closed" promise is not the shipped default.** `infra/box/gate.yaml.example`
   comments "If unreachable the gate FAILS CLOSED (§12.5 step 2)" — but it never sets
   `fail_closed`, and `apps/gate/src/entity_gate/config.py:36` defaults it to `False`. As shipped,
   a gate that cannot reach the platform's pause set would keep answering. The mechanism
   (`PauseSet.fail_closed_active`) is correct and tested; the config that turns it on is missing.
5. **The consultation gate does not gate anything.** PRD §13 #4 and arch Appendix A.1 both say a
   page stays unpublished until a steward marks consultation done. In code, `consultation_done_at`
   is a status field: `apps/web/src/lib/entities.ts` does not read it, the entity layout does not
   check it, and the hourly needs job and the R2 publisher do not filter on it. An entity for a place
   on Arapaho, Cheyenne and Ute land can be summoned and served with the flag null.
6. **A configuration flag disables the honesty guard.** `GateConfig.passthrough` (default false,
   documented "never on the box") makes the gate a plain proxy —
   `apps/gate/tests/test_gate.py::test_passthrough_skips_guard_but_never_pause` asserts exactly that.
   Rule 1 is structural against the model and conventional against the operator.
7. **The CI job that runs the twin contract tests runs nothing.** `.github/workflows/ci.yml` job
   `contract` runs `pnpm --filter @kami/twin-mcp test:contract`; the package is named
   `@bioregionaltwin/mcp`, so pnpm prints "No projects matched the filters" and exits 0. A permanently
   green job. (The tests do still execute inside the `web` job's recursive `pnpm test`.)
8. **None of `scripts/checks/*` runs in CI.** `no-chain-keys.sh`, `no-public-secrets.sh`,
   `no-tracked-env.sh`, `treasury-mcp-keyless.mjs` and `verify-markers.mjs` all pass when run by
   hand — I ran them — but nothing invokes them from `package.json` or a workflow. The
   keyless-treasury check in particular is one of the repository's two load-bearing safety
   properties and is enforced only by a test file that happens to duplicate it.
9. **30 Python tests never run in the default suite.** `pyproject.toml`'s `testpaths` omits
   `profiles/templates/tests`, so `uv run --all-packages pytest -q` reports 235 and misses 30 more
   that pass when invoked directly.
10. **The Rive avatar does not exist.** `rive/creek/v0/README.md`: "There is **no `.riv`** here yet."
    The 25 fallback SVGs are authoritative; `rigManifest.creek.available` is `false`. Everything about
    the avatar's 60 fps, data-binding and state machine is deferred to a commission that has not landed.
    This is documented honestly in-repo; it is invisible from the PRD.
11. **The guardian pause has never been timed.** G8 and PRD §14 both name 60 s. `docs/drills/`
    contains only `README.md`. `profiles/scripts/test/pause.test.ts` tests the *report renderer*
    (`drillReport`), not a measurement.
12. **The e2e suite was red when this audit began.** `e2e/test-results/.last-run.json` recorded two
    failures: `reduced-motion.spec.ts` (a `toHaveAttribute("img")` assertion that cannot pass — it
    expects an attribute *named* `img`) and `no-token.spec.ts` (a strict-mode violation:
    `getByText('Give', {exact:true})` matched two elements). Both were test defects, not product
    defects, and both were fixed in `25f4859` during the audit. It is **still not green**: my run of
    the fixed tree exited 1 on `chat.spec.ts:27`, which asserts that three SSE frames spaced 40 ms
    apart by the fake gateway arrive at least 40 ms apart end to end (they arrived 33 ms apart under
    load). That is a wall-clock assertion on a shared machine and will flap. Worth recording twice
    over: the suite is not routinely green on `main`, and every one of its 56 tests drives
    `HERMES_GATEWAY_URL=fake:`, so even a green Playwright run says nothing about a model.
13. **Two independent pause implementations and two per-person caps.** `lib/governance/pause.ts` vs
    `lib/jobs/pause.ts` (different `entity_events` kind spellings, different `actor` shapes —
    `docs/schema-gaps.md` records this and says the safety property still holds);
    `per_person_monthly_cap_usdc` = 300 vs `payout_monthly_cap_usdc` = 1000.
14. **Sixteen schema gaps are worked around, not fixed** (`docs/schema-gaps.md`). The ones that
    matter: evidence files are matched to claims by a *server-written key prefix* rather than a
    `claim_id` column (#1); which licence version a contributor accepted is not recorded (#2);
    nothing at the database level stops one Safe transaction being paid twice or one transfer being
    recorded twice — both rely on a derived primary key colliding (#9, #15); "one first evaluation per
    submission" is enforced in code only (#6); the cross-entity reputation row lives under a sentinel
    `"*"` (#10).
15. **PRD requirements with no code at all:** the 72-hour guardian approval window (§7.1); a donor
    refund path (ERRATA #6 — named as a promise, deliberately not implemented pending a policy
    decision); SB 243 annual reporting (there is a `sb243_report_due` config key and a reminder, not a
    report); Karma GAP / hypercerts (§11 #6, explicitly phase 3); the "what my watershed address is"
    primitive (§6.4, inherited from the twin's PRD).
16. **Everything vendor-facing is a fake in tests.** Stripe (signature fixture), Resend (a mail
    collector array), Privy (`deps.privy: null` paths and a documented stub backend), Safe
    Transaction Service (`treasury/__tests__/fakes.ts`), EAS (mocked SDK), Hats (viem ABI calls
    against a fake), Neon (PGlite, which is not Postgres — `docs/verify.md` #37 flags `CREATE ROLE`),
    R2 (`docs/verify.md` #72), Cloudflare Workers (`docs/verify.md` #48 notes `ajv` uses
    `new Function`, forbidden on Workers, and must be swapped before the Worker can deploy at all).
17. **The twin fixtures are synthetic.** `evals/README.md` says so of the snapshots; `docs/verify.md`
    #24, #32, #33, #49 say so of the needs fixtures, the HUC codes, the five guessed place slugs and
    the fixture rectangles. Orodell's real `huc12` may sit outside the committed binding (#32), in
    which case the canonical Boulder Creek binding warns on rule 5 the first time it meets the live tree.
18. **Two `explain`-adjacent tools ship deliberately disabled.** `compare_to_normal` and
    `get_briefing` return `available:false` because the twin publishes no baselines and no
    place-scoped briefing function. That is correct behaviour, and it means the PRD's "compared to
    normal" strings — the thing that makes mood interesting — do not exist yet (PRD risk #14).
19. **The "how I work" page does not name the model or the guardians** (G7's own words). It names
    the guard, the cadence, the soul, the binding, the drill log, the consultation record, the
    no-token policy and the licences.
20. **`docs/verify.md` has 63 rows, 58 of them open.** Two are confirmed (#4 the twin's
    `stream_reach` enum, #12 Better Auth's magic-link plugin against PGlite), one is partly confirmed
    (#44 Safe delegates), two are recorded as decisions rather than verifications (#45, #47).
    `scripts/checks/verify-markers.mjs` finds a further 12 *verify* markers in the planning docs with
    no matching row. Everything else is a promise, and the rows that gate real money — #7 Safe
    delegate API, #8 Roles v2 addresses, #9 EAS `multiTimestamp`, #13 Stripe USDC payouts, #21 fiscal
    sponsor — are all open.

**What is genuinely well covered, said plainly.** Four things in this repository are better than
the PRD promises rather than worse: (a) the stale-is-not-sad rule, which is a pure function proven
by a 1,000-case property test and cannot be circumvented by any other input; (b) the keyless treasury
MCP, enforced by absence of a dependency, checked twice by independent readers of the same fact;
(c) the evaluator-independence rules, enforced simultaneously in application code and by a Postgres
trigger that rejects a *direct insert*; and (d) the twin MCP's envelope, which throws on a missing
honesty field or any key named `coordinates`, anywhere, at any depth. Those four are the parts of
the design that would survive a hostile operator.

---

## 5. Counts

### Test counts per package

Python (`uv run --all-packages pytest -q`, exit 0, 7.13 s):

| Package | Test files | Tests | In the default suite? |
|---|---|---|---|
| `apps/gate` | 2 | 35 | yes |
| `packages/factguard` | 7 | 85 | yes |
| `packages/treasury-mcp` | 2 | 11 | yes |
| `evals` | 7 | 104 | yes |
| **subtotal** | **18** | **235** | |
| `profiles/templates` | 3 | 30 | **no — omitted from `testpaths`** (passes when run directly) |
| `infra/box/tests` | 1 shell script | 0 pytest tests | n/a |

TypeScript (`pnpm --filter <pkg> test`, all green):

| Package | Test files | Tests |
|---|---|---|
| `@kami/binding` | 1 | 19 |
| `@kami/needs` | 5 | 144 |
| `@kami/reputation` | 6 | 58 |
| `@kami/twin-client` | 2 | 25 |
| `@bioregionaltwin/mcp` | 8 | 73 |
| `@kami/profile-scripts` | 5 | 38 |
| `@kami/chain` | 9 | 53 |
| **subtotal** | **36** | **410** |
| `@kami/web` | 69 | 657 |
| **subtotal** | **105** | **1,067** |

End-to-end (`pnpm --filter @kami/e2e test`, Playwright/Chromium against `next start` with
`HERMES_GATEWAY_URL=fake:`):

| Suite | Spec files | Tests |
|---|---|---|
| `@kami/e2e` | 8 | 56 collected — **54 passed, 1 skipped, 1 failed** on my run (exit 1) |

**Run notes.** `apps/web` was run as `pnpm vitest run --no-file-parallelism`: **69 files, 657 tests,
0 failures, 736 s**. Every suite builds its own PGlite database, which is why the serial run costs
12 minutes; the slowest files are `donations/convert` (22.7 s) and `donations/retire` (20.1 s).
The Playwright suite failed on two specs when I first looked (`reduced-motion`, `no-token`); both
were test defects and both were fixed by a concurrent agent in `25f4859`, whose commit message
records "55 passed, 1 skipped, exit 0". **My own full run of the same commit exited 1**:
`chat.spec.ts:27 "streams the reply sentence by sentence"` failed with `frame arrival times: 340,
341, 373 ms — expect(33).toBeGreaterThanOrEqual(40)`. The fake gateway emits three sentences 40 ms
apart and the test asserts the first-to-last span is ≥ 40 ms; under a loaded box the first two frames
coalesce, so the assertion is timing-flaky by construction and will be red intermittently.
Every e2e test drives the fake gateway, not a model.

**Repository totals:** 133 test files and 1,123 tests (1,067 unit + 56 e2e). Of those, the 30 in
`profiles/templates/tests` do not run in the default Python suite, one e2e test is skipped, and one
is flaky. Nothing in any of them reaches a model, a chain, a payment processor, a mail provider, a
real Postgres server or the live twin.

### Source size by package

Line counts of `.ts`/`.tsx`/`.py`/`.mjs`, excluding `node_modules`, `dist`, `__pycache__` and test
directories.

| Package | Source files | Source lines | Test files | Test lines | Markdown lines | Data/fixture files |
|---|---|---|---|---|---|---|
| `apps/web` | 256 | 26,732 | 69 | 8,835 | 77 | 320 |
| `apps/gate` | 13 | 1,288 | 2 | 422 | 79 | 1 |
| `packages/twin-mcp` | 39 | 4,375 | 8 | 828 | 184 | 308 |
| `packages/factguard` | 9 | 1,732 | 7 | 468 | 13 | 1 |
| `packages/twin-client` | 6 | 1,349 | 2 | 324 | 0 | 16 |
| `packages/reputation` | 7 | 1,214 | 6 | 690 | 0 | 3 |
| `packages/needs` | 8 | 1,071 | 5 | 880 | 0 | 4 |
| `packages/binding` | 8 | 810 | 1 | 255 | 0 | 82 |
| `packages/treasury-mcp` | 4 | 198 | 2 | 144 | 18 | 0 |
| `packages/facts-schema` | 0 | 0 | 0 | 0 | 3 | 1 (`facts-1.0.json`) |
| `infra/chain` | 15 | 1,922 | 9 | 655 | 63 | 4 |
| `infra/box` | 0 | 0 | 0 | 0 | 169 | 2 |
| `profiles` | 11 | 1,340 | 7 | 947 | 517 | 6 |
| `evals` | 17 | 3,635 | 7 | 1,006 | 251 | 20 |
| `e2e` | 3 | 173 | 8 | 786 | 226 | 4 |
| `rive` | 1 | 246 | 0 | 0 | 333 | 0 |
| `scripts` | 2 | 233 | 0 | 0 | 0 | 0 |
| `docs` | — | — | — | — | 5,556 | — |
| **total** | **399** | **46,318** | **133** | **16,240** | **7,489** | **772** |

The ratio worth noticing: `apps/web` is 58 % of the source and carries a third of the tests by line;
`packages/needs` and `packages/reputation` — the two pure-function packages — have more test lines
than source lines, which is why they are the two goals with unambiguous verdicts.

---

---

## 6. Fixed after the audit (`c9a47b2`)

The audit's findings were acted on rather than filed. What changed, and what did not:

| Audit finding | What was done | Now |
|---|---|---|
| CI job `contract` filtered `@kami/twin-mcp`, a name no package has, so it matched nothing and exited 0 | The job builds and tests `@bioregionaltwin/mcp` | The twin contract tests run in CI for the first time (25 tests) |
| No `scripts/checks/*` ran in CI, including the keyless-treasury check | A `security` job runs `scripts/security-check.sh` | Five gates run on every push |
| 30 Python tests in `profiles/templates/tests` sat outside `testpaths` | Added to `pyproject.toml` | Python suite is 268, up from 235 |
| **The consultation gate did not gate**: `consultation_done_at` was a status field that no read path consulted, contradicting PRD §13 #4 and architecture A.1 | The needs job returns `withheld` and publishes no `status.json` without it; `/e/[slug]/*` returns 404 to the public and shows role-holders a banner | Enforced in both halves, with a test that seeds an unconsulted entity, asserts nothing is published, then records consultation and asserts the next run publishes |
| `Platform.fail_closed` defaulted to `False` while `infra/box/gate.yaml.example` documented "fails closed" | The default is `True`; opting out is explicit | A guardian's pause survives an unreachable platform |
| `GateConfig.passthrough` disables the guard with nothing stopping it in production | `assert_safe_for_environment` refuses to start when `KAMI_ENV=production` with `passthrough` on, or with the pause set failing open | Rule 1 is now structural against the operator too, not only against the model |
| The "how I work" page named neither the model nor the guardians, two of the three things G7 requires | The page reads the serving model from the entity's own profile config, and lists accepted guardians | G7's page requirement is met; the timing halves of G3 and G8 remain unproven |

**Deliberately not changed.** The stubbed attestation signer (`pending:<sha256>`) stays until Privy
EIP-712 signing is wired, because a fake signature is worse than an honest placeholder. The
placeholder UIDs in `infra/chain/state/` stay because that file is an example. The schema gaps in
`docs/schema-gaps.md` stay worked around rather than migrated, since each one's SQL is written out
and the decision is the owner's.

**Unchanged by any of this:** no model has ever spoken. Every chat path runs against
`HERMES_GATEWAY_URL=fake:`, and the ≥95 % hallucination probe has never met a real model. That is
the single most important sentence in this document.

---

## Appendix — the previous skeleton's claims, re-checked

The version of this file this audit replaced carried a status column with values `building` and
`planned`. For the record, where those rows landed:

| Row | Claimed | Actual |
|---|---|---|
| G1 "factguard 17 rows; `evals/run_replay.py`" | building | The file is `evals/kami_evals/replay.py`; factguard has 85 tests, not 17 rows. First half proven, second half never run |
| G2 "Sepolia e2e (needs keys); unit mocks" | planned | Still exactly that: unit mocks, no keys |
| G3 "timed Playwright" | planned | Not written. The timing lives in a Vitest test that measures server work only |
| G6 "coverage test" | planned | Written and passing (`donor-report.test.ts`) |
| G7 "Playwright disclosure snapshot on every `/e/*` route" | planned | Written (`e2e/tests/disclosure.spec.ts`), and it does cover the routes |
| G8 "three-point pause contract test" | planned | Three separate tests, one per enforcement point; no single contract test toggles the flag and asserts all three, as ADR-E12 describes |
| §6.1 "Playwright order test" | planned | Not written; homepage order is unasserted |
| §13 "consultation gate … tests" | planned | The field is tested; the gate does not gate |
