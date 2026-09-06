# ADR-E02 — Hermes Agent as the harness, one profile per entity, gateway-multiplexed

**Status:** accepted for build (2026-09-06)
**Context.** The owner asked for Hermes. B2 §1.1 shows it has every primitive: profiles, `SOUL.md`, cron with `wakeAgent:false` pre-scripts, `continuity`, `context_from`, a built-in MCP client with per-server include lists, an OpenAI-compatible API server, and `gateway.multiplex_profiles`.
**Decision.** One Hermes profile per entity under `~/.hermes/profiles/<slug>/`; one gateway process multiplexing all profiles once there are more than ~10 (one systemd unit per profile before that). Version pinned (v0.21.0 / Docker tag, *verify* exact tag) and upgraded monthly behind the eval suite. Hermes has no allowlist mode, so each profile disables every toolset it does not need and include-lists MCP tools.
**Consequences.** (+) No harness to write. (+) Profiles are directories: exportable, diffable, backed up. (−) ~5,800 commits between minor versions; the upgrade gate is real work. (−) `API_SERVER_KEY` is one key for the whole gateway; per-entity authorization is done at the platform, not at Hermes (*verify* per-profile API routing in multiplexed mode).
**Alternatives rejected.** Cloudflare Agents SDK (would reimplement skills/memory/heartbeat in TS; kept as a fallback scheduler, §14); Letta (memory provider later, not the harness); Claude Agent SDK (frontier model on the hot path — PRD non-goal).

## Build notes

_None yet._
