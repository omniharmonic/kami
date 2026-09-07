#!/usr/bin/env python3
"""Report actual local gate+harness readiness, with no synthetic usage rows."""
import json,sys
from telemetry import read_batch, acknowledge
from datetime import datetime,timezone
from pathlib import Path
import httpx
settings_path=Path.home()/'.kami/runtime/settings.json'
if settings_path.stat().st_mode & 0o077:raise SystemExit('Settings are not private')
s=json.loads(settings_path.read_text())
try:
 with httpx.Client(timeout=15,follow_redirects=False) as c:
  gate=c.get('http://127.0.0.1:8001/healthz');gate.raise_for_status();gate=gate.json()
  harness=c.get('http://127.0.0.1:8642/health',headers={'Authorization':'Bearer '+s['API_SERVER_KEY']});harness.raise_for_status()
  if harness.json().get('kami_runtime_contract')!=1:raise ValueError('Harness contract unavailable')
  if gate.get('pause',{}).get('last_sync_ok') is not True:raise ValueError('Pause synchronization unavailable')
  at=datetime.now(timezone.utc).isoformat()
  headers={'Authorization':'Bearer '+s['GATE_ADMIN_SECRET']}
  provenance=c.post('https://beings.earth/api/gate/provenance',headers=headers,json={'at':at,'slug':s['KAMI_ENTITY_SLUG'],'provenance':gate['provenance']});provenance.raise_for_status()
  delivered=0
  if s.get('KAMI_TELEMETRY_PROTOCOL') == '1':
   cursor_path=settings_path.parent/'telemetry-cursor.json'
   cursor=json.loads(cursor_path.read_text()) if cursor_path.exists() else {}
   batch,proposed=read_batch(settings_path.parent/'events',cursor)
   heartbeat=c.post('https://beings.earth/api/gate/heartbeat',headers=headers,json={'telemetry':batch});heartbeat.raise_for_status()
   acknowledge(cursor_path,proposed,batch,heartbeat.json());delivered=len(batch['records'])
  else:
   heartbeat=c.post('https://beings.earth/api/gate/heartbeat',headers=headers,json={'at':at,'host':'beings-mac-runtime','usage_events':[],'guard_events':[]});heartbeat.raise_for_status()
 print(json.dumps({'status':'reported','at':at,'paused':s['KAMI_ENTITY_SLUG'] in gate['pause']['paused'],'telemetry_records':delivered}))
except Exception as e:
 # Do not print response bodies, request headers, or credentials.
 print(json.dumps({'status':'unavailable','error_type':type(e).__name__}));sys.exit(1)
