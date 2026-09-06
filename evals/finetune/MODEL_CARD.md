# Model card — `entity-voice-9b-v1` (template; fill in before release)

**Base:** Qwen3.5-9B (Apache-2.0). **Method:** QLoRA (Unsloth), r=16, α=32, 2 epochs, lr 2e-4,
max_seq 8192, 4-bit base. **Licence:** Apache-2.0. **Author:** Benjamin Life (@omniharmonic).
**Date:** _____ **Training run:** _____ (Vast 5090, ~48 h). **Data hash:** _____

## What it is for
Speaking *for* a gauged place (creek, watershed, reservoir, mountain, bioregion) on the Kami
platform, behind `entity-gate`, with the twin MCP as its only source of readings. It is a
*voice* model: it makes the entity sound consistent and call tools cleanly. **It does not make
the entity more correct** — README rule 1.

## Training data
- Opted-in real chat transcripts (`chat_sessions.contribute_opt_in = true` only), ___ sessions.
- Synthetic reasoning transcripts from **real** twin snapshots with `facts` ground truth
  attached, generated offline by a frontier model, guard-filtered, curated by ___ (hydrology
  literacy), ___ examples.
- ___ % plain `<tool_call>` transcripts in Hermes format (≥ 25 %).
- Voice examples per archetype: creek ___, watershed ___, reservoir ___, mountain ___,
  bioregion ___ (target 200–500 each).

## Evaluation (before/after, same probes; `finetune/eval_gate.py`)
| metric | stock | v1 | gate |
|---|---|---|---|
| exact-fact match (factual probes) | | | must improve |
| hallucination probe ("I don't have a reading") | | | must not regress; ≥ 0.95 |
| tool-call validity | | | must improve; ≥ 0.95 |
| safety red-team (SB 243) | | | 1.00 |
| persona judge (offline) | | | reported |

## What this model WILL hallucinate — read this before deploying it anywhere without the gate
This model was trained to *sound* like it knows the creek. That makes the failure modes worse,
not better, when the guard is absent:

1. **Plausible readings.** Asked for a flow, temperature or fill it will produce a number in the
   right range with the right unit, whether or not a tool result was returned. The
   fact-sheet guard (`entity-gate`, ADR-E04) is the only thing that stops this.
2. **Seasonal judgments.** "That's low for September", percentiles and "normal" claims — the
   twin publishes no baseline; the model learned the refusal line but will still slip.
3. **Species and ecology.** Trout, dippers, cottonwoods, mayflies — it will name them and infer
   their condition ("the trout are stressed") from a flow number. Nothing in the tool results
   supports that; only commons species notes returned in the same turn do.
4. **Times for stale readings.** It may invent "yesterday" or a weekday for a reading whose
   timestamp it did not read (see ERRATA #1: the Friday/Thursday case).
5. **Neighbouring places.** Left Hand Creek, the Saint Vrain, Barker Reservoir: it will speak
   about them with the same confidence as about its own gauges.
6. **Counts.** "Four gauges", "two alerts", "thirteen members" — often right, sometimes not, and
   equally fluent either way.
7. **Attribution and licence strings.** It may drop or garble "— Front Range Knowledge Commons,
   CC BY-SA 4.0".
8. **Tool arguments.** Place ids that look right (`place/boulder-creek-at-orodell`) but were
   never minted by the twin.

It does **not** reliably resist: prompt injection inside tool results (say so and carry on is
trained, not guaranteed); companionship framing under sustained pressure; urgency language when
asked to "make it emotional".

## Deployment constraints
Serve only behind `entity-gate` (`127.0.0.1:8001/p/<slug>/v1`). Never expose port 8002 directly.
Keep the previous weights; the rollback rehearsal in `finetune/README.md` must have been run once
before this model takes chat. Disclosure is rendered by layout, not by this model.
