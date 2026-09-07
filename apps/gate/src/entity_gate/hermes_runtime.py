"""Dedicated Hermes harness, with gate-only model routing and source evidence.

The bootstrap uses only the two configured MCP toolsets; no terminal, browser,
file, delegation, memory or provider fallback is available to website visitors.
"""
from __future__ import annotations
import asyncio
import hmac
import json
import uuid
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route
from .guard_hook import toolcall_log
from .stream import sse

FORBIDDEN_KEYS = {'coordinates', 'bbox', 'centroid', 'geometry', 'authorization',
                  'api_key', 'access_token', 'refresh_token', 'token', 'secret'}


def sanitize(value):
    if isinstance(value, dict):
        return {k: sanitize(v) for k, v in value.items() if k.lower() not in FORBIDDEN_KEYS}
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return value
        if isinstance(parsed, (dict, list)):
            return json.dumps(sanitize(parsed), ensure_ascii=False)
    return value


def evidence_document(value):
    if isinstance(value, str):
        try:
            return evidence_document(json.loads(value))
        except ValueError:
            return {}
    if isinstance(value, dict) and 'result' in value and set(value).issubset({'result','structuredContent'}):
        return evidence_document(value.get('structuredContent') or value['result'])
    if isinstance(value, dict) and isinstance(value.get('content'), list):
        return [evidence_document(p.get('text', '')) for p in value['content']
                if isinstance(p, dict) and p.get('type') == 'text']
    return value


def install_mcp_sanitizer():
    """Wrap handlers before discovery; also covers later reconnect registration."""
    import tools.mcp_tool as mcp
    original = mcp._make_tool_handler
    def factory(*args, **kwargs):
        handler = original(*args, **kwargs)
        server, tool = args[:2]
        def safe_handler(*a, **kw):
            if server == 'kami-platform' and not tool.startswith(('get_', 'list_')):
                return json.dumps({'error': 'Website chat is read-only; use the steward agent for proposals.'})
            raw = sanitize(handler(*a, **kw))
            # Hermes wraps MCP JSON as a JSON string in result. Unwrap that
            # envelope before factguard sees it; retain the published object.
            normalized = evidence_document(raw)
            return json.dumps(normalized) if normalized != {} else raw
        return safe_handler
    mcp._make_tool_handler = factory
    names = mcp.discover_mcp_tools()
    required = ('get_entity_config', 'get_place')
    if any(not any(n.endswith(suffix) for n in names) for suffix in required):
        raise RuntimeError('Both platform and twin MCP tools must be discovered before startup')
    return names


def hermes_factory(*, gate_base, gate_key, soul, toolsets):
    from run_agent import AIAgent
    def create(on_delta, on_complete):
        agent = AIAgent(
            model='beings-guarded', provider='custom', api_mode='chat_completions',
            base_url=gate_base, api_key=gate_key,
            enabled_toolsets=toolsets, fallback_model=None, credential_pool=None,
            max_iterations=12, quiet_mode=True, verbose_logging=False,
            skip_context_files=True, skip_memory=True, save_trajectories=False,
            ephemeral_system_prompt=soul,
            stream_delta_callback=on_delta, tool_complete_callback=on_complete,
            session_id='beings-' + uuid.uuid4().hex,
        )
        # Fail before the first round if installed Hermes rewrites the configured provider.
        if str(getattr(agent, 'base_url', '')).rstrip('/') != gate_base.rstrip('/'):
            raise RuntimeError('Hermes changed the guarded model endpoint')
        if getattr(agent, 'api_mode', None) != 'chat_completions':
            raise RuntimeError('Hermes changed the guarded API mode')
        # Extended conversations fail at the context limit rather than invoking
        # a separately configured auxiliary summarizer outside this gate.
        agent.compression_enabled = False
        agent._skill_nudge_interval = 0
        agent.tools = [t for t in agent.tools if 'kami_platform' not in t['function']['name'] or
                       any('_'+prefix in t['function']['name'] for prefix in ('get_', 'list_'))]
        agent.valid_tool_names = {t['function']['name'] for t in agent.tools}
        return agent
    return create


def create_runtime(*, key, agent_factory):
    if len(key) < 32:
        raise ValueError('Runtime key requires at least 32 characters')
    # Installed Hermes has process-global caches; serialize turns for this profile.
    turn_lock = asyncio.Lock()
    def authorized(request):
        return (request.client and request.client.host in ('127.0.0.1', '::1') and
                hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer '+key))

    async def health(request):
        if not authorized(request):
            return JSONResponse({'error':'unauthorized'},status_code=401)
        return JSONResponse({'kami_runtime_contract':1, 'guarded': True, 'evidence':True})

    async def chat(request: Request):
        if not authorized(request):
            return JSONResponse({'error':'unauthorized'},status_code=401)
        try:
            body=await request.json()
            messages=body['messages']
            if not isinstance(messages,list) or not 1 <= len(messages) <= 100:
                raise ValueError()
            if sum(len(str(m.get('content',''))) for m in messages if isinstance(m,dict)) > 64000:
                raise ValueError()
            if any(not isinstance(m,dict) or set(m) != {'role','content'} or
                   m['role'] not in ('user','assistant') or not isinstance(m['content'],str)
                   for m in messages) or messages[-1]['role'] != 'user':
                raise ValueError()
        except (ValueError,KeyError,TypeError):
            return JSONResponse({'error':'invalid_request'},status_code=400)
        loop=asyncio.get_running_loop()
        queue=asyncio.Queue()
        evidence=[]
        active={'agent':None, 'disconnected':False}
        def emit(delta):
            if delta:
                loop.call_soon_threadsafe(queue.put_nowait, sse({'choices':[{'index':0,
                    'delta':{'content':str(delta)},'finish_reason':None}]}))
        def complete(call_id,name,args,result):
            # Full tool result never leaves the service; footer carries allowlisted metadata.
            evidence.extend([{'role':'assistant','tool_calls':[{'id':call_id,
                'function':{'name':name,'arguments':'{}'}}]},
                {'role':'tool','tool_call_id':call_id,'content':json.dumps(evidence_document(sanitize(result)))}])
        def run():
            if active['disconnected']:
                return
            agent=agent_factory(emit,complete)
            active['agent']=agent
            if active['disconnected']:
                agent.interrupt()
                return
            result=agent.run_conversation(messages[-1]['content'],conversation_history=messages[:-1])
            # Hermes returns failures as dictionaries on several paths.
            if isinstance(result,dict) and result.get('error'):
                raise RuntimeError('Agent turn failed')
        async def work():
            async with turn_lock:
                try:
                    await asyncio.to_thread(run)
                    await queue.put(sse(toolcall_log([{'role':'user','content':''}]+evidence),'toolcalls'))
                    await queue.put(sse('[DONE]'))
                except Exception:
                    await queue.put(sse({'error':{'type':'runtime_error','message':'Agent unavailable'}}))
                finally:
                    await queue.put(None)
        task=asyncio.create_task(work())
        async def frames():
            try:
                while True:
                    frame=await queue.get()
                    if frame is None:
                        break
                    yield frame
                await task
            finally:
                if not task.done():
                    active['disconnected']=True
                    if active['agent'] is not None:
                        active['agent'].interrupt()
                    # Do not cancel the to_thread task: retain its turn lock until
                    # Hermes exits, preventing overlapping process-global state.
        return StreamingResponse(frames(),media_type='text/event-stream')
    return Starlette(routes=[Route('/health',health),Route('/v1/chat/completions',chat,methods=['POST'])])
