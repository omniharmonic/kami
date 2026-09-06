"""Regex crisis detector over the latest user message (§10.4, T1.6).

A match replaces the reply with the crisis template (resources, never generated), is logged
as ``guard_event action=crisis``, and makes no upstream call.
"""

from __future__ import annotations

import json
import re
import time
import uuid

from .copy import CRISIS_TEMPLATE

_PHRASES = [
    r"kill(?:ing)?\s+myself",
    r"end(?:ing)?\s+my\s+(?:own\s+)?life",
    r"take\s+my\s+(?:own\s+)?life",
    r"suicid(?:e|al)",
    r"(?:want|wanted|wanting|going|plan(?:ning)?)\s+to\s+die",
    r"(?:don'?t|do\s+not|no\s+longer)\s+want\s+to\s+(?:live|be\s+alive|be\s+here|wake\s+up)",
    r"(?:hurt|harm|cut)(?:ing)?\s+myself",
    r"self[-\s]?harm",
    r"better\s+off\s+dead",
    r"no\s+reason\s+to\s+(?:live|go\s+on|keep\s+going)",
    r"end\s+it\s+all",
    r"(?:wish|wished)\s+i\s+(?:was|were)\s+dead",
    r"overdose\s+on",
]
CRISIS_RE = re.compile("|".join(f"(?:{p})" for p in _PHRASES), re.IGNORECASE)


def detect(text: str | None) -> str | None:
    """The matched phrase, or None."""
    if not text:
        return None
    m = CRISIS_RE.search(text)
    return m.group(0) if m else None


def _envelope(model: str | None) -> dict:
    return {"id": f"chatcmpl-gate-{uuid.uuid4().hex[:12]}", "created": int(time.time()),
            "model": model or "entity-gate"}


def nonstream_payload(model: str | None) -> dict:
    env = _envelope(model)
    return {
        **env,
        "object": "chat.completion",
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": CRISIS_TEMPLATE}}],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "kami_guard": {"status": "crisis"},
    }


def stream_frames(model: str | None) -> list[bytes]:
    env = _envelope(model)
    first = {**env, "object": "chat.completion.chunk",
             "choices": [{"index": 0, "delta": {"role": "assistant", "content": CRISIS_TEMPLATE},
                          "finish_reason": None}]}
    last = {**env, "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
    return [
        f"data: {json.dumps(first)}\n\n".encode(),
        f"data: {json.dumps(last)}\n\n".encode(),
        b"event: toolcalls\ndata: " + json.dumps({"calls": [], "guard": "crisis"}).encode()
        + b"\n\n",
        b"data: [DONE]\n\n",
    ]
