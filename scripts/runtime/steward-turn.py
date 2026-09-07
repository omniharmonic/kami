#!/usr/bin/env python3
"""One scheduled task. Paused beings spend no model tokens and perform no writes."""
import argparse,json,os,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('job');p.add_argument('--settings',required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[2];settings_path=Path(a.settings)
if settings_path.stat().st_mode & 0o077:raise SystemExit('Settings are not private')
settings=json.loads(settings_path.read_text());os.environ.update(settings)
os.environ['HERMES_HOME']=settings['KAMI_HERMES_PROFILE_DIR']
source=Path(settings.get('KAMI_HERMES_SOURCE',str(Path.home()/'.hermes/hermes-agent')))
sys.path[:0]=[str(root/'apps/gate/src'),str(root/'packages/factguard/src'),str(source)]
from entity_gate.steward_jobs import JOBS, WriteGuard, live_pause_check
if a.job not in JOBS:raise SystemExit('Unknown stewardship job')
slug=settings['KAMI_ENTITY_SLUG']
paused=lambda:live_pause_check(slug,settings['GATE_ADMIN_SECRET'])
if paused():
 print(json.dumps({'job':a.job,'status':'skipped','reason':'paused_or_sync_unavailable','model_calls':0}));raise SystemExit(0)
from entity_gate.hermes_runtime import install_mcp_sanitizer,hermes_factory
policy=WriteGuard(paused);install_mcp_sanitizer(policy)
if paused():
 print(json.dumps({'job':a.job,'status':'skipped','reason':'paused_before_model','model_calls':0}));raise SystemExit(0)
profile=Path(settings['KAMI_HERMES_PROFILE_DIR'])
skill=root/'profiles/templates/skills/entity-steward/SKILL.md'
soul=(profile/'SOUL.md').read_text()+'\n\n'+skill.read_text()
agent=hermes_factory(gate_base=f'http://127.0.0.1:8001/p/{slug}/v1',gate_key=settings['KAMI_MODEL_GATE_KEY'],soul=soul,toolsets=['bioregional-twin','kami-platform'],background=True)(lambda _:None,lambda *args:None)
result=agent.run_conversation(JOBS[a.job][1])
status='error' if result.get('error') else 'completed'
print(json.dumps({'job':a.job,'status':status,'write_attempts_allowed':policy.writes,'writes_held':policy.held}))
if status=='error':raise SystemExit(1)
