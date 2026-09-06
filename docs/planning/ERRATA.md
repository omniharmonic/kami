# Errata found during the build

Corrections to the planning documents discovered while implementing them. The planning docs are left as written; code follows this file.

| # | Where | Correction | Found by |
|---|---|---|---|
| 1 | `02` Appendix A.3, `03` T0.4 row 5, PRD App. B chat example | `2026-09-04T20:15Z` is a **Friday** (14:15 MDT), not a Thursday. Weekday words resolve in America/Denver against the fact sheet's `as_of`; the guard drops "from Thursday" for that reading and accepts "from Friday". `render_time` says "Friday afternoon (2026-09-04 20:15Z)". | WP4 (factguard) |
| 2 | `03` T2.13 golden example | A $40 tier-2 claim gives `n = 1 + ln(1 + 40/25) ≈ 1.9555`, not 2.33; `reputation/v1` follows §8.3's formula exactly. | WP12 (reputation) |
| 3 | `02` §5.1 `config.yaml` | The twin MCP stdio command needs `--tree <base_url>`; the template uses `npx -y @bioregionaltwin/mcp --tree {{twin_base_url}} --binding ./binding.json`. | WP5 (profiles) |
| 4 | `02` §9.1 | `HealthSnapshot` carries no per-need weight, so `computeMood` takes weights from the binding's `NeedSpec`s; hysteresis recomputes the previous candidate from the previous snapshot's own fields rather than storing a non-schema field. | WP3 (needs) |
| 5 | `02` ADR-E04 atom kinds, `03` T0.4 | A licence identifier ("CC BY-SA 4.0", "Apache-2.0", "CC0 1.0") is a proper noun naming a legal document, not a measurement. The guard claims those spans before reading numbers, so the attribution PRD §13 #9 requires survives instead of being struck for want of a "4.0" atom. | WP13 (found) / WP4 (fixed) |
