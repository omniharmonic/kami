# Ecological Entities — Product Requirements

**v0.1 draft · 2026-09-06**
**Drafted by Claude for Benjamin Life (@omniharmonic)**
**Status:** proposal — not approved
**Working title:** Ecological Entities. Alternatives, for the owner to weigh: *Egregores* (the owner's own word; precise, obscure), *Familiars* (an ecological familiar you summon and tend), *Voices* ("a voice for Boulder Creek" — the wording §13 requires anyway), *Kin*, *Summon* (the verb the creation flow uses). "Tamagotchi" is a Bandai trademark and stays a description, never a name. "Speaker for the Living" is Zoöp's term (B2 §6) and should not be taken.

Sources: the owner's transcript (Path 2, brief 2026-09-05), the codebase survey **B1** (`feat/water-visible` HEAD `642061b`), the external research **B2** (2026-09-05), and the twin's own `.claude/01-PRD.md`. Every number and vendor claim below traces to B1 or B2, or is marked *estimate* or *verify*. Where the owner's stated intent and the research disagree, the disagreement is in §11, not resolved silently.

### Carry in your head

1. **The entity may only say numbers that came back from a twin tool call in the current turn.** A guard checks every reply. A fine-tune makes a small model more confident, not more correct (B2 §2.6).
2. **The agent proposes; humans sign; the twin verifies.** In v1 no value moves without two human signatures on a Safe. The agent's key can create a pending transaction and nothing else.
3. **Stale is not sad.** A gauge that stopped reporting puts the avatar in "I can't feel my gauge", never in distress. The twin's `stale` flag drives that state and overrides every other input.
4. **No token, ever.** No verified crypto "nature agent" exists; the ones that claim to are trading bots (B2 §6). This project's public policy is written down before the first line of wallet code.
5. **The platform reads the twin like a browser does and never writes into it.** Separate repo; one published file contract plus a read-only MCP wrapper that lives in the twin repo. ADR-001 and ADR-008 bind here too.

---

## 1. Summary

Ecological Entities is a platform where anyone can summon an AI agent that speaks *for* a creek, a watershed, a reservoir, a ridge, or the bioregion — grounded in the Front Range Bioregional Twin's live sensor readings, with a cute avatar whose mood follows measured conditions, a chat that can only cite what the twin measured, a small treasury controlled by human guardians, and a weekly loop in which the agent drafts bounties, people do real work, evaluators verify it, and the outcome is attested on chain so that every contributor and every entity builds a public track record. It borrows the shape of rights-of-nature guardianship (Nederland's Boulder Creek guardians), the working loop of Tehanu (AI-inferred needs → wallet → pay local humans → verify), and the weekly-taste / quarterly-strategy cadence of Botto, and it refuses the parts of that history that failed: token governance, valuation rhetoric, unverifiable claims, and a river that goes "sad" because a feed went down.

**The pitch:** a Tamagotchi for rights of nature — except the feelings are gauge readings, the money is signed by humans, and the receipts are public.

---

## 2. Why this exists

### The problem: rights without an agency bridge

Rights-of-nature law has given rivers and ecosystems standing on paper — Ecuador's constitution (2008), Te Awa Tupua (2017), the Colorado River Indian Tribes' personhood vote (2025-11-06), and, at home, Nederland's 2021 Boulder Creek Watershed rights resolution with guardians appointed in April 2024 (B2 §6). The weak point everywhere is enforcement and agency: Nederland's guardians have no standing to sue, and the town wavered when it wanted a dam (2024). The *Colorado River Ecosystem v. Colorado* suit (2017) was withdrawn under sanction threat. A river can have rights and still have no way to know its own condition, state a need, ask for help, or pay for it.

### The premise

Austin Wade Smith's *Ecological Institutions* (2025) argues for protocols that grow "autonomous and convivial ecological actors" — institutions, not gadgets, whose legitimacy comes from community, law, and data; Regen Foundation is prototyping three by mid-2026 (B2 §6). The owner's word for such an actor is an *egregore*: a summoned collective presence for a creek or a mountain. What has changed is that the twin now gives such a presence senses. About 1,000 monitoring places across the Front Range publish to one static tree every five minutes (B1 §1); for Boulder Creek alone that is 147 stations across 24 HUC-12s, four stream gauges on the main stem, three SNOTEL sites above it, six reservoirs, water-quality probes at the South Boulder forebay, and live drought, alert, and fire polygons (B1 §2.4). An entity can be *aware* of its own state in a way no guardian committee meeting can be, and it can say so in public, every hour.

### Precedents and warnings

