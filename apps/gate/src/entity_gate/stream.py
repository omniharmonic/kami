"""Streaming path: forward to upstream with ``stream: true``, guard sentence by sentence.

Upstream SSE ``data:`` chunks are parsed; ``delta.content`` is fed to the factguard sentence
splitter and released sentences are re-emitted as OpenAI-format chunks; ``tool_calls`` deltas
pass through untouched; ``reasoning_content`` is dropped from the client stream. At the end
the gate line (if any) is emitted, then ``event: toolcalls`` with the turn's tool-call log,
then ``data: [DONE]``.
"""

from __future__ import annotations

import copy
import json
import time
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
from factguard import StreamingGuard


def sse(data: Any, event: str | None = None) -> bytes:
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    head = f"event: {event}\n" if event else ""
    return f"{head}data: {payload}\n\n".encode()


class _Envelope:
    def __init__(self, model: str | None) -> None:
        self.id = f"chatcmpl-gate-{uuid.uuid4().hex[:12]}"
        self.created = int(time.time())
        self.model = model or "entity-gate"

    def adopt(self, chunk: dict[str, Any]) -> None:
        self.id = chunk.get("id") or self.id
        self.created = chunk.get("created") or self.created
        self.model = chunk.get("model") or self.model

    def content_chunk(self, text: str, finish_reason: str | None = None) -> dict[str, Any]:
        return {"id": self.id, "object": "chat.completion.chunk", "created": self.created,
                "model": self.model,
                "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}]}

    def finish_chunk(self, finish_reason: str) -> dict[str, Any]:
        return {"id": self.id, "object": "chat.completion.chunk", "created": self.created,
                "model": self.model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}]}


async def _sse_data_lines(resp: httpx.Response) -> AsyncIterator[str]:
    """Yield the concatenated ``data:`` payload of each SSE event."""
    buf: list[str] = []
    async for raw in resp.aiter_lines():
        line = raw.rstrip("\r")
        if line == "":
            if buf:
                yield "\n".join(buf)
                buf = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("data:"):
            buf.append(line[5:].lstrip())
    if buf:
        yield "\n".join(buf)


async def guarded_stream(body: dict[str, Any], upstream: httpx.AsyncClient, url: str, *,
                         guard: StreamingGuard | None, toolcalls: dict[str, Any],
                         on_done: Callable[[dict[str, Any]], None] | None = None,
                         timeout: float = 300,
                         headers: dict[str, str] | None = None) -> AsyncIterator[bytes]:
    """Async generator of SSE frames for the client."""
    req = copy.deepcopy(body)
    req["stream"] = True
    so = dict(req.get("stream_options") or {})
    so["include_usage"] = True
    req["stream_options"] = so

    env = _Envelope(req.get("model"))
    usage: dict[str, Any] = {}
    finish_reason: str | None = None
    saw_tool_calls = False
    raw_chars = 0
    summary: dict[str, Any] = {"status": "ok", "released": 0, "dropped": 0, "error": None}

    try:
        async with upstream.stream("POST", url, json=req, timeout=timeout,
                                   headers=headers or None) as resp:
            if resp.status_code != 200:
                text = (await resp.aread()).decode("utf-8", "replace")
                summary["status"] = "upstream_error"
                summary["error"] = f"{resp.status_code}: {text[:300]}"
                yield sse({"error": {"message": "upstream error", "type": "upstream_error",
                                     "status": resp.status_code}})
                yield sse("[DONE]")
                return
            async for data in _sse_data_lines(resp):
                if data.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                env.adopt(chunk)
                if chunk.get("usage"):
                    usage = chunk["usage"]
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                choice = choices[0]
                delta = choice.get("delta") or {}
                if "reasoning_content" in delta or "reasoning" in delta:
                    delta = {k: v for k, v in delta.items()
                             if k not in ("reasoning_content", "reasoning")}
                    choice = {**choice, "delta": delta}
                    chunk = {**chunk, "choices": [choice]}
                if delta.get("tool_calls"):
                    saw_tool_calls = True
                    yield sse(chunk)
                    if choice.get("finish_reason"):
                        finish_reason = choice["finish_reason"]
                    continue
                content = delta.get("content")
                if content:
                    raw_chars += len(content)
                    if guard is None:
                        yield sse(chunk)
                    else:
                        for seg in guard.feed(content):
                            yield sse(env.content_chunk(seg))
                elif delta.get("role") is not None or (delta and not choice.get("finish_reason")):
                    yield sse(chunk)  # role announcement / empty delta
                if choice.get("finish_reason"):
                    finish_reason = choice["finish_reason"]
    except httpx.HTTPError as exc:
        summary["status"] = "upstream_error"
        summary["error"] = repr(exc)
        yield sse({"error": {"message": "upstream unreachable", "type": "upstream_error"}})
        yield sse("[DONE]")
        if on_done:
            on_done({**summary, "usage": usage, "raw_chars": raw_chars})
        return

    if guard is not None:
        tail = guard.finish()
        if tail:
            yield sse(env.content_chunk(tail))
        summary["released"] = len([s for s in guard.result.released if s.strip()])
        summary["dropped"] = len(guard.result.dropped)
        summary["events"] = guard.result.events
        summary["stale_lines"] = guard.result.stale_lines
        summary["final_text"] = guard.result.final_text
    if finish_reason is None:
        finish_reason = "tool_calls" if saw_tool_calls else "stop"
    yield sse(env.finish_chunk(finish_reason))
    if usage:
        yield sse({"id": env.id, "object": "chat.completion.chunk", "created": env.created,
                   "model": env.model, "choices": [], "usage": usage})
    yield sse({**toolcalls, "guard": {"released": summary.get("released"),
                                      "dropped": summary.get("dropped")}}, event="toolcalls")
    yield sse("[DONE]")
    if on_done:
        on_done({**summary, "usage": usage, "raw_chars": raw_chars})
