#!/usr/bin/env python3
"""Install the verified guarded stack without changing a being's pause state.

Requires --gate-secret-file containing the existing production GATE_ADMIN_SECRET,
--tunnel-id for a separately provisioned tunnel, and --hostname for its DNS route.
"""
import argparse,json,os,pathlib,plistlib,secrets,subprocess,sys
import yaml
p=argparse.ArgumentParser()
p.add_argument('--gate-secret-file',required=True)
p.add_argument('--tunnel-id',required=True)
p.add_argument('--hostname',required=True)
p.add_argument('--slug',default='boulder-creek')
p.add_argument('--source-profile',default='beings-earth')
a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2];home=pathlib.Path.home()
if not a.slug or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in a.slug):raise SystemExit('Invalid slug')
if not a.source_profile or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in a.source_profile):raise SystemExit('Invalid source profile')
existing=home/'.kami/runtime/settings.json'
if existing.exists() and json.loads(existing.read_text()).get('KAMI_ENTITY_SLUG') != a.slug:
 raise SystemExit('This device runtime already serves another being. Provision a separate host/port deployment; existing being was not replaced.')
private=home/'.kami/runtime';private.mkdir(mode=0o700,parents=True,exist_ok=True);private.chmod(0o700)
profile=private/'profile';profile.mkdir(mode=0o700,exist_ok=True)
source=home/'.hermes/profiles'/a.source_profile
config=yaml.safe_load((source/'config.yaml').read_text())
config['model']={'default':'beings-guarded','provider':'custom','base_url':f'http://127.0.0.1:8001/p/{a.slug}/v1','context_length':128000}
config['compression']={'enabled':False};config['fallback_model']=[];config['fallback_models']=[]
(profile/'config.yaml').write_text(yaml.safe_dump(config));(profile/'SOUL.md').write_text((source/'SOUL.md').read_text())
secret=pathlib.Path(a.gate_secret_file).read_text().strip()
if len(secret)<32:raise SystemExit('Production gate secret missing or too short')
settings_path=private/'settings.json'
settings=json.loads(settings_path.read_text()) if settings_path.exists() else {}
for k in ['KAMI_CODEX_BRIDGE_KEY','KAMI_MODEL_GATE_KEY','API_SERVER_KEY','HERMES_GATEWAY_API_KEY']:
 settings.setdefault(k,secrets.token_urlsafe(48))
for line in (home/'.kami/credentials'/f'{a.slug}.env').read_text().splitlines():
 if '=' in line and not line.startswith('#'):
  k,v=line.removeprefix('export ').split('=',1)
  if k=='PLATFORM_MCP_TOKEN':settings[k]=v.strip().strip('\"').strip("'")
settings.update({'GATE_ADMIN_SECRET':secret,'KAMI_PLATFORM_TOKEN':secret,'KAMI_ENTITY_SLUG':a.slug,'KAMI_HERMES_SOURCE':str(home/'.hermes/hermes-agent'),'KAMI_HERMES_PROFILE_DIR':str(profile),'KAMI_CODEX_MODEL':'gpt-5.6-luna'})
fd=os.open(settings_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump(settings,f)
os.chmod(settings_path,0o600)
gate={'upstream_url':'http://127.0.0.1:8002','upstream_api_key_env':'KAMI_CODEX_BRIDGE_KEY','upstream_model':'gpt-5.6-luna','paused':[a.slug],'events_dir':str(private/'events'),'provenance':{'placement':'hosted','provider':'OpenAI Codex via guarded Hermes','model':'gpt-5.6-luna','slug':a.slug},'platform':{'base_url':'https://beings.earth','pause_set_url':'https://beings.earth/api/gate/pause-set','token_env':'KAMI_PLATFORM_TOKEN','fail_closed':True,'poll_seconds':15}}
(private/'gate.yaml').write_text(yaml.safe_dump(gate))
(private/'tunnel.yaml').write_text(yaml.safe_dump({'tunnel':a.tunnel_id,'credentials-file':str(home/'.cloudflared'/f'{a.tunnel_id}.json'),'ingress':[{'hostname':a.hostname,'service':'http://127.0.0.1:8643'},{'service':'http_status:404'}]}))
logs=home/'Library/Logs/beings-runtime';logs.mkdir(parents=True,exist_ok=True);logs.chmod(0o700)
launch=home/'Library/LaunchAgents';launch.mkdir(parents=True,exist_ok=True)
py=str(home/'.hermes/hermes-agent/venv/bin/python');domain=f'gui/{os.getuid()}'
for component in ['bridge','gate','hermes','router','tunnel']:
 label=f'earth.beings.{component}';path=launch/f'{label}.plist'
 plist={'Label':label,'ProgramArguments':[py,str(root/'scripts/runtime/run-service.py'),component],'WorkingDirectory':str(root),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,'StandardOutPath':str(logs/f'{component}.log'),'StandardErrorPath':str(logs/f'{component}.error.log'),'EnvironmentVariables':{'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin','HOME':str(home)}}
 path.write_bytes(plistlib.dumps(plist))
 subprocess.run(['launchctl','bootout',domain+'/'+label],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['launchctl','bootstrap',domain,str(path)],check=True)
 subprocess.run(['launchctl','enable',domain+'/'+label],check=True)
print('Installed five guarded runtime launch agents. Secrets:',settings_path)
print('Router URL: https://'+a.hostname)
print(a.slug+' remains explicitly paused in gate configuration.')
