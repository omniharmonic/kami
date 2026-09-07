import importlib.util
import json
from pathlib import Path
import pytest

spec=importlib.util.spec_from_file_location('runtime_telemetry',Path(__file__).resolve().parents[3]/'scripts/runtime/telemetry.py')
telemetry=importlib.util.module_from_spec(spec);spec.loader.exec_module(telemetry)


def usage():
    return {'ts':'2026-09-07T22:15:00Z','slug':'boulder-creek','job':'chat','prompt_tokens':123,'output_tokens':45,'latency_ms':12.3,'authorization':'NEVER_SEND','sentence':'private model content'}


def test_retry_uses_same_ids_and_does_not_advance_without_explicit_ack(tmp_path):
    log=tmp_path/'usage_events.jsonl';log.write_text(json.dumps(usage())+'\n')
    first,proposed=telemetry.read_batch(tmp_path,{})
    again,_=telemetry.read_batch(tmp_path,{})
    assert first==again
    cursor=tmp_path/'cursor.json'
    with pytest.raises(ValueError):telemetry.acknowledge(cursor,proposed,first,{'ok':True})
    assert not cursor.exists()
    telemetry.acknowledge(cursor,proposed,first,{'telemetry_version':1,'acknowledged':[r['id'] for r in first['records']]})
    subsequent,_=telemetry.read_batch(tmp_path,json.loads(cursor.read_text()))
    assert subsequent['records']==[]
    assert cursor.stat().st_mode & 0o077 == 0
    serialized=json.dumps(first)
    assert 'NEVER_SEND' not in serialized and 'private model content' not in serialized
    assert first['records'][0]['prompt_tokens']==123


def test_distinct_identical_lines_are_distinct_events_and_partial_lines_wait(tmp_path):
    line=json.dumps(usage())
    (tmp_path/'usage_events.jsonl').write_text(line+'\n'+line+'\n'+line[:20])
    batch,_=telemetry.read_batch(tmp_path,{})
    assert len(batch['records'])==2
    assert batch['records'][0]['id']!=batch['records'][1]['id']


def test_guard_delivery_contains_only_categories(tmp_path):
    (tmp_path/'guard_events.jsonl').write_text(json.dumps({'ts':'2026-09-07T22:15:00Z','slug':'boulder-creek','action':'drop','reason':'unmatched','sentence':'secret prose','unmatched':{'token':'private'}})+'\n')
    batch,_=telemetry.read_batch(tmp_path,{})
    assert batch['records'][0]['action']=='drop'
    assert 'secret' not in json.dumps(batch) and 'private' not in json.dumps(batch)


def test_batch_bound_and_invalid_counts(tmp_path):
    (tmp_path/'usage_events.jsonl').write_text((json.dumps(usage())+'\n')*200)
    batch,_=telemetry.read_batch(tmp_path,{},limit=250)
    assert len(batch['records'])==125
    for invalid in [-1,float('inf'),1.5,True]:
        with pytest.raises(ValueError):telemetry.sanitize_record({**usage(),'output_tokens':invalid},'usage','a'*64)
