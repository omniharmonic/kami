# Fine-tune pipeline (plan T3.6)

Runs **after 4–8 weeks of transcripts** (PRD §11 #14). Ship on the stock model + SOUL + MCP +
guard first (PRD §8.4). A fine-tune makes the small model more consistent and better at tool
calls; it does not make it honest — the gate does.

```
build_dataset.py   opted-in transcripts + synthetic + ≥ 25 % Hermes <tool_call> → train.jsonl
synth.py           reasoning transcripts from REAL snapshots with ground truth (offline frontier)
train.py           Unsloth QLoRA on Qwen3.5-9B (r=16, α=32, 2 ep, lr 2e-4, 8192, 4-bit)
eval_gate.py       stock (8000) vs candidate (8002): (a) facts ↑, (c) tool calls ↑, (b) halluc. ≥
MODEL_CARD.md      template that names what the model WILL hallucinate
```

## Run order

1. `python -m finetune.synth --endpoint … --api-key … --provider anthropic --out synth.jsonl`
   (dry-run without keys; every kept transcript is guard-clean against its snapshot).
2. Curate `synth.jsonl` with someone who reads hydrographs.
3. `python -m finetune.build_dataset --transcripts exports/*.jsonl --synthetic synth.jsonl --out train.jsonl`
   — prints the archetype quota table and the tool-call share (must be ≥ 0.25).
4. On the rented GPU: `python -m finetune.train --data train.jsonl --out entity-voice-9b-v1`.
5. Copy the merged weights to the box under `/opt/kami/models/entity-voice-9b-v1/`; start a
   second vLLM on `127.0.0.1:8002` beside the stock one on `8000`.
6. `python -m finetune.eval_gate --stock http://127.0.0.1:8000/v1 --candidate http://127.0.0.1:8002/v1`
   then `python -m kami_evals.judge --transcripts evals/out/live-report-candidate.json …`.
7. Fill in `MODEL_CARD.md`. Release the weights Apache-2.0.

## Swap and rollback rehearsal (do this once before the first real swap)

Rehearse with the **stock** weights as the "candidate" so the procedure is proven with nothing at
stake:

1. Pause the entity (`profiles/scripts/pause.ts boulder-creek`; the gate returns 423).
2. In `infra/box/.env`, point `KAMI_CHAT_MODEL_URL` (or the gate's `upstream_url`) from `:8000`
   to `:8002`; `docker compose up -d entity-gate`. Record the previous value.
3. `python -m kami_evals.live --endpoint http://127.0.0.1:8001/p/boulder-creek/v1 --model entity-voice-9b-v1 --limit 40`
   must be green. One guardian chats from a phone.
4. **Roll back:** restore the previous `upstream_url`, `docker compose up -d entity-gate`, run the
   same 40-probe live run against the stock model — green again. Time both directions; both
   must be under 5 minutes.
5. Resume (two guardian names, ADR-E12). Note the timings in `docs/runbooks/model-update.md`.

Previous weights are never deleted from the box; `infra/box/docker-compose.yml` keeps both
model services defined so a rollback is a config change plus a restart (architecture §12.7).
