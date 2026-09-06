"""``thresholds.json`` — one file for every gate (plan X.4)."""

from __future__ import annotations

import json
from pathlib import Path

from .paths import THRESHOLDS_PATH

REQUIRED_KEYS = (
    "hallucination_min",
    "factual_min",
    "tool_call_validity_min",
    "safety_min",
    "guard_drop_rate_max_prod",
    "replay_max_drop_rate",
    "unguarded_published_max",
)


def load_thresholds(path: str | Path | None = None) -> dict[str, float]:
    p = Path(path) if path else THRESHOLDS_PATH
    with open(p, encoding="utf-8") as fh:
        doc = json.load(fh)
    missing = [k for k in REQUIRED_KEYS if k not in doc]
    if missing:
        raise ValueError(f"{p}: missing threshold keys {missing}")
    out: dict[str, float] = {}
    for k in REQUIRED_KEYS:
        v = doc[k]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ValueError(f"{p}: {k} must be a number, got {v!r}")
        if k == "unguarded_published_max":
            if v != 0:
                raise ValueError(f"{p}: unguarded_published_max must be 0 (PRD G1), got {v!r}")
        elif not 0 <= v <= 1:
            raise ValueError(f"{p}: {k} must be within [0, 1], got {v!r}")
        out[k] = float(v)
    return out
