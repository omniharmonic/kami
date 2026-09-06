# ADR-E14 — Dashboards are static-first; chat is the only dynamic path

**Status:** accepted for build (2026-09-06)
**Context.** Twin ADR-001; B2 §10 recommendation.
**Decision.** An hourly Vercel cron builds `entity/<slug>/status.json` (the `HealthSnapshot` plus pulse log, board summary, treasury summary, `as_of`) and publishes it to the platform's R2 bucket with `Cache-Control: public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400` — the twin's `latest` class verbatim. Pages render from it (ISR) and the browser polls it every 60 s. Chat streams through the gateway and is the only request that reaches the GPU box.
**Consequences.** (+) The site survives Neon, Vercel functions and the GPU box being down — it serves the last snapshot with an honest "as of". (−) Hourly, not nightly as the PRD says (§15).
**Alternatives rejected.** Server-rendered dashboards from Neon on every request; WebSockets for meters.

---

## Build notes

_None yet._
