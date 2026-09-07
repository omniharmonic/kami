#!/usr/bin/env python3
"""Run using the installed Hermes venv. No profile/auth file is modified."""
import os
from pathlib import Path
import sys
root = Path(__file__).resolve().parents[2]
hermes = Path(os.environ.get('KAMI_HERMES_SOURCE', str(Path.home() / '.hermes/hermes-agent')))
sys.path[:0] = [str(root / 'apps/gate/src'), str(root / 'packages/factguard/src'), str(hermes)]
import uvicorn
from entity_gate.codex_bridge import create_bridge
app = create_bridge(os.environ['KAMI_CODEX_BRIDGE_KEY'],
                    model=os.environ.get('KAMI_CODEX_MODEL', 'gpt-5.6-luna'))
if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8002, access_log=False)
