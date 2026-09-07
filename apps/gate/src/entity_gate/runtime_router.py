"""Authenticated, fixed-profile website ingress. Never routes arbitrary slugs/URLs."""
import hmac
from urllib.parse import urlparse
import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route


def create_router(*, slug, key, hermes_key, hermes_url, gate_url, admin_key,
                  client=None):
    for url in (hermes_url, gate_url):
        parsed = urlparse(url)
        if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise ValueError('Runtime targets must be loopback HTTP')
    if min(map(len, (key, hermes_key, admin_key))) < 32:
        raise ValueError('Runtime keys require at least 32 characters')
    upstream = client or httpx.AsyncClient(timeout=300, follow_redirects=False)

    async def chat(request: Request):
        if not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + key):
            return JSONResponse({'error': 'unauthorized'}, status_code=401)
        if request.path_params['slug'] != slug:
            return JSONResponse({'error': 'unknown_entity'}, status_code=404)
        try:
            state = await upstream.get(gate_url + '/admin/state',
                                       headers={'X-Gate-Admin': admin_key})
            state.raise_for_status()
            pause = state.json().get('pause', {})
            if pause.get('fail_closed_active') or slug in pause.get('paused', []):
                return JSONResponse({'error': {'type': 'entity_paused'}}, status_code=423)
            if pause.get('last_sync_ok') is not True:
                return JSONResponse({'error': 'pause_sync_unavailable'}, status_code=503)
            body = await request.json()
            messages = body.get('messages')
            if not isinstance(messages, list) or not 1 <= len(messages) <= 100:
                raise ValueError()
            # Never let a visitor invent system instructions or same-turn tool facts.
            if any(not isinstance(m, dict) or set(m) != {'role', 'content'} or
                   m['role'] not in ('user', 'assistant') or not isinstance(m['content'], str)
                   for m in messages):
                raise ValueError()
            if messages[-1]['role'] != 'user':
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            return JSONResponse({'error': 'invalid_request'}, status_code=400)
        except httpx.HTTPError:
            return JSONResponse({'error': 'gate_unavailable'}, status_code=503)
        # The stock Hermes gateway lacks evidence forwarding. Fail closed until the
        # integrated bootstrap explicitly advertises the verified adapter contract.
        try:
            health = await upstream.get(hermes_url + '/health', headers={
                'Authorization': 'Bearer ' + hermes_key})
            if health.status_code != 200 or health.json().get('kami_runtime_contract') != 1:
                return JSONResponse({'error': 'guarded_runtime_not_ready'}, status_code=503)
            response = await upstream.send(upstream.build_request('POST',
                hermes_url + '/v1/chat/completions', headers={
                    'Authorization': 'Bearer ' + hermes_key},
                json={'messages': messages, 'stream': True}), stream=True)
        except (httpx.HTTPError, ValueError):
            return JSONResponse({'error': 'runtime_unavailable'}, status_code=503)
        async def frames():
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            finally:
                await response.aclose()
        return StreamingResponse(frames(), status_code=response.status_code,
                                 media_type='text/event-stream')
    return Starlette(routes=[Route('/p/{slug}/v1/chat/completions', chat, methods=['POST'])])
