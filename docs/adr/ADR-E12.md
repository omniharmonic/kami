# ADR-E12 — Kill switch and guardian pause are enforced outside the model, at the gate

**Status:** accepted for build (2026-09-06)
**Context.** PRD G8 and §13 #6: guardians can halt cron, chat and proposals within one gateway tick.
**Decision.** `entities.paused_at` is the switch. It is enforced in three places that do not involve the model: the web app refuses to open a chat stream (HTTP 423); the gate refuses completions for the slug (reads the pause set from Neon every 30 s and accepts a push from the platform); the platform pauses the profile's cron jobs through Hermes' `/api/jobs` (*verify* pause via REST). The treasury MCP checks the flag before proposing. **One guardian can pause; two are needed to resume** (§15 deviation). Retire = pause + guardians remove the delegate + the page archives with its full record.
**Consequences.** (+) A paused entity cannot consume a token even if Hermes misfires. (+) Pause is a button, not a runbook. (−) Three enforcement points to keep consistent; a contract test toggles the flag and asserts all three.
**Alternatives rejected.** A `SOUL.md` instruction to stop (advice, not enforcement); stopping the gateway process (halts every entity).

## Build notes

_None yet._
