#!/usr/bin/env python3
"""Install PRD schedules into the isolated guarded profile using Hermes's real API.

Jobs are paused by default; --enable installs runnable schedules whose scripts
still check the production pause state before every model turn and write.
"""
import argparse,json,os,pathlib,plistlib,subprocess,sys
import yaml
p=argparse.ArgumentParser();p.add_argument('--enable',action='store_true');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2];home=pathlib.Path.home()
settings_path=home/'.kami/runtime/settings.json'
if settings_path.stat().st_mode & 0o077:raise SystemExit('Settings are not private')
settings=json.loads(settings_path.read_text());settings['KAMI_HERMES_SOURCE']=str(home/'.hermes/hermes-agent')
settings_path.write_text(json.dumps(settings));settings_path.chmod(0o600)
profile=pathlib.Path(settings['KAMI_HERMES_PROFILE_DIR']);scripts=profile/'scripts';scripts.mkdir(exist_ok=True)
config=yaml.safe_load((profile/'config.yaml').read_text());config['timezone']='America/Denver'
config.setdefault('cron',{})['script_timeout_seconds']=1800
(profile/'config.yaml').write_text(yaml.safe_dump(config))
os.environ['HERMES_HOME']=str(profile);os.environ['HERMES_TIMEZONE']='America/Denver'
sys.path[:0]=[settings['KAMI_HERMES_SOURCE'],str(root/'apps/gate/src'),str(root/'packages/factguard/src')]
from cron.jobs import create_job,list_jobs,pause_job,resume_job
from entity_gate.steward_jobs import JOBS
existing={j.get('name'):j for j in list_jobs(include_disabled=True)}
for name,(schedule,_) in JOBS.items():
 wrapper=scripts/f'beings-{name}.py'
 wrapper.write_text('import os,sys\nos.execv(sys.executable, [sys.executable, '+repr(str(root/'scripts/runtime/steward-turn.py'))+', '+repr(name)+', "--settings", '+repr(str(settings_path))+'])\n')
 job=existing.get('beings-'+name)
 if job is None:job=create_job(prompt=None,schedule=schedule,name='beings-'+name,deliver='local',script=wrapper.name,no_agent=True)
 if a.enable:resume_job(job['id'])
 else:pause_job(job['id'],reason='Awaiting guarded runtime activation')
 print(name, 'scheduled with pause enforcement' if a.enable else 'schedule disabled')
label='earth.beings.scheduler';path=home/'Library/LaunchAgents'/f'{label}.plist';logs=home/'Library/Logs/beings-runtime'
plist={'Label':label,'ProgramArguments':[str(home/'.hermes/hermes-agent/venv/bin/python'),str(root/'scripts/runtime/scheduler-tick.py')],'WorkingDirectory':str(root),'StartInterval':60,'RunAtLoad':True,'StandardOutPath':str(logs/'scheduler.log'),'StandardErrorPath':str(logs/'scheduler.error.log'),'EnvironmentVariables':{'HOME':str(home),'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'}}
path.write_bytes(plistlib.dumps(plist));domain=f'gui/{os.getuid()}'
subprocess.run(['launchctl','bootout',domain+'/'+label],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.run(['launchctl','bootstrap',domain,str(path)],check=True)
subprocess.run(['launchctl','enable',domain+'/'+label],check=True)
report_label='earth.beings.reporter';report_path=home/'Library/LaunchAgents'/f'{report_label}.plist'
report=dict(plist);report['Label']=report_label;report['ProgramArguments']=[str(home/'.hermes/hermes-agent/venv/bin/python'),str(root/'scripts/runtime/report-health.py')]
report['StandardOutPath']=str(logs/'reporter.log');report['StandardErrorPath']=str(logs/'reporter.error.log')
report_path.write_bytes(plistlib.dumps(report))
subprocess.run(['launchctl','bootout',domain+'/'+report_label],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.run(['launchctl','bootstrap',domain,str(report_path)],check=True)
subprocess.run(['launchctl','enable',domain+'/'+report_label],check=True)
print('Installed minute scheduler tick and verified-health reporter; no external message delivery.')
