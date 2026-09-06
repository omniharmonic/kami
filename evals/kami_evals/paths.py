"""Filesystem layout of the evals package (everything is relative to ``evals/``)."""

from __future__ import annotations

from pathlib import Path

EVALS_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = EVALS_ROOT / "fixtures"
SNAPSHOTS_DIR = FIXTURES_DIR / "snapshots"
REPLAYS_DIR = FIXTURES_DIR / "replays"
GAZETTEER_PATH = FIXTURES_DIR / "gazetteer.json"
PROBES_DIR = EVALS_ROOT / "probes"
OUT_DIR = EVALS_ROOT / "out"
THRESHOLDS_PATH = EVALS_ROOT / "thresholds.json"
HARD_RULES_PATH = EVALS_ROOT.parent / "profiles" / "templates" / "SOUL.hard-rules.md"
