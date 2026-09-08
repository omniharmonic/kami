# Ecological Entities — Technical Architecture

**v0.1 draft · 2026-09-06**
**Drafted by Claude for Benjamin Life (@omniharmonic)**
**Status:** proposal — not approved
**Companion to:** `01-PRD.md` (the authority on *what*; this document decides *how*)

Sources: the PRD; the codebase survey **B1** (`feat/water-visible` HEAD `642061b`); the external research **B2** (2026-09-05); the twin's own `.claude/02-technical-architecture.md`, `docs/twin-commons-handoff.md` and `sources/ids-schema.json`. Vendor facts trace to B1/B2 or are marked *verify*. Where this document deviates from the PRD it says so in §15, not silently.

**System summary.** Ecological Entities is a separate product that reads the Front Range Bioregional Twin exactly as a browser does — static files over the CDN, and a read-only MCP wrapper that the twin repo publishes — and never writes into it. Each entity is a Hermes Agent profile on a GPU box the platform owns or rents, talking to a local open-weights Qwen model through vLLM, behind a per-entity **gate** that meters tokens, enforces pauses, and runs the fact-sheet guard on every completion. The public web app (Next.js on Vercel, Neon Postgres, magic-link auth) renders an hourly typed health snapshot into a Rive avatar and meters, streams chat from the gateway over an outbound-only tunnel, and holds all operational state. Money lives on Base: one Safe per entity signed by humans, the agent as a proposer-only delegate, USDC in and out, EAS attestations for outcomes and payouts, and a reputation function anyone can recompute from published attestation UIDs. Public prose — the entity's page, its weekly state, its quarterly memos — lives in a dedicated Parachute vault that links into the Front Range Knowledge Commons.

### Five things to carry in your head

1. **The twin is upstream and read-only.** Every arrow from the platform to the twin is a GET. There is no database link, no shared library beyond the published MCP package, no write path, ever (ADR-E01, ADR-E10).
2. **The model never runs unguarded and never runs alone.** Every completion passes through the gate: pause check, budget check, then the fact-sheet guard, which admits only atoms that appeared in a tool result after the last user message (ADR-E04, ADR-E12).
3. **Mood is code, not prose.** Needs and mood are computed by a deterministic TypeScript package from twin readings; the model reads the result and may comment on it. `stale` is a first-class state in every contract and overrides everything (ADR-E09, ADR-E11).
4. **The agent proposes; humans sign; the platform pays gas.** The proposer key never lives on the model host; the Safe threshold is 2-of-3 humans; the allowance phase adds a Zodiac Roles cap and nothing else (ADR-E05).
5. **Everything public is a static file with an `as_of`.** `status.json`, `reputation/<date>.json`, bindings, and commons notes are artifacts; chat is the only dynamic path, and when the GPU box is down the entity is asleep, not dead (ADR-E14).

---

## 1. System overview

