"""Unsloth QLoRA on Qwen3.5-9B (plan T3.6; PRD §8.4). Runs on a rented 5090/4090, never on the
serving box while it serves.

    python -m finetune.train --data train.jsonl --out entity-voice-9b-v1 [--dry-run]

Config (PRD §8.4 / B2 §2.5): r=16, alpha=32, dropout 0, 2 epochs, lr 2e-4, cosine, max_seq 8192,
4-bit base, target the attention + MLP projections, chat template = the model's own so the
Hermes ``<tool_call>`` turns are tokenised as served.
"""

from __future__ import annotations

import argparse
import json
import sys

BASE_MODEL = "unsloth/Qwen3.5-9B-bnb-4bit"  # verify: exact Unsloth 4-bit repo name for Qwen3.5
CONFIG = {
    "base_model": BASE_MODEL,
    "load_in_4bit": True,
    "max_seq_length": 8192,
    "lora": {"r": 16, "lora_alpha": 32, "lora_dropout": 0.0, "bias": "none",
             "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj",
                                "down_proj"], "use_rslora": False, "use_gradient_checkpointing":
             "unsloth"},
    "train": {"num_train_epochs": 2, "learning_rate": 2e-4, "lr_scheduler_type": "cosine",
              "warmup_ratio": 0.03, "per_device_train_batch_size": 2,
              "gradient_accumulation_steps": 8, "weight_decay": 0.01, "bf16": True,
              "logging_steps": 10, "save_strategy": "epoch", "seed": 3407,
              "report_to": "trackio"},  # verify: Trackio vs W&B (PRD §8.5)
    "output_name": "entity-voice-9b-v1",
    "licence": "Apache-2.0",
}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--data", default="train.jsonl")
    p.add_argument("--out", default=CONFIG["output_name"])
    p.add_argument("--dry-run", action="store_true", help="print the config and exit")
    args = p.parse_args(argv)
    cfg = dict(CONFIG, data=args.data, output_name=args.out)
    if args.dry_run:
        print(json.dumps(cfg, indent=2))
        return 0
    try:
        import unsloth  # noqa: F401
        from unsloth import FastLanguageModel
    except ImportError:
        print("finetune.train: `unsloth` is not installed. This script runs on a rented GPU box "
              "(Vast 5090 ≈ $0.53/h × ~48 h per run), not in the sandbox or on the serving box.\n"
              "  pip install unsloth   (see https://github.com/unslothai/unsloth)\n"
              "Use --dry-run to inspect the configuration.", file=sys.stderr)
        return 2
    from datasets import load_dataset
    from trl import SFTConfig, SFTTrainer

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=cfg["base_model"], max_seq_length=cfg["max_seq_length"],
        load_in_4bit=cfg["load_in_4bit"])
    model = FastLanguageModel.get_peft_model(model, **cfg["lora"], random_state=cfg["train"]["seed"])
    ds = load_dataset("json", data_files=cfg["data"], split="train")

    def to_text(row):
        return {"text": tokenizer.apply_chat_template(row["messages"], tokenize=False)}

    ds = ds.map(to_text, remove_columns=[c for c in ds.column_names if c != "text"])
    trainer = SFTTrainer(model=model, tokenizer=tokenizer, train_dataset=ds,
                         dataset_text_field="text", max_seq_length=cfg["max_seq_length"],
                         args=SFTConfig(output_dir=cfg["output_name"], **cfg["train"]))
    trainer.train()
    model.save_pretrained_merged(cfg["output_name"], tokenizer, save_method="merged_16bit")
    print(f"saved {cfg['output_name']} — serve on port 8002 beside the stock model; run "
          "finetune/eval_gate.py before any swap")
    return 0


if __name__ == "__main__":
    sys.exit(main())
