# entity-gate (`apps/gate`)

OpenAI-compatible streaming reverse proxy that sits between Hermes and vLLM on the GPU box
(`127.0.0.1:8001/p/<slug>/v1` → `127.0.0.1:8000/v1`). Every completion passes through it:
pause check (423) → daily budget (429 + `Retry-After`) → per-entity concurrency slot
(2 in flight, queue 8, else 429 `{"people_ahead": n}`) → forward to vLLM with `stream: true`
→ fact-sheet guard sentence by sentence (`kami-factguard`, ADR-E04) → gate line → trailing
`event: toolcalls` → `data: [DONE]`. A regex crisis detector answers self-harm phrases with a
fixed template and never calls the model (§10.4).

The upstream does not have to be vLLM, or local. Anything OpenAI-compatible works, and the
gate reports which it is — see "Pointing the gate at a hosted API" and "Provenance is not
optional" below.

## Runbook (architecture §12.5 step 2)

```
entity-gate --config gate.yaml --upstream http://127.0.0.1:8000 --listen 127.0.0.1:8001
```

The gate pulls the pause set and budgets from the platform and, with `platform.fail_closed: true`,
**fails closed** (refuses completions) if it cannot. Start order on the box: vLLM (step 1) →
the gate (step 2) → `hermes gateway start` (step 3) → the tunnel (step 4).

`python -m entity_gate --config gate.yaml ...` is equivalent. `--passthrough` skips the guard for
UI development; it never skips pause.

## Pointing the gate at a hosted API

The gate speaks plain OpenAI-compatible HTTP, so anything that does — a hosted API, LM
Studio, Ollama's compat endpoint, a second vLLM — can sit behind it. Four keys in
`gate.yaml` cover the differences, and none of them is ever the key itself:

| key | what it is |
|---|---|
| `upstream_url` | base URL; the gate appends `/v1/chat/completions` |
| `upstream_api_key_env` | the **name** of the environment variable holding the key |
| `upstream_headers` | static headers a provider wants (`HTTP-Referer`, `X-Title`) |
| `upstream_model` | the name the *upstream* uses, when it differs from the profile's |
| `request_timeout_s` | default **300**; loopback answers in milliseconds, a hosted API queues, cold-starts and rate-limits, and a timeout reads to a visitor as the kami being asleep |

A literal `upstream_api_key:` in `gate.yaml` is **refused at load** — a key in a config file
is a key in git, in backups, and in the support ticket where someone pastes their config.
So is an `Authorization` header smuggled into `upstream_headers`. The key is read once at
startup from the named variable, sent only to the upstream, and scrubbed out of error
bodies, log lines and event rows.

**Check the upstream before anything else.** Hosted endpoints agree on the URL and disagree
on exactly the things the gate needs:

```
uv run --package kami-gate python -m entity_gate.check_upstream --config gate.yaml
```

It sends one chat completion carrying one tool schema and reports, in plain language,
whether the upstream (a) answers, (b) returns a well-formed tool call, (c) streams, and
(d) reports usage. It exits non-zero on (a) or (b) — a model that cannot call a tool cannot
be a kami, because every number it says has to come from a tool result (ADR-E04). (c) and
(d) only warn: without streaming, chat waits for whole replies; without a `usage` object,
the daily budget falls back to a character-count estimate.

### OpenRouter

```yaml
upstream_url: https://openrouter.ai/api
upstream_api_key_env: OPENROUTER_API_KEY     # the NAME; the key lives in the environment
upstream_headers:
  HTTP-Referer: https://kami.example         # OpenRouter attributes traffic with these
  X-Title: Kami
upstream_model: qwen/qwen3.5-9b-instruct     # profile says qwen3.5-9b; OpenRouter wants this (*verify*)
request_timeout_s: 300

provenance:
  placement: hosted
  provider: OpenRouter
  model: qwen/qwen3.5-9b-instruct
  slug: boulder-creek
  note: "Running on OpenRouter while the DGX Spark is being set up."

platform:
  base_url: https://kami.example             # derives /api/gate/provenance
  pause_set_url: https://kami.example/api/gate/pause-set
  token_env: KAMI_PLATFORM_TOKEN
  fail_closed: true
```

The base URL, the two attribution headers and the model slug are *verify* (`docs/verify.md`
row 74) — the sandbox cannot reach OpenRouter, and `check_upstream` is how you settle them.

```
export OPENROUTER_API_KEY=...        # never in the yaml, never in NEXT_PUBLIC_*
export KAMI_PLATFORM_TOKEN=...
export GATE_ADMIN_SECRET=...
uv run --package kami-gate python -m entity_gate.check_upstream --config gate.yaml
entity-gate --config gate.yaml --listen 127.0.0.1:8001
curl -s 127.0.0.1:8001/healthz | jq .provenance
```

### LM Studio (or any local OpenAI-compatible server)

LM Studio serves on `127.0.0.1:1234` and ignores the key, so there is no
`upstream_api_key_env` — and the placement is `owned`, because the Mac mini is the
project's.

```yaml
upstream_url: http://127.0.0.1:1234
upstream_model: qwen3.5-9b-instruct          # whatever `GET /v1/models` calls it (*verify*, row 75)
request_timeout_s: 300                       # a Mac mini prefills slowly at 64k

provenance:
  placement: owned
  provider: "LM Studio on a Mac mini"
  model: qwen3.5-9b-instruct
```

Load the model in LM Studio with tool use enabled and a context of at least 64k (Hermes
refuses less, ADR-E03), then run `check_upstream` — small local builds are exactly where
(b) fails, and it is better to learn that here than in a visitor's chat window.

## Provenance is not optional

`provenance.placement` is **required and has no default**. A gate that cannot say where its
model runs will not start, for the same reason a production gate will not start with
`passthrough: true`: it would be running in a shape that quietly breaks a promise the
product makes in public.

The promise is PRD G7 — a public "how I work" page that names the model — next to the PRD §3
non-goal, "no cloud frontier model on the hot path". Running a hosted API makes an asserted
"inference is local" false the moment the box is repointed, and nobody remembers to edit the
copy. So the copy does not assert it. `placement`, `provider` and `model` are served on
`GET /healthz` and `GET /admin/provenance`, and pushed to
`POST {platform}/api/gate/provenance` on startup and every `heartbeat_seconds`, with the
same shared secret as the heartbeat and the pause set. The platform stores the last report
under `config.gate_provenance.<slug or "default">` and the page renders **that** — including
saying it does not know, when no report has arrived.

Three things this deliberately does not do. It does not forbid `hosted`: the deviation from
§3 is recorded in `docs/planning/ERRATA.md` row 7 as a testing measure while hardware is
pending, and hiding it would be the actual violation. It does not soften the public page:
the page says what is true today, which is sometimes "someone else's API", and that
sentence costs less than the trust it protects. And it does not change enforcement — the
fact-sheet guard does not know or care where the model runs, and there is a test that says
so (`tests/test_upstream_and_provenance.py`). A hosted model gets the same fact sheet, the
same sentence-by-sentence release and the same gate line as a local one.

The key names, never the key values, appear in what is reported: `api_key_env:
"OPENROUTER_API_KEY"`, `authenticated: true`.

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
curl 127.0.0.1:8001/admin/provenance -H "X-Gate-Admin: $GATE_ADMIN_SECRET"
```

`/admin/provenance` adds to the `/healthz` block where the report is being sent and whether
the last push succeeded.

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
