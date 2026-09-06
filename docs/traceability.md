# PRD traceability

Every goal, journey, experience rule, mechanism and phase criterion in the PRD maps to code and a test. Filled in as work packages land; the final integration pass (WP16) checks every row.

| PRD | Requirement | Code | Test | Status |
|---|---|---|---|---|
| G1 | Numbers only from same-turn tool results; 0 unguarded facts / 200 turns; ≥95 % probe | `packages/factguard`, `apps/gate`, `evals/` | factguard 17 rows; `evals/run_replay.py` | building |
| G2 | One bounty completed → verified → paid (2 human sigs) → attested | `apps/web` governance + `lib/signing`, `infra/chain` | Sepolia e2e (needs keys); unit mocks | planned |
| G3 | Stranger summons in < 20 min with email only | `apps/web/app/summon` | timed Playwright | planned |
| G4 | Mood tracks percentile, never staleness; stale → "can't feel it" 100 % | `packages/needs` | G4 property test (1,000 cases) | building |
| G5 | Zero on-chain value movement without ≥2 human signatures; agent is proposer only | `lib/signing/validate.ts`, `packages/treasury-mcp` | tool-list-is-three test; relayer refuses < 2 confirmations | planned |
| G6 | Donor report within 31 days, 100 % coverage | `api/cron/donor-report` | coverage test | planned |
| G7 | Disclosure everywhere; SB 243 cadence; "how I work" page | `EntityShell`, `Chat`, `how-i-work` | Playwright disclosure snapshot on every `/e/*` route | planned |
| G8 | Open source; ≥2 non-founder guardians; pause within 60 s | `pause` action, gate PauseSet, `deploy-profile` | three-point pause contract test | planned |
| §4.2 | Binding rules; ids minted only by the twin | `packages/binding` | validator tests | planned |
| §4.5 | Hard rules first, voice second; voice edit needs Steward | `profiles/templates/SOUL.hard-rules.md`, `souls` table | golden render | planned |
| §4.7 | pulse / weekly / quarterly / donor-report cadence; `wakeAgent:false` | `profiles/templates/skills/entity-steward` | precheck tests | planned |
| §6.1 | Homepage order | `app/e/[slug]/page.tsx` | Playwright order test | planned |
| §6.3 | Mood rules; never dies; cosmetics earned by humans | `packages/needs` | mood tests | building |
| §6.5 | Twin down → stale, not dark | `status.json` publisher, `Chat` fallback copy | e2e with fixture | planned |
| §6.6 | Disclosure label, reminder every 12 turns, crisis protocol | `Chat`, `apps/gate/crisis.py` | e2e + gate test | building |
| §7.2 | Verification tiers | `bounties.verification_tier`, evidence spec check | evidence tests | planned |
| §7.3 | Reputation deterministic over UIDs, recomputable | `packages/reputation` | recompute round-trip | building |
| §7.5 | Safe 2-of-3, proposer delegate, no sign tool | `infra/chain/deploy-safe.ts`, `packages/treasury-mcp` | tests | planned |
| §7.6 | Structured bounty spec; tier-1 needs prediction | `bounties` schema + `draft_bounty` | tests | planned |
| §9.2 | Never writes into the twin; 60 s floor; User-Agent | `packages/twin-client` | tests | planned |
| §13 | Ethics: consultation gate, retention, licences | `entities.consultation_done_at`, retention cron | tests | planned |
