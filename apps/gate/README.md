# entity-gate (`apps/gate`)

OpenAI-compatible streaming reverse proxy that sits between Hermes and vLLM on the GPU box
(`127.0.0.1:8001/p/<slug>/v1` → `127.0.0.1:8000/v1`). Every completion passes through it:
pause check (423) → daily budget (429 + `Retry-After`) → per-entity concurrency slot
(2 in flight, queue 8, else 429 `{"people_ahead": n}`) → forward to vLLM with `stream: true`
→ fact-sheet guard sentence by sentence (`kami-factguard`, ADR-E04) → gate line → trailing
`event: toolcalls` → `data: [DONE]`. A regex crisis detector answers self-harm phrases with a
fixed template and never calls the model (§10.4).

## Runbook (architecture §12.5 step 2)

```
entity-gate --config gate.yaml --upstream http://127.0.0.1:8000 --listen 127.0.0.1:8001
```

The gate pulls the pause set and budgets from the platform and, with `platform.fail_closed: true`,
**fails closed** (refuses completions) if it cannot. Start order on the box: vLLM (step 1) →
the gate (step 2) → `hermes gateway start` (step 3) → the tunnel (step 4).

`python -m entity_gate --config gate.yaml ...` is equivalent. `--passthrough` skips the guard for
UI development; it never skips pause.

## Smoke (§12.5 step 5)

A fake tool result and a reply with a wrong number → the wrong sentence is dropped and the gate
line is present:

```
curl -N http://127.0.0.1:8001/p/boulder-creek/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "Qwen/Qwen3.5-9B", "stream": true,
    "messages": [
      {"role": "user", "content": "how is the creek?"},
      {"role": "assistant", "content": null, "tool_calls": [{"id": "c1", "type": "function",
        "function": {"name": "get_entity_status", "arguments": "{}"}}]},
      {"role": "tool", "tool_call_id": "c1", "content": "{\"as_of\":\"2026-09-06T05:00:00Z\",\"needs\":[{\"property\":\"discharge\",\"place_id\":\"place/boulder-creek-near-orodell-co\",\"value\":15.4,\"unit\":\"[ft_i]3/s\",\"time\":\"2026-09-04T20:15:00Z\",\"stale\":false,\"staleness_s\":900,\"source_status\":\"ok\",\"source_id\":\"cdss/BOCOROCO\"}]}"}
    ]}'
```

Expect: every sentence whose numbers match `15.4 cfs` streams; a sentence such as "That's about
30% below normal" is missing; the stream ends with
`I dropped a sentence because it contained something I hadn't measured.`, an
`event: toolcalls` frame, and `data: [DONE]`.

## Admin (loopback + `X-Gate-Admin: $GATE_ADMIN_SECRET`)

```
curl -X POST 127.0.0.1:8001/admin/pause/boulder-creek -H "X-Gate-Admin: $GATE_ADMIN_SECRET"
curl -X POST 127.0.0.1:8001/admin/resume/boulder-creek -H "X-Gate-Admin: $GATE_ADMIN_SECRET" \
  -H 'content-type: application/json' -d '{"guardians": ["Ana", "Ben"]}'
curl 127.0.0.1:8001/admin/state -H "X-Gate-Admin: $GATE_ADMIN_SECRET"
```

One guardian can pause; **two distinct names are required to resume** (ADR-E12), and both are
logged to `guard_events.jsonl`.

## Headers

* `X-Kami-Job: cron` — draws from the cron budget bucket.
* `X-Guard: ok | held | stream | passthrough` — on the non-stream path `held` means both passes
  failed the guard; the body carries `kami_guard: {"status": "held", "violations": [...]}` and the
  fallback text, so the caller stores `held_by_guard`.

## Events

Phase 0 sinks are append-only JSONL files in `events_dir`: `usage_events.jsonl` and
`guard_events.jsonl` (`action` ∈ `drop | crisis | paused | budget | queue_full | pause | resume`).
`telemetry.py` logs JSON spans to stdout and can be swapped for an OpenTelemetry exporter.

## Tests

```
uv run --package kami-gate pytest apps/gate
```

Tests run against an in-process fake upstream (`tests/fake_upstream.py`); nothing reaches a GPU or
the live twin.
