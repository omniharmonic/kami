#!/usr/bin/env python3
"""Launch the dedicated, MCP-only harness using the installed Hermes Python."""
import os
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[2]
source=Path(os.environ.get('KAMI_HERMES_SOURCE',str(Path.home()/'.hermes/hermes-agent')))
profile=Path(os.environ['KAMI_HERMES_PROFILE_DIR']).resolve()
os.environ['HERMES_HOME']=str(profile)
sys.path[:0]=[str(root/'apps/gate/src'),str(root/'packages/factguard/src'),str(source)]
import uvicorn
from entity_gate.hermes_runtime import create_runtime, hermes_factory, install_mcp_sanitizer
install_mcp_sanitizer()
slug=os.environ['KAMI_ENTITY_SLUG']
if not slug or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in slug):
    raise ValueError('Invalid slug')
factory=hermes_factory(gate_base=f'http://127.0.0.1:8001/p/{slug}/v1',
    gate_key=os.environ['KAMI_MODEL_GATE_KEY'], soul=(profile/'SOUL.md').read_text(),
    toolsets=['bioregional-twin','kami-platform'])
app=create_runtime(key=os.environ['API_SERVER_KEY'],agent_factory=factory)
if __name__=='__main__':
    uvicorn.run(app,host='127.0.0.1',port=8642,access_log=False)