```
                                  humans: visitors · donors · contributors · guardians · stewards · evaluators
                                                          │ https
 ┌────────────────────────────────────────────────────────▼────────────────────────────────────────────────────┐
 │  BROWSER (untrusted)                                                                                          │
 │   Next.js pages · Rive runtime (avatar) · Privy React SDK (wallet, lazy) · Stripe Checkout redirect          │
 │   reads: status.json (platform R2)  ·  geom/*.geojson (twin R2, read-only)  ·  SSE chat stream               │
 └───────┬──────────────────────────────────┬───────────────────────────────┬───────────────────────────────────┘
         │ server actions / route handlers  │ GET (read-only)               │ GET (read-only)
 ┌───────▼──────────────────────────────┐   │                       ┌───────▼───────────────────────────────────┐
 │  PLATFORM CONTROL PLANE (trusted)    │   │                       │  THE TWIN (external, read-only)           │
 │  Vercel: Next.js App Router          │   │                       │   R2 static tree  data.bioregionaltwin.org│
 │   · route handlers: chat, webhooks,  │   │                       │    id/  latest/  geom/  boundary/          │
 │     cron (hourly needs, nightly rep) │   │                       │    network/ (in progress)  briefings/     │
 │   · signing service (attester key,   │   │                       │   ▲ outbound publish only                 │
 │     relayer key, proposer keys)      │   │                       │   │ compute host (Hetzner CX33) — never   │
 │  Neon Postgres (all operational state)│  │                       │   │ contacted by the platform             │
 │  Better Auth magic links (verify)    │   │                       └───┼───────────────────────────────────────┘
 │  Platform R2 bucket: status.json,    │◄──┘                           │
 │   bindings, reputation, evidence     │                       ┌───────┴───────────────────────────────────┐
 │  Platform MCP (HTTP, per-entity token)│                      │  TWIN MCP SERVER (twin repo, read-only)   │
 └───┬───────────────┬──────────────────┘                       │   stdio package  npx @bioregionaltwin/mcp │
     │ https         │ outbound-only tunnel (Cloudflare Tunnel   │   Worker  mcp.bioregionaltwin.org (HTTP)  │
     │               │ or Tailscale; no inbound port on the box) │   contract tests in the twin's CI         │
     │               ▼                                           └───────▲─────────────────▲─────────────────┘
     │   ┌───────────────────────────────────────────────────────────────┼─────────────────┼───────────────┐
     │   │  AGENT RUNTIME HOST — GPU box (semi-trusted: untrusted text flows here)          │ GET (stdio)   │
     │   │   vLLM  :8000  Qwen3.5-9B (pulses/chat) · Qwen3.8-27B when a card allows        │               │
     │   │   entity-gate :8001  /p/<slug>/v1 → pause · budget · concurrency · FACT GUARD · usage            │
     │   │   Hermes gateway (multiplexed profiles) :8642 API · cron · MCP client                             │
     │   │     profile/<slug>/ SOUL.md config.yaml skills/entity-steward  ─── twin MCP (stdio, --binding)   │
     │   │                                                               ─── treasury MCP (stdio, no key)  │
     │   │                                                               ─── platform MCP (http)           │
     │   │   cloudflared / tailscaled (outbound)                                                             │
     │   └──────────────────────────────────┬────────────────────────────────────────────────────────────────┘
     │                                      │ https (scoped token, write)          │ https (anonymous, read)
     │                              ┌───────▼──────────────────────────────────────▼──────────────────────────┐
     │                              │  COMMONS (external)                                                     │
     │                              │   Parachute hub agent.omniharmonic.com · vault `entities` (platform)    │
     │                              │   REST + MCP · links by path into vault `front-range-bioregion`         │
     │                              │   public: prism.omniharmonic.com/p/… (CC BY-SA prose)                   │
     │                              └─────────────────────────────────────────────────────────────────────────┘
     │
 ┌───▼───────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │  MONEY LAYER (Base mainnet; Base Sepolia through phase 1)                                                  │
 │   Safe per entity (2-of-3 human owners) · Safe Transaction Service (agent = proposer delegate)             │
 │   USDC · Zodiac Roles v2 `bounty-payer` (allowance phase only) · Hats (Guardian/Evaluator/Steward)         │
 │   EAS schemas + attestations (base.easscan.org) · Privy embedded wallets (users) · Stripe (card donations) │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Trust boundaries, in order of decreasing trust: the platform control plane (Vercel + Neon + signing service) → the GPU box (it runs the model that reads chats, tool results and commons prose, all of which are untrusted text) → the browser → the chain (public, adversarial) → the twin and the commons (external; the twin is trusted for facts and never written; the commons is written with a scoped, revocable token). Read-only arrows: every arrow into the twin; browser → status.json; agent → commons `front-range-bioregion`. The twin's compute host has no arrow at all.

What runs where, in one line each: **Vercel** serves pages, streams chat, runs cron routes and holds the signing service; **Neon** holds every table in Appendix B; **the platform R2 bucket** holds `status.json`, published bindings, reputation JSON and evidence files; **the GPU box** runs vLLM, the gate, Hermes and the tunnel client; **Cloudflare Workers** host the twin MCP (twin repo) and nothing of the platform's; **Base** holds Safes, attestations, Hats and Roles.

---

## 2. Architecture Decision Records

Format follows the twin's: Context / Decision / Consequences / Alternatives rejected.

### ADR-E01 — The platform reads the twin as a browser does
**Status:** proposed
**Context.** The twin publishes files, not endpoints (twin ADR-001); its compute host has no inbound port; `sources/ids-schema.json` says "no shared database, no shared library, no runtime call in either direction." B1 §1 shows every fact an entity needs is already in `id/`, `latest/`, `geom/`, `boundary/`.
**Decision.** The platform consumes the twin only through (a) anonymous GETs of the published tree and (b) the read-only MCP package the twin repo publishes (§4). No database link, no import of `twin/`, no write into R2, no request to the compute host. Polling `latest/` never exceeds once per 60 s, sends `User-Agent: ecological-entities/<ver> (<contact>)`, and uses `If-None-Match`.
**Consequences.** (+) The twin cannot be broken by the platform. (+) The twin's failure mode (stale, not dark) is inherited for free. (+) The platform can be rebuilt from scratch against a public contract. (−) Anything the tree lacks (baselines, stream ids, rollups) must be added twin-side first — Appendix C.
**Alternatives rejected.** A read replica of the twin's Postgres (couples two hosts, violates twin §11); a platform-side copy of `twin/` (drift); a shared MCP over Tailscale to the twin's database (twin §11 line 425 — contradicts the roadmap, puts the compute host on the hot path).

### ADR-E02 — Hermes Agent as the harness, one profile per entity, gateway-multiplexed
**Status:** proposed
**Context.** The owner asked for Hermes. B2 §1.1 shows it has every primitive: profiles, `SOUL.md`, cron with `wakeAgent:false` pre-scripts, `continuity`, `context_from`, a built-in MCP client with per-server include lists, an OpenAI-compatible API server, and `gateway.multiplex_profiles`.
**Decision.** One Hermes profile per entity under `~/.hermes/profiles/<slug>/`; one gateway process multiplexing all profiles once there are more than ~10 (one systemd unit per profile before that). Version pinned (v0.21.0 / Docker tag, *verify* exact tag) and upgraded monthly behind the eval suite. Hermes has no allowlist mode, so each profile disables every toolset it does not need and include-lists MCP tools.
**Consequences.** (+) No harness to write. (+) Profiles are directories: exportable, diffable, backed up. (−) ~5,800 commits between minor versions; the upgrade gate is real work. (−) `API_SERVER_KEY` is one key for the whole gateway; per-entity authorization is done at the platform, not at Hermes (*verify* per-profile API routing in multiplexed mode).
**Alternatives rejected.** Cloudflare Agents SDK (would reimplement skills/memory/heartbeat in TS; kept as a fallback scheduler, §14); Letta (memory provider later, not the harness); Claude Agent SDK (frontier model on the hot path — PRD non-goal).

### ADR-E03 — Local open-weights model behind an OpenAI-compatible endpoint; no frontier model on the hot path
**Status:** proposed
**Context.** The owner wants a local model for ethical and safety reasons. B2 §2: Qwen3.5-9B is the current 8B-class (Apache-2.0); Qwen3.8-27B is stronger and needs 32–48 GB for 64k contexts; Hermes refuses models under a 64k context. The twin's CX33 cannot host either (B1 §8).
**Decision.** vLLM serves the model on the GPU box on `127.0.0.1:8000` with `--enable-auto-tool-choice`, the `hermes` tool parser (Qwen3/3.5) or `qwen3_coder` (3.8), `--reasoning-parser qwen3`, and `--max-model-len 65536`. Hermes never talks to vLLM directly; it talks to the gate (ADR-E04). Pulses and chat run at reasoning `low`/`medium`; weekly and quarterly jobs pin the larger model when one exists. **Model size and buy-vs-rent are the owner's decision** (PRD §11 #3); the architecture is indifferent — the model is a `base_url` and a name in `config.yaml`. A hosted frontier model may be used offline for synthetic data and eval judging only.
**Consequences.** (+) Chat transcripts never leave owned/rented hardware. (+) Swapping 9B → 27B is a config change and an eval run. (−) The honesty burden moves to the guard (ADR-E04). (−) GPU economics are the platform's largest cost line (§13).
**Alternatives rejected.** Ollama for production (single-user-ish, weaker batching); llama.cpp on a Mac Studio (no vLLM, slow prefill — acceptable fallback); any hosted API on the hot path.

### ADR-E04 — The fact-sheet guard: every number the entity utters must appear in a tool result of the same turn
**Status:** proposed
**Context.** B2 §2.6: a fine-tuned small model *will* invent readings in fluent prose. The twin's briefing spec already states the rule for its own weekly text (B1 §5). PRD G1 requires 0 unguarded facts over 200 turns.
**Decision.** The guard is an OpenAI-compatible reverse proxy, **`entity-gate`**, on the GPU box between Hermes and vLLM (`127.0.0.1:8001/p/<slug>/v1` → `127.0.0.1:8000/v1`). It sees every completion request (which carries the turn's tool results as `role: tool` messages) and every completion. Defined precisely:

*Fact sheet.* The set of **atoms** extracted from every `tool` message that follows the last `user` message in the request, plus the platform-injected entity config (caps, guardian names). Atom kinds: `number` (value, unit if present, property, place_id, time), `time` (an ISO instant), `place` (a name or id), `species` (only from commons species notes returned this turn), `count` (the length of every array in a tool result). Earlier turns' tool results are not admissible; the entity re-calls the tool (the MCP caches, so this is cheap).

*Extraction from the reply.* Numerals (including decimals, percentages, negatives), spelled-out numbers one–twenty and tens, ISO dates, month-day forms, weekday words, "N hours/days ago", proper nouns matched against a gazetteer built from `id/index.json` names, commons place-note titles and commons species titles. Numbers inside a direct echo of the last user message are tagged `echo` and allowed.

*Matching tolerance.* A reply number matches an atom if, after any unit conversion from a fixed table (`[ft_i]3/s`↔cfs, `Cel`↔°F, `[in_i]`↔mm, `[acr_us].[ft_i]`↔acre-feet, `m`↔ft), `|reply − fact| ≤ 0.5 × 10^(−d)` where `d` is the reply's displayed decimals, **and** the relative error is ≤ 2 %. Counts and integers match exactly. A time matches if it resolves to the same calendar day in `America/Denver` as an atom, or the same hour ±1 h for relative forms; weekdays resolve relative to the tool result's `as_of`. Place and species names match by id or exact title.

*On failure — chat.* The gate streams **sentence by sentence**; a sentence is released only when all its atoms match. A failing sentence is withheld, logged as a `guard_event` with the unmatched atoms, and the reply ends with a gate-authored line: "I dropped a sentence because it contained something I hadn't measured." If no sentence survives, the reply is the fallback: "I don't have a reading for that." Nothing is regenerated mid-stream.

*On failure — pulses, bounty drafts, memos, donor reports.* One regeneration with the violation list appended as a system message. If the second pass fails, the artifact is **held** (`status = 'held_by_guard'`) for steward review with the violations shown; it is never published automatically.

**Consequences.** (+) The rule is enforced where every completion passes, whatever Hermes does. (+) Guard failure rate is a first-class metric. (−) Sentence-level streaming adds ~one sentence of latency. (−) Legitimate reasoning that mentions a number not in the tools ("if flow fell to 5 cfs…") is blocked; the SOUL teaches the entity to ask a tool for scenarios it wants to name.
**Alternatives rejected.** Guard in the web app only (misses pulses and cron outputs); guard as a Hermes skill (a skill is advice to the model, not enforcement); constrained decoding (does not cover prose numbers from context).

### ADR-E05 — Agent as proposer only; Safe 2-of-3 per entity; Roles allowance only in the allowance phase, capped
**Status:** proposed
**Context.** The owner: "all transactions approved by humans but proposed by the agent." B2 §4.1: Safe + Transaction Service delegates match exactly; Zodiac Roles v2 allows scoped allowances later.
**Decision.** One Safe per entity on Base, owners = creator + two guardians, threshold 2; the platform is **not** an owner. The agent's proposer key is a Transaction-Service delegate (*verify* `addSafeDelegate` needs an owner signature). The treasury MCP the agent sees has `get_balance`, `list_pending`, `propose_bounty_payout` and no sign/execute tool; it holds no key at all — it calls the platform's signing service, which holds the proposer key. Signed transactions are executed by a platform **relayer** key that pays gas; guardians only sign EIP-712 hashes. In the allowance phase a Roles v2 role `bounty-payer` permits `USDC.transfer(to ∈ verified-contributor set, amount ≤ 25 USDC)` with 100 USDC per 24 h; nothing else changes.
**Consequences.** (+) Zero agent-signed value movement in v1 is structurally true, not a policy. (+) Box compromise yields only the ability to create pending proposals guardians can see. (−) Guardians must sign twice per payout in the worst case (approve bounty, sign tx) — §7 reduces this to one screen. (−) Delegate registration needs a guardian signature at summon and at rotation.
**Alternatives rejected.** Agent as a Safe owner with threshold (an owner can still be phished into signing); Coinbase Agentic Wallets as the treasury (policy-only, no human approval); a platform-custodied hot wallet.

### ADR-E06 — Off-chain proposals and evaluations in Postgres; on-chain outcomes and payouts as EAS attestations; reputation as a deterministic function over published UIDs
**Status:** proposed
**Context.** PRD §7.7 draws the line at outcomes. B2 §5: EAS onchain attestations cost cents on Base; offchain ones are free and can be timestamped.
**Decision.** Postgres holds proposals, bounty specs, submissions, evaluation notes, chats, pulses. EAS on Base holds `EntityRegistered` (once), `BountyCompleted` (onchain, carries `safeTxHash`), `ProposalOutcome` (offchain-signed by the evaluator's wallet, timestamped onchain nightly — *verify* `multiTimestamp`), `BountyPosted` (offchain, timestamped), `ReputationSnapshot` (weekly, onchain, Merkle root of input UIDs). Reputation is computed nightly by a versioned pure function (§8.3) over attestation UIDs and published with the UID list.
**Consequences.** (+) The track record is portable and tamper-evident; the process is fast and editable. (+) Anyone can recompute. (−) Two sources of truth for outcomes (row + attestation); the row stores the UID and the nightly reconciliation asserts they agree.
**Alternatives rejected.** Everything on chain (cost, privacy, editability); nothing on chain (the owner's stated reason for the chain is the track record); Karma GAP wholesale (phase-3 option, PRD §11 #6).

### ADR-E07 — Email-first identity with Privy embedded wallets provisioned lazily
**Status:** proposed
**Context.** "Sign up with their email." B2 §4.2: Privy is free under 499 MAU and has a Safe signer guide; Better Auth (Vercel-owned, v1.7.x) and Neon Auth do magic links.
**Decision.** Better Auth magic links (*verify* the magic-link plugin in v1.7; Neon Auth is the fallback) are the only login. A Privy embedded wallet is created the first time a user needs one — claiming a bounty, accepting guardianship, or opening `/me/wallet` — and its address is stored on `users`. Privy is never the identity provider; it is a wallet provider keyed by our user id.
**Consequences.** (+) Visitors, donors and creators never see a wallet. (+) Privy is replaceable behind one table column. (−) Two vendors for one person; the reconciliation is `users.privy_did`.
**Alternatives rejected.** Privy as the auth provider (vendor lock on identity); Base Account passkeys (not email-native); wallets for everyone at signup (needless MAU).

### ADR-E08 — The commons as the entity's long-term public memory; the platform DB as operational state
**Status:** proposed
**Context.** B1 §4.2: tags are create-only, `commons-seed` publishes, PATCH needs `if_updated_at`, the commons owns its schema, prose is CC BY-SA. PRD §11 #15 recommends a separate vault.
**Decision.** A dedicated Parachute vault **`entities`** on the same hub, with its own revocable write token, its own publication (`/p/entities`, *verify* naming), and a tag family `entity`, `entity/page`, `entity/state`, `entity/memo`, `entity/report`, `entity/bounty`. Every note carries `metadata.place_id` (the binding's anchor twin id) and wikilinks by full path into `wiki/places/watersheds/huc…` in the `front-range-bioregion` vault (cross-vault links *verify*; fall back to absolute URLs). The platform writes with the fence pattern and `if_updated_at`; humans may write below the fence. Postgres holds everything operational (Appendix B); `commons_notes` indexes what was mirrored.
**Consequences.** (+) The civic commons stays clean of agent process logs. (+) Entity prose renders on the public wiki with a map for free. (−) Two vaults to administer; the commons side must agree (handoff §7).
**Alternatives rejected.** Notes in the `front-range-bioregion` vault under an `entity-log` tag (pollutes the commons); Hermes `MEMORY.md` as the memory (2,200-char cap; not public); a vector store (no public record).

### ADR-E09 — The avatar is a state machine driven by a typed health snapshot, never by free text
**Status:** proposed
**Context.** B2 §7: Rive state machines with data binding; Finch's "never dies" rule; the twin's honesty rule.
**Decision.** A TypeScript package `@entities/needs` computes `HealthSnapshot` (§9.1) from twin readings hourly on Vercel and publishes it as `status.json`. The Rive runtime binds the snapshot's numeric and enum inputs directly. The model cannot set mood; it can only comment on the snapshot it reads back through the platform MCP.
**Consequences.** (+) G4's stale test is a unit test on a pure function. (+) One implementation of mood, shared by the page, the pulse and the tests. (−) The avatar cannot react to conversation (by design).
**Alternatives rejected.** Model-chosen mood tokens; per-archetype prompt rules; a 3D runtime (deferred, PRD §11 #11).

### ADR-E10 — Separate repo; the twin publishes the MCP package and the contract tests
**Status:** proposed
**Context.** B1 §7: nothing in `twin/` would be imported except the MCP wrapper; a monorepo means a uv workspace, a pnpm workspace, a second compose project and doubled CI. The twin's PRD line is "coupled by exactly one ID string and one JSON schema."
**Decision.** Two repos. `frontrange-twin` gains `mcp/` — one TypeScript codebase built two ways: an `npx @bioregionaltwin/mcp` stdio package and a Cloudflare Worker — plus `mcp/schemas/place-set-binding-1.0.json` and `mcp/schemas/facts-1.0.json`, and a contract test job in `.github/workflows/ci.yml`. The platform repo (`ecological-entities`) pins the package by semver and re-runs the contract tests against its pinned version in its own CI. The coupling surface is: `sources/ids-schema.json`, the two MCP schemas, the tool contract (§4), and the published tree.
**Consequences.** (+) The twin's CI stays ~5 min. (+) The twin never learns the platform exists. (−) TypeScript, not Python, for the wrapper (B1 offered either); the twin's Python briefing generator and the TS wrapper share a *schema*, not code (§15).
**Alternatives rejected.** Monorepo (B1 §7 costs); MCP in the platform repo (the contract belongs beside the publisher).

### ADR-E11 — Stale ≠ sad: staleness is a first-class state in every contract
**Status:** proposed
**Context.** At the local build every Tier-A source was `critical` and Orodell was 118,000 s stale (B1 §3.2). A river that looks sad because CDSS is down is a false signal (PRD risk 11).
**Decision.** Every reading crossing any boundary — MCP output, `HealthSnapshot`, `status.json`, commons note, chat footer — carries `stale: boolean`, `staleness_s`, `time`, `source_id`, `source_status`. A stale driving reading forces `mood = asleep` (the "can't feel my gauge" pose) and excludes the need from every aggregate. Missing is absent, never interpolated. The word "stale" is a state, not an error, in every enum in Appendix B.
**Consequences.** (+) G4 is testable. (+) The twin's outage story is inherited. (−) Day-one mood drivers are only drought, alerts, reservoir fill and flood category (PRD §6.3).
**Alternatives rejected.** Treating stale as unknown-but-usable with a caveat; carrying forward the last value.

### ADR-E12 — Kill switch and guardian pause are enforced outside the model, at the gate
**Status:** proposed
**Context.** PRD G8 and §13 #6: guardians can halt cron, chat and proposals within one gateway tick.
**Decision.** `entities.paused_at` is the switch. It is enforced in three places that do not involve the model: the web app refuses to open a chat stream (HTTP 423); the gate refuses completions for the slug (reads the pause set from Neon every 30 s and accepts a push from the platform); the platform pauses the profile's cron jobs through Hermes' `/api/jobs` (*verify* pause via REST). The treasury MCP checks the flag before proposing. **One guardian can pause; two are needed to resume** (§15 deviation). Retire = pause + guardians remove the delegate + the page archives with its full record.
**Consequences.** (+) A paused entity cannot consume a token even if Hermes misfires. (+) Pause is a button, not a runbook. (−) Three enforcement points to keep consistent; a contract test toggles the flag and asserts all three.
**Alternatives rejected.** A `SOUL.md` instruction to stop (advice, not enforcement); stopping the gateway process (halts every entity).

### ADR-E13 — Disclosure is a rendering invariant, not a prompt instruction
**Status:** proposed
**Context.** EU AI Act Art. 50 (since 2026-08-02) and SB 243 (since 2026-01-01) per B2 §9. A model can forget an instruction; a layout cannot.
**Decision.** The `EntityShell` layout renders the disclosure label under the avatar and above the chat on every entity route; the chat component injects the SB 243 reminder as a **system-rendered** message every N turns (default 12, *verify* the statutory cadence) counted by the web app, not by the model; every reply renders a "what I looked at" footer built from the turn's tool-call log returned by the gate. The SOUL also says it, as belt and braces.
**Consequences.** (+) 100 % disclosure coverage is a snapshot test. (−) Third-party clients of the platform MCP do not get the rendering; the platform MCP's chat tool therefore returns the label in its output.
**Alternatives rejected.** Prompt-only disclosure; a one-time banner.

### ADR-E14 — Dashboards are static-first; chat is the only dynamic path
**Status:** proposed
**Context.** Twin ADR-001; B2 §10 recommendation.
**Decision.** An hourly Vercel cron builds `entity/<slug>/status.json` (the `HealthSnapshot` plus pulse log, board summary, treasury summary, `as_of`) and publishes it to the platform's R2 bucket with `Cache-Control: public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400` — the twin's `latest` class verbatim. Pages render from it (ISR) and the browser polls it every 60 s. Chat streams through the gateway and is the only request that reaches the GPU box.
**Consequences.** (+) The site survives Neon, Vercel functions and the GPU box being down — it serves the last snapshot with an honest "as of". (−) Hourly, not nightly as the PRD says (§15).
**Alternatives rejected.** Server-rendered dashboards from Neon on every request; WebSockets for meters.

---

## 3. The entity binding contract

The binding is the entity's body: the set of twin ids it senses through. Its schema lives in the twin repo as `mcp/schemas/place-set-binding-1.0.json` (a twin "place set" document, deliberately ignorant of the platform); the platform stores versions in `entity_bindings` and publishes the current one at `https://<platform-data>/entity/<slug>/binding.json`.