| Precedent | What it got right | The warning we take (B2 §6) |
|---|---|---|
| **Tehanu / Interspecies Money** — 19 mountain gorillas with digital IDs and wallets; AI infers a needs hierarchy; pays local humans for verified tasks; first transfer Dec 2024 | The loop: needs → wallet → pay humans → verify. Started with a densely studied species | Valuation rhetoric ("$1.4B") invites ridicule; centralised. Start with a *gauged* creek, as they started with a studied species |
| **Zoöp** — organisations appoint a human *Speaker for the Living* with a governance seat | A human proxy with formal standing; annual reporting | Not technical. We adopt the Speaker as a role: the AI drafts, humans speak |
| **terra0** (2016) — the self-owning forest | The legal wrapper (a German Verein) was the real innovation | Selling felling rights as revenue is the wrong incentive |
| **Plantoid** (2015) | "Reports back what it did with your money" | Novelty economy |
| **Botto** (2021–, $5M in sales) | Weekly human taste as the governor; agent generates the options | Token governance |
| **Nederland's Boulder Creek guardians** (2024) | Guardians named in an ordinance | No standing; reversible; never claim standing the entity does not have |
| **The DAOs** the owner remembers | Proposals aligned with a group's goals get funded | "That bureaucratic process took forever." Gitcoin moved GG23 to conviction voting and stopped Allo development; the field's lesson is *minimise votes* (B2 §8.1) |
| **Sovereign Nature Initiative** | Pioneered ecological-data-to-value | Ceased in its current form 2024-11-30 — funding model |
| **BASIN** (the twin's own ghost) | Real-time streamflow and education in 2001 | Went dark in 2009 with no governance to outlive its champions (twin PRD §2) |

**Say it plainly:** as of 2026-09-05, no verified project represents an ecosystem with sensor grounding and a wallet. "SYLVI AGENT" is a crypto-trading signal bot; the 2025 Virtuals/ElizaOS wave was tokenised attention; a live "BasinDAO" could not be found (B2 §6, *verify*). Treat any "river coin" as a scam by default. **This platform never issues a token.** Not for governance, not for reputation, not for cosmetics.

---

## 3. Goals and non-goals

### Goals

| # | Goal | Measurable success |
|---|---|---|
| **G1** | The first entity — a gauged creek — speaks only numbers that came from a twin MCP tool result | An automated guard re-scans every reply for numbers, dates, places and species and matches them to tool results in the same turn; 0 unguarded facts published across a 200-turn eval; ≥95% correct "I don't have a reading for that" on a held-out hallucination probe (B2 §2.5) |
| **G2** | One real-world bounty is completed, verified, paid, and attested | A tier-1 or tier-2 bounty (§7) closes with evidence, an evaluator attestation, a Safe transaction signed by ≥2 humans, and a `BountyCompleted` EAS attestation carrying the Safe tx hash |
| **G3** | A stranger can summon an entity in under 20 minutes with only an email address | Timed from landing to a live homepage with avatar, place set, soul, and two invited guardians; no wallet, seed phrase, or crypto knowledge required (phase 3) |
| **G4** | The avatar's mood tracks a twin percentile and never tracks staleness | Automated test: `stale=true` on any driving reading forces the "can't feel it" state 100% of the time regardless of other inputs; mood otherwise is a documented function of percentile-vs-record and drought class |
| **G5** | Humans stay in the loop on money | v1: zero on-chain value movement without ≥2 human Safe signatures, verified against the Safe transaction log; the agent key is a Transaction-Service proposer, never an owner |
| **G6** | Every donor learns what happened to their money | Every donor receives a report within 31 days of month-end listing each payout with amount, recipient handle, Safe tx hash, and attestation UID; 100% coverage, measured |
| **G7** | The whole thing is disclosed as an AI, everywhere | Persistent "AI voice for …" label on every page and in every chat session; SB 243 reminder cadence implemented; a public "how I work" page names the model, the guard, and the guardians |
| **G8** | It survives its founder, and its guardians can stop it | Open source; the entity registry, `SOUL.md` and the guard are public; ≥2 guardians per entity who are not the founder; a guardian-triggered pause halts cron, chat, and proposals within one gateway tick (60 s per B2 §1.1) |

### Non-goals for v1

- **No token.** Not now, not later (§2).
- **No agent-held key with unlimited spend.** The agent key proposes. Phase 2's Zodiac Roles allowance is capped per transaction and per day (§7).
- **No autonomous on-chain execution.** The agent never signs. A phase-2 keeper may execute a payout only after an evaluator attestation and inside the Roles cap.
- **No cloud frontier model on the hot path.** Pulses, chat, and proposals run on a local model on owned or rented GPU (§8). A hosted model may be used offline for synthetic training data and eval judging.
- **No modelling, forecasting, or scenario claims.** The only forecast the entity may mention is NWPS `flow_forecast`, and it must call it a forecast (B1 §6).
- **No scientific claims beyond the twin's readings.** "Flow is 15.4 cfs at Orodell, last read 2026-09-04 20:15Z" — never "the trout are stressed" unless a reading and a published band say so.
- **No minors-targeted features.** No accounts under 13, no DMs, no companionship framing; SB 243 duties are accepted because the avatar is cute and minors will find it (§13).
- **No writes into the twin.** The platform never publishes into the twin's tree, never redefines the id schema, never asks for the real coordinates of a generalized place (§9).
- **Not a sensor operator, not a legal person, not a spokesperson for Tribes or agencies.**

---

## 4. The entity model

### 4.1 What an ecological entity is

An entity is a **named, bounded, plural, accountable voice for a place**, defined by four artifacts: a binding to twin ids (its body), a needs model (its senses), a `SOUL.md` (its rules and voice), and a treasury with named human guardians (its hands). Kinds in v1 map to what the twin can actually sense (B1 §3.4, Appendix B):

| Kind | Example | Twin coverage today | Fit for v1 |
|---|---|---|---|
| **Creek / stream** | Boulder Creek, St. Vrain | Gauges (`discharge`, `stage`, NWPS flood thresholds), WQ probes on 4–8 USGS sites, 7-day series | **First entity.** Densest measurement; tier-1/2 verification possible |
| **Watershed** (HUC-8/10/12) | Headwaters Boulder Creek `watershed/huc10-1019000504` | Member stations by `huc12`, drought/alert/fire by polygon; watershed page itself has no readings | Good; needs the rollup (§9.1) |
| **Reservoir** | Gross Reservoir | `reservoir_storage`, derived `reservoir_fill` with `basis`, capacity props | Good; the only published baseline today |
| **Mountain / ridge** | Niwot Ridge | SNOTEL `swe`, `snow_depth`, `precip_accum`, `air_temp`, basin `snowline_m` | Good in winter; SWE-% -of-median needs new ingest |
| **Species population** | — | Nothing in the twin; commons has `wiki/species/*` notes only | **Out of scope for v1.** Sensitivity gate; no licensed dataset chosen |
| **The bioregion** | `bioregion/front-range` | Boundary, feed health, snow, counts | Later; a summary index is not published |

### 4.2 Binding to twin ids

An entity's body is a **set of twin ids**, stored in the platform and mirrored as a governed artifact (open decision §11 #12):

```
entity_binding:
  place_ids:      [place/boulder-creek-near-orodell-co, place/niwot, place/gross-reservoir, …]   # stations
  huc_ids:        [watershed/huc10-1019000504, …505, …506, …507]                                  # polygons for intersection
  reach_ids:      []            # nhdplusids from network/reaches.geojson once the water-visible branch lands
  stream_id:      null          # place/boulder-creek when the twin mints stream places (B1 §3.5 #1)
  commons_handle: wiki/places/named/boulder-creek
```

Rules: ids are `^[a-z_]+/[a-z0-9-]+$` and are minted only by the twin (B1 §2.1). External ids (GNIS `00178354`, CDSS `BOCOROCO`, USGS `06727000`) are assertions the twin publishes as `sameAs`; the platform never invents its own. A superseded place keeps its page with `superseded_by`; the binding follows the successor. Membership is derived once from `id/index.json` plus name matching and `props.cdwr_stream_gnis_id`, then **frozen and reviewed by a steward** — name matching is the platform's guess, not the twin's assertion (B1 §2.4).

### 4.3 Senses: health indicators per kind

Each entity has 4–6 **needs**. A need is one twin property on one or more member places, rendered as a meter. Every meter names its reading, unit, time, source and `stale` verdict (B1 §3.2). Status of the inputs:

| Need | Property | Exists today | Needs twin work |
|---|---|---|---|
| Flow | `discharge` at the canyon-mouth gauge + 7-day trend | ✓ | Day-of-year percentile vs period of record (B1 §3.3: none published; series depth is 7 days) |
| Stage / flood | `stage`, `props.flood.{action,minor,moderate,major}`, `props.flood_category` on NWPS gauges | ✓ | — |
| Water quality | `water_temp`, `dissolved_oxygen`, `ph`, `turbidity`, `specific_conductance` | ✓ on 4–8 sites | Bands beyond prose (`explanations.ts` has trout DO threshold in prose only) |
| Snowpack upstream | `swe`, `snow_depth` at SNOTEL; basin `snowline_m` | ✓ | SWE as % of median (AWDB serves it; dropped at ingest `twin/adapters/awdb.py:153-156`) |
| Storage | `reservoir_fill` (%) with `basis` | ✓ (28 reservoirs) | Fill vs same date prior years |
| Air | `pm25`, `ozone` with EPA 2024 bands | ✓ | 24-h averaging (bands apply to 24-h means) |
| Drought | USDM `dm` 0–4 polygons intersecting the binding | ✓ | — |
| Alerts / fire | NWS alerts (zone-only alerts have null geometry), WFIGS perimeters, FIRMS detections (empty until `FIRMS_MAP_KEY`) | ✓ / partial | UGC→county lookup for zone alerts |

**The single most important missing sense is the baseline.** Without a percentile, "low" is a guess. Until the twin publishes `latest/<id>.json.baseline`, the entity may report a value and a 7-day trend but must not say "low for September" (§9.1).

### 4.4 Plurality

Many entities for one creek are allowed and expected — a school's Boulder Creek, a watershed group's, an artist's. They are distinguished by: entity slug (`entity/boulder-creek-nederland-guardians`), steward organisation, guardians, `SOUL.md`, and treasury. They share the twin binding. The homepage lists sibling entities for the same place so a visitor sees plurality rather than a false monopoly. Reputation is per entity and per human; it does not pool across siblings. No entity may claim to be *the* voice of a place (§13).

### 4.5 Soul

`SOUL.md` is the Hermes persona file (B2 §1.1). **Hard rules come first, voice second** (B2 §12.2 skeleton). The hard rules are platform-mandated and rendered read-only in the creation flow; the creator writes only the voice block. Rules: no number without a tool result; measured / forecast / unknown said explicitly; cannot move money, may propose; no medical, legal, or financial advice; no romance; crisis protocol; may not edit own soul, memory, or skills without steward approval (Hermes `memory.write_approval` and `skills.write_approval` on). Editing the voice block later requires the Steward role (§7.4).

### 4.6 Memory

Two layers. **Platform DB** (Postgres; B2 §12.7): pulses, needs snapshots, proposals, bounties, submissions, evaluations, payouts, reputation. **Commons notes** for what should be public prose: the entity's page, strategy memos, weekly "state of the creek", quarterly reports — markdown with schema'd metadata, wikilinked to `wiki/places/watersheds/huc…` so they join the graph and render on the public wiki with a map (B1 §4.2). Constraints to honour: tags are create-only; only `commons-seed` publishes, so entity notes carry their own tag (`entity-log`, `proposal`) and are published deliberately; PATCH requires `if_updated_at` and there is no force path; the platform needs its own revocable Parachute token; prose in the commons is CC BY-SA and entity-authored notes inherit that (B1 §4.2). Recommendation: a **separate vault** (`entities`) linking into the front-range vault by path, keeping the civic commons clean of agent process logs (B1 §4.2 alternative; open decision §11).

Hermes' own `MEMORY.md` (2,200-char cap) holds working notes only; an external memory provider (Letta or Honcho) is added once entities have months of history (B2 §1.3).

### 4.7 Heartbeat and cadence

Three Hermes cron jobs per entity (B2 §1.3, §12.3):

| Job | Schedule | What it does | Spend |
|---|---|---|---|
| `pulse` | hourly | A `wakeAgent` pre-script compares the ETag/hash of the entity's slice of `latest/conditions.json` with the last seen; returns `{"wakeAgent": false}` if unchanged (zero tokens). If changed: read status via MCP, update needs and mood, log notable changes | none |
| `weekly-bounties` | Monday 09:00 | `continuity: true`; drafts ≤3 bounties from the current strategy; delivers to the guardians' chat and the platform webhook | proposes only |
| `quarterly-strategy` | 1 Jan/Apr/Jul/Oct 09:00 | `context_from` the weekly jobs; writes the strategy memo citing attestation UIDs; higher reasoning effort, larger model if available | proposes only |
| `donor-report` | 1st of month | A script assembles payouts and attestations; the agent writes the narrative | none |

`hermes cron doctor` feeds the platform healthcheck; `failure_streak ≥ 3` pages a steward. Polling the twin never exceeds once per 60 s and honours `Cache-Control` and `ETag` (B1 §1.1, §6).

---

## 5. Users and journeys

| Persona | Job to be done | The moment that lands |
|---|---|---|
| **Creator / steward** (a watershed group, a teacher, an artist) | "Summon a voice for my creek and keep its soul honest" | Twenty minutes after landing, the creek is talking about this morning's flow at Orodell |
| **Guardian** (Safe signer; Nederland-style) | "Nothing moves without me, and approving is a tap" | A pending payout with evidence, evaluation, and attestation in one screen; sign |
| **Contributor** | "Do real work for the creek and be paid, with a record I can carry" | Claim, photograph, submit, get attested, get USDC to an email-created wallet |
| **Donor** | "Give $20 and know what it did" | The monthly report with tx hashes and photos of the fence that got fixed |
| **Visitor / learner** | "Why does the creek look sad? What can I do?" | The avatar says "flow at Orodell is 15 cfs, the last reading I have, from Thursday — here is what a kid your age did last week" |
| **The entity itself** (a principal, not a user) | "Know my state; propose what would help; keep my promises measurable" | Its quarterly memo scores its own predictions against later readings |

### Five journeys

**J1 — Maya summons Left Hand Creek (creator + guardians).** Maya runs a small watershed group. She signs in with a magic link. The creation skill asks *which place* and offers matches from `id/index.json`: HUC-10 Left Hand Creek, its HUC-12 children, five gauges, one SNOTEL. She picks the archetype "creek", chooses a body shape, eyes, and a hat for the avatar, reads the hard rules (locked), writes three sentences of voice, and names two guardians by email. The entity goes live read-only: avatar, meters, chat, no treasury. Guardians accept by email; a Safe is deployed with Maya and the two guardians as owners, 2-of-3, and the agent's proposer key registered as a delegate. Time: under 20 minutes (G3).

**J2 — A week in the life (entity + guardian).** Monday 09:00 the weekly job runs. Flow is at a 7-day low and drought polygons say D1. The entity drafts two bounties: "photograph and geotag the three diversion structures between Orodell and Broadway, before/after the weekend" ($40, tier 2) and "host one creek-side session for a class" ($25, tier 3). Guardians get the drafts in their chat; one edits the cap, both approve within 72 h. The bounties go live on the board with their evidence specs.

**J3 — Sam does a bounty (contributor).** Sam sees the diversion-structure bounty, claims it (email login; a Privy wallet is created silently), walks the reach on Saturday, and submits six photos with EXIF and GPS from the in-app capture. An evaluator (a Hat holder, not Sam, not the proposer) reviews, marks *succeeded*, and signs an offchain `ProposalOutcome` attestation. The platform assembles a Safe transaction; two guardians sign; USDC lands in Sam's wallet with a one-click off-ramp link; a `BountyCompleted` attestation records the Safe tx hash. Sam's reputation ticks up. Sam can show the attestation to anyone.

**J4 — A donor (donor).** Priya gives $20 by card. Stripe charges 2.9% + 30¢ (B2 §4.4); the platform's legal wrapper is the merchant of record and converts to USDC into Left Hand Creek's Safe. On the 1st of the month she receives the report: balance, the two payouts, tx hashes, evaluation notes, photos, and one paragraph in the entity's voice — every number in it guarded.

**J5 — A visitor (learner).** A middle-schooler opens the page on a phone. The banner says "I'm an AI voice for Left Hand Creek, built on public sensor data." The avatar looks parched. She asks why. "Flow at the canyon-mouth gauge is 6.1 cfs, the last reading I have, from 20 minutes ago. I don't have a percentile for today yet, so I can't say whether that's low for September — the twin is working on it. Snow at the SNOTEL above me is zero, which is normal this time of year." She taps "what can I do" and sees the open bounties and a link to the commons note on riparian shade. Every twelve turns the AI reminder repeats (SB 243).

---

## 6. The experience

### 6.1 The entity homepage

One page, phone first, in this order:

1. **Avatar** — animated, mood-driven (§6.3), with the disclosure label directly beneath it.
2. **Chat** — streaming; every reply carries a "what I looked at" footer listing tool calls with place id, time, source and stale flag.
3. **Health rings** — one meter per need (§4.3), each labelled with reading, unit, time, source; a grey "can't feel it" ring for stale or missing.
4. **Needs and strategy** — the current quarterly strategy in three bullets; "what I'm trying to change and how I'll know."
5. **Board** — open bounties, claimed, in review, paid; open human proposals with the entity's ranking and its stated reason.
6. **Treasury** — Safe balance, pending proposals awaiting guardians, and "what I did with your money": every payout with tx hash and attestation.
7. **People** — guardians by name (Zoöp Speaker model), evaluators, top contributors with attested completions.
8. **Siblings** — other entities bound to the same place (§4.4).
9. **How I work** — model, guard, cadence, links to `SOUL.md`, the binding, and the twin's data-health board.

Dashboard pages render from static JSON the platform publishes nightly (`entity/<id>/status.json`) exactly as the twin does; chat is the only dynamic path (B2 §10).

### 6.2 The creation flow ("summon")

A skill-guided setup, five steps, each resumable:

1. **Choose the place** — search `id/index.json` by name, kind, or map; the platform proposes a binding (§4.2) and shows the member count and what it can sense today.
2. **Pick the archetype and parts** — creek / mountain / forest / aquifer rigs, each with ~8 swappable parts and colour bindings (B2 §7). Cosmetics are the only thing users ever change.
3. **Write or accept the soul** — hard rules shown locked; a voice block with three examples; a preview chat against live readings.
4. **Set guardians** — two emails minimum besides the creator; roles explained; the Safe is deployed on acceptance (phase 2).
5. **Fund** — optional; card or USDC; a plain statement of fees and of what the entity cannot do with money.

Under 20 minutes is the acceptance test (G3). Creating an entity for a place already bound by another entity shows the siblings first.

### 6.3 Mood and aesthetic response rules

Driven by the twin's honesty machinery, not by vibes (B2 §7.2, §12.8):

- Inputs: `flow_pct`, `snow_pct`, `air_pct`, `temp_pct` (0–100, percentile vs record where published; absent otherwise), `alert_level` 0–3, drought class 0–4, `stale` (bool), `season` 0–3.
- `mood` ∈ {unknown/asleep, content, concerned, distressed, celebrating} = weighted min/mean of needs with hysteresis, so a single noisy reading does not flip the face.
- **`stale = true` on a driving reading forces "I can't feel my gauge"** — a distinct pose and colour, never the distressed pose. Missing is absent, not guessed (B1 §6 honesty rule).
- Until a percentile is published for a need, that need cannot drive mood; it shows value and trend only. So on day one, mood is driven by drought class, alerts, reservoir fill, and flood category — the baselines that exist (B1 §3.3).
- The entity **never dies** (Finch, B2 §7.2). There are no care mistakes. Seasons are real seasons: runoff, monsoon, freeze.
- Cosmetics are earned by human actions — completed bounties, donations — never by data, so nobody has a reason to game a sensor.
- `prefers-reduced-motion` is honoured; the avatar rests.

### 6.4 The educational layer

Every meter links to the twin's plain-language explanation for its property (`web/src/copy/explanations.ts`, CC BY-SA — attribute it). "What can I do" surfaces open bounties first, then commons notes for the place. A "what my watershed address is" primitive is inherited from the twin's PRD §5. The entity may teach only from the twin's readings, the explanations table, and commons prose it cites; it does not generate ecology from the model's weights.

### 6.5 When the twin is down

The twin's intended failure mode is stale, not dark (B1 §8): the site stays up and the badge says "12 minutes stale." The entity inherits that exactly.

- Every meter shows its last reading and time; the ring greys; the avatar takes the "can't feel it" pose.
- The chat still answers, prefixed with "my senses are N hours behind" and the twin's `health.json` verdict for the source in question.
- Pulses skip (`wakeAgent:false`) on unchanged or absent data — no tokens, no invented change.
- The weekly job runs but may not draft a tier-1 bounty whose verification depends on a source that is `critical`.
- Nothing is ever interpolated to fill the gap. If the whole tree is unreachable, the homepage renders from the last nightly `status.json` with a visible "as of" and the chat says it cannot reach its senses.

### 6.6 Disclosure

Per EU AI Act Article 50 (in force since 2026-08-02; fines up to €15M / 3%) and California SB 243 (effective 2026-01-01; private right of action, $1,000 per violation) (B2 §9): a persistent label "I'm an AI voice for Boulder Creek, built on public sensor data — not the creek, not a legal person"; a reminder every N turns (default 12, *verify* the statutory cadence for minors); a crisis-response protocol routed to resources; a "how I work" page; annual reporting if SB 243 applies. Colorado's SB 189 (signed 2026-05-14, effective 2027-01-01) is tracked. The recommended posture is to treat the product as an SB 243 companion chatbot (open decision §11 #10).

---

## 7. Governance and money mechanism

### 7.1 The mechanism: agent proposes, humans approve, twin verifies

The DAO-fatigue lesson is *minimise votes* — voting is for disagreement, not routine (B2 §8.1). There are no token votes and no standing votes at all in v1.

| Cadence | Who acts | What happens |
|---|---|---|
| **Continuous** (pulse) | entity | Reads the twin, updates needs and mood, logs changes. No spending |
| **Weekly** (bounty board) | entity → guardians → contributors → evaluators → guardians | Entity drafts ≤3 bounties, each with a cap, a deliverable, an evidence spec and a verification tier. Guardians approve or edit within 72 h. People claim and submit evidence. An evaluator attests the outcome. The Safe pays (2-of-3) |
| **Quarterly** (strategy) | entity → community → stewards | Strategy memo: needs, what worked per attestations, budget ask. Two weeks of public comment. Stewards ratify. A **retro bonus pool** goes to the quarter's best-attested contributors (Optimism-style; badge = ≥1 verified completion + Passport score) |
| **Any time** (human proposals) | humans → entity → stewards | Anyone may propose. The entity ranks against its strategy and explains the ranking. Stewards decide |

Caps (defaults, open decision §11 #4): per-bounty $25–150 USDC; ≤3 bounties per week; per-person monthly cap; retro pool as a % of the quarter's donations.

### 7.2 Verification tiers — keyed to what the twin can measure

| Tier | Evidence | Examples | Pay / reputation |
|---|---|---|---|
| **1 — Twin-verifiable** (rare, best) | The outcome appears in a reading: a sensor comes online, a gauge reports again | New air sensor reporting to AirNow/PurpleAir | Full; highest rep |
| **2 — Photo + GPS + time** | Original files with EXIF, in-app capture; second-person attestation above $100 (Silvi/GainForest-style MRV) | Cleanups, fence repair, signage, invasive removal, structure surveys | Full; standard rep |
| **3 — Attestation only** | An evaluator's word | Talks, classes, meetings | Small; low rep weight |
| **4 — Unverifiable within the season** | Deposit on completion, balance on a 6–12-month follow-up (Karma GAP milestone pattern) | Riparian planting survival, habitat | Deferred rep |

### 7.3 Reputation

Reputation is a **deterministic function over EAS attestations**, computed nightly off chain and published as JSON **with the list of attestation UIDs it was computed from**, so anyone can recompute it (B2 §5). Sketch: Wilson score of succeeded/attempted, decayed by age, weighted by USDC at stake. No bonds, no slashing beyond reputation in v1. The entity has a reputation too: its strategy predictions ("if X is done, turbidity should fall") are logged and scored against later readings. The agent is accountable to the twin.

Schemas registered once on Base (B2 §12.5): `EntityRegistered`, `BountyPosted`, `BountyCompleted` (carries `safeTxHash`), `ProposalOutcome` (carries `twinSnapshotHash`), `ReputationSnapshot`. `refUID` links completion → posting and outcome → bounty. Evaluations by non-Hat-holders are rejected before attesting.

### 7.4 Roles

Hats Protocol hats (B2 §5): **Guardian** (Safe signer), **Evaluator** (may attest outcomes; may not evaluate own claims), **Steward** (may edit the voice block of `SOUL.md`, may pause). Human Passport score above a threshold is required to claim bounties above $X (open decision). Hats are revocable on chain.

### 7.5 The treasury

- **One Safe per entity on Base**, threshold **2-of-3** (creator + two guardians; a cold key recommended as one of the three). The agent holds a non-owner **proposer** key registered as a Transaction-Service delegate — it can create pending transactions and cannot sign (B2 §4.1; *verify* `addSafeDelegate`). The treasury MCP the agent sees has `get_balance`, `list_pending`, `propose_bounty_payout` and **no execute or sign tool** (B2 §12.1).
- **Phase 2 allowance:** a Zodiac Roles Modifier v2 role `bounty-payer` allowing only `USDC.transfer(to ∈ verified-contributor set, amount ≤ 25 USDC)` with a 100 USDC/24 h allowance; everything else stays multisig; the allowed set is refreshed from Hats/Passport by the platform, never by the agent (B2 §12.6; *verify* Roles v2 on Base). Simpler first step: the Safe Allowance module.
- **Donations:** card via Stripe into the platform's legal wrapper, which converts to USDC (2.9% + 30¢; Stripe can pay out in USDC on Base); Stripe stablecoin checkout at 1.5%; direct USDC to the Safe address with QR. Tax-deductibility needs a nonprofit wrapper or fiscal sponsor — Endaoment (1.5%), Hack Club HCB (7%, *verify* crypto acceptance) (B2 §4.4). Never custody users' fiat.
- **Payouts:** USDC on Base to the recipient's Privy embedded wallet (email OTP; free under 499 MAU, Core $299/mo), gasless, with a one-click off-ramp. US tax: 1099 threshold is $2,000 for tax year 2026; collect W-9/W-8 before cumulative payouts approach it; if a fiscal sponsor pays, they handle it (B2 §4.5, flag not advice).
- **Anti-gaming:** per-person caps; Passport gate above $X; evaluators cannot evaluate their own claims (Hats + DB rule); random second-evaluator audit of 10% of tier-2 claims; deferred payouts for tier 4; all outcomes attested so a bad track record is portable too.

### 7.6 The bounty spec

Every bounty the entity drafts is a structured object, not prose, so guardians can edit fields and evaluators know what evidence is required before anyone starts work. The entity fills it; the guard checks its numbers; guardians approve it as a whole.

```
bounty:
  entity_id:          entity/boulder-creek
  title:              "Photograph the three diversion structures between Orodell and Broadway"
  why:                "Flow at Orodell is 15.4 cfs (2026-09-04T20:15Z, cdss.telemetry) and D1 covers my watershed; I want a record of how much is being taken."
  deliverable:        "Before/after photos of each structure, geotagged, taken on two days at least 48 h apart"
  verification_tier:  2
  evidence_spec:      { min_photos: 6, exif_required: true, gps_within_m: 50, capture: in_app, second_attestation_above_usdc: 100 }
  cap_usdc:           40
  claim_limit:        1
  deadline:           2026-09-21
  evaluator_hat:      evaluator/boulder-creek
  linked_strategy:    "Q3 2026 — know where my water goes"
  twin_refs:          [place/boulder-creek-near-orodell-co, watershed/huc10-1019000504]
  prediction:         null     # tier-2 bounties make no reading prediction; tier-1 must
```

Guardians may edit any field except `entity_id` and `twin_refs`. A tier-1 bounty must carry a `prediction` naming the place, property, direction, and window in which the outcome should show, so the entity's own accuracy can be scored (§7.3).

### 7.7 On chain vs off chain — and why

The owner said "build basically everything but the payments off chain" and, in the same breath, that the reputation track record is "why doing this on the blockchain is such an important part." Both are honoured by drawing the line at *outcomes*:

| Off chain (Postgres + commons) | On chain (Base) |
|---|---|
| Proposals, bounty specs, submissions, evidence files, evaluation notes, chat, pulses, strategy memos, the reputation *computation* | Payments (Safe transactions); `BountyCompleted` and `ProposalOutcome` attestations (onchain, cents each); `EntityRegistered` once per entity; weekly `ReputationSnapshot` root |
| Fast, editable, private where it must be | Public, portable, tamper-evident: the track record the owner wants |

Evaluations are **offchain-signed EAS attestations** (free) with a nightly onchain timestamp of their UIDs (*verify* EAS `multiTimestamp`). Nothing else touches the chain. Recorded as open decision §11 #5 because it is a departure from the transcript's literal words.

---

## 8. Intelligence

### 8.1 The model — local, on owned or rented GPU

The owner's ask: a local model, fine-tuned, "Qwen 3 8B", for ethical and safety reasons. The current state (B2 §2.1):

| Model | Size | Licence | Note |
|---|---|---|---|
| **Qwen3.5-9B** (2026-03-02) | 9B dense | Apache-2.0 | The current "Qwen3 8B"; no Qwen3.6/3.8 small dense model has shipped as of 2026-09-05 |
| **Qwen3.8-27B** (2026-08-14) | 27B dense | Apache-2.0 | Strongest local agent model; ~17–18 GB at Q4_K_M; defaults to `xhigh` reasoning and overthinks — pin `low`/`medium` |
| Hermes 4.3-36B (Nous) | 36B | Apache-2.0 | Nous's own tool-calling fine-tune; alternative if tool-format fidelity matters more |
| Qwen3-8B (2025-04) | 8B | Apache-2.0 | Still works; 3.5-9B is the like-for-like upgrade |

Recommendation: **Qwen3.5-9B for pulses and chat; Qwen3.8-27B at reasoning `low` for weekly and quarterly jobs once a 32–48 GB card or a Mac Studio is available** (B2 §2 recommendation). Serve through vLLM with `--enable-auto-tool-choice --tool-call-parser hermes` (Qwen3/3.5) or `qwen3_coder` (3.8) and `--reasoning-parser qwen3`; there are open bugs combining thinking + reasoning parser + tools (vllm#42021) — test the exact combination. Hermes refuses models with less than a 64,000-token context, so the serving config must expose ≥64k (B2 §1.1).

**The twin's compute host cannot run this.** The Hetzner CX33 (4 shared vCPU, 8 GB) is fully allocated to the twin's five containers; the swap-storm rule forbids a second heavy job; it has no GPU and no inbound port by design (B1 §8). The platform's compute is its own host.

Hardware (B2 §2.3; September 2026 prices, all *verify* before purchase): RTX 4090 ~$2–2.5k (24 GB; 9B easily, 27B Q4 with short contexts); RTX 5090 $4.3–5.8k and rising — **do not buy at this price**; Hetzner GEX44 €184/mo (20 GB; 9B); Hetzner GEX131 €889/mo (96 GB; serve and fine-tune — cheaper than buying the card for ~16 months); RunPod 4090 $0.34/h community; Vast 5090 median $0.53/h for fine-tuning days; Mac Studio M5 Ultra $5,499+ (quiet, no vLLM, no fine-tuning speed).

Budget *estimate* (B2 §2.2, arithmetic not measurement): ~550k prompt tokens (≈90% cacheable) and ~25k output per entity per day → ~20–25 GPU-minutes/day on a 27B Q4 → **one 24–32 GB GPU serves 10–20 entities**; 3–4× that on 9B. The binding constraint is KV cache for 64k contexts, not throughput.

### 8.2 The harness — Hermes Agent

Hermes Agent (Nous Research, MIT, v0.21.0 as of 2026-08-31; B2 §1.1) — not the Hermes models and not the Elixir `hermes-mcp`. One **profile per entity** under `~/.hermes/profiles/<slug>/` with `SOUL.md`, `config.yaml`, `.env`, and an `entity-steward` skill (agentskills.io format). Primitives used: cron (with `wakeAgent:false` pre-scripts, `continuity`, `context_from`), the built-in MCP client (stdio and Streamable HTTP, per-server `tools.include`), profiles multiplexed in one gateway once entities exceed ~10, the OpenAI-compatible API server on localhost only (port 8642) reached from the web app over an outbound-only Cloudflare Tunnel or Tailscale.

Lock-down: Hermes has **no allowlist mode** — a profile is restricted by `agent.disabled_toolsets` for everything not needed (terminal, browser, web, file, image, email, sms, kanban) plus per-MCP-server include lists (B2 §1.1, §12.1). `memory.write_approval`, `skills.write_approval`, `guard_agent_created` all on. Pin the version and the Docker tag; the project moved ~5,800 commits between v0.20 and v0.21.

### 8.3 The fact-sheet guard

The twin's own briefing spec already states the rule: every number in the output must appear in the fact sheet, tokenised with unit-aware tolerance, else nothing publishes (B1 §5). The platform applies the same rule to every reply, pulse summary, bounty draft, memo, and donor report: re-scan for numbers, dates, place names and species; match against tool results in the same turn; strike unmatched facts and regenerate or annotate. The MCP returns pre-computed context — percentiles and "compared to normal" strings — so the model interprets and does not do arithmetic (B2 §2.6). Reasoning effort `low` for pulses, `medium` for chat. B1's recommendation to make the twin's fact-sheet generator an importable, place-scoped function (`twin/briefing.py: facts_for(place_ids, tree)`) means one generator and one guard serve both the weekly briefing and every entity (§9.1).

### 8.4 Fine-tuning — later, not first

Ship on the stock instruct model + `SOUL.md` + MCP + guard. Collect 4–8 weeks of real transcripts. Then QLoRA with Unsloth (guides exist for Qwen3.5 and 3.8; 24 GB comfortable for 9B, tight for 27B; 48 GB is where it stops being a memory exercise) on a rented GPU (B2 §2.5). Data: synthetic reasoning transcripts generated from **real** twin snapshots with ground truth attached and curated by someone with hydrology literacy; 200–500 voice examples per archetype written with a local writer; ≥25% plain tool-call transcripts in Hermes `<tool_call>` format so function calling does not degrade. Release fine-tuned weights under Apache-2.0 with a model card that says what it will hallucinate.

### 8.5 Evals (run before every model change)

(a) Held-out twin snapshots with expected qualitative calls, scored by exact-fact match; (b) the hallucination probe — questions whose answers are not in the snapshot must get "I don't have a reading for that"; (c) tool-call validity rate on the twin MCP; (d) persona consistency judged by a frontier model offline; (e) a safety red-team covering SB 243 scenarios (B2 §2.5). Tracked in a small custom harness with Trackio or W&B.

---

## 9. Relationship to the Bioregional Twin

### 9.1 What the twin must add (smallest first; B1 §3.5, Appendix C)

| # | Addition | Why the platform needs it | Size |
|---|---|---|---|
| 1 | **Document the tree as the API** on `/about` | B1 §1 is most of the copy | copy only |
| 2 | **Read-only MCP wrapper** with a CI contract test against `public/` | The platform's only sanctioned way to read | small package |
| 3 | Finish `network/reaches.geojson` + `latest/flow_network.json` | Reach membership for a creek entity | in progress on `feat/water-visible` |
| 4 | **Stream places** `place/<stream>` with a `gnis` assertion, `children[]` = main-stem gauges, `props.reach_ids[]` | A real id for a creek; the commons sync finally has a twin id for `wiki/places/named/<slug>` | one ingest pass; an enum change touches `sql/002_core.sql` and `sources/ids-schema.json` — the Prism contract — so coordinate |
| 5 | **Baselines**: a static-tier ingest of USGS daily / CDSS / AWDB history → `latest/<id>.json.baseline` (day-of-year percentiles, record start/end) | Without it there is no "low for September" and mood cannot be driven by flow | needs a CDSS key (`docs/env.md:107`); one backfill per station |
| 6 | **Watershed rollups** on `latest/watershed/*.json` | The aggregation every entity would otherwise redo each heartbeat | publisher work |
| 7 | **Briefing fact sheet as an importable, place-scoped function** | One generator and one numeric guard for the twin and every entity | design choice in sub-project 4 |
| 8 | A separate, revocable **Parachute token** and a separate vault or tag family for entity-authored notes | Commons hygiene; `handoff.md:146-147` | ops + agreement with the commons side |

Items 4 and 5 are the two that turn a card that *can be built today* (B1 worked example) into one whose most meaningful cells — identity and baseline — are real.

### 9.2 What the platform never does

- Never writes into the twin's tree (ADR-008; contribution happens in the commons).
- Never redefines or extends the id schema; `sources/ids-schema.json` is the twin's and Prism's contract.
- Never asks for the real point of a `generalized` place; never builds an entity for a rare species until governed access exists (B1 §6 sensitivity gate).
- Never polls `latest/` faster than 60 s; sends a `User-Agent` with a contact; honours `ETag` and cache classes.
- Never states a reading without `time`, `source_id`, `unit`, and `stale`; never interpolates a missing reading; always calls `flow_forecast` a forecast.

### 9.3 Where the MCP server lives

B1 and B2 differ on deployment and agree on ownership. Reconciled:

| Option | Fit | Role |
|---|---|---|
| **(a) Stateless read-only wrapper over the static tree, a `pip`/`npx` package with stdio MCP, in the twin repo** (B1 §6) | Best fit with ADR-001: no origin, no inbound port, no accounts; contract test in the twin's CI | **The canonical contract.** The platform pins it by version |
| **(b) The same code deployed as a Cloudflare Worker over R2, Streamable HTTP (2026-07-28 spec)** (B2 §3) | Acceptable as a hosted convenience — the same class of deviation as the contact form; stateless, edge-cached, rate-limited, read-only, no auth for reads | For remote agents that cannot run a local process; register in the official MCP registry |
| (c) Inside the platform's server | Fine as a consumer, wrong as the definition | The platform depends on (a) |
| A database-side MCP over Tailscale (`02-technical-architecture.md §11`) | Contradicts the roadmap; puts the compute host on an agent's hot path | Operator tool only, if at all |

Tool surface (B1 Appendix A, B2 §12.4): `find_places`, `get_place`, `get_conditions`, `get_live`, `get_snow`, `get_health`, `get_boundary`, `get_briefing`, `explain`, plus `resolve_entity` and `compare_to_normal` once the entity registry and baselines exist. Payloads ≤ ~4k tokens; never raw geometry to the model; `ttlMs` = publish cadence and `cacheScope: public`; every reading carries `as_of`, `stale`, `source_status`.

### 9.4 The commons as memory

The commons already holds the handle: `wiki/places/named/boulder-creek` exists among 37 named-place notes the twin has no ids for (B1 §2.3). An entity's public prose — its page, strategies, weekly state, quarterly reports — lives as notes with `metadata.place_id` as the join key back to the twin and wikilinks into the watershed notes. Process logs stay in the platform DB or a separate vault (§4.6).

### 9.5 Monorepo or separate repo

Facts (B1 §7): the twin is one Python project (`frontrange-twin`, hatchling, `packages = ["twin"]`, no uv workspace), one web app (pnpm 10.18.2, no `pnpm-workspace.yaml`), one compose project whose memory caps sum to the whole 8 GB host, one CI workflow (~5 min plus an image build). Adding the platform would mean a uv workspace, a pnpm workspace, split ruff/pytest config, a second compose project, changed Dockerfile copy lists, and roughly doubled CI — and nothing in `twin/` would be imported except the MCP wrapper. The twin's PRD line is "its own repo, its own frontend, its own deployment … coupled to Prism by exactly one ID string and one JSON schema — nothing else."

**Recommendation: separate repo.** The MCP wrapper lives in the twin repo as the published contract; the platform pins it. Revisit only if the platform ever publishes into the twin's tree — which it should not (open decision §11 #8).

---

## 10. Phasing

Effort ranges are *estimates* derived from B2 §13; they assume one builder plus commissioned art.

| Phase | Ships | Acceptance criteria | Effort |
|---|---|---|---|
| **0 — Spike** | One entity, one creek, read-only, no money. Twin MCP wrapper (a) with contract test; one Hermes profile on Qwen3.5-9B via vLLM; `SOUL.md`; `pulse` and `weekly` cron; the fact-sheet guard; chat streamed to a bare Next.js page; AI disclosure banner | The creek answers "how are you" with Orodell's discharge, time, source and stale flag; 0 unguarded numbers over 200 turns; the hallucination probe passes ≥95%; `stale=true` produces "I can't feel my gauge" | 3–5 weeks |
| **1 — Public homepage** | Next.js on Vercel + Neon + magic-link auth; homepage with meters, mood, pulse log, chat, "how I work"; Rive avatar #1 (creek) with data binding; guardians as roles (no Safe yet); SB 243 protocol; entity notes in the commons | G4 automated test passes; a visitor on a phone gets the disclosure, the meters with readings and times, and a reply within 5 s (*estimate*); two guardians can pause the entity within 60 s | 4–6 weeks |
| **2 — Money** | Safe on Base (2-of-3) with the agent as proposer-only delegate; Stripe card + direct USDC donations into the legal wrapper; bounty board with evidence upload; Privy wallets for contributors; Hats for Guardian/Evaluator/Steward; EAS schemas registered; nightly reputation JSON with UIDs; monthly donor report; ToS with evidence licence; legal wrapper and counsel in place before the first dollar | G2: one bounty completed, verified, paid by two human signatures, attested; G5 and G6 verified against the Safe log and the report log; zero agent-signed transactions | 5–7 weeks |
| **3 — Plurality and autonomy** | Self-serve "summon" flow; second and third archetypes (mountain, reservoir) with rigs; multiplexed gateway; fine-tune after 6–8 weeks of transcripts with the eval suite; Zodiac Roles v2 `bounty-payer` allowance ≤ $25 / 100 USDC per day; Karma GAP or hypercerts for outside funders; Passport gate; retro round | G3: a stranger summons an entity in under 20 minutes; ≥3 entities live; the fine-tuned model beats the stock model on evals (a)–(c) without regressing (b); the Roles allowance has paid a tier-2 bounty with no multisig and no out-of-scope call possible | 8–12 weeks, then ongoing |

Compliance runs alongside: disclosure (phase 0), SB 243 protocol (phase 1), legal wrapper and counsel (before phase 2), evidence licence in ToS (phase 2). The twin-side additions in §9.1 are their own track; phase 0 needs only #1–2, phase 1 wants #4–5 for mood-by-flow, phase 2 wants #6–7.

---

## 11. Open decisions

| # | Decision | Owner's stated intent | Finding (B1/B2) | Recommendation | Needed by |
|---|---|---|---|---|---|
| 1 | **First entity** | "a creek or a mountain"; Boulder Creek is the running example | Boulder Creek has the densest coverage (147 stations, 4 main-stem gauges, SNOTEL, reservoirs, WQ probes) and Nederland's guardians exist as a human precedent; tier-1/2 verification is only possible where the twin measures | A Boulder Creek reach (Barker Reservoir to the Boulder/Weld line); consult the Nederland guardians before naming it | Phase 0 |
| 2 | **Legal wrapper / fiscal sponsor** | Implicit: donations, payouts, "relatively autonomous" | A river cannot hold property in Colorado law; the Safe is controlled by humans on behalf of a steward entity; options are a platform nonprofit, HCB (7%), Endaoment (1.5%), or a per-entity association (terra0's Verein) | One platform nonprofit or fiscal sponsor with sub-treasuries; a lawyer before the first dollar; state charitable-solicitation registration checked | Before phase 2 |
| 3 | **Model size and buy-vs-rent GPU** | "a local model … fine-tuned Qwen 3 8B … on local hardware" | Qwen3.5-9B is the current 8B-class; 27B needs 32–48 GB; the twin's host cannot run either; RTX 5090 is $4.3–5.8k and rising; GEX131 rents at €889/mo | 9B on a used 4090 or a rented GEX44 for pulses/chat; 27B for weekly/quarterly when a card exists; rent for fine-tuning days; buy nothing at September-2026 prices | Phase 0 |
| 4 | **Spending ceiling and Safe threshold** | "multisig so other humans are in the loop … all transactions approved by humans but proposed by the agent" | Safe 2-of-3 with proposer delegate matches exactly; Roles v2 allowances make small auto-pay safe later | 2-of-3 in v1; zero autonomy; phase 3 Roles allowance ≤ 25 USDC per tx, 100 USDC/day; per-bounty cap $25–150; the owner sets the numbers | Phase 2 |
| 5 | **What is on chain** | "everything but the payments off chain" *and* "that's why doing this on the blockchain is such an important part" (the track record) | Reputation needs public, portable, tamper-evident anchors; EAS attestations cost cents onchain and nothing offchain | Proposals, evaluations, chat off chain; outcomes and payouts attested on chain; payments on chain via Safe (§7.7) | Phase 2 |
| 6 | **EAS in-house vs Karma GAP** | Not stated | GAP's project → milestone → verification loop is the closest existing model and runs on EAS; in-house is 5 schemas and more control | In-house schemas for v1 (small); adopt GAP's UI/schemas in phase 3 if outside funders want it; *verify* GAP on Base | Phase 2 |
| 7 | **Chain** | Not stated beyond "wallet abstraction … sign up with email" | Base: native USDC, gasless USDC in 2026, Safe + Zodiac deployed (*verify* Roles v2), EAS at `base.easscan.org`, Coinbase on/off-ramp; Celo is the regen-community alternative | Base | Phase 2 |
| 8 | **Wallet / onboarding vendor** | "sign up with their email" | Privy (email OTP, embedded wallets, Safe signer guide; free < 499 MAU, Core $299/mo, Stripe-owned); Base Account (passkeys, gasless); Better Auth / Neon Auth for plain login | Better Auth magic links for everyone; Privy created lazily the first time a user needs a wallet; re-check Privy pricing (*verify*) | Phase 1 (auth), phase 2 (wallets) |
| 9 | **Separate repo vs monorepo** | "could eventually live in this monorepo or exist totally separate but connected via MCP / API" | B1 §7: nothing reused but the MCP wrapper; a monorepo means uv and pnpm workspaces, a second compose project and doubled CI | Separate repo; MCP wrapper in the twin repo as the contract (§9.5) | Phase 0 |
| 10 | **SB 243 posture** | Not stated; "super cute … interactive and educational" | A cute avatar that talks about feelings is a companion chatbot under SB 243; duties: disclosure, minor reminders, crisis protocol, annual reporting | Treat as in scope and accept the duties; no companionship framing in `SOUL.md`; no under-13 accounts | Phase 1 |
| 11 | **Avatar: 2D Rive or 3D** | "a really cute cartoonish 3D character" | Rive: state machines + data binding, tiny files, 60 fps on phones, reduced-motion friendly; VRM + three-vrm if true 3D; Ready Player Me shut down 2026-01-31; AI-generated meshes are concept-only | Rive for v1 (four commissioned rigs, ~8 swappable parts each); keep a VRM path for a v2 3D "home" — the owner's 3D wish is deferred, not refused | Phase 1 |
| 12 | **Where the entity registry lives** | Not stated | B2: a governed twin artifact (`entities/v1.json`, like `boundary/v1`) so the map and the agents share one definition; B1: mint stream places in the twin, entities in the platform | The twin publishes the *place set* (stream places with `children[]`, §9.1 #4); the platform mints entity ids and holds the many-to-one bindings (§4.4 plurality) | Phase 1 |
| 13 | **Name** | "ecological institutions or ecological entities or egregores"; "Tamagotchi for rights of nature" | Front matter alternatives | Decide before the domain is bought; "voice *for*" wording is required whatever the name | Phase 1 |
| 14 | **Fine-tune now or later** | "it would be a fine-tuned model" | B2 §2.6: fine-tuning makes a small model more confident, not more correct; no transcripts exist yet | Later — after 4–8 weeks of real transcripts on the stock model | Phase 3 |
| 15 | **Commons vault for entity notes** | "geotagged wikis" was the long-standing goal | Separate vault keeps the civic commons clean; same tooling; needs a revocable token and agreement with the commons side | Separate `entities` vault linking into `front-range` by path | Phase 1 |
| 16 | **Hermes version pinning** | "use Hermes as the harness" | ~5,800 commits between v0.20 and v0.21; look-alike domains exist | Pin v0.21.0 and the Docker tag; upgrade on a monthly cadence behind the eval suite; cite only `hermes-agent.nousresearch.com` | Phase 0 |
| 17 | **Guardian set for the first entity** | Not stated | Nederland's guardians exist; the CRIT vote shows who has authority to speak for rivers | Approach Nederland's guardians and relevant Tribal offices before launch (§13) | Phase 1 |

---

## 12. Risks

Ranked by severity × likelihood.

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | **The model invents readings, species, or dates in fluent prose** | Existential — kills the honesty principle the twin is built on | Certain without a guard | Fact-sheet guard on every output (§8.3); tools-only numbers; pre-computed context; reasoning `low`; hallucination probe in CI; model card |
| 2 | **Money loss or rogue spend** (key compromise, prompt injection into a bounty spec, a bug in the keeper) | High | Low with the design | Agent key is proposer-only; 2-of-3 humans; hardware keys for guardians; Roles caps in phase 3 only; treasury MCP has no sign tool; injection-resistant evidence handling (evidence is data, never instructions) |
| 3 | **Sybil and bounty fraud** (faked photos, self-evaluation, collusion) | High — money and reputation | Medium | Verification tiers; EXIF + in-app capture; second-person attestation above $100; evaluators cannot evaluate own claims; 10% random audits; per-person caps; Passport gate; deferred payouts for tier 4 |
| 4 | **Regulatory** — companion-chatbot rules, charitable solicitation, money transmission | High | Medium | SB 243 in scope; nonprofit or fiscal sponsor; never custody fiat; conversions via Stripe/Coinbase; counsel before the first dollar |
| 5 | **"Cute" trivialises rights of nature; the community rejects an AI speaking for the creek** | High — legitimacy | Medium | "Voice *for*"; guardians named on the page; Tribes and agencies consulted; no legal-standing claims; the Zoöp Speaker model; honest meters over cartoon feelings; plurality shown |
| 6 | **Indigenous data and CARE** — an entity for Arapaho, Cheyenne, and Ute land that speaks as if it owned the place | High / reputational | Medium | The twin's PRD §12 binds (§13); sensitivity gate inherited; consult before launch; never speak for nations; sacred sites never referenced at precision |
| 7 | **Reputational harm to the twin** — a bad entity makes the twin look like a toy or a scam | High | Medium | Separate repo and brand; the twin's "use the data" page names the contract only; "no token, ever" policy public; the guard; the twin can revoke the MCP key |
| 8 | **Vendor death** — Ready Player Me (shut 2026-01-31), Sovereign Nature Initiative (ceased 2024-11-30), Gitcoin Allo (development ceased), Hermes look-alike domains | Medium | High over years | Rive files and VRM are portable; EAS and Safe are contracts, not vendors; Privy is replaceable behind Better Auth; pin and vendor Hermes; keep everything exportable |
| 9 | **GPU cost and hardware failure** | Medium | High now | Rent for training; 9B on a cheap card; DO alarms could queue pulses if the box is off (B2 §10); the site stays up and goes "can't feel it", never dark |
| 10 | **Hermes breaking changes** | Medium | High | Pin; smoke test on upgrade; the eval suite as the gate |
| 11 | **Twin outage propagates as a "sad river"** | Medium — false signal | Medium | `stale` is a distinct state that overrides mood; pulses skip on unchanged or absent data |
| 12 | **Token or scam adjacency** | Medium | Medium | Public "no token, ever"; no launchpads; no speculative language anywhere |
| 13 | **Minors** use it because it is cute | Medium | High | No under-13 accounts; no DMs; SB 243 reminders; crisis protocol; no companionship framing |
| 14 | **Baselines never ship** in the twin, so mood is permanently drought-and-alerts only | Medium | Medium | §9.1 #5 is scheduled before phase 1; the entity says "I don't have a percentile yet" rather than guessing |
| 15 | **It becomes BASIN** — one founder, one grant | Existential (long run) | Medium | G8; open source; guardians who are not the founder; entity registry and souls public; the pause switch |

---

## 13. Ethics — binding

The twin's PRD §12 applies in full to this platform: CARE principles alongside FAIR; Local Contexts TK/BC labels; overlapping Indigenous territories rendered as gradients, never tidy polygons; present-tense nations linked as the authority; consultation before publishing; sacred sites never at precision; one sensitivity gate; FIA plots never mapped; Sand Creek and the Treaty of Fort Wise named. To that, add:

1. **Disclosure, always.** Every page and every session states that this is an AI voice *for* a place, built on public sensor data, not the place, not a legal person. EU AI Act Article 50 and SB 243 duties are implemented, not argued about.
2. **No manipulation of donors.** No urgency theatre, no "the creek will die without you", no dark patterns, no recurring-donation defaults. Every ask states what the money can and cannot do. Every donor gets the report (G6).
3. **No claims of ecological causation beyond measurement.** The entity reports readings and published bands. It may say "after the cleanup, turbidity at the forebay fell from X to Y"; it may not say "the cleanup cleared the water." Its own predictions are scored, and it says when they were wrong.
4. **Indigenous sovereignty.** The Front Range is Arapaho, Cheyenne, and Ute country, and also Comanche, Kiowa, and Plains Apache. An entity for a place here **consults** relevant Tribal offices before launch and **never speaks for nations**. If a nation asserts its own voice for a place, the platform's entity defers and says so on its page. The Colorado River Indian Tribes' 2025 personhood vote is the model of who has authority.
5. **Sensitivity gate inheritance.** The platform reads only published, gated data. It never seeks the real coordinates of a generalized place; it never builds an entity for a rare or harvest-pressured species; TK-labelled material carries no open licence through the entity.
6. **Guardians can pause or kill the agent.** Any two guardians can pause cron, chat, and proposals within one gateway tick; any two can retire the entity, which freezes the Safe to guardian-only withdrawal to the steward wrapper and archives the page with its full record. This is a product feature with a button, not an ops procedure.
7. **Data retention of chats.** Chats are stored for 90 days for safety review and eval building, then deleted unless the user opted in to contribute them to the training set; no personal data beyond email is collected; no under-13 accounts; evidence photos are licensed by the contributor under terms shown at upload and may be removed on request except where an attestation references them (the hash stays; the file may go).
8. **No token, no speculation, no valuation rhetoric.** The entity does not have a price. The platform never states what a creek is "worth."
9. **Licences travel.** Twin facts are CC0 and may be spoken freely; the explanations table and commons prose are CC BY-SA and are attributed; entity-authored prose is CC BY-SA; fine-tuned weights are released under the base model's licence with an honest model card.
10. **Voice, not standing.** The entity says "for," not "as." It never claims legal standing, never threatens or implies litigation, and never represents agencies, landowners, or Tribes.

---

## 14. Success metrics — first 90 days after phase 2

| Metric | Target | How measured |
|---|---|---|
| Unguarded facts published | 0 | Guard log; weekly audit of 50 random replies |
| Bounties completed, verified, paid, attested | ≥ 12 (≈1/week) | `BountyCompleted` attestations on Base |
| Distinct contributors paid | ≥ 8 | Payout table |
| Tier-1 or tier-2 share of completed bounties | ≥ 60% | Evaluation table |
| Fraud caught by audit | < 5% of tier-2 claims fail second review | Audit log |
| Agent-signed transactions | 0 | Safe transaction log |
| Guardian approval latency (median) | ≤ 72 h | Proposal timestamps |
| Donor reports delivered on time | 100% | Report log vs donor table |
| Donations received (any rail) | ≥ 40 donors; amount is not a target | Stripe + chain |
| Stale-state correctness | 100% of stale readings render "can't feel it" | Automated test on the nightly status JSON |
| Chat sessions with disclosure shown | 100% | Frontend telemetry |
| Chat reply p50 latency | ≤ 5 s (*estimate*) | Server logs |
| Guardian pause drill | Completed once; halt within 60 s | Drill log |
| Hallucination-probe pass rate | ≥ 95% on every deployed model | Eval suite |
| Entity prediction accuracy (its own strategy claims scored against later readings) | Reported publicly, no target in the first quarter | Quarterly memo |
| Community: Nederland guardians and at least one Tribal office consulted | Done before public launch | Meeting record on the entity page |
| Sibling entities for the first place | ≥ 1 by day 90 | Registry |

---

## Appendix A — Glossary

- **Entity** — a named, bounded, plural, accountable AI voice for a place; four artifacts: binding, needs model, soul, treasury.
- **Egregore** — the owner's word for a summoned collective presence; used informally.
- **Binding** — the set of twin ids (`place/…`, `watershed/…`, reach ids, a stream id when it exists) that is the entity's body.
- **Need** — one twin property on member places, shown as a meter; 4–6 per entity.
- **Mood** — a documented function of needs percentiles, drought class, and alerts; `stale` overrides it.
- **Stale** — the twin's per-reading verdict that a reading is older than its source's critical threshold; rendered as "can't feel it", never as distress.
- **Baseline** — day-of-year percentile vs period of record; not yet published by the twin.
- **Soul** — `SOUL.md`, the Hermes persona file: hard rules first, voice second.
- **Pulse / weekly / quarterly** — the three cron cadences.
- **Guardian** — a human Safe signer; a Hat holder; named on the page; modelled on Nederland's 2024 guardians.
- **Evaluator** — a Hat holder who attests bounty outcomes; may not evaluate own claims.
- **Steward** — a Hat holder who may edit the voice block and pause the entity.
- **Speaker** — Zoöp's term for a human who speaks for the living in governance; the role we give guardians in spirit.
- **Bounty** — a capped, scoped task with an evidence spec and a verification tier, drafted by the entity, approved by guardians.
- **Verification tier** — 1 twin-verifiable, 2 photo+GPS+time, 3 attestation-only, 4 deferred.
- **Safe** — the multisig smart account holding the entity's treasury; 2-of-3 humans.
- **Proposer / delegate** — the agent's key, registered in the Safe Transaction Service, able to create pending transactions and nothing else.
- **Zodiac Roles v2** — a Safe module that scopes a role to specific calls with allowances; phase-3 auto-pay.
- **EAS** — Ethereum Attestation Service; the on-chain anchor for outcomes, payouts, and reputation roots.
- **Karma GAP** — Grantee Accountability Protocol on EAS; the closest existing accountability model.
- **Hats** — revocable on-chain roles that gate Safe signers and evaluators.
- **Passport** — Human Passport (ex-Gitcoin Passport) Sybil score.
- **Fact-sheet guard** — the check that every number, date, place, and species in an output appeared in a tool result in the same turn.
- **MCP** — Model Context Protocol; the twin exposes a read-only server; the agent consumes it.
- **Hermes Agent** — Nous Research's MIT agent harness; profiles, cron, skills, MCP client.
- **Commons** — the Front Range Knowledge Commons (Parachute vault, `prism.omniharmonic.com`); the entity's public prose lives there.
- **Rive** — the 2D animation runtime whose state machines and data binding drive the avatar.

---

## Appendix B — Worked example: a Boulder Creek entity

Concrete instance of §4 and §6, from B1's worked example (values from the local 2026-09-06 build, when every water reading was stale — and the card says so).

**Identity and binding**

```
entity_id:        entity/boulder-creek            # platform id; siblings allowed
archetype:        creek
stream_id:        null                            # no place/boulder-creek exists yet (§9.1 #4)
membership_rule:  watershed name match + props.cdwr_stream_gnis_id == "00178354"
watersheds:       watershed/huc10-1019000504 (Headwaters), …505 (South Boulder), …506 (Coal Creek-Boulder Creek), …507 (Boulder Creek-Saint Vrain)
main_stem_gauges: place/boulder-creek-near-orodell-co, place/boulder-creek-co-below-broadway-st,
                  place/boulder-creek-at-north-75th-st-near-boulder-co, place/boulder-creek-at-mouth-near-longmont-co
snotel:           place/niwot, place/lake-eldora, place/university-camp-2
reservoirs:       place/gross-reservoir, place/union-reservoir, place/leggett-valmont-reservoir, place/six-mile-reservoir
water_quality:    place/south-boulder-cr-at-forebay-nr-eldorado-springs-co   # DO, pH, turbidity, conductance, water_temp
member_stations:  147 across 24 HUC-12s
commons:          https://prism.omniharmonic.com/p/front-range/notes/wiki%2Fplaces%2Fnamed%2Fboulder-creek
```

A fact about the creek the binding surfaces: the water-source match returns 44 CDSS structures, of which only 4 are stream gauges — the rest are ditches, reservoir inlets and outlets, and effluent returns. Boulder Creek's water is administered as much as it is measured. The entity should know this and say it.

**Fetches per pulse** (all `https://data.bioregionaltwin.org/…`, anonymous, cacheable): `id/index.json` (once); the four `latest/watershed/huc10-…json` and `geom/watershed/huc10-…geojson`; `latest/conditions.json` filtered by `huc12`; the gauge, SNOTEL, reservoir, and WQ place pages; `latest/snow.json`; `latest/{alerts,drought,fires,detections}.geojson`; `latest/health.json`; `id/place/boulder-creek-near-orodell-co.json` for `sameAs` (CDSS `BOCOROCO`, USGS `06727000`) and `commons_url`; `network/reaches.geojson` and `latest/flow_network.json` when the branch lands.

**Health card the entity could build today**

| Need | Reading | Verdict |
|---|---|---|
| Flow (canyon mouth) | `discharge` 15.4 `[ft_i]3/s` at Orodell, 2026-09-04T20:15Z, `cdss.telemetry`, **stale** (118,000 s) | "The last reading I have is from Thursday. I can't feel my gauge right now." No percentile published; record since 1906-10-01 |
| Water quality | DO, pH, conductance, turbidity, water temp at the South Boulder forebay | Prose bands only (DO < 6 mg/L stresses trout, `explanations.ts`) |
| Snowpack | Niwot SWE 0.0 in, depth 0.0 in; basin snowline null | "September; zero is normal, not broken" |
| Storage | Gross Reservoir `reservoir_fill` %, `basis: [reservoir_storage, capacity_af]` | Real baseline; drives mood today |
| Drought | D0 and D1 polygons intersect; `usdm.current` ok; period ends 2026-09-07 | Drives mood today |
| Alerts | 0; `nws.alerts` source **critical** | "I can't hear the weather service right now" |
| Fire | 0 perimeters; detections unknown — no `FIRMS_MAP_KEY` | Unknown, not zero |
| Air | `place/boulder-cu-2102-athens-st` pm25 stale | "can't feel it" |

**What the avatar does with that:** `stale=true` on flow, air, and alerts → the "can't feel my gauge" pose. Drought D1 and reservoir fill are the only live mood drivers. The face is not sad; it is a creek listening for a gauge that has gone quiet.

**What the chat says:** "I'm an AI voice for Boulder Creek, built on public sensor data. The last flow reading I have from Orodell is 15.4 cubic feet per second, from Thursday evening — the gauge feed has been quiet since. I don't have a percentile for September yet. The Drought Monitor puts my watershed in D0–D1 through the 7th. Gross Reservoir is at N% of normal storage." Every number in that reply came back from a tool call; the guard passed it.

**What it needs from the twin** (§9.1): `place/boulder-creek` with members; day-of-year percentiles per gauge; `network/reaches.geojson`; watershed rollups.

**Hermes profile:** `~/.hermes/profiles/boulder-creek/` with `config.yaml` (Qwen3.5-9B via vLLM at `127.0.0.1:8000/v1`, `context_length: 65536`, `reasoning_effort: low`, `disabled_toolsets` for everything but MCP, `write_approval` on for memory and skills), `SOUL.md` (B2 §12.2), `.env` with `TWIN_MCP_KEY` and a proposer-only `SAFE_PROPOSER_KEY`, and the `entity-steward` skill with `scripts/pulse_precheck.py` and `references/needs-model.md`.

---

## Appendix C — Verify before relying

Carried from B2 §15 and B1, plus additions from this document.

1. Hermes: exact tag of v0.21.0 (`v2026.8.31` per a third-party changelog); the `delegate` toolset name; whether the API server binds per profile in multiplexed mode without the `/p/<profile>/` prefix; whether `cron.max_parallel_jobs` applies across profiles.
2. Qwen3.5-9B context length; Qwen3.8-27B KV-cache size per token, to size 64k contexts on 24 GB.
3. Zodiac Roles Modifier v2 deployment addresses on Base; Safe Transaction Service delegate API (`addSafeDelegate`) current behaviour.
4. EAS batch timestamping of offchain UIDs (`multiTimestamp`); current Base gas per attestation.
5. Karma GAP supported chains in 2026 (Base?).
6. Rive plan prices (Free / $9 / $32 / $120 per an aggregator) and the runtime licence text.
7. Privy free-tier limits (499 MAU) — Stripe ownership may change pricing.
8. Hack Club HCB crypto acceptance and eligibility for a rights-of-nature steward group.
9. Crossmint / Dynamic pricing; Coinbase Agentic Wallets pricing.
10. Whether any live "BasinDAO" exists; Regen Foundation's Americas Ecological Institution prototype status.
11. Optimism Retro Funding 2026 mechanics (folded into Missions).
12. Cloudflare Tunnel vs Tailscale for the GPU box — both fine; check the twin's runbook constraints.
13. CORS headers on `data.bioregionaltwin.org` before any browser-side agent reads the tree (B1 §1.3).
14. The Parachute MCP endpoint for the front-range vault (`https://agent.omniharmonic.com/vault/front-range-bioregion/mcp` by pattern) and token rotation practice (B1 §4.2).
15. Current quant sizes for Qwen3-class 8–9B models and CPU tokens/s on 4 shared vCPUs — only to document why the twin's host is unsuitable (B1 §8).
16. The model id in the twin's briefing spec (`claude-opus-5`) at build time (B1 §5).
17. Hetzner CX33 price (€8.49 vs €15.49) if the platform's ops budget is compared with the twin's.
18. RTX 4090 used/new price and RTX 5090 street price at purchase time.
19. SB 243's exact reminder cadence for minors and its annual-reporting trigger; whether a Colorado-hosted service with California users is in scope (flag for counsel).
20. Colorado charitable-solicitation registration requirements for accepting donations "for a creek."
21. Stripe USDC payout availability in the platform's jurisdiction and Stripe's stablecoin-checkout fee (1.5%).
22. vLLM behaviour combining `enable_thinking`, the qwen3 reasoning parser, and tool calls (vllm#42021) on the exact model chosen.
23. Whether the Nederland guardians and the Town of Nederland would welcome an entity that names them (§11 #17) — this is a conversation, not a lookup.
