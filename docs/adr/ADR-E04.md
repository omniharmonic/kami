# ADR-E04 — The fact-sheet guard: every number the entity utters must appear in a tool result of the same turn

**Status:** accepted for build (2026-09-06)
**Context.** B2 §2.6: a fine-tuned small model *will* invent readings in fluent prose. The twin's briefing spec already states the rule for its own weekly text (B1 §5). PRD G1 requires 0 unguarded facts over 200 turns.
**Decision.** The guard is an OpenAI-compatible reverse proxy, **`entity-gate`**, on the GPU box between Hermes and vLLM (`127.0.0.1:8001/p/<slug>/v1` → `127.0.0.1:8000/v1`). It sees every completion request (which carries the turn's tool results as `role: tool` messages) and every completion. Defined precisely:

*Fact sheet.* The set of **atoms** extracted from every `tool` message that follows the last `user` message in the request, plus the platform-injected entity config (caps, guardian names). Atom kinds: `number` (value, unit if present, property, place_id, time), `time` (an ISO instant), `place` (a name or id), `species` (only from commons species notes returned this turn), `count` (the length of every array in a tool result). Earlier turns' tool results are not admissible; the entity re-calls the tool (the MCP caches, so this is cheap).

*Extraction from the reply.* Numerals (including decimals, percentages, negatives), spelled-out numbers one–twenty and tens, ISO dates, month-day forms, weekday words, "N hours/days ago", proper nouns matched against a gazetteer built from `id/index.json` names, commons place-note titles and commons species titles. Numbers inside a direct echo of the last user message are tagged `echo` and allowed.

*Matching tolerance.* A reply number matches an atom if, after any unit conversion from a fixed table (`[ft_i]3/s`↔cfs, `Cel`↔°F, `[in_i]`↔mm, `[acr_us].[ft_i]`↔acre-feet, `m`↔ft), `|reply − fact| ≤ 0.5 × 10^(−d)` where `d` is the reply's displayed decimals, **and** the relative error is ≤ 2 %. Counts and integers match exactly. A time matches if it resolves to the same calendar day in `America/Denver` as an atom, or the same hour ±1 h for relative forms; weekdays resolve relative to the tool result's `as_of`. Place and species names match by id or exact title.

*On failure — chat.* The gate streams **sentence by sentence**; a sentence is released only when all its atoms match. A failing sentence is withheld, logged as a `guard_event` with the unmatched atoms, and the reply ends with a gate-authored line: "I dropped a sentence because it contained something I hadn't measured." If no sentence survives, the reply is the fallback: "I don't have a reading for that." Nothing is regenerated mid-stream.

*On failure — pulses, bounty drafts, memos, donor reports.* One regeneration with the violation list appended as a system message. If the second pass fails, the artifact is **held** (`status = 'held_by_guard'`) for steward review with the violations shown; it is never published automatically.

**Consequences.** (+) The rule is enforced where every completion passes, whatever Hermes does. (+) Guard failure rate is a first-class metric. (−) Sentence-level streaming adds ~one sentence of latency. (−) Legitimate reasoning that mentions a number not in the tools ("if flow fell to 5 cfs…") is blocked; the SOUL teaches the entity to ask a tool for scenarios it wants to name.
**Alternatives rejected.** Guard in the web app only (misses pulses and cron outputs); guard as a Hermes skill (a skill is advice to the model, not enforcement); constrained decoding (does not cover prose numbers from context).

## Build notes

_None yet._
