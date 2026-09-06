# Architecture Decision Records

Mirrored from `docs/planning/02-technical-architecture.md` §2 so each decision has a stable file. Status of every ADR: **accepted for build** (2026-09-06) — the planning docs said *proposed*; the owner's instruction to implement the full PRD accepts them. Deviations discovered during the build are appended to the relevant file under "Build notes".

| ADR | Title |
|---|---|
| [ADR-E01](ADR-E01.md) | The platform reads the twin as a browser does |
| [ADR-E02](ADR-E02.md) | Hermes Agent as the harness, one profile per entity, gateway-multiplexed |
| [ADR-E03](ADR-E03.md) | Local open-weights model behind an OpenAI-compatible endpoint; no frontier model on the hot path |
| [ADR-E04](ADR-E04.md) | The fact-sheet guard: every number the entity utters must appear in a tool result of the same turn |
| [ADR-E05](ADR-E05.md) | Agent as proposer only; Safe 2-of-3 per entity; Roles allowance only in the allowance phase, capped |
| [ADR-E06](ADR-E06.md) | Off-chain proposals and evaluations in Postgres; on-chain outcomes and payouts as EAS attestations; reputation as a deterministic function over published UIDs |
| [ADR-E07](ADR-E07.md) | Email-first identity with Privy embedded wallets provisioned lazily |
| [ADR-E08](ADR-E08.md) | The commons as the entity's long-term public memory; the platform DB as operational state |
| [ADR-E09](ADR-E09.md) | The avatar is a state machine driven by a typed health snapshot, never by free text |
| [ADR-E10](ADR-E10.md) | Separate repo; the twin publishes the MCP package and the contract tests |
| [ADR-E11](ADR-E11.md) | Stale ≠ sad: staleness is a first-class state in every contract |
| [ADR-E12](ADR-E12.md) | Kill switch and guardian pause are enforced outside the model, at the gate |
| [ADR-E13](ADR-E13.md) | Disclosure is a rendering invariant, not a prompt instruction |
| [ADR-E14](ADR-E14.md) | Dashboards are static-first; chat is the only dynamic path |

## Added during the build

| ADR | Title |
|---|---|
| [ADR-E15](ADR-E15.md) | The twin MCP package is developed in the Kami repo and lifted upstream unchanged |

