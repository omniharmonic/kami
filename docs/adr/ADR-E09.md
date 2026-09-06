# ADR-E09 — The avatar is a state machine driven by a typed health snapshot, never by free text

**Status:** accepted for build (2026-09-06)
**Context.** B2 §7: Rive state machines with data binding; Finch's "never dies" rule; the twin's honesty rule.
**Decision.** A TypeScript package `@entities/needs` computes `HealthSnapshot` (§9.1) from twin readings hourly on Vercel and publishes it as `status.json`. The Rive runtime binds the snapshot's numeric and enum inputs directly. The model cannot set mood; it can only comment on the snapshot it reads back through the platform MCP.
**Consequences.** (+) G4's stale test is a unit test on a pure function. (+) One implementation of mood, shared by the page, the pulse and the tests. (−) The avatar cannot react to conversation (by design).
**Alternatives rejected.** Model-chosen mood tokens; per-archetype prompt rules; a 3D runtime (deferred, PRD §11 #11).

## Build notes

_None yet._
