# ADR-E11 — Stale ≠ sad: staleness is a first-class state in every contract

**Status:** accepted for build (2026-09-06)
**Context.** At the local build every Tier-A source was `critical` and Orodell was 118,000 s stale (B1 §3.2). A river that looks sad because CDSS is down is a false signal (PRD risk 11).
**Decision.** Every reading crossing any boundary — MCP output, `HealthSnapshot`, `status.json`, commons note, chat footer — carries `stale: boolean`, `staleness_s`, `time`, `source_id`, `source_status`. A stale driving reading forces `mood = asleep` (the "can't feel my gauge" pose) and excludes the need from every aggregate. Missing is absent, never interpolated. The word "stale" is a state, not an error, in every enum in Appendix B.
**Consequences.** (+) G4 is testable. (+) The twin's outage story is inherited. (−) Day-one mood drivers are only drought, alerts, reservoir fill and flood category (PRD §6.3).
**Alternatives rejected.** Treating stale as unknown-but-usable with a caveat; carrying forward the last value.

## Build notes

_None yet._
