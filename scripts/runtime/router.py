#!/usr/bin/env python3
import os
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(root/'apps/gate/src'),str(root/'packages/factguard/src')]
import uvicorn
from entity_gate.runtime_router import create_router
app=create_router(slug=os.environ['KAMI_ENTITY_SLUG'],key=os.environ['HERMES_GATEWAY_API_KEY'],
    hermes_key=os.environ['API_SERVER_KEY'],hermes_url='http://127.0.0.1:8642',
    gate_url='http://127.0.0.1:8001',admin_key=os.environ['GATE_ADMIN_SECRET'])
if __name__=='__main__':
    uvicorn.run(app,host='127.0.0.1',port=8643,access_log=False)
