"""An in-process fake vLLM: scripted streamed/non-streamed chat completions."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route


class FakeUpstream:
    def __init__(self, replies: list[str] | str = "OK.", *, reasoning: str = "",
                 tool_calls: list[dict] | None = None, hold: asyncio.Event | None = None,
                 piece: int = 5, usage: bool = True) -> None:
        self.replies = [replies] if isinstance(replies, str) else list(replies)
        self.reasoning = reasoning
        self.tool_calls = tool_calls
        self.hold = hold
        self.piece = piece
        self.usage = usage
        self.requests: list[dict[str, Any]] = []
        self.app = Starlette(routes=[
            Route("/v1/chat/completions", self.handle, methods=["POST"])])

    def _next_reply(self) -> str:
        if len(self.replies) > 1:
            return self.replies.pop(0)
        return self.replies[0]

    @staticmethod
    def _usage(prompt: int, completion: int) -> dict[str, int]:
        return {"prompt_tokens": prompt, "completion_tokens": completion,
                "total_tokens": prompt + completion}

    async def handle(self, request: Request):
        body = await request.json()
        self.requests.append(body)
        reply = self._next_reply()
        prompt_tokens = len(json.dumps(body)) // 4
        if body.get("stream"):
            return StreamingResponse(self._frames(reply, body, prompt_tokens),
                                     media_type="text/event-stream")
        if self.hold is not None:
            await self.hold.wait()
        msg: dict[str, Any] = {"role": "assistant", "content": reply}
        if self.tool_calls:
            msg = {"role": "assistant", "content": None, "tool_calls": self.tool_calls}
        return JSONResponse({
            "id": "chatcmpl-fake", "object": "chat.completion", "created": int(time.time()),
            "model": body.get("model", "fake"),
            "choices": [{"index": 0, "message": msg,
                         "finish_reason": "tool_calls" if self.tool_calls else "stop"}],
            "usage": self._usage(prompt_tokens, len(reply) // 4),
        })

    async def _frames(self, reply: str, body: dict[str, Any], prompt_tokens: int):
        if self.hold is not None:
            await self.hold.wait()
        env = {"id": "chatcmpl-fake", "object": "chat.completion.chunk",
               "created": int(time.time()), "model": body.get("model", "fake")}

        def chunk(delta: dict[str, Any], finish: str | None = None) -> bytes:
            return ("data: " + json.dumps({**env, "choices": [
                {"index": 0, "delta": delta, "finish_reason": finish}]}) + "\n\n").encode()

        yield chunk({"role": "assistant", "content": ""})
        if self.reasoning:
            yield chunk({"reasoning_content": self.reasoning})
        for i in range(0, len(reply), self.piece):
            yield chunk({"content": reply[i:i + self.piece]})
            await asyncio.sleep(0)
        if self.tool_calls:
            yield chunk({"tool_calls": self.tool_calls})
            yield chunk({}, "tool_calls")
        else:
            yield chunk({}, "stop")
        if self.usage:
            yield ("data: " + json.dumps({**env, "choices": [],
                                          "usage": self._usage(prompt_tokens, len(reply) // 4)})
                   + "\n\n").encode()
        yield b"data: [DONE]\n\n"
