"""Metadata-only JSONL batches and acknowledgment-based byte cursors."""
from __future__ import annotations
import hashlib
import json
import math
import os
from pathlib import Path

ACTIONS={'drop','crisis','paused','budget','queue_full','pause','resume'}
REASONS={'unmatched','stale','budget','queue','paused','crisis','other'}


def finite_int(value, maximum):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0 or value>maximum or int(value)!=value:
        raise ValueError('Invalid bounded telemetry count')
    return int(value)


def sanitize_record(raw, kind, record_id):
    # Never copy raw sentence, arguments, unmatched claims, headers, or credentials.
    record={'id':record_id,'kind':kind,'slug':raw.get('slug'),'at':raw.get('ts') or raw.get('at'),
            'job':'cron' if raw.get('job')=='cron' else 'chat'}
    if kind=='usage':
        record.update(prompt_tokens=finite_int(raw.get('prompt_tokens'),2_147_483_647),
                      output_tokens=finite_int(raw.get('output_tokens'),2_147_483_647))
        if raw.get('latency_ms') is not None:
            latency=raw['latency_ms']
            if isinstance(latency,bool) or not isinstance(latency,(int,float)) or not math.isfinite(latency) or latency<0:
                raise ValueError('Invalid telemetry latency')
            record['latency_ms']=finite_int(round(latency),86_400_000)
    else:
        action=raw.get('action')
        if action not in ACTIONS:raise ValueError('Unknown guard action')
        reason=raw.get('reason')
        record.update(action=action,reason=reason if reason in REASONS else 'other')
    return record


def read_batch(events_dir: Path, cursor: dict, limit=250):
    records=[];proposed=dict(cursor)
    for kind in ('usage','guard'):
        path=events_dir/f'{kind}_events.jsonl'
        if not path.exists():continue
        stat=path.stat();identity=f'{stat.st_dev}:{stat.st_ino}'
        old=cursor.get(kind,{})
        offset=old.get('offset',0) if old.get('identity')==identity else 0
        if not isinstance(offset,int) or offset<0 or offset>stat.st_size:offset=0
        with path.open('rb') as stream:
            stream.seek(offset)
            for _ in range(limit//2):
                start=stream.tell();line=stream.readline(1_048_577)
                if len(line)>1_048_576:raise ValueError('Oversized local telemetry row')
                if not line or not line.endswith(b'\n'):break
                raw=json.loads(line)
                prefix=f'{path.resolve()}:{identity}:{start}:'.encode()
                record_id=hashlib.sha256(prefix+line).hexdigest()
                records.append(sanitize_record(raw,kind,record_id));offset=stream.tell()
        proposed[kind]={'identity':identity,'offset':offset}
    return {'version':1,'records':records},proposed


def acknowledge(path: Path, proposed: dict, batch: dict, response: dict):
    expected=[r['id'] for r in batch['records']]
    if response.get('telemetry_version')!=1 or response.get('acknowledged')!=expected:
        raise ValueError('Telemetry acknowledgment missing or mismatched')
    temp=path.with_suffix('.tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as stream:
        json.dump(proposed,stream);stream.flush();os.fsync(stream.fileno())
    os.replace(temp,path)
