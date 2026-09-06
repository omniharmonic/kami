# ADR-E08 — The commons as the entity's long-term public memory; the platform DB as operational state

**Status:** accepted for build (2026-09-06)
**Context.** B1 §4.2: tags are create-only, `commons-seed` publishes, PATCH needs `if_updated_at`, the commons owns its schema, prose is CC BY-SA. PRD §11 #15 recommends a separate vault.
**Decision.** A dedicated Parachute vault **`entities`** on the same hub, with its own revocable write token, its own publication (`/p/entities`, *verify* naming), and a tag family `entity`, `entity/page`, `entity/state`, `entity/memo`, `entity/report`, `entity/bounty`. Every note carries `metadata.place_id` (the binding's anchor twin id) and wikilinks by full path into `wiki/places/watersheds/huc…` in the `front-range-bioregion` vault (cross-vault links *verify*; fall back to absolute URLs). The platform writes with the fence pattern and `if_updated_at`; humans may write below the fence. Postgres holds everything operational (Appendix B); `commons_notes` indexes what was mirrored.
**Consequences.** (+) The civic commons stays clean of agent process logs. (+) Entity prose renders on the public wiki with a map for free. (−) Two vaults to administer; the commons side must agree (handoff §7).
**Alternatives rejected.** Notes in the `front-range-bioregion` vault under an `entity-log` tag (pollutes the commons); Hermes `MEMORY.md` as the memory (2,200-char cap; not public); a vector store (no public record).

## Build notes

_None yet._
