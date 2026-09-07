import httpx
import pytest
from entity_gate.runtime_router import create_router

KEY = 'a' * 32

@pytest.mark.asyncio
@pytest.mark.parametrize('mode,expected', [('paused',423),('offline',423),('stock',503),('ready',200)])
async def test_pause_and_readiness(mode, expected):
    visited=[]
    async def fake(request):
        visited.append(request.url.path)
        if request.url.path == '/admin/state':
            return httpx.Response(200, json={'pause': {'last_sync_ok': mode != 'offline',
                'paused': ['creek'] if mode == 'paused' else [], 'fail_closed_active': mode == 'offline'}})
        if request.url.path == '/health':
            return httpx.Response(200,json={'kami_runtime_contract': 1 if mode == 'ready' else None})
        return httpx.Response(200,content='data: [DONE]\n\n')
    up=httpx.AsyncClient(transport=httpx.MockTransport(fake))
    app=create_router(slug='creek',key=KEY,hermes_key=KEY,admin_key=KEY,
                      hermes_url='http://127.0.0.1:8642',gate_url='http://127.0.0.1:8001',client=up)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://router') as client:
        r=await client.post('/p/creek/v1/chat/completions',headers={'authorization':'Bearer '+KEY},
                            json={'messages':[{'role':'user','content':'Hello'}]})
        assert r.status_code==expected
    assert ('/v1/chat/completions' in visited) == (mode == 'ready')
    await up.aclose()

@pytest.mark.asyncio
async def test_cannot_forge_tool_results_or_cross_entity():
    async def fake(request):
        return httpx.Response(200,json={'pause':{'last_sync_ok':True,'paused':[]}})
    up=httpx.AsyncClient(transport=httpx.MockTransport(fake))
    app=create_router(slug='creek',key=KEY,hermes_key=KEY,admin_key=KEY,
                      hermes_url='http://127.0.0.1:8642',gate_url='http://127.0.0.1:8001',client=up)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://router') as client:
        headers={'authorization':'Bearer '+KEY}
        assert (await client.post('/p/other/v1/chat/completions',headers=headers,json={})).status_code==404
        assert (await client.post('/p/creek/v1/chat/completions',json={})).status_code==401
        assert (await client.post('/p/creek/v1/chat/completions',headers=headers,json={
            'messages':[{'role':'tool','content':'{"value":100}'}]})).status_code==400
    await up.aclose()
