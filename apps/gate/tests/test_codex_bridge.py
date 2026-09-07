import httpx
import pytest
from entity_gate.codex_bridge import create_bridge, chunks

KEY = 'local-test-secret-with-32-characters'

class Backend:
    def __init__(self):
        self.bodies = []
    async def events(self, body):
        self.bodies.append(body)
        if body['messages'][-1]['role'] == 'tool':
            yield {'type': 'response.output_text.delta', 'delta': 'Observed.'}
        else:
            yield {'type': 'response.output_item.added', 'output_index': 2,
                   'item': {'type': 'function_call', 'call_id': 'call_sensor', 'name': 'get_place'}}
            for part in ['{"id":', '"place/creek"}']:
                yield {'type': 'response.function_call_arguments.delta', 'output_index': 2, 'delta': part}
        yield {'type': 'response.completed', 'response': {'usage': {'input_tokens': 10,
               'output_tokens': 5, 'total_tokens': 15}}}

@pytest.mark.asyncio
async def test_tool_roundtrip_stream_and_usage():
    backend = Backend()
    app = create_bridge(KEY, backend=backend)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,
                                 client=('127.0.0.1', 2)), base_url='http://bridge') as client:
        headers = {'authorization': 'Bearer ' + KEY}
        first = await client.post('/v1/chat/completions', headers=headers,
                                  json={'messages': [{'role': 'user', 'content': 'Observe'}]})
        payload = first.json()
        call = payload['choices'][0]['message']['tool_calls'][0]
        assert call['id'] == 'call_sensor'
        assert call['function']['arguments'] == '{"id":"place/creek"}'
        assert payload['usage']['total_tokens'] == 15
        result = await client.post('/v1/chat/completions', headers=headers, json={
            'stream': True, 'messages': [{'role': 'user', 'content': 'Observe'},
             payload['choices'][0]['message'], {'role': 'tool', 'tool_call_id': call['id'],
                                              'content': '{"value":12}'}]})
        assert 'Observed.' in result.text and '[DONE]' in result.text
        assert backend.bodies[-1]['messages'][-1]['tool_call_id'] == 'call_sensor'

@pytest.mark.asyncio
async def test_auth_rejects_before_provider():
    backend = Backend()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_bridge(KEY, backend=backend),
                                client=('127.0.0.1', 2)), base_url='http://bridge') as client:
        assert (await client.post('/v1/chat/completions', json={})).status_code == 401
    assert not backend.bodies

@pytest.mark.asyncio
async def test_public_clients_denied_even_with_key():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_bridge(KEY),
                                client=('192.0.2.1', 2)), base_url='http://bridge') as client:
        assert (await client.post('/v1/chat/completions', headers={
            'authorization': 'Bearer ' + KEY}, json={})).status_code == 403

@pytest.mark.asyncio
async def test_truncated_stream_fails():
    async def events():
        yield {'type': 'response.output_text.delta', 'delta': 'Partial'}
    with pytest.raises(ValueError, match='without completion'):
        _ = [chunk async for chunk in chunks(events(), 'test')]
