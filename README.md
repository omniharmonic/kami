# beings.earth — digital caretakers for living places

**beings.earth** is a platform where anyone can summon an AI agent that speaks *for* a creek, a watershed, a reservoir, a ridge, or a bioregion — grounded in the [Front Range Bioregional Twin](https://github.com/omniharmonic/frontrange-twin)'s live sensor readings, with an avatar whose mood follows measured conditions, a chat that can only cite what the twin measured, a small treasury controlled by human guardians, and a weekly loop in which the agent drafts bounties, people do real work, evaluators verify it, and the outcome is attested on chain.

**The pitch:** a Tamagotchi for rights of nature — except the feelings are gauge readings, the money is signed by humans, and the receipts are public.

Built by Benjamin Life ([@omniharmonic](https://github.com/omniharmonic)). Apache-2.0.

## Carry in your head

1. **A kami may only say numbers that came back from a twin tool call in the current turn.** A guard checks every reply. A fine-tune makes a small model more confident, not more correct.
2. **The agent proposes; humans sign; the twin verifies.** No value moves without two human signatures on a Safe. The agent's key can create a pending transaction and nothing else.
3. **Stale is not sad.** A gauge that stopped reporting puts the avatar in "I can't feel my gauge", never in distress. The twin's `stale` flag drives that state and overrides every other input.
4. **No token, ever.** Not for governance, not for reputation, not for cosmetics. See [`docs/no-token.md`](docs/no-token.md).
5. **The platform reads the twin like a browser does and never writes into it.** Separate repo; one published file contract plus a read-only MCP wrapper.

Kami is the platform’s original sprite mascot and guide. The landscape is an illustrated digital home, not measured terrain. Current implementation and remaining integration work: [`docs/beings-earth-audit.md`](docs/beings-earth-audit.md).

## State of the build

**Live at https://beings.earth.** Every work package in
`docs/planning/03-implementation-plan.md` is implemented and the whole suite is green.

**Start at [`docs/STATUS.md`](docs/STATUS.md)** — what exists, what is deployed, what is
proven and what is not, with the current counts. For the row-by-row audit against the PRD,
[`docs/traceability.md`](docs/traceability.md) maps each goal to the assertion that proves
it and names what is not proven.

| Suite | Result |
|---|---|
| `apps/web` (Vitest, PGlite) | 84 files, 761 tests |
| Python (`factguard`, `entity-gate`, `treasury-mcp`, `evals`) | 297 tests |
| TypeScript packages | 410 tests |
| Twin MCP contract tests (fixture tree) | 25 tests |
| End-to-end (Playwright, production build) | 41 specs |
| Production build · security gates | compiles, no warnings · six gates green |

**Production verification: see [the current handoff](docs/deploy/beings-production.md).** Sign-in, public twin MCP reads, and authenticated platform MCP connections have now been tested live. Website model chat remains unconfigured. The original baseline below describes fixture coverage, not the newer live checks.

**Original implementation baseline: no model had spoken.** Every chat path in
this repository runs against a fake gateway. The fact-sheet guard is proven against a generated
adversarial corpus of 204 turns; the ≥95 % hallucination probe in `evals/` has never met a real
model. The same is true of the chain (no Safe has been deployed), the twin (this sandbox cannot
reach `data.bioregionaltwin.org`, so every fixture is synthetic), Stripe, Privy and the Parachute
vault. Each is behind an interface with a test that asserts against a fake, and
`docs/traceability.md` §4 names every one.

Three long-lead items gate a real launch, none of them code: a legal wrapper and counsel
([`docs/legal/CHECKLIST.md`](docs/legal/CHECKLIST.md)), the commissioned Rive rigs
([`rive/BRIEF.md`](rive/BRIEF.md)), and consultation with Nederland's Boulder Creek guardians and
the relevant Tribal offices — which the platform now enforces as a publication gate, not a
reminder.

## Repository layout

```
apps/web            Next.js 16 App Router on Vercel + Neon (Drizzle) — the public platform, cron jobs, signing service, platform MCP
apps/gate           Python: entity-gate, the OpenAI-compatible proxy between Hermes and vLLM (pause · budget · fact guard)
packages/twin-mcp   TypeScript read-only MCP server over the twin's published tree (stdio + Cloudflare Worker) — the contract; liftable into frontrange-twin/mcp/
packages/twin-client  Typed GET client for the tree (ETag, 60 s floor, User-Agent)
packages/binding    Place-set binding loader/validator/proposer
packages/needs      HealthSnapshot, mood rules, bands, season, Rive inputs — pure functions
packages/factguard  Python: atom extraction, unit table, matcher, sentence splitter
packages/reputation reputation/v1 pure function + recompute CLI
packages/treasury-mcp  Python stdio MCP launched by Hermes: get_balance · list_pending · propose_bounty_payout — holds no key
infra/              vercel.json crons · box/ (GPU box compose + runbook) · chain/ (EAS, Hats, Safe, Roles scripts) · neon/
profiles/           Hermes profile templates, the entity-steward skill, deploy/pause scripts, the Boulder Creek profile
rive/               Avatar input contract, commissioning brief, SVG fallbacks
evals/              Hallucination probe, 200-turn replay, live runner, judge, fine-tune pipeline
e2e/                Playwright
docs/               Planning docs (PRD, architecture, plan), ADRs, runbooks, legal checklist, verify list
```

## Quick start

```bash
corepack enable && pnpm install
uv sync
pnpm ci                    # typecheck + vitest + pytest
pnpm --filter @kami/web dev
```

See [`docs/planning/`](docs/planning/) for the PRD, technical architecture, and implementation plan, and [`CLAUDE.md`](CLAUDE.md) for engineering conventions.

## Relationship to the twin

Every arrow from Kami to the twin is a GET. Kami never publishes into the twin's tree, never redefines its id schema, never polls `latest/` faster than once per 60 s, and always sends a `User-Agent` with a contact. The read-only MCP package in `packages/twin-mcp` is written to be lifted verbatim into `frontrange-twin/mcp/` as the published contract; until that PR lands, Kami pins the copy here.