```yaml
schema_version: "1.0"                       # place-set-binding schema, twin repo
binding_version: 3                          # integer, immutable per version
entity_id: entity/boulder-creek             # platform id; not a twin id; pattern ^entity/[a-z0-9-]+$
archetype: creek                            # creek | watershed | reservoir | mountain | bioregion
anchor: place/boulder-creek-near-orodell-co # the place whose headline need leads the page
stream_id: null                             # place/boulder-creek when the twin mints stream places (App. C #4)
commons_handle: wiki/places/named/boulder-creek      # front-range-bioregion vault path (read-only)
members:                                    # every twin id the entity may sense through
  - { id: place/boulder-creek-near-orodell-co, role: main_stem_gauge }
  - { id: place/boulder-creek-co-below-broadway-st, role: main_stem_gauge }
  - { id: place/niwot, role: snotel }
  - { id: place/gross-reservoir, role: reservoir }
  - { id: place/south-boulder-cr-at-forebay-nr-eldorado-springs-co, role: water_quality }
  - { id: place/boulder-cu-2102-athens-st, role: air }
watersheds: [watershed/huc10-1019000504, watershed/huc10-1019000505,
             watershed/huc10-1019000506, watershed/huc10-1019000507]
reach_ids: []                               # nhdplusid strings from network/reaches.geojson (when published)
boundary:                                   # URLs only; the platform stores no geometry
  geometry_urls: [https://data.bioregionaltwin.org/geom/watershed/huc10-1019000504.geojson, …]
needs:                                      # 4–6; see §9 for how they become meters
  - { need: flow,    property: discharge,        places: [place/boulder-creek-near-orodell-co], agg: single }
  - { need: storage, property: reservoir_fill,   places: [place/gross-reservoir], agg: single }
  - { need: snow,    property: swe,              places: [place/niwot], agg: single }
  - { need: water,   property: dissolved_oxygen, places: [place/south-boulder-cr-at-forebay-nr-eldorado-springs-co], agg: single }
  - { need: air,     property: pm25,             places: [place/boulder-cu-2102-athens-st], agg: mean_24h }
  - { need: drought, property: dm,               places: [],  agg: max_intersecting }   # from latest/drought.geojson
membership_rule: "watershed name contains 'Boulder Creek' + props.cdwr_stream_gnis_id == '00178354'"
frozen_at: 2026-09-06T00:00:00Z
reviewed_by: user_01J…                      # steward who froze it; name matching is the platform's guess
twin_index_etag: "\"a1b2…\""                 # id/index.json ETag at freeze
```

**Validation** (in the platform on save; in the twin MCP on load; both against the same schema):

1. Every id matches `^[a-z_]+/[a-z0-9-]+$` (`sources/ids-schema.json` line 13) and appears in `id/index.json`.
2. Every `id/<id>.json` validates against `sources/ids-schema.json` (fetched from the pinned twin package, `additionalProperties: false`).
3. Role constraints: `main_stem_gauge` requires kind `monitoring_site` with a `discharge` datastream in `latest/conditions.json`; `snotel` requires `swe`; `reservoir` requires `reservoir_storage`; `water_quality` requires at least one of the five WQ properties; `air` requires `pm25` or `ozone`. Watersheds must be kind `watershed`.
4. `sensitivity`: `public` or `generalized` only (the tree has nothing else). A `generalized` place may supply readings but never a `geometry_url` for `boundary`.
5. Consistency warnings, not errors: a member's `huc12` outside the watersheds' HUC-12 set; a need whose property has no reading today.
6. `needs[].agg ∈ {single, mean, median, min, max, mean_24h, max_intersecting}`.

**Versioning.** Versions are immutable rows; `entities.binding_version` points at the current one; the published `binding.json` carries `binding_version` and a `sha256` the `EntityRegistered` attestation's `twinEntityURI` resolves to. Changing anything creates a new version in `pending_review` until a steward approves.

**When the twin supersedes a place.** The twin keeps the retired page with `superseded_by` and drops the id from `id/index.json` (B1 §2.1; Big Thompson after 2013). A nightly `binding-check` job fetches `latest/<id>.json` for every member; on `superseded_by` it drafts a new binding version substituting the successor, marks the need `stale` with `reason: superseded` until a steward approves, and posts to the guardians' channel. An id that vanishes with no successor marks the need `missing` and pages a steward. The entity meanwhile says "one of my gauges was retired; my stewards are updating my body" — a templated line, not a model choice.

---

## 4. The twin MCP server

Lives in the twin repo at `mcp/`. One TypeScript codebase (`@modelcontextprotocol/server` 2.0; spec 2026-07-28, stateless, `ttlMs` + `cacheScope` on every list and read; legacy-stateless compatibility for 2025 clients) built as (a) `npx @bioregionaltwin/mcp` over stdio and (b) a Worker at `mcp.bioregionaltwin.org` over Streamable HTTP, deployed from the `mcp-worker` template (B2 §3.1). Both are pure functions of the published tree; neither touches the database or the compute host. Registered in the official MCP registry.

### 4.1 Rules the server enforces
- Every reading returned carries `time`, `unit` (UCUM), `source_id`, `stale`, `staleness_s`, `source_status`; absent means unknown, never zero.
- `flow_forecast` is returned with `forecast: true` and the label "forecast" in `label`.
- **No geometry ever enters a tool output.** Outputs carry `geometry_url`, `map_url`, centroids and bboxes at most.
- Every tool output ≤ 16 KB (≈ 4k tokens); lists paginate with `cursor` + `limit ≤ 50`.
- Caching: `latest/` fetched with `If-None-Match`, `ttlMs: 60000`; `id/`, `geom/`, `boundary/`, `ttlMs: 300000`; `cacheScope: "public"`. The Worker sets `cf: { cacheTtl }` accordingly; the stdio package keeps an in-memory cache.
- `User-Agent: bioregionaltwin-mcp/<ver> (contact@bioregionaltwin.org)` (*verify* the contact address).
- No auth for reads. The Worker rate-limits anonymous callers (60 requests/min per IP via a rate-limiting binding, *verify*) and accepts an optional `X-API-Key` for a higher tier; keys are issued by the twin's operator and are not a platform concern.

### 4.2 Tools

Primitives (from B1 Appendix A) and composites (from B2 §12.4), all with the same envelope `{ as_of, schema_version, tree_generated_at, ...payload }`.

