import httpx
import pytest
from entity_gate.hermes_runtime import create_runtime, sanitize

KEY='x'*32

def test_geometry_nested_mcp_text_removed():
    value={'content':[{'type':'text','text':'{"id":"place/creek","bbox":[1,2],"geometry":{"coordinates":[3]},"reading":{"value":12,"unit":"cfs","source_id":"usgs","time":"2026-09-07","stale":false}}'}]}
    cleaned=sanitize(value)
    text=cleaned['content'][0]['text']
    assert 'coordinates' not in text and 'bbox' not in text and 'geometry' not in text
    assert 'source_id' in text and '12' in text

@pytest.mark.asyncio
async def test_real_callback_evidence_without_raw_results():
    class Agent:
        def __init__(self,delta,complete):
            self.delta,self.complete=delta,complete
        def run_conversation(self,user,conversation_history):
            self.complete('c1','get_place',{'secret':'hide'},'{"id":"place/creek","time":"2026-09-07","source_id":"usgs","stale":true,"coordinates":[10,20]}')
            self.delta('The reading is stale.')
            return {'final_response':'The reading is stale.'}
    app=create_runtime(key=KEY,agent_factory=Agent)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,client=('127.0.0.1',1)),base_url='http://harness') as c:
        r=await c.post('/v1/chat/completions',headers={'authorization':'Bearer '+KEY},json={'messages':[{'role':'user','content':'Hi'}]})
        assert 'event: toolcalls' in r.text and 'usgs' in r.text
        assert 'coordinates' not in r.text and 'hide' not in r.text
        assert 'The reading is stale.' in r.text and '[DONE]' in r.text

def test_installed_hermes_result_envelope_is_normalized_for_guard():
    import json
    from entity_gate.hermes_runtime import evidence_document
    from entity_gate.guard_hook import build_sheet, toolcall_log
    reading={'id':'place/creek','property':'discharge','value':14.1,'unit':'cfs',
             'time':'2026-09-07T22:15:00Z','source_id':'cdss.telemetry','stale':False,
             'source_status':'ok','staleness_s':30,'coordinates':[1,2]}
    raw=json.dumps({'result':json.dumps(reading)})
    result=json.dumps(evidence_document(sanitize(raw)))
    assert 'coordinates' not in result
    messages=[{'role':'user','content':'Read'}, {'role':'tool','tool_call_id':'c1','content':result}]
    log=toolcall_log(messages)
    assert log['sources']==['cdss.telemetry']
    assert log['place_ids']==['place/creek']
    assert build_sheet(messages).atoms


def test_source_footer_preserves_each_gauges_provenance_pairing():
    import json
    from entity_gate.hermes_runtime import source_footer
    messages=[{'role':'assistant','tool_calls':[{'id':'c1','function':{'name':'get_place'}}]},
      {'role':'tool','tool_call_id':'c1','content':json.dumps({'places':[
          {'id':'place/upper','readings':[{'time':'2026-09-08T00:00:00Z','source_id':'cdss','stale':False,'source_status':'ok'}]},
          {'id':'place/lower','readings':[{'time':'2026-09-07T20:00:00Z','source_id':'usgs','stale':True,'source_status':'warning'}]},
      ]})}]
    rows=source_footer(messages)['calls']
    assert rows==[
       {'tool':'get_place','place_id':'place/upper','time':'2026-09-08T00:00:00Z','source_id':'cdss','stale':False,'source_status':'ok'},
       {'tool':'get_place','place_id':'place/lower','time':'2026-09-07T20:00:00Z','source_id':'usgs','stale':True,'source_status':'warning'}]


def test_source_footer_never_labels_configuration_as_live():
    from entity_gate.hermes_runtime import source_footer
    rows=source_footer([{'role':'tool','name':'get_entity_config','content':'{"members":12}'}])['calls']
    assert rows[0]['stale'] is None and rows[0]['source_status']=='unknown'
    assert rows[0]['time'] is None and rows[0]['source_id'] is None


def test_source_footer_is_bounded():
    from entity_gate.hermes_runtime import source_footer
    rows = [{'id': f'place/{i}', 'source_id': 'sensor', 'time': '2026-09-08T00:00:00Z'} for i in range(100)]
    result = source_footer([{'role':'tool','name':'get_place','content':{'places':rows}}])
    assert len(result['calls']) == 50
