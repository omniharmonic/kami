#!/usr/bin/env python3
"""launchd entry point. Private settings never appear in plist arguments."""
import json
import os
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[2]
settings=Path.home()/'.kami/runtime/settings.json'
if settings.stat().st_mode & 0o077:
    raise SystemExit('Runtime settings must be private (0600)')
env=os.environ.copy()
env.update(json.loads(settings.read_text()))
env['PYTHONPATH']=str(root/'apps/gate/src')+':'+str(root/'packages/factguard/src')
py=str(Path.home()/'.hermes/hermes-agent/venv/bin/python')
service=sys.argv[1]
commands={
 'bridge':[py,str(root/'scripts/runtime/codex-bridge.py')],
 'gate':[py,'-m','entity_gate','--config',str(Path.home()/'.kami/runtime/gate.yaml')],
 'hermes':[py,str(root/'scripts/runtime/hermes-server.py')],
 'router':[py,str(root/'scripts/runtime/router.py')],
 'tunnel':['/opt/homebrew/bin/cloudflared','tunnel','--config',str(Path.home()/'.kami/runtime/tunnel.yaml'),'run'],
}
if service not in commands:raise SystemExit('Unknown runtime service')
os.chdir(root)
os.execve(commands[service][0],commands[service],env)