| Tool | Input | Output (abridged) | Reads |
|---|---|---|---|
| `find_places` | `{query?, kind?, huc?, bbox?, cursor?, limit?}` | `{places:[{id, kind, name, huc12, bbox}], next_cursor?}` | `id/index.json` |
| `get_place` | `{id, series?: boolean}` | identity record + `readings[]` with computed `stale` + 7-day `series_summary{min,max,last,trend}` per property (+ `points_url`) + `children, parent_id, superseded_by, commons_url, sameAs, geometry_url` | `id/<id>.json`, `latest/<id>.json` |
| `get_conditions` | `{place_ids?[] \| huc? \| within?: place_id}` | `{stations:[{id, name, huc12, readings[]}], sources:{source_id:{health, staleness_s}}}` | `latest/conditions.json` (+ `geom/` for `within`) |
| `get_live` | `{layer: alerts\|drought\|fires\|detections\|quakes, within?: place_id}` | features intersecting the polygon, **properties only** plus `centroid`; zone-only alerts flagged `geometry: null, matched_by: null` | `latest/<layer>.geojson`, `geom/` |
| `get_snow` | `{}` | `{snowline_m, opacity, basis[], rule, stale}` | `latest/snow.json` |
| `get_health` | `{}` | the honesty board | `latest/health.json` |
| `get_boundary_summary` | `{version?: "v1"}` | `{id, boundary_version, area_sqkm, huc8[], method, rationale_url, geometry_url}` — prose, no ring | `boundary/v1.geojson`, `boundary/v1.md` |
| `get_briefing` | `{date?}` | fact sheet + analysis when sub-project 4 ships; `{available:false}` until then | `briefings/latest.json` |
| `explain` | `{property}` | `{label, short, long, unitHelp, bands?, license:"CC BY-SA 4.0", attribution}` | the explanations table, vendored into the package from `web/src/copy/explanations.ts` at build |
| `list_entities` | `{}` | stdio: the configured binding(s); Worker: `{entities: []}` (the twin does not host the registry) | `--binding` files |
| `resolve_entity` | `{query: string \| binding_url}` | a validated place-set binding (§3) — from the configured binding, from a twin stream/watershed id, or from a `binding_url` on an allowlisted origin | binding + `id/` |
| `get_entity_status` | `{entity?: string}` | `{needs:[{need, property, place_id, value?, unit, time, stale, staleness_s, source_status, week:{min,max,trend}, percentile_por?: null, label}], live:{drought_max_dm, alerts:[...], fires_inside, detections_24h}, sources:{...}, snapshot_hash}` — **the one call a pulse needs** | everything above for the binding's members |
| `get_reading_history` | `{place_id, property, window: 24h\|7d}` | `{summary:{min, max, last, trend, n}, points_url}` — no raw points to the model | `latest/<id>.json` |
| `get_alerts` | `{entity?: string}` | `{alerts:[{kind: nws\|drought\|fire\|air, headline, severity, until, place_ids[], url}]}` | live layers + binding |
| `compare_to_normal` | `{place_id, property, date?}` | **blocked**: returns `{available:false, reason:"twin publishes no baseline yet", record_start?}` until `latest/<id>.json.baseline` ships (App. C #5); then `{percentile_por, median_por, years_of_record, label}` | place page |

Resources (static, `ttlMs` 300000): `twin://boundary/v1`, `twin://glossary`, `twin://licence`, `twin://about`. `snapshot_hash` on `get_entity_status` is a sha256 over the members' readings with `generated_at` and `staleness_s` excluded — the pulse precheck's "changed" key.

### 4.3 Contract tests
`mcp/test/contract.test.ts` runs every tool against a checked-in fixture tree (`mcp/fixtures/public/`, a pruned snapshot regenerated by `mcp/scripts/refresh-fixtures.ts`; *verify* whether the twin's CI can build `public/` instead) and asserts: every reading has the five honesty fields; no key named `coordinates` anywhere in any output; every output ≤ 16 KB; `flow_forecast` is labelled; `get_entity_status` on the fixture binding produces exactly the expected `needs[]`; a stale fixture reading yields `stale: true`; the binding validator rejects an id absent from `id/index.json`. A nightly workflow runs the same suite against `https://data.bioregionaltwin.org`. The platform repo runs the same test file against its pinned package version.

### 4.4 Versioning and deprecation
Semver on the package; `tools/list` returns `_meta.contract_version` (`1.x`). Additive changes (new optional field, new tool) are minor. Removing or renaming a tool or field is major, preceded by ≥ 90 days with `deprecated: true` and a `replaced_by` in the tool description. The output envelope carries the tree's `schema_version` so a tree change surfaces as data, not as a crash. The platform pins `^1` and its CI fails on a contract-test regression before deploy.

---

## 5. The agent runtime

### 5.1 Profile layout (per entity)

```
~/.hermes/profiles/<slug>/
├── .env                 # HERMES-side only: PLATFORM_MCP_TOKEN (per-entity, scoped), no chain keys
├── config.yaml
├── SOUL.md              # hard rules (platform-owned block) + voice block (steward-editable)
├── binding.json         # the current published binding, pulled by the profile deploy job
└── skills/entity-steward/
    ├── SKILL.md         # when to call which tool; "no number without a tool result"; crisis protocol
    ├── scripts/pulse_precheck.py
    └── references/needs-model.md
```

`config.yaml` (abridged; differences from B2 §12.1 in bold):

```yaml
model:
  default: qwen3.5-9b
  provider: custom
  base_url: http://127.0.0.1:8001/p/<slug>/v1     # the gate, never vLLM directly
  context_length: 65536
  reasoning_effort: low
agent:
  disabled_toolsets: [terminal, browser, web, file, image, email, sms, kanban, delegate]   # verify names
memory:  { memory_enabled: true, write_approval: true }
skills:  { write_approval: true, guard_agent_created: true }
mcp_servers:
  twin:      { type: stdio, command: npx, args: [-y, "@bioregionaltwin/mcp@^1", --binding, ./binding.json],
               tools: { include: [get_entity_status, get_alerts, get_reading_history, get_place, explain, get_health, compare_to_normal] } }
  treasury:  { type: stdio, command: uv, args: [run, treasury-mcp, --entity, <slug>],
               tools: { include: [get_balance, list_pending, propose_bounty_payout] } }   # holds no key
  platform:  { type: http, url: https://<platform>/mcp, headers: { Authorization: "Bearer ${PLATFORM_MCP_TOKEN}" },
               tools: { include: [get_needs_snapshot, get_entity_config, list_open_bounties, draft_bounty, list_submissions,
                                  read_evidence_summary, post_update, get_strategy, get_attestation_summary] } }
cron: { model: qwen3.5-9b, max_parallel_jobs: 2 }
approval: { dangerous_commands: true }
```

### 5.2 Cron schedule (Hermes cron; the gateway ticks every 60 s)

| Job | Schedule | Pins | Tokens |
|---|---|---|---|
| `pulse` | hourly | `enabled_toolsets: [mcp:twin, mcp:platform]`, 9B, `low`; pre-script `pulse_precheck.py` | zero unless the snapshot changed |
| `daily-reflection` | 06:30 America/Denver | `continuity: true`; 9B, `low` | one short note: what changed in 24 h, what it is watching |
| `weekly-bounties` | Monday 09:00 | `continuity: true`, skill `entity-steward`, 27B if available, `medium` | ≤ 3 structured bounty drafts (PRD §7.6) |
| `quarterly-strategy` | `0 9 1 1,4,7,10 *` | `context_from: [weekly-bounties]`, `high`, 27B | the strategy memo, citing attestation UIDs from `get_attestation_summary` |
| `donor-report` | 1st of month 09:00 | `low` | narrative only; the numbers come from a platform script |

`hermes cron doctor` output is scraped into the platform healthcheck; `failure_streak ≥ 3` pages a steward.

### 5.3 The pulse pipeline

```
precheck (no LLM) ─► GET <platform>/api/entities/<slug>/precheck  →  {changed, snapshot_id}
   │  fallback if the platform is unreachable: hash the entity's slice of latest/conditions.json
   │  (generated_at and staleness_s excluded — latest/ bodies change every cycle, B1 §1.1)
   ├─ unchanged ─► print {"wakeAgent": false}      (zero tokens; logged as pulse.skipped)
   └─ changed   ─► wake ─► get_needs_snapshot (platform: the HealthSnapshot computed by code)
                           get_entity_status (twin: the readings behind it)
                           diff vs last pulse (platform returns `deltas[]`: band changes, alert start/end, stale flips)
                           ─► if any delta is `notable` → one utterance (≤ 80 words) → gate guard
                           ─► post_update({kind: pulse, snapshot_id, text?})  → pulses row → status.json → commons weekly roll-up
```

Mood and needs are never computed here; the snapshot arrives computed (ADR-E09). The model's only job in a pulse is the optional sentence.

### 5.4 The guard pipeline (chat and cron alike)
Request → gate: pause check (423) → daily budget check (429 with `Retry-After`) → per-entity concurrency slot (2 concurrent, queue 8, else 429) → forward to vLLM with `stream: true` → response: extract atoms from `tool` messages after the last `user` message → sentence splitter on the token stream → per-sentence match (§ADR-E04) → release or withhold → append gate line if anything was withheld → write `usage_events` and `guard_events` (batched to Neon) → return the tool-call log in a trailing SSE `event: toolcalls` for the "what I looked at" footer.

### 5.5 Chat path
Browser → `POST /e/[slug]/chat` route handler (Node runtime, streaming) → session and rate limit (anonymous allowed: 20 turns per session per hour keyed by a signed cookie; 60/day per IP) → paused check → `POST https://gw.<tunnel-host>/p/<slug>/v1/chat/completions` with `API_SERVER_KEY` (*verify* the per-profile path in multiplexed mode; fallback: one API server port per profile) → Hermes runs the profile → LLM calls via the gate → SSE relayed to the browser. Per-entity concurrency lives in the gate; the web app renders "N people ahead" from the 429 body. Reply p50 ≤ 5 s is the PRD's estimate; sentence-level release makes first-sentence latency the number that matters.

### 5.6 Memory
| Layer | Holds | Where | Retention |
|---|---|---|---|
| Commons notes | entity page, weekly state, quarterly memos, donor-report narratives, public bounty specs | `entities` vault | indefinite, CC BY-SA |
| Postgres | pulses, snapshots, proposals, bounties, submissions, evaluations, payouts, chats, guard and usage events | Neon | chats 90 d; the rest indefinite |
| Hermes `MEMORY.md` | working notes (2,200 chars), writes need steward approval | profile dir, backed up nightly | rolling |
| Session context | the conversation | Hermes sessions | per session |
An external memory provider (Letta/Honcho) is added only when an entity has months of history and a reason.

### 5.7 Multi-tenancy limits
B2 §2.2's estimate: ~20–25 GPU-minutes per entity-day on 27B, 3–4× fewer on 9B; KV cache for 64k contexts is the binding constraint. Defaults: **10 entities per 24 GB card on 9B, 20 on a 48 GB card**; a `gate.yaml` sets per-entity daily budgets (default 800k prompt / 40k output tokens — B2's estimate × 1.5) and the global concurrency (vLLM `--max-num-seqs` sized to the KV budget). Over budget → 429 → the web app says "I've talked a lot today; back tomorrow" — rendered, not generated. Cron jobs draw from a separate budget so chat cannot starve the weekly job.

**GPU box down:** the site keeps serving `status.json` with `as_of`; the chat route gets a tunnel error and renders "I'm asleep — my thinking machine is off"; the avatar shows the `asleep` pose (distinct from stale); cron does not run (Hermes is on the box); the hourly needs job on Vercel keeps `status.json` fresh from the twin alone. Nothing is queued for replay in v1 (§14.3 discusses DO alarms as the fallback).

### 5.8 Observability
The gate emits OpenTelemetry spans (entity, job kind, prompt/output tokens, latency, guard result) to a collector on the box and rows to `usage_events`/`guard_events`. vLLM's Prometheus endpoint is scraped locally. The admin dashboard shows per-entity cost (tokens × the card's hourly cost), guard failure rate (target < 2 % of sentences, 0 published), pulse skip ratio, cron `failure_streak`, tunnel health, and the twin's `get_health` verdicts. Alerts go to the stewards' channel via the platform (Telegram/email; the twin's Telegram path is not reused).

### 5.9 Kill switch
`/guardian` → "Pause <entity>" → `pause_events` row + `entities.paused_at` → (1) web app 423 on chat, proposals read-only; (2) gate refuses `/p/<slug>/…` within 30 s; (3) platform calls Hermes `/api/jobs` to pause the profile's jobs (*verify*), and the profile deploy job writes `paused: true` into the profile so a gateway restart does not resurrect it. Resume needs two guardians. Drill quarterly; the drill log is public on "how I work".

---

## 6. The web platform

Next.js 16 App Router on Vercel (Node runtime everywhere; no Edge runtime — the chat route streams from a private tunnel host and the signing service needs Node crypto). Neon Postgres via a pooled connection; Drizzle for schema and migrations (*verify* team preference; Prisma is equivalent). Better Auth with the magic-link plugin and Resend for mail (*verify*).

### 6.1 Routes

| Route | Renders | Data | Dynamic? |
|---|---|---|---|
| `/` | landing, entity list, "no token, ever" | `entities` | ISR 300 s |
| `/e/[slug]` | the homepage in PRD §6.1 order: avatar, chat, rings, strategy, board, treasury, people, siblings, how I work | `status.json` (client poll 60 s) + ISR page shell | shell ISR; chat dynamic |
| `/e/[slug]/chat` | full-screen chat with disclosure and reminders | SSE from `/e/[slug]/chat` POST handler | dynamic |
| `/e/[slug]/proposals` | board: bounties by state, human proposals with the entity's ranking and reason | `bounties`, `proposals`, `claims` | ISR 60 s + server actions |
| `/e/[slug]/proposals/[id]` | one bounty: spec, evidence spec, claims, submissions, evaluation, attestation UIDs | — | dynamic for claimants |
| `/e/[slug]/treasury` | Safe balance, pending Safe proposals, payouts with tx hash + UID, donations by month, "what I did with your money" | `safe_proposals`, `payouts`, `donations`, chain read via the signing service's RPC | ISR 60 s |
| `/e/[slug]/how-i-work` | model, guard, cadence, links to `SOUL.md`, `binding.json`, twin health, drill log, consultation record | `souls`, `entity_bindings` | ISR |
| `/summon` | five resumable steps (PRD §6.2): place → archetype/parts → soul → guardians → fund | server actions per step; `summon_drafts` | dynamic, auth |
| `/guardian` | my entities: pending Safe proposals to sign, bounty drafts to approve/edit, pause/resume, delegate rotation | — | dynamic, auth + role |
| `/me` | profile, wallet (Privy, lazy), my claims and attestations, my reputation export, data controls | — | dynamic, auth |
| `/admin` | platform operators: entities, gate budgets, guard events, tunnel health, reconciliation, commons sync | role `platform_admin` | dynamic |

### 6.2 Server actions vs route handlers
Server actions: every authenticated mutation (summon steps, claim, submit evidence metadata, approve/edit bounty, evaluate, pause/resume, donate-intent, W-9 flag). Route handlers: `POST /e/[slug]/chat` (streaming), `POST /api/webhooks/stripe`, `POST /api/webhooks/hermes` (cron deliveries, HMAC-signed), `GET /api/entities/[slug]/precheck` (pulse precheck, token-authenticated), `POST /api/cron/*` (Vercel cron: hourly needs, nightly reputation, nightly reconciliation, nightly binding-check, nightly EAS timestamp), `POST /api/evidence/upload` (presigned PUT to R2), `GET/POST /mcp` (the platform MCP, Streamable HTTP, per-entity bearer tokens).

### 6.3 Realtime
Chat: SSE relay of the gateway stream, one event per released sentence, trailing `toolcalls` and `reminder` events. Meters and avatar: `status.json` polled every 60 s with `cache: "no-cache"` (the twin's own pattern, `web/src/config.ts:84`). Guardian queues: polled every 30 s on `/guardian`.

### 6.4 Auth and roles
Better Auth sessions (cookie, 30 d). Roles are rows in `entity_roles` (`guardian`, `evaluator`, `steward`) plus `users.platform_admin`. In phase 2 each role row also carries a Hats `hat_id`; the platform checks `isWearerOfHat` on chain (cached ≤ 1 h) before accepting an evaluator's signature or a guardian's Safe signature — the DB row is the invitation, the hat is the authority.

### 6.5 Privy integration points
`@privy-io/react-auth` is loaded only on `/me/wallet`, on the claim button, and on the guardian-accept screen. The server verifies the Privy access token, stores `privy_did` and `wallet_address`, and never holds a user key. Signing surfaces: guardian EIP-712 Safe signatures; evaluator offchain EAS attestations (EIP-712); optional donor "claim this USDC donation" message.

### 6.6 Stripe donation flow
`/e/[slug]` → "Give" → server action creates a Checkout Session (`mode: payment`, one-time only — no recurring default, PRD §13 #2; metadata `entity_id`, `donor_user_id?`) → redirect → webhook `checkout.session.completed` → `donations` row (`rail: card`, gross, fee, net) → the platform's monthly USDC conversion (Stripe USDC payout to the platform treasury wallet, *verify* availability) → `treasury_transfers` row → `USDC.transfer(entity Safe, net)` by the relayer → `donations.chain_tx_hash`. The merchant of record is `config.legal_entity` — a string and a Stripe account id, nothing more (§7.8).

### 6.7 Data model
Appendix B has the DDL. Shape, in prose:

- **Identity:** `users` (email, `privy_did`, `wallet_address`, Passport score + checked_at, `platform_admin`), Better Auth's own tables, `entity_roles` (user × entity × role, `hat_id`, `accepted_at`), `guardian_invites`.
- **Entities:** `entities` (slug, name, archetype, `steward_org_id`, `binding_version`, `safe_address`, `chain_id`, `hermes_profile`, `paused_at`, `retired_at`, `rive_config jsonb`, cosmetics), `entity_bindings` (versioned JSON + sha256 + review state), `souls` (versioned; `hard_rules_version`, `voice_md`, `edited_by`), `steward_orgs`.
- **Sensing:** `need_snapshots` (hourly `HealthSnapshot` per entity, the `status.json` source), `pulses` (skipped/woke, `snapshot_id`, `deltas`, `text`, guard result), `guard_events`, `usage_events`.
- **Governance:** `strategies`, `proposals` (agent/human, rank + reason), `bounties` (the §7.6 spec as columns + `evidence_spec jsonb`, state machine), `claims`, `submissions`, `evidence_files` (R2 key, sha256, EXIF summary, licence accepted), `evaluations` (outcome, notes, offchain attestation payload + UID, `audit_of`), `audits`.
- **Money:** `safe_proposals` (safeTxHash, nonce, status, confirmations), `payouts` (submission, amount, tx hash, UID), `donations`, `treasury_transfers`, `tax_forms`, `donor_reports`, `reconciliations`.
- **Attestation and reputation:** `attestations` (local index by UID: schema, attester, refUID, onchain/offchain, timestamped_at), `reputation_runs`, `reputation_scores`.
- **Records:** `chat_sessions`, `chat_messages` (90-day TTL job), `commons_notes` (path, `updated_at` seen, hash, kind), `entity_events` (append-only audit log, hash-chained), `pause_events`, `summon_drafts`, `config`.

**Mirrored to commons notes:** `entities` + `souls.voice_md` + binding summary → `entity/page`; `pulses` (weekly roll-up) → `entity/state`; `strategies` → `entity/memo`; `donor_reports.public_md` → `entity/report`; `bounties` (spec, state, UIDs — never claimant PII) → `entity/bounty`. Nothing else leaves Postgres.

---

## 7. Money layer

Base mainnet in phase 2; Base Sepolia for phases 0–1 and staging. USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (*verify*).

### 7.1 Safe deployment
When the second guardian accepts (summon step 4, phase 2), the platform's **deployer key** deploys a Safe via Protocol Kit with a CREATE2 salt derived from `entity_id` (predictable address, shown on the page before deployment), owners = creator's wallet + guardian A + guardian B (Privy embedded wallets by default; any EVM address accepted — a hardware key is recommended for one of the three), threshold **2**. The platform is not an owner. Then a guardian signs the delegate registration for the entity's proposer address (`addSafeDelegate`, *verify* signature requirement). `EntityRegistered` is attested. Gas for deployment is paid by the deployer key (~cents on Base).

### 7.2 Proposer key custody
One proposer key per entity, generated and held by the **signing service** (a Vercel function with keys in a KMS — Privy server wallets with an authorization key, or AWS KMS; owner's choice, *verify* pricing) — never on the GPU box, never in a Hermes `.env`. The treasury MCP on the box authenticates to the platform with the entity's scoped token and asks the signing service to propose. Rotation: generate a new key, a guardian signs the new delegate, the old delegate is removed, `entities.proposer_address` updates; quarterly by policy, immediately on incident.

### 7.3 Propose → approve → execute

```
agent (Hermes)        treasury-mcp        platform signing svc      Safe Tx Service      guardian A/B (Privy)     relayer
   │ propose_bounty_payout(submission_id) │                             │                     │                    │
   │────────────────►│ POST /api/treasury/propose (entity token)         │                     │                    │
   │                 │──────────────────►│ checks: evaluation.outcome=succeeded, ProposalOutcome UID present,      │
   │                 │                   │ amount ≤ bounty.cap, recipient = claimant wallet, not paused             │
   │                 │                   │ build safeTx {to: USDC, data: transfer(recipient, amount), nonce}       │
   │                 │                   │ sign hash with proposer key ──► POST /multisig-transactions/ ─────►│    │
   │                 │◄──────────────────│ {safeTxHash}                                                        │    │
   │◄────────────────│ "proposed; waiting for guardians"                                                        │    │
   │                                     │ notify guardians (email + /guardian queue)                           │    │
   │                                     │                       guardian A opens /guardian: evidence, evaluation,│
   │                                     │                       attestation, amount → signs EIP-712 ────────►│    │
   │                                     │                       guardian B likewise ───────────────────────►│    │
   │                                     │ poll Tx Service: confirmations ≥ 2 ──────────────────────────────►│    │
   │                                     │ relayer execTransaction (pays gas) ─────────────────────────────────────►│
   │                                     │ tx mined → payouts row → attest BountyCompleted{safeTxHash} → notify recipient
```

Guardians never pay gas and never leave the platform (Safe{Wallet} remains available for the same Safe as an escape hatch). The Transaction Service is polled (it has no webhooks, *verify*); the poll is the nightly reconciliation's sibling, every 60 s while a proposal is pending.

### 7.4 Gas sponsorship
The relayer key holds a small ETH float on Base (top-up alert at 0.01 ETH). Contributors' USDC transfers out of their Privy wallets are gasless on Base per Coinbase's 2026 programme (B2 §4.3, *verify* scope). No paymaster contracts in v1.

### 7.5 Zodiac Roles v2 allowance (allowance phase)
A Roles Modifier v2 module enabled on the Safe by a 2-of-3 transaction (*verify* Base deployment addresses). Role `bounty-payer`: member = a dedicated **keeper key** in the signing service (not the proposer key); target USDC; function `transfer(address,uint256)`; conditions `to ∈ allowedRecipients`, `amount ≤ 25_000_000`; allowance 100 USDC per 24 h. `allowedRecipients` is refreshed daily by the platform from wearers of the Verified Contributor hat with a Passport score above the threshold; the agent cannot touch it. The keeper executes a payout only when an evaluator's `ProposalOutcome` UID exists and the bounty's `verification_tier ≤ 2`. Everything else stays 2-of-3.

### 7.6 Donations
Card (§6.6); direct USDC to the Safe address with QR (detected by polling the Tx Service's incoming transfers, *verify*, and Base logs as a fallback; attributed to a donor only if they sign a "this was me" message from the sending wallet; otherwise anonymous). No fiat is ever custodied by the platform; conversion is Stripe's. Tax-deductibility depends on the legal wrapper (§7.8).

### 7.7 Payouts, reporting, reconciliation
Payout = USDC to the claimant's Privy wallet; the page shows a Coinbase off-ramp link (*verify* availability); the off-ramp is theirs. `tax_forms` tracks cumulative USD value per recipient per year; at $1,500 the UI asks for a W-9/W-8 before the next payout (threshold $2,000 for tax year 2026, B2 §4.5; a fiscal sponsor that pays handles it instead). **Donor report:** on the 1st, a script assembles the month's balance, inflows, payouts (amount, recipient handle, Safe tx hash, attestation UID, evidence thumbnails), and the entity writes one guarded paragraph; sent by email to every donor of record and published as `entity/report` (without donor identities) — G6 measured by `donor_reports.sent_at` coverage. **Reconciliation** (nightly): Σ inflows − Σ payouts vs on-chain USDC balance of the Safe; every `payouts.safe_tx_hash` has a mined tx and a `BountyCompleted` UID; every `evaluations.eas_uid` resolves on EAS; every Safe proposal older than 14 days without 2 signatures is flagged; mismatches page a steward and block the donor report until resolved.

### 7.8 The legal wrapper is an owner decision — the architecture is indifferent
Every fiat touchpoint is a config value: `config.legal_entity_name`, `config.stripe_account_id`, `config.fiscal_sponsor` (null | HCB | Endaoment | …), `config.tax_collector` (platform | sponsor). Every chain touchpoint is an address. Sub-treasuries are Safes. If the wrapper is a fiscal sponsor that pays in fiat, `payouts.rail` gains a `fiat` value and the Safe path is unused for that entity — no schema change. Counsel before the first dollar (PRD §11 #2).

---

## 8. Reputation and attestations

### 8.1 Schemas (registered once on Base; strings from B2 §12.5)

```
EntityRegistered:   bytes32 entityId, string twinEntityURI, address safe, uint256 guardiansHatId
BountyPosted:       bytes32 entityId, bytes32 bountyHash, string specURI, uint8 verificationTier, uint256 capUSDC
BountyCompleted:    bytes32 entityId, bytes32 bountyHash, address recipient, uint256 amountUSDC, bytes32 safeTxHash, string evidenceURI
ProposalOutcome:    bytes32 entityId, bytes32 proposalHash, uint8 outcome, uint256 evaluatorHatId, string evidenceURI, bytes32 twinSnapshotHash
ReputationSnapshot: bytes32 entityId, bytes32 rootOfUIDs, string scoresURI, uint64 computedAt
```
`entityId = keccak256(entity slug)`; `bountyHash = sha256` of the canonical bounty spec JSON; `twinSnapshotHash` is the twin MCP's `snapshot_hash` at evaluation time; `outcome ∈ {0 succeeded, 1 partial, 2 failed, 3 unverifiable}`; `refUID` links `BountyCompleted → BountyPosted` and `ProposalOutcome → BountyPosted`.

### 8.2 On-chain vs off-chain, and who attests
| Attestation | Mode | Attester |
|---|---|---|
| `EntityRegistered` | onchain | platform attester key |
| `BountyPosted` | offchain, nightly timestamp | platform attester key |
| `ProposalOutcome` | offchain, signed by the evaluator's wallet (EIP-712 via Privy), nightly timestamp | the evaluator; the platform verifies the Evaluator hat before accepting |
| `ProposalOutcome` for tier-1 (twin-verified) | onchain | platform attester key, with `twinSnapshotHash` of the reading that proves it |
| `BountyCompleted` | onchain | platform attester key, after the Safe tx is mined |
| `ReputationSnapshot` | onchain, weekly | platform attester key |
Nightly: all offchain UIDs since the last run are Merkle-rooted and timestamped in one tx (*verify* `multiTimestamp`). The `attestations` table is the local index; EAS is the source of truth.

### 8.3 The reputation function (`reputation/v1`)
For a subject *s* (a user, or an entity for its own predictions) and an entity *e*, over all `ProposalOutcome` attestations where *s* is the claimant:

- `w_i = decay(age_i) × tier_i × stake_i`, with `decay = 0.5^(age_days/365)`, `tier ∈ {1: 1.0, 2: 1.0, 3: 0.4, 4: 0.6 until the follow-up outcome, then 1.0}`, `stake = 1 + ln(1 + usd_i / 25)`.
- `success_i ∈ {succeeded: 1, partial: 0.5, failed: 0, unverifiable: excluded}`.
- `n = Σ w_i`, `p = Σ w_i·success_i / n`; score = the Wilson lower bound at z = 1.96 on `(p, n)`, scaled 0–100; `n < 1` renders "new".
- Cross-entity score = the n-weighted mean over entities. Nothing pools across sibling entities for the *entity's* own score.
- Entity score: the fraction of tier-1 `prediction`s whose named place/property moved in the predicted direction within the window, per `get_reading_history`; published, no target in the first quarter.
- Sybil gate: a Human Passport score ≥ `config.passport_min` (default 20, *verify* the current scorer scale) is required for a score to be **published**; below it, the score is computed but shown as "unverified" and the user cannot claim bounties above `config.passport_gate_usd`.

Output: `reputation/<date>.json` `{function: "reputation/v1", computed_at, inputs: [uid…], scores: [{subject, entity, n, p, score, passport_ok}]}` on the platform R2 bucket; `rootOfUIDs = keccak256` Merkle root of the sorted input UIDs; `scoresURI` points at the file. Display on `/me` and on each entity's People section; export as JSON from `/me`. **Recompute:** `packages/reputation/recompute.ts <scoresURI>` fetches the listed UIDs from the EAS GraphQL API (*verify* endpoint for Base), re-runs the function, and prints a diff — the same script the nightly job runs.

---

## 9. Avatar layer

### 9.1 The typed health snapshot

```ts
type HealthSnapshot = {
  schema_version: "1.0"; entity_id: string; as_of: string;             // ISO
  needs: Array<{
    need: "flow"|"storage"|"snow"|"water"|"air"|"drought"|"stage"|"fire"|"alerts";
    place_id: string|null; property: string; value: number|null; unit: string|null;
    time: string|null; source_id: string|null; stale: boolean; staleness_s: number|null;
    source_status: "ok"|"warning"|"critical"|"unknown";
    percentile: number|null;              // null until the twin publishes baselines
    band: string|null;                    // from published bands only (EPA, USDM, NWPS flood, reservoir_fill)
    health: number|null;                  // 0–1, null when stale or unbanded
    trend_7d: "rising"|"falling"|"flat"|null;
    label: string;                        // guarded, templated: "15.4 cfs at Orodell, 2026-09-04 20:15Z, stale"
  }>;
  drought_class: 0|1|2|3|4|null; alert_level: 0|1|2|3; flood_category: "none"|"action"|"minor"|"moderate"|"major"|null;
  stale_driving: boolean;                 // any need with weight > 0 is stale
  mood: "asleep"|"content"|"concerned"|"distressed"|"celebrating";
  mood_reason: string;                    // templated, e.g. "drought D1 in my watershed"
  season: 0|1|2|3;                        // 0 freeze, 1 runoff, 2 monsoon, 3 fall — by date and snowline
  gpu_online: boolean; paused: boolean;
  cosmetics: Record<string, number>;      // earned by humans only
};
```

### 9.2 Rive state machine inputs (B2 §12.8)
Numbers `flow_pct, snow_pct, air_pct, temp_pct` (0–100 or −1 for absent), `alert_level` 0–3, `drought` 0–4, `mood` enum 0 asleep / 1 content / 2 concerned / 3 distressed / 4 celebrating, booleans `stale`, `paused`, `gpu_online`, `season` 0–3, `cosmetic_*`. Data-bound text: `headline_label` (the anchor need's label). The binding is one function `snapshotToRiveInputs()` with a unit test per rule below.

### 9.3 Mood mapping rules (computed in `@entities/needs`, in this order; first match wins)
1. `paused` → mood `asleep`, reason "paused by my guardians". `gpu_online = false` → `asleep`, "my thinking machine is off" (avatar still renders; chat is off).
2. `stale_driving` → `asleep` ("I can't feel my gauge"). Never distressed.
3. `alert_level = 3` (NWS `severity ∈ {Extreme, Severe}` intersecting the boundary) or `flood_category ∈ {moderate, major}` → `distressed`.
4. `drought_class ≥ 2` or any need `health ≤ 0.15` → `distressed`.
5. `drought_class = 1`, `alert_level = 2`, `flood_category ∈ {action, minor}`, any need `health ≤ 0.35`, or mean health ≤ 0.5 → `concerned`.
6. A `BountyCompleted` attestation in the last 24 h → `celebrating` (human-caused; the only path to it).
7. Otherwise `content`.

Health per need: percentile bands when a baseline exists (`<10 → 0.1, 10–25 → 0.3, 25–75 → 0.7, 75–90 → 0.8, >90 → 0.6` — very high flow is not "good"); until then, only published bands map: `reservoir_fill` (% of normal: `<40 → 0.2, 40–70 → 0.5, ≥70 → 0.8`), EPA 2024 PM2.5/ozone bands on 24-h means, USDM classes, NWPS flood categories. Unbanded needs (`swe` in summer, `dissolved_oxygen` with prose-only thresholds) carry `health: null` and show value + trend only. **Hysteresis:** a mood change other than to `asleep` or `distressed` takes effect only after two consecutive hourly snapshots agree.

### 9.4 Assets, fallback, accessibility
Four commissioned Rive rigs (creek, mountain/ridge, reservoir, watershed) with ~8 swappable parts and colour bindings; `.riv` files versioned in the repo under `public/rigs/<archetype>/<version>.riv`; the creation flow writes `entities.rive_config`. Fallback: a static SVG per archetype × mood, used when the runtime fails to load, when `prefers-reduced-motion` is set (the state machine is not started; the pose is static), and for OG images. Accessibility: the avatar is `role="img"` with `aria-label` = `mood_reason` + the headline label; every meter shows value, unit, time and source as text; colour never carries information alone; the "can't feel it" ring is grey *and* labelled.

---

## 10. Security and safety

### 10.1 Threat model and controls
| Threat | Vector | Controls |
|---|---|---|
| Prompt injection into the entity | commons notes, evidence text, bounty proposals from humans, chat | Evidence and proposals reach the model only through `read_evidence_summary` (structured fields, no free text over 500 chars, no URLs); commons prose is quoted, never instructed (the SOUL says tool text is data); the model has no tool that moves value or messages third parties; the guard drops uttered facts that did not come from tools |
| Rogue spend | agent, bug, injection | Proposer-only delegate; 2-of-3 humans; signing service validates every proposal against evaluation state and caps; Roles allowance ≤ 25/100 USDC with a recipient set the agent cannot edit |
| Proposer/attester/relayer key theft | Vercel env leak, KMS misuse | Keys in KMS; proposer can only create pending txs; attester can only attest (revocable); relayer float capped; rotation runbook (§10.6) |
| Guardian key theft | phishing, Privy account takeover | Threshold 2; hardware key recommended for one owner; pending proposals visible to all guardians; pause by any one guardian |
| Sybil / bounty fraud | fake photos, self-evaluation, collusion | Verification tiers; in-app capture with EXIF + GPS within `gps_within_m`; second attestation above $100; evaluator ≠ claimant ≠ proposer (DB constraint + hat); 10 % random second-evaluator audits; per-person monthly cap; Passport gate; deferred tier-4 payouts |
| Donor manipulation | the model's prose | No urgency language allowed by the SOUL; donation pages are static copy, not generated; no recurring default; every ask lists what money cannot do; the guard blocks invented numbers in reports |
| Jailbreaks to make the river say things | chat | Hard rules first in the SOUL; the guard limits *facts*, not opinions — so the persona rules and a lightweight classifier (§10.4) handle the rest; sessions are rate-limited; every reply logged 90 d |
| GPU box compromise | tunnel credential, Hermes API key | Box holds no chain keys; outbound-only; the platform token per entity is scoped to that entity's MCP tools; revoking the tunnel token isolates the box; the twin is read-only anyway |
| Twin outage or bad data | upstream | Stale handling everywhere; nothing interpolated; `get_health` verdicts surfaced |
| Minors | cute avatar | No under-13 accounts (age gate at signup, no DMs); SB 243 reminders; crisis protocol routes to resources; no companionship framing |

### 10.2 Secrets inventory
| Secret | Lives in | Used by | Rotation |
|---|---|---|---|
| Neon connection string | Vercel env | app, cron | on incident |
| Better Auth secret, Resend key, Stripe secret + webhook secret | Vercel env | app | annual / incident |
| Privy app secret | Vercel env | server verification | annual |
| Proposer keys (per entity), attester key, relayer key, deployer key, keeper key | KMS / Privy server wallets | signing service | proposer quarterly; others annual; all on incident |
| `PLATFORM_MCP_TOKEN` (per entity) | Hermes profile `.env` on the box | treasury-mcp, platform MCP | on profile deploy; on incident |
| Hermes `API_SERVER_KEY` | box + Vercel env | chat route | quarterly |
| Tunnel credential | box | cloudflared/tailscaled | on incident |
| Parachute `entities` vault token | Vercel env | commons sync | ≤ 1 yr TTL; `parachute auth revoke-token <jti>` |
| Twin MCP API key (optional tier) | box | twin MCP | issued by the twin operator |
| R2 keys (platform bucket) | Vercel env + box (evidence upload presign only on Vercel) | publisher, evidence | annual |
No secret is ever in a `NEXT_PUBLIC_*` variable, a commons note, a status file, or a profile directory that is backed up unencrypted.

### 10.3 Network posture and rate limits
GPU box: default-deny firewall, no inbound ports, SSH via the tunnel/Tailscale only; vLLM, gate and Hermes bind `127.0.0.1`; the tunnel exposes only the Hermes API server path to the Vercel origin (Cloudflare Access service token or Tailscale ACL — *verify* which fits the owner's existing twin tunnel). Rate limits: chat 20 turns/session/hour and 60/day/IP anonymous, 200/day authenticated; platform MCP 600 req/h per entity token; evidence uploads 50 MB per file, 30 files per submission; Stripe webhooks idempotent by event id.

### 10.4 Content policy for a local model
Phase 0–1: the SOUL's hard rules + refusal templates in persona + a regex crisis detector in the gate (self-harm terms → the reply is replaced by the crisis template with resources, logged, never generated). Phase 3: a small safety classifier (Llama-Guard-class, *verify* a current Apache-licensed option that fits beside the main model) on input and output in the gate. Blocked categories: medical, legal, financial advice; romance; claims of legal standing; speaking for Tribes or agencies.

### 10.5 Audit log
`entity_events` is append-only (no UPDATE/DELETE grants for the app role), each row carrying `prev_hash` and `hash = sha256(prev_hash || canonical row)`; a nightly job verifies the chain and publishes the head hash in `status.json`. Everything that changes an entity's soul, binding, roles, pause state, treasury or attestations writes a row.

### 10.6 Incident playbook
1. **Pause the entity** (`/guardian` or `/admin`): stops chat, cron, proposals within 30 s.
2. **Rotate the proposer key**: signing service generates a new key; a guardian signs the delegate change; old delegate removed; `entity_events` row.
3. **Freeze the Safe** if a signer is suspect: the two remaining owners execute `swapOwner` to a fresh guardian wallet; if two owners are suspect, the third executes nothing — funds are safe by threshold; escalate to counsel.
4. **Isolate the box**: revoke the tunnel credential and the entity tokens; redeploy profiles from the repo.
5. **Revoke the attester** if compromised: EAS attestations by that key after the incident time are revoked (`revocable: true` on all schemas) and the nightly reconciliation re-runs reputation without them.
6. **Publish** a note on "how I work" within 72 h.

---

## 11. Compliance hooks

- **Disclosure rendering** (ADR-E13): the `EntityShell` label "I'm an AI voice for <name>, built on public sensor data — not the creek, not a legal person"; a snapshot test asserts its presence on every `/e/*` route; the platform MCP's chat tool returns it in every output.
- **SB 243 reminders:** the chat component injects a system-rendered reminder every `config.reminder_every_turns` (default 12; *verify* the statutory cadence for minors) and a crisis template on detection; annual reporting fields (`config.sb243_report_due`) tracked in `/admin`; the posture is "companion chatbot in scope" (PRD §11 #10).
- **EU AI Act Art. 50:** the same label; generated text is marked in the HTML (`data-generated="ai"` on reply nodes) and in the commons notes' frontmatter (`generated_by: entity-agent`) — *verify* the accepted machine-readable marker.
- **Data retention:** `chat_messages` deleted after 90 days by a nightly job unless `chat_sessions.contribute_opt_in`; `usage_events` aggregated after 90 days; evidence files removable on request except where an attestation references them (the hash stays in `evidence_files.sha256`; the object is deleted). No personal data beyond email and, for payees, tax forms held by `config.tax_collector`.
- **CARE / Indigenous data:** inherited from the twin — the platform reads only gated artifacts; a binding may not include a `generalized` place's geometry; the summon flow shows the consultation record field (`entities.consultation_md`) as an optional relationship record; publication is controlled independently by `entities.published_at` (PRD §13 #4); TK-labelled commons material is never quoted by the entity (the platform MCP's commons reader skips notes with TK/BC labels in metadata).
- **Cookies/consent:** one session cookie and one anonymous chat cookie, both essential; no analytics cookies; Stripe's own cookies on its hosted page only.

---

## 12. Environments, deployment, operations

### 12.1 Environments
| | dev | staging | prod |
|---|---|---|---|
| Web | `next dev` / Vercel preview per PR | Vercel preview branch `staging` | Vercel production |
| DB | Neon branch per developer (from prod schema, no chat data) | Neon branch `staging` | Neon main |
| Twin | local `public/` fixture via `npx @bioregionaltwin/mcp --tree ./fixtures` | `https://data.bioregionaltwin.org` | same |
| GPU | any machine with Ollama or a rented pod; the gate in `--passthrough` mode for UI work | the same box, profiles suffixed `-staging`, separate gate budgets | the box |
| Chain | Base Sepolia (Safe, EAS, Hats all deployed there, *verify* Roles v2) | Base Sepolia | Base mainnet from phase 2 |
| Commons | a scratch Parachute vault | `entities-staging` vault | `entities` vault |
| Stripe | test mode | test mode | live |

### 12.2 What runs where
Vercel: the app, cron routes, the signing service, the platform MCP. Neon: Postgres. Platform R2: `status.json`, bindings, reputation JSON, evidence, rigs. Cloudflare Workers: the twin MCP (twin repo's deploy, not ours). GPU box: vLLM, gate, Hermes gateway, tunnel client, OTel collector, nightly profile backup. Base: contracts.

### 12.3 IaC and scripts
The platform repo carries `infra/`: `vercel.json` (crons), Neon migrations (Drizzle), `box/` (an Ansible playbook or a documented `docker compose` for the GPU box: vLLM container, gate container, Hermes container with `~/.hermes:/opt/data`, cloudflared), `chain/` (scripts to register EAS schemas, deploy Hats trees, deploy a Safe, enable Roles — each idempotent and recording addresses in `config`). Profiles are generated, not hand-edited: `scripts/deploy-profile.ts <slug>` renders `SOUL.md` from `souls`, `config.yaml` from the template, `binding.json` from `entity_bindings`, pushes over the tunnel to the box, and asks Hermes to reload (*verify* reload without gateway restart).

### 12.4 Backups
Neon point-in-time restore (30 d, *verify* plan) plus a nightly `pg_dump` to the platform R2 bucket (separate prefix, 90-day lifecycle). Profiles (`~/.hermes`) tarred nightly to R2, encrypted. R2 evidence versioned. Chain state needs no backup; the `attestations` index is rebuildable from EAS. Restore rehearsed before phase 2.

### 12.5 The GPU box runbook
1. **Start vLLM:** `vllm serve Qwen/Qwen3.5-9B --port 8000 --host 127.0.0.1 --max-model-len 65536 --enable-auto-tool-choice --tool-call-parser hermes --reasoning-parser qwen3 --enable-prefix-caching --max-num-seqs <from gate.yaml>` (*verify* the exact flag set for the chosen model and vllm#42021).
2. **Start the gate:** `entity-gate --config gate.yaml --upstream http://127.0.0.1:8000 --listen 127.0.0.1:8001`; it pulls the pause set and budgets from the platform and fails closed (refuses completions) if it cannot.
3. **Start Hermes:** `hermes gateway start` with `gateway.multiplex_profiles: true`, `API_SERVER_ENABLED=true`, `API_SERVER_KEY` set, port 8642 on loopback.
4. **Start the tunnel:** `cloudflared tunnel run` (or `tailscale up --advertise…`) exposing only `127.0.0.1:8642`.
5. **Smoke:** `curl` the gate with a fake tool result and a reply containing a wrong number → expect the sentence dropped; run one pulse with `hermes cron run pulse --profile <slug>`.
6. **Model update:** pull the new weights to a second directory; run the eval suite (§12.6) against a second vLLM on port 8002; swap `--model` and restart vLLM during the nightly window; keep the previous weights for rollback.
7. **Profile deploy:** `scripts/deploy-profile.ts <slug>`; `hermes cron doctor`; check the pulse skipped/woke counter within the hour.

### 12.6 CI
Platform repo: typecheck, unit tests (`@entities/needs` rules, guard matcher, reputation function, binding validator), the twin's contract tests against the pinned MCP package, guard evals (200-turn fixture replay against a recorded model — no GPU in CI; the live eval runs on the box nightly and posts a badge), Playwright e2e (disclosure snapshot on every route, chat stream renders a footer, pause halts chat, `stale=true` fixture yields the grey ring), migration dry-run against a Neon branch. Deploy to production requires the nightly live eval to be green.

### 12.7 Rollback
Vercel: instant rollback to the previous deployment. Neon: migrations are expand/contract; a rollback is the previous deploy plus, if needed, a branch restore. Box: previous container tags and weights kept; `docker compose up` the old tag. Profiles: regenerated from the DB at any commit. Chain: nothing is rolled back — schemas are additive, attestations are revocable.

---

## 13. Cost model

Monthly, USD; prices from B2 §2.3, §4.2, §4.4, §7.1, §10 unless marked; all *verify* before committing. €1 ≈ $1.09 assumed.

| Line | Phase 1 (1 entity, no money) | Phase 2 (1–3 entities, money) | Phase 3 (10–20 entities, 27B, fine-tune) |
|---|---|---|---|
| GPU — rent Hetzner GEX44 (20 GB, €184) | $200 | $200 | — |
| GPU — rent Hetzner GEX131 (96 GB, €889) | — | — | $970 |
| GPU — *or* own a used RTX 4090 (~$2.2k over 24 mo + ~$30 power) | ($120) | ($120) | ($120, 9B only) |
| Fine-tuning days (Vast 5090 $0.53/h × ~48 h/run, 1 run/quarter) | — | — | $9 |
| Vercel Pro (1 seat) | $20 | $20 | $20 + usage |
| Neon (Launch tier, *verify* $19) | $0–19 | $19 | $19–69 |
| Platform R2 | <$1 | <$1 | ~$2 |
| Cloudflare (tunnel free; Workers for the twin MCP are the twin's line, ~$0–5) | $0 | $0 | $0 |
| Privy (free < 499 MAU; Core $299 above) | $0 | $0 | $0–299 |
| Stripe (2.9 % + 30¢ per card gift; 1.5 % stablecoin) | — | % of donations | % of donations |
| Base gas (Safe deploy, ~10 payouts, ~30 attestations, nightly timestamps) | $0 (Sepolia) | ~$5 | ~$20 |
| Relayer ETH float (one-time top-ups) | — | ~$20 | ~$50 |
| Rive (Cadet $9 / Voyager $32, *verify*) | $9 | $9 | $32 |
| Resend (free tier, then $20, *verify*) | $0 | $0–20 | $20 |
| Domain, misc | $2 | $2 | $2 |
| Commissioned rigs (one-time, owner's estimate; not in B2) | one-time | one-time | one-time |
| Legal wrapper / counsel (one-time; fiscal sponsor 1.5–7 % of donations) | — | one-time + % | % |
| **Total (renting)** | **≈ $235–250** | **≈ $280–300 + %** | **≈ $1,150–1,500 + %** |
| **Total (owned 4090, 9B only)** | ≈ $155 | ≈ $200 + % | not enough VRAM for 27B |

**Per-entity marginal cost:** GPU minutes (~20–25/day on 27B ≈ 1/20 of a card ≈ $10–50 depending on rent), gas ~$1–2, Neon/R2 negligible, commons free, one profile's RAM (1–2 GB) → **$5–50 per entity per month**, dominated by the card. The twin's own cost stays ≈ $10.65 (twin §9); the MCP Worker adds at most the Workers Paid plan.

---

## 14. The three things that could break the model

### 14.1 A 9B model cannot be made reliably honest, even guarded
The guard stops invented *facts*; it cannot stop invented *reasoning* ("the trout are stressed"), tool-call failures, or a persona that drifts. If the hallucination probe stays under 95 % on 9B after the SOUL and skill are tuned: (a) move chat to Qwen3.8-27B at `low` — the cost line in §13 phase 3; (b) add **template mode**: the entity speaks only in guarded templates filled from `HealthSnapshot` and tool results (every sentence a tested string), with free prose limited to the weekly memo held for steward review; (c) narrow tools further so there is less to misuse. What is *not* a fallback: a hosted frontier model on the hot path (PRD non-goal). Template mode is built in phase 0 regardless, because it is also the GPU-down and the paused voice.

### 14.2 Safe + Roles UX is too heavy for guardians
If median approval latency exceeds 72 h or guardians drop out: (a) reduce signing to one screen and one tap per payout (already the design), with email links that deep-link into `/guardian`; (b) allow the fiscal sponsor's operations key as one of the three owners for entities that opt in, so a professional signs second; (c) fall back to **fiat rails**: guardians approve in the app, the sponsor pays by bank, and attestations still record the outcome — `payouts.rail = 'fiat'` exists for this; (d) the allowance phase moves tier-2 payouts under $25 off the multisig entirely. The track record (EAS) survives every fallback; only the money rail changes.

### 14.3 GPU economics or availability
A rented 96 GB card at ~$970/month is the largest line and the least predictable (B2: RTX 5090 up 13.7 % in two weeks). Fallbacks: (a) 9B on a $200/month 20 GB rental or an owned 4090 carries pulses and chat for ~10 entities; (b) **scale-to-zero** windows — cron jobs cluster into a nightly window and the card is rented by the hour for weekly/quarterly jobs (RunPod 4090 $0.34/h); (c) if the box is often off, move the pulse schedule to Cloudflare Durable Object alarms (B2 §1.2) that queue pulses and replay them when the box returns — the site never depends on the box (ADR-E14); (d) a Mac Studio for quiet, slow, owned inference via llama.cpp. The architecture treats the model as a URL; none of these changes a contract.

**A fourth, named because the PRD does:** the twin never ships baselines (PRD risk 14). Then `compare_to_normal` stays blocked, mood stays drought-and-alerts-only, and the entity keeps saying "I don't have a percentile yet." The platform never computes its own baseline from 7-day series; it waits.

---

## 15. ADR deviations / PRD feedback

| # | Where | Deviation or feedback |
|---|---|---|
| 1 | PRD §4.7, §8.3 | Mood and needs are computed by platform code (`@entities/needs`), not by the pulse; the pulse reads the snapshot and may utter one sentence. The PRD's "update needs and mood" should read "read needs and mood". |
| 2 | PRD §6.1 | `status.json` is hourly, not nightly — the needs job is cheap and the avatar should follow the twin's cadence within the hour. |
| 3 | PRD §13 #6, G8 | One guardian can pause (the safe direction); two are needed to resume or retire. Stricter than "any two can pause". |
| 4 | PRD App. B, B2 §12.1 | The Hermes profile holds **no** `SAFE_PROPOSER_KEY`; the treasury MCP is keyless and the proposer key lives in the platform's signing service (ADR-E05). |
| 5 | PRD §9.1 #7, §8.3 | "One generator and one guard" becomes one **schema** (`facts-1.0.json`) with two emitters (the twin's Python briefing generator; the TS MCP) and one matcher (`factguard`, Python, platform repo, offered upstream). The MCP is TypeScript so one codebase serves stdio and the Worker. |
| 6 | PRD §11 #12 | The binding **schema** lives in the twin repo (`mcp/schemas/place-set-binding-1.0.json`) as a neutral "place set" document; the platform mints entity ids and holds bindings. The twin does not host an entity registry; `list_entities` on the Worker returns empty. |
| 7 | PRD §3, §7.5, §10, §11 #4 | The Zodiac Roles allowance is called "phase 2" in §3/§7.5 and "phase 3" in §10/§11. This document says "the allowance phase" = phasing-table phase 3. Please unify. |
| 8 | PRD §9.3 | Tool names: B1's primitives are kept and B2's composites added (`get_entity_status`, `get_alerts`, `get_reading_history`, `get_boundary_summary`, `explain`); `get_place_reading` → `get_reading_history`; `explain_metric` → `explain`. `compare_to_normal` ships blocked. |
| 9 | PRD §8.3 | Chat guard failure is sentence-drop with a gate-authored line, not regeneration; regeneration is for non-streamed outputs only. |
| 10 | PRD §4.6 | A separate `entities` vault is decided, not recommended; cross-vault wikilinks need *verify* — absolute URLs are the fallback. |
| 11 | PRD §7.5 | Gas: guardians never pay; a platform relayer executes signed Safe transactions. Not in the PRD; no conflict. |
| 12 | PRD §5 J1 | The Safe is deployed on the second guardian's acceptance in phase 2, not at summon in phase 1 (phase 1 has guardians as roles only, per §10). J1's text should say so. |
| 13 | PRD §6.6 | The SB 243 reminder counter is owned by the web app; the model never counts turns. |
| 14 | PRD §14 | Add "guard sentence-drop rate" and "pulse skip ratio" to the metrics table; both are cheap and diagnostic. |

---

## Appendix A — Sequence diagrams

### A.1 Summon (phase 3 self-serve; phases 0–2 run the same steps by hand)
```
creator ─► /summon step 1: search id/index.json (find_places) ─► platform proposes a binding ─► validator (§3) ─► steward review queue
        ─► step 2: archetype + parts ─► entities.rive_config
        ─► step 3: hard rules shown locked; voice block written ─► souls v1 ─► preview chat via a staging profile (guarded)
        ─► step 4: two guardian emails ─► guardian_invites ─► magic links ─► accept → entity_roles(guardian) [+ Privy wallet lazily]
              phase 2+: on 2nd acceptance → deployer deploys Safe(owners=3 humans, threshold 2) → guardian signs addSafeDelegate(proposer)
                        → EntityRegistered attested → entities.safe_address
        ─► step 5 (optional): donate
        ─► deploy-profile.ts <slug> → box → hermes cron add pulse/daily/weekly/quarterly/donor-report → first pulse
        ─► commons: entity/page note created in `entities` vault (tags at create; place_id = anchor)
        ─► status.json published → /e/<slug> live after an explicit steward publication action; consultation is optional
```

### A.2 Pulse
```
hermes cron (hourly) ─► pulse_precheck.py ─► GET /api/entities/<slug>/precheck ─► {changed:false} ─► {"wakeAgent":false}  (no tokens)
                                                                          └─► {changed:true, snapshot_id}
   ─► hermes wakes profile ─► get_needs_snapshot(platform) ─► get_entity_status(twin, stdio) ─► platform returns deltas[]
   ─► if notable: LLM (via gate) writes ≤80 words ─► guard: atoms from the two tool results ─► release / hold
   ─► post_update({kind:"pulse", snapshot_id, text}) ─► pulses row ─► next status.json build ─► weekly roll-up to entity/state note
```

### A.3 Chat turn with the guard
```
browser ─► POST /e/<slug>/chat {session, text}
  web app: auth/rate limit ─► paused? 423 ─► reminder due? emit `reminder` event ─► POST gateway /p/<slug>/v1/chat/completions (stream)
  hermes: SOUL + skill + history ─► tool calls: get_entity_status, get_alerts … ─► LLM request → gate
  gate: pause/budget/slot ─► forward to vLLM ─► atoms ← tool messages after last user message
        stream tokens ─► sentence 1 "Flow at Orodell is 15.4 cfs, the last reading I have, from Thursday." atoms {15.4 cfs↔discharge@orodell ✓, Thursday↔2026-09-04 ✓, Orodell ✓} → release
        sentence 2 "That's about 30% below normal for September." atoms {30%: no match} → withhold, guard_event
        end ─► gate line "I dropped a sentence because it contained something I hadn't measured." ─► `toolcalls` event
  web app ─► SSE to browser ─► footer "what I looked at": place ids, times, sources, stale flags
```

### A.4 Weekly bounty lifecycle
```
Mon 09:00 weekly-bounties (continuity) ─► get_strategy, get_needs_snapshot, get_attestation_summary ─► draft_bounty ×≤3 (structured, §7.6)
  ─► guard (regenerate once; else held_by_guard) ─► bounties.status = drafted ─► guardians notified
  guardian edits fields (not entity_id/twin_refs) ─► approve (1 guardian in phase 2; config) within 72 h ─► status = open ─► BountyPosted (offchain)
  contributor claims (Passport ≥ gate if cap > X) ─► claims row ─► in-app capture ─► submissions + evidence_files (EXIF/GPS checked vs evidence_spec)
  evaluator (hat ≠ claimant ≠ proposer) ─► evaluations.outcome ─► signs ProposalOutcome (offchain, EIP-712) ─► 10% audits sampled
  outcome = succeeded ─► agent propose_bounty_payout ─► §7.3 ─► BountyCompleted (onchain) ─► reputation recomputed nightly
  tier 4 ─► deposit now, balance at follow-up evaluation (6–12 months) ─► second ProposalOutcome with refUID
```

### A.5 Donation to report
```
donor ─► Give $20 ─► Stripe Checkout ─► webhook ─► donations(rail=card, gross 20.00, fee 0.88, net 19.12)
  monthly ─► Stripe USDC payout to platform treasury wallet (verify) ─► treasury_transfers ─► relayer USDC.transfer(Safe, Σ net) ─► donations.chain_tx_hash
  … payouts happen (A.4) …
  1st of month ─► donor-report script: balance, inflows, payouts{amount, handle, safeTxHash, UID, thumbnails}
              ─► entity writes one paragraph (via gate; numbers must match the script's tool result)
              ─► email to donors of record ─► donor_reports.sent_at ─► public entity/report note (no donor identities)
  nightly reconciliation must be clean or the report is blocked and a steward is paged
```

---

## Appendix B — Postgres DDL sketch

```sql
-- enums
create type archetype as enum ('creek','watershed','reservoir','mountain','bioregion');
create type entity_role as enum ('guardian','evaluator','steward');
create type mood as enum ('asleep','content','concerned','distressed','celebrating');
create type source_status as enum ('ok','warning','critical','unknown');
create type need_state as enum ('live','stale','missing','superseded','unbanded');
create type proposal_author as enum ('agent','human');
create type bounty_status as enum ('drafted','held_by_guard','open','claimed','in_review','paid','deferred','expired','withdrawn');
create type outcome as enum ('succeeded','partial','failed','unverifiable');
create type payout_rail as enum ('usdc_safe','usdc_roles','fiat');
create type donation_rail as enum ('card','usdc_direct','stablecoin_checkout');
create type attestation_mode as enum ('onchain','offchain');
create type review_state as enum ('pending_review','approved','rejected');

-- identity
create table users (
  id text primary key, email citext unique not null, name text,
  privy_did text unique, wallet_address text unique,
  passport_score numeric, passport_checked_at timestamptz,
  platform_admin boolean not null default false, age_gate_ok boolean not null default false,
  created_at timestamptz not null default now());
-- Better Auth owns: session, account, verification (magic links)

create table steward_orgs (id text primary key, name text not null, legal_note text, created_at timestamptz default now());

create table entities (
  id text primary key check (id ~ '^entity/[a-z0-9-]+$'),
  slug text unique not null, name text not null, archetype archetype not null,
  steward_org_id text references steward_orgs(id),
  binding_version int, soul_version int,
  safe_address text, chain_id int, proposer_address text, guardians_hat_id numeric,
  hermes_profile text unique, rive_config jsonb not null default '{}', cosmetics jsonb not null default '{}',
  consultation_md text, consultation_done_at timestamptz, published_at timestamptz,
  paused_at timestamptz, retired_at timestamptz,
  eas_uid_registered text, created_by text references users(id), created_at timestamptz default now());
create index on entities (archetype) where retired_at is null;

create table entity_bindings (
  entity_id text references entities(id), binding_version int, binding jsonb not null,
  sha256 text not null, review review_state not null default 'pending_review',
  reviewed_by text references users(id), reviewed_at timestamptz, created_at timestamptz default now(),
  primary key (entity_id, binding_version));

create table souls (
  entity_id text references entities(id), soul_version int, hard_rules_version text not null,
  voice_md text not null, edited_by text references users(id), created_at timestamptz default now(),
  primary key (entity_id, soul_version));

create table entity_roles (
  entity_id text references entities(id), user_id text references users(id), role entity_role,
  hat_id numeric, invited_at timestamptz default now(), accepted_at timestamptz, revoked_at timestamptz,
  primary key (entity_id, user_id, role));

create table guardian_invites (id text primary key, entity_id text references entities(id), email citext, token_hash text,
  expires_at timestamptz, accepted_user_id text references users(id));

-- sensing
create table need_snapshots (
  id bigserial primary key, entity_id text references entities(id), as_of timestamptz not null,
  snapshot jsonb not null, snapshot_hash text not null, mood mood not null, stale_driving boolean not null,
  unique (entity_id, as_of));
create index on need_snapshots (entity_id, as_of desc);

create table pulses (
  id bigserial primary key, entity_id text references entities(id), at timestamptz not null default now(),
  woke boolean not null, snapshot_id bigint references need_snapshots(id), deltas jsonb, text text,
  guard_result text check (guard_result in ('pass','dropped','held')), tokens_prompt int, tokens_output int);
create index on pulses (entity_id, at desc);

create table guard_events (
  id bigserial primary key, entity_id text references entities(id), at timestamptz default now(),
  context text not null, -- chat|pulse|weekly|quarterly|report
  sentence text not null, unmatched jsonb not null, action text not null); -- dropped|regenerated|held
create index on guard_events (entity_id, at desc);

create table usage_events (
  id bigserial primary key, entity_id text references entities(id), at timestamptz default now(),
  job text not null, tokens_prompt int not null, tokens_output int not null, latency_ms int, model text);
create index on usage_events (entity_id, at desc);

-- governance
create table strategies (id text primary key, entity_id text references entities(id), quarter text not null,
  memo_md text not null, guard_result text, comment_open_until timestamptz, ratified_by text references users(id),
  ratified_at timestamptz, commons_path text, created_at timestamptz default now(), unique (entity_id, quarter));

create table proposals (id text primary key, entity_id text references entities(id), author_kind proposal_author not null,
  author_id text, title text not null, body_md text not null, status text not null default 'open',
  rank int, rank_reason_md text, strategy_id text references strategies(id), created_at timestamptz default now());

create table bounties (
  id text primary key, entity_id text references entities(id), proposal_id text references proposals(id),
  strategy_id text references strategies(id), title text not null, why_md text not null, deliverable_md text not null,
  verification_tier smallint not null check (verification_tier between 1 and 4),
  evidence_spec jsonb not null, cap_usdc numeric(12,2) not null, claim_limit int not null default 1,
  deadline date, evaluator_hat_id numeric, twin_refs text[] not null, prediction jsonb,
  status bounty_status not null default 'drafted', spec_sha256 text not null,
  approved_by text references users(id), approved_at timestamptz, eas_uid_posted text, commons_path text,
  created_at timestamptz default now());
create index on bounties (entity_id, status);

create table claims (id text primary key, bounty_id text references bounties(id), user_id text references users(id),
  claimed_at timestamptz default now(), released_at timestamptz, unique (bounty_id, user_id));

create table submissions (id text primary key, claim_id text references claims(id), submitted_at timestamptz default now(),
  note_md text, evidence_summary jsonb not null); -- the only form the model ever sees

create table evidence_files (id text primary key, submission_id text references submissions(id), r2_key text not null,
  sha256 text not null, mime text, bytes int, exif jsonb, gps_lon numeric, gps_lat numeric, captured_at timestamptz,
  in_app_capture boolean not null, licence_accepted_at timestamptz not null, deleted_at timestamptz);

create table evaluations (
  id text primary key, submission_id text references submissions(id), evaluator_id text references users(id),
  outcome outcome not null, notes_md text, twin_snapshot_hash text, second_attestation_by text references users(id),
  offchain_attestation jsonb, eas_uid text, attested_at timestamptz, audit_of text references evaluations(id),
  created_at timestamptz default now());
-- rule enforced in the app and by a trigger: evaluator_id <> claimant and <> proposer of the bounty

-- money
create table safe_proposals (safe_tx_hash text primary key, entity_id text references entities(id),
  submission_id text references submissions(id), nonce int, to_address text, amount_usdc numeric(12,2),
  proposed_at timestamptz default now(), confirmations int not null default 0, executed_tx_hash text,
  status text not null default 'pending'); -- pending|executed|rejected|expired

create table payouts (id text primary key, submission_id text references submissions(id), rail payout_rail not null,
  amount_usdc numeric(12,2) not null, usd_value_at_payment numeric(12,2), safe_tx_hash text, tx_hash text,
  executed_at timestamptz, eas_uid_completed text, recipient_address text, recipient_user_id text references users(id));

create table donations (id text primary key, entity_id text references entities(id), donor_user_id text references users(id),
  rail donation_rail not null, gross numeric(12,2), fee numeric(12,2), net numeric(12,2), currency text,
  stripe_session_id text unique, chain_tx_hash text, received_at timestamptz default now(), reported_in text);

create table treasury_transfers (id text primary key, entity_id text references entities(id), amount_usdc numeric(12,2),
  tx_hash text, kind text not null, at timestamptz default now()); -- conversion_in|safe_out_retire|…

create table tax_forms (user_id text references users(id), tax_year int, cumulative_usd numeric(12,2) not null default 0,
  form_kind text, collected_by text, collected_at timestamptz, primary key (user_id, tax_year));

create table donor_reports (id text primary key, entity_id text references entities(id), month date not null,
  data jsonb not null, narrative_md text, guard_result text, public_md text, commons_path text,
  sent_at timestamptz, donors_notified int, donors_total int, unique (entity_id, month));

create table reconciliations (id bigserial primary key, entity_id text references entities(id), at timestamptz default now(),
  ok boolean not null, findings jsonb not null);

-- attestations and reputation
create table attestations (uid text primary key, schema text not null, mode attestation_mode not null,
  attester text not null, entity_id text references entities(id), ref_uid text, payload jsonb not null,
  created_at timestamptz default now(), timestamped_tx text, timestamped_at timestamptz, revoked_at timestamptz);
create index on attestations (entity_id, schema);

create table reputation_runs (id text primary key, function_version text not null, computed_at timestamptz not null,
  uids text[] not null, root_of_uids text not null, scores_uri text not null, eas_uid_snapshot text);
create table reputation_scores (run_id text references reputation_runs(id), subject text not null, entity_id text,
  n numeric, p numeric, score numeric, passport_ok boolean, primary key (run_id, subject, entity_id));

-- records
create table chat_sessions (id text primary key, entity_id text references entities(id), user_id text references users(id),
  anon_key text, started_at timestamptz default now(), contribute_opt_in boolean not null default false, turns int default 0);
create table chat_messages (id bigserial primary key, session_id text references chat_sessions(id), at timestamptz default now(),
  role text not null, content text not null, toolcalls jsonb, guard_dropped int default 0, reminder boolean default false);
create index on chat_messages (at); -- 90-day deletion job

create table commons_notes (path text primary key, vault text not null, entity_id text references entities(id), kind text not null,
  updated_at_seen timestamptz, content_sha256 text, last_synced_at timestamptz);

create table entity_events (id bigserial primary key, entity_id text references entities(id), at timestamptz default now(),
  actor text, kind text not null, payload jsonb not null, prev_hash text, hash text not null);
-- app role: INSERT and SELECT only

create table pause_events (id bigserial primary key, entity_id text references entities(id), at timestamptz default now(),
  by_user text references users(id), action text not null); -- pause|resume_request|resume|retire

create table summon_drafts (id text primary key, user_id text references users(id), step int, data jsonb, updated_at timestamptz);
create table config (key text primary key, value jsonb not null, updated_at timestamptz default now());
```

---

## Appendix C — The twin-side change list (references B1)

| # | Change | Where (B1) | Needed by |
|---|---|---|---|
| 1 | Document the tree as the API on `/about` | roadmap §6, `…alive-twin-design.md:182` | phase 0 |
| 2 | `mcp/` package: TS, stdio + Worker, the tools in §4.2, `schemas/place-set-binding-1.0.json`, `schemas/facts-1.0.json`, fixtures, contract tests in `.github/workflows/ci.yml`; vendor `web/src/copy/explanations.ts` into the package at build with CC BY-SA attribution | B1 §6 option (a)+(b), Appendix A | phase 0 |
| 3 | Finish `network/reaches.geojson` + `latest/flow_network.json` | `twin/publisher/network.py` (worktree), `sql/011_reach.sql` | phase 1 (reach ids in bindings) |
| 4 | Stream places `place/<stream>` with a `gnis` assertion, `children[]` = main-stem gauges, `props.reach_ids[]`; enum change touches `sql/002_core.sql:3-8` and `sources/ids-schema.json:17-21` (the Prism contract — coordinate) | `twin/ingest/stations.py:29-36`, `twin/commons/paths.py:15` | phase 1 |
| 5 | Baselines: static-tier ingest of USGS daily / CDSS / AWDB history → `latest/<id>.json.baseline {doy_percentiles, record_start, record_end}`; needs a CDSS key (`docs/env.md:107`); unblocks `compare_to_normal` and mood-by-flow | B1 §3.3, `twin/adapters/awdb.py:153-156` | phase 1 |
| 6 | Watershed rollups on `latest/watershed/*.json` | B1 §3.4 | phase 2 |
| 7 | `twin/briefing.py: facts_for(place_ids, tree)` emitting `facts-1.0.json`; the twin's weekly briefing guard may adopt `factguard` | B1 §5 | phase 2 |
| 8 | A UGC→county lookup published once (`id/ugc.json`) so zone-only alerts can be matched | `types.ts:246-248` | phase 1 |
| 9 | Confirm CORS on `data.bioregionaltwin.org` (the browser fetches `geom/` directly) | B1 §1.3 | phase 1 |
| 10 | Agree with the commons side on the `entities` vault, its publication, and cross-vault linking; mint a separate revocable token | `handoff.md:146-147`, B1 §4.2 | phase 1 |

Nothing in this list writes platform data into the twin; every item is something the twin would plausibly want anyway (B1 §3.5).

---

## Appendix D — Verify list

Carried from PRD Appendix C (items 1–23 there) plus what this document added.

1. Hermes: per-profile API routing in multiplexed mode (`/p/<profile>/v1/…`), cron pause via `/api/jobs`, profile reload without gateway restart, exact toolset names for `disabled_toolsets` (incl. `delegate`), v0.21.0 Docker tag.
2. Whether Hermes' API server response exposes the tool-call log (used for the "what I looked at" footer); fallback: the gate's own log keyed by request id.
3. vLLM flag set and vllm#42021 behaviour for Qwen3.5-9B and Qwen3.8-27B with thinking + tools; KV budget for 64k contexts on 20/24/48 GB.
4. MCP TS SDK 2.0 `createMcpHandler` stateless mode and the `mcp-worker` template; Workers rate-limiting binding availability; registry submission process.
5. Whether the twin's CI can build `public/` for contract tests, or fixtures are required.
6. Safe Transaction Service: `addSafeDelegate` signature requirements; incoming-transfer endpoint; absence of webhooks; Protocol Kit CREATE2 deployment on Base; Base Sepolia availability of Safe, EAS, Hats, Roles v2.
7. Zodiac Roles Modifier v2 Base addresses and allowance semantics.
8. EAS `multiTimestamp` and the GraphQL endpoint for Base; gas per attestation today.
9. Hats Protocol `isWearerOfHat` on Base; Human Passport v2 score scale and a sensible `passport_min`.
10. Privy: free-tier limits, server-wallet pricing for KMS use, EIP-712 signing from embedded wallets; alternatively AWS KMS cost.
11. Better Auth v1.7 magic-link plugin; Neon Auth as the fallback; Neon Launch tier price and PITR window.
12. Stripe: USDC payout availability in the wrapper's jurisdiction; stablecoin checkout fee; Checkout metadata limits.
13. Coinbase off-ramp link availability for Privy wallets; gasless USDC scope on Base.
14. Rive plan tiers and runtime licence; data-binding API version for numeric/enum inputs.
15. Resend free tier; Cloudflare Access service tokens vs Tailscale ACLs for the tunnel (match the twin's existing setup).
16. Parachute: cross-vault wikilinks, a second publication for the `entities` vault, MCP endpoint URL pattern, token TTL/rotation.
17. EU AI Act Art. 50 machine-readable marking expectations; SB 243 reminder cadence for minors and annual-report trigger; Colorado charitable-solicitation registration.
18. USDC contract address on Base; a current Apache-licensed safety classifier that fits beside a 9B model.
19. Hetzner GEX44/GEX131 prices and availability; RTX 4090 used price at purchase time.
20. Whether the Nederland guardians and the relevant Tribal offices welcome the first entity (a conversation, not a lookup).
