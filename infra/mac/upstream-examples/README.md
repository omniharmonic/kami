# `upstream-examples/` — two complete `gate.yaml` fragments

The gate speaks plain OpenAI-compatible HTTP, so what changes between providers is four keys
and a provenance block. Both files here are drop-in: copy the blocks over the matching ones
in `apps/gate/gate.yaml`, or keep one as `~/.kami/gate.yaml` and set `KAMI_GATE_YAML` in
`~/.kami/kami.env`.

| file | placement | when |
|---|---|---|
| `openai.gate.yaml` | `hosted` | **the worked path today** — OpenAI, while the DGX Spark is being set up |
| `lmstudio.gate.yaml` | `owned` | the local alternative on this Mac mini, and the shape the Spark takes |

Three rules that hold for every provider:

1. **The key is never in the YAML.** `upstream_api_key_env` names an environment variable;
   the value lives in `~/.kami/kami.env` (chmod 600), which only `bin/run-gate.sh` reads. A
   literal `upstream_api_key:` is refused at load, and so is an `Authorization` header hidden
   in `upstream_headers`.
2. **`provenance.placement` is required and has no default.** The gate will not start without
   it, because the public "how I work" page renders what the gate reports, and a page that
   claims local inference while someone else's API answers the chat is a false claim about
   the system's own integrity.
3. **Check before you start.** `python -m entity_gate.check_upstream --config <file>` sends
   one completion with one tool schema and reports whether the upstream answers, returns a
   well-formed tool call, streams, and reports usage. The first two are fatal: a model that
   cannot call a tool cannot be a kami.

```bash
uv run --package kami-gate python -m entity_gate.check_upstream --config ~/.kami/gate.yaml
bash scripts/kami-doctor --only upstream,gate
```

Any other OpenAI-compatible endpoint — OpenRouter, Together, Groq, a second vLLM, Ollama's
compat endpoint — is the same four keys with different values. That is the whole point: when
the DGX Spark arrives, moving to it is `upstream_url: http://127.0.0.1:8000`,
`upstream_api_key_env: null`, `placement: owned`, restart. Not a migration. The Spark is a
CUDA machine, so from that point `infra/box/` is the runbook that applies; this Mac kit is
explicitly the interim.

More detail, including the OpenRouter header quirks and what each key does:
`apps/gate/README.md`, "Pointing the gate at a hosted API".
