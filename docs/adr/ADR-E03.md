# ADR-E03 — Local open-weights model behind an OpenAI-compatible endpoint; no frontier model on the hot path

**Status:** accepted for build (2026-09-06)
**Context.** The owner wants a local model for ethical and safety reasons. B2 §2: Qwen3.5-9B is the current 8B-class (Apache-2.0); Qwen3.8-27B is stronger and needs 32–48 GB for 64k contexts; Hermes refuses models under a 64k context. The twin's CX33 cannot host either (B1 §8).
**Decision.** vLLM serves the model on the GPU box on `127.0.0.1:8000` with `--enable-auto-tool-choice`, the `hermes` tool parser (Qwen3/3.5) or `qwen3_coder` (3.8), `--reasoning-parser qwen3`, and `--max-model-len 65536`. Hermes never talks to vLLM directly; it talks to the gate (ADR-E04). Pulses and chat run at reasoning `low`/`medium`; weekly and quarterly jobs pin the larger model when one exists. **Model size and buy-vs-rent are the owner's decision** (PRD §11 #3); the architecture is indifferent — the model is a `base_url` and a name in `config.yaml`. A hosted frontier model may be used offline for synthetic data and eval judging only.
**Consequences.** (+) Chat transcripts never leave owned/rented hardware. (+) Swapping 9B → 27B is a config change and an eval run. (−) The honesty burden moves to the guard (ADR-E04). (−) GPU economics are the platform's largest cost line (§13).
**Alternatives rejected.** Ollama for production (single-user-ish, weaker batching); llama.cpp on a Mac Studio (no vLLM, slow prefill — acceptable fallback); any hosted API on the hot path.

## Build notes

_None yet._
