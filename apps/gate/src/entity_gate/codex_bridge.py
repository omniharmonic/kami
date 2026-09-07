"""Loopback-only Chat Completions bridge to the installed Hermes Codex transport.

Run in the Hermes venv; credentials stay in Hermes's refreshable auth store.
The only caller is entity-gate, authenticated with a separate local bridge key.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import time
import uuid
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from .stream import sse


class HermesCodexBackend:
    async def events(self, body):
        from agent.transports.codex import ResponsesApiTransport
        from hermes_cli.auth import resolve_codex_runtime_credentials
        from openai import AsyncOpenAI

        credentials = await asyncio.to_thread(resolve_codex_runtime_credentials,
                                               refresh_if_expiring=True)
        # Do not allow an environment override to exfiltrate OAuth credentials.
        base = credentials['base_url'].rstrip('/')
        if base != 'https://chatgpt.com/backend-api/codex':
            raise ValueError('Unsupported Codex credential endpoint')
        kwargs = ResponsesApiTransport().build_kwargs(
            body['model'], body['messages'], body.get('tools'),
            is_codex_backend=True, provider='openai-codex', base_url=base,
            replay_encrypted_reasoning=False,
            reasoning_config={'effort': body.get('reasoning_effort', 'low')},
        )
        async with AsyncOpenAI(api_key=credentials['api_key'], base_url=base,
                               timeout=300, max_retries=0) as client:
            async with client.responses.stream(**kwargs) as stream:
                async for event in stream:
                    yield event.model_dump()


async def chunks(events, model):
    """Preserve call_id linkage and incremental arguments; never expose reasoning."""
    envelope = {'id': 'chatcmpl-' + uuid.uuid4().hex, 'object': 'chat.completion.chunk',
                'created': int(time.time()), 'model': model}
    calls = {}
    completed = False
    async for event in events:
        kind = event.get('type')
        delta: dict[str, Any] | None = None
        if kind == 'response.output_text.delta':
            delta = {'content': event.get('delta', '')}
        elif kind == 'response.output_item.added':
            item = event.get('item', {})
            if item.get('type') == 'function_call':
                index = len(calls)
                calls[event['output_index']] = index
                delta = {'tool_calls': [{'index': index, 'id': item['call_id'],
                         'type': 'function', 'function': {'name': item['name'],
                                                        'arguments': ''}}]}
        elif kind == 'response.function_call_arguments.delta':
            if event.get('output_index') not in calls:
                raise ValueError('Orphan function argument delta')
            delta = {'tool_calls': [{'index': calls[event['output_index']],
                     'function': {'arguments': event.get('delta', '')}}]}
        elif kind == 'response.completed':
            completed = True
            response = event.get('response', {})
            usage = response.get('usage') or {}
            yield {**envelope, 'choices': [{'index': 0, 'delta': {},
                   'finish_reason': 'tool_calls' if calls else 'stop'}],
                   'usage': {'prompt_tokens': usage.get('input_tokens', 0),
                             'completion_tokens': usage.get('output_tokens', 0),
                             'total_tokens': usage.get('total_tokens', 0)}}
        elif kind in ('response.failed', 'response.incomplete', 'error'):
            raise ValueError('Codex response did not complete')
        if delta is not None:
            yield {**envelope, 'choices': [{'index': 0, 'delta': delta, 'finish_reason': None}]}
    if not completed:
        raise ValueError('Codex stream ended without completion')


def create_bridge(key: str, *, model='gpt-5.6-luna', backend=None):
    if len(key) < 32:
        raise ValueError('Bridge key must have at least 32 characters')
    backend = backend or HermesCodexBackend()

    async def chat(request: Request):
        if not request.client or request.client.host not in ('127.0.0.1', '::1'):
            return JSONResponse({'error': 'loopback_only'}, status_code=403)
        if not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + key):
            return JSONResponse({'error': 'unauthorized'}, status_code=401)
        try:
            body = await request.json()
            if not isinstance(body, dict) or not isinstance(body.get('messages'), list):
                raise ValueError()
            body['model'] = model
        except (ValueError, TypeError):
            return JSONResponse({'error': 'invalid_request'}, status_code=400)
        if body.get('stream'):
            async def frames():
                try:
                    async for chunk in chunks(backend.events(body), model):
                        yield sse(chunk)
                    yield sse('[DONE]')
                except Exception:
                    # Provider exceptions can contain auth headers. Never serialize them.
                    yield sse({'error': {'type': 'upstream_error',
                                         'message': 'Codex stream unavailable'}})
            return StreamingResponse(frames(), media_type='text/event-stream')
        try:
            content = ''
            calls = {}
            last = None
            async for chunk in chunks(backend.events(body), model):
                last = chunk
                delta = chunk['choices'][0]['delta']
                content += delta.get('content', '')
                for call in delta.get('tool_calls', []):
                    index = call['index']
                    if index not in calls:
                        calls[index] = {'id': call['id'], 'type': 'function',
                                        'function': {'name': call['function']['name'], 'arguments': ''}}
                    calls[index]['function']['arguments'] += call['function'].get('arguments', '')
            assert last
            message = {'role': 'assistant', 'content': content or None}
            if calls:
                message['tool_calls'] = list(calls.values())
            return JSONResponse({**last, 'object': 'chat.completion', 'choices': [
                {'index': 0, 'message': message, 'finish_reason': 'tool_calls' if calls else 'stop'}]})
        except Exception:
            return JSONResponse({'error': 'Codex unavailable'}, status_code=502)

    return Starlette(routes=[Route('/v1/chat/completions', chat, methods=['POST'])])
