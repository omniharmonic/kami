#!/usr/bin/env python3
"""Run the installed Hermes scheduler once; its jobs are script-only wrappers."""
import json,os,sys
from pathlib import Path
settings_path=Path.home()/'.kami/runtime/settings.json'
if settings_path.stat().st_mode & 0o077:raise SystemExit('Settings are not private')
settings=json.loads(settings_path.read_text())
os.environ.update(settings);os.environ['HERMES_HOME']=settings['KAMI_HERMES_PROFILE_DIR']
os.environ['HERMES_TIMEZONE']='America/Denver'
sys.path.insert(0,settings.get('KAMI_HERMES_SOURCE',str(Path.home()/'.hermes/hermes-agent')))
from cron.scheduler import tick
tick(verbose=False)
