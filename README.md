# Kami — AI voices for places

**Kami** (神, the Shinto word for the spirits that inhabit rivers, mountains, and living places) is a platform where anyone can summon an AI agent that speaks *for* a creek, a watershed, a reservoir, a ridge, or a bioregion — grounded in the [Front Range Bioregional Twin](https://github.com/omniharmonic/frontrange-twin)'s live sensor readings, with an avatar whose mood follows measured conditions, a chat that can only cite what the twin measured, a small treasury controlled by human guardians, and a weekly loop in which the agent drafts bounties, people do real work, evaluators verify it, and the outcome is attested on chain.

**The pitch:** a Tamagotchi for rights of nature — except the feelings are gauge readings, the money is signed by humans, and the receipts are public.

Built by Benjamin Life ([@omniharmonic](https://github.com/omniharmonic)). Apache-2.0.

## Carry in your head

1. **A kami may only say numbers that came back from a twin tool call in the current turn.** A guard checks every reply. A fine-tune makes a small model more confident, not more correct.
2. **The agent proposes; humans sign; the twin verifies.** No value moves without two human signatures on a Safe. The agent's key can create a pending transaction and nothing else.
3. **Stale is not sad.** A gauge that stopped reporting puts the avatar in "I can't feel my gauge", never in distress. The twin's `stale` flag drives that state and overrides every other input.
4. **No token, ever.** Not for governance, not for reputation, not for cosmetics. See [`docs/no-token.md`](docs/no-token.md).
5. **The platform reads the twin like a browser does and never writes into it.** Separate repo; one published file contract plus a read-only MCP wrapper.

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
