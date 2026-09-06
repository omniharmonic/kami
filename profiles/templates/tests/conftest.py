"""Make the templates dir and the skill scripts dir importable. Stdlib only; run with
`python3 -m pytest profiles/templates/tests -q` from the repo root."""

import sys
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TEMPLATES))
sys.path.insert(0, str(TEMPLATES / "skills" / "entity-steward" / "scripts"))
