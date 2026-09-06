"""A tiny in-process OpenAI-compatible fake (same pattern as ``apps/gate/tests/fake_upstream.py``).

The live runner is driven against this over ``httpx.ASGITransport`` — nothing reaches a GPU, the
gate, or the twin. ``reply_for`` decides what the fake says for a given request, so a test can
script an honest model, a hallucinating one, or one that calls tools.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

Reply = str | dict[str, Any]


class FakeEndpoint:
    """``reply_for(body) -> str`` (content) or ``{"content": ..., "tool_calls": [...]}``."""

    def __init__(self, reply_for: Callable[[dict[str, Any]], Reply] | Reply = "OK.") -> None:
        self.reply_for = reply_for if callable(reply_for) else (lambda _b, r=reply_for: r)
        self.requests: list[dict[str, Any]] = []
        self.app = Starlette(routes=[
            Route("/v1/chat/completions", self.handle, methods=["POST"]),
            Route("/p/{slug}/v1/chat/completions", self.handle, methods=["POST"]),
        ])

    async def handle(self, request: Request) -> JSONResponse:
        body = await request.json()
        self.requests.append(body)
        out = self.reply_for(body)
        if isinstance(out, str):
            out = {"content": out}
        message: dict[str, Any] = {"role": "assistant", "content": out.get("content")}
        if out.get("tool_calls"):
            message["tool_calls"] = out["tool_calls"]
        return JSONResponse({
            "id": "chatcmpl-fake", "object": "chat.completion", "created": int(time.time()),
            "model": body.get("model", "fake"),
            "choices": [{"index": 0, "message": message,
                         "finish_reason": "tool_calls" if out.get("tool_calls") else "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
        })

    @staticmethod
    def tool_call(name: str, arguments: dict[str, Any] | str, cid: str = "call_x") -> dict:
        args = arguments if isinstance(arguments, str) else json.dumps(arguments)
        return {"id": cid, "type": "function",
                "function": {"name": name, "arguments": args}}

    def last_user_question(self) -> str:
        for m in reversed(self.requests[-1]["messages"]):
            if m.get("role") == "user":
                return m.get("content", "")
        return ""
