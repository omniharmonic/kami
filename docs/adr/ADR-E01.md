# ADR-E01 — The platform reads the twin as a browser does

**Status:** accepted for build (2026-09-06)
**Context.** The twin publishes files, not endpoints (twin ADR-001); its compute host has no inbound port; `sources/ids-schema.json` says "no shared database, no shared library, no runtime call in either direction." B1 §1 shows every fact an entity needs is already in `id/`, `latest/`, `geom/`, `boundary/`.
**Decision.** The platform consumes the twin only through (a) anonymous GETs of the published tree and (b) the read-only MCP package the twin repo publishes (§4). No database link, no import of `twin/`, no write into R2, no request to the compute host. Polling `latest/` never exceeds once per 60 s, sends `User-Agent: ecological-entities/<ver> (<contact>)`, and uses `If-None-Match`.
**Consequences.** (+) The twin cannot be broken by the platform. (+) The twin's failure mode (stale, not dark) is inherited for free. (+) The platform can be rebuilt from scratch against a public contract. (−) Anything the tree lacks (baselines, stream ids, rollups) must be added twin-side first — Appendix C.
**Alternatives rejected.** A read replica of the twin's Postgres (couples two hosts, violates twin §11); a platform-side copy of `twin/` (drift); a shared MCP over Tailscale to the twin's database (twin §11 line 425 — contradicts the roadmap, puts the compute host on the hot path).

## Build notes

_None yet._
