"""Building the fact sheet from a request, the tool-call log, and the non-stream guard path."""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
from factguard import FactSheet, Gazetteer, GuardResult, guard_text
from factguard.atoms import PLACE_ID_RE, content_text, parse_json_text

from .copy import FALLBACK, GUARD_REGENERATE_SYSTEM

_PLACE_IN_TEXT_RE = re.compile(r"\b[a-z_]+/[a-z0-9-]+\b")


def build_sheet(messages: list[dict[str, Any]]) -> FactSheet:
    """Atoms from tool messages after the last user message + the KAMI_ENTITY_CONFIG block."""
    return FactSheet.from_tool_messages(messages, include_config=True)


def last_user_text(messages: list[dict[str, Any]]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            return content_text(m.get("content"))
    return ""


def _args_summary(arguments: Any, limit: int = 120) -> str:
    if isinstance(arguments, str):
        doc = parse_json_text(arguments)
        text = json.dumps(doc, ensure_ascii=False) if doc is not None else arguments
    else:
        text = json.dumps(arguments, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _collect(node: Any, out: dict[str, set]) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("place_id", "id", "parent_id", "anchor") and isinstance(v, str) \
                    and PLACE_ID_RE.match(v):
                out["place_ids"].add(v)
            elif k == "time" and isinstance(v, str):
                out["times"].add(v)
            elif k == "source_id" and isinstance(v, str):
                out["sources"].add(v)
            elif k == "stale" and v is True:
                out["stale"].add(True)
            if isinstance(v, (dict, list)):
                _collect(v, out)
    elif isinstance(node, list):
        for item in node:
            _collect(item, out)


def toolcall_log(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """The turn's tool-call log for the "what I looked at" footer (ADR-E13)."""
    last_user = -1
    for i, m in enumerate(messages):
        if m.get("role") == "user":
            last_user = i
    calls: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for m in messages[last_user + 1:]:
        if m.get("role") == "assistant":
            for tc in m.get("tool_calls") or []:
                fn = tc.get("function") or {}
                cid = tc.get("id") or f"call_{len(order)}"
                calls[cid] = {"id": cid, "name": fn.get("name"),
                              "args": _args_summary(fn.get("arguments", "")),
                              "place_ids": [], "times": [], "sources": [], "stale": False}
                order.append(cid)
        elif m.get("role") == "tool":
            cid = m.get("tool_call_id")
            if cid not in calls:
                cid = cid or f"call_{len(order)}"
                calls[cid] = {"id": cid, "name": m.get("name"), "args": "",
                              "place_ids": [], "times": [], "sources": [], "stale": False}
                order.append(cid)
            doc = parse_json_text(content_text(m.get("content")))
            acc: dict[str, set] = {"place_ids": set(), "times": set(), "sources": set(),
                                   "stale": set()}
            if doc is not None:
                _collect(doc, acc)
            entry = calls[cid]
            entry["place_ids"] = sorted(acc["place_ids"])
            entry["times"] = sorted(acc["times"])
            entry["sources"] = sorted(acc["sources"])
            entry["stale"] = bool(acc["stale"])
    entries = [calls[c] for c in order]
    return {
        "calls": entries,
        "place_ids": sorted({p for e in entries for p in e["place_ids"]}),
        "times": sorted({t for e in entries for t in e["times"]}),
        "sources": sorted({s for e in entries for s in e["sources"]}),
        "stale": any(e["stale"] for e in entries),
    }


# ---------------------------------------------------------------------------------------
# non-stream path (cron, memos, donor reports): regenerate once, then hold
# ---------------------------------------------------------------------------------------
@dataclass
class NonStreamOutcome:
    status_code: int
    payload: dict[str, Any]
    guard_status: str  # ok | held | passthrough | tool_calls | upstream_error
    prompt_tokens: int = 0
    output_tokens: int = 0
    attempts: int = 0
    violations: list[str] = field(default_factory=list)
    guard_results: list[GuardResult] = field(default_factory=list)

    @property
    def headers(self) -> dict[str, str]:
        return {"X-Guard": self.guard_status}


def _content_of(payload: dict[str, Any]) -> str | None:
    try:
        msg = payload["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return None
    if msg.get("tool_calls"):
        return None
    return content_text(msg.get("content")) if msg.get("content") is not None else ""


def _usage(payload: dict[str, Any]) -> tuple[int, int]:
    u = payload.get("usage") or {}
    return int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)


async def run_nonstream(body: dict[str, Any], upstream: httpx.AsyncClient, url: str, *,
                        sheet: FactSheet, last_user: str, gazetteer: Gazetteer | None,
                        tz: str, now: datetime | None = None, passthrough: bool = False,
                        timeout: float = 300,
                        headers: dict[str, str] | None = None) -> NonStreamOutcome:
    body = copy.deepcopy(body)
    body["stream"] = False
    body.pop("stream_options", None)
    prompt_total = output_total = 0
    outcome_results: list[GuardResult] = []

    async def call(b: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        resp = await upstream.post(url, json=b, timeout=timeout, headers=headers or None)
        try:
            payload = resp.json()
        except ValueError:
            payload = {"error": {"message": resp.text[:500], "type": "upstream_error"}}
        return resp.status_code, payload

    status, payload = await call(body)
    if status != 200:
        return NonStreamOutcome(status if status >= 400 else 502, payload, "upstream_error")
    p, o = _usage(payload)
    prompt_total += p
    output_total += o
    content = _content_of(payload)
    if content is None:
        payload["kami_guard"] = {"status": "tool_calls"}
        return NonStreamOutcome(200, payload, "tool_calls", prompt_total, output_total, 1)
    if passthrough:
        payload["kami_guard"] = {"status": "passthrough"}
        return NonStreamOutcome(200, payload, "passthrough", prompt_total, output_total, 1)

    g1 = guard_text(content, sheet, last_user, now=now, tz=tz, gazetteer=gazetteer)
    outcome_results.append(g1)
    if g1.ok:
        payload["kami_guard"] = {"status": "ok", "attempts": 1}
        return NonStreamOutcome(200, payload, "ok", prompt_total, output_total, 1,
                                guard_results=outcome_results)

    # one regeneration with the violation list as a system message
    retry = copy.deepcopy(body)
    retry.setdefault("messages", []).append({
        "role": "system",
        "content": GUARD_REGENERATE_SYSTEM.format(
            violations="\n".join(f"- {v}" for v in g1.violations)),
    })
    status, payload2 = await call(retry)
    if status != 200:
        return NonStreamOutcome(status if status >= 400 else 502, payload2, "upstream_error",
                                prompt_total, output_total, 2, g1.violations, outcome_results)
    p, o = _usage(payload2)
    prompt_total += p
    output_total += o
    content2 = _content_of(payload2)
    g2 = guard_text(content2 or "", sheet, last_user, now=now, tz=tz, gazetteer=gazetteer) \
        if content2 is not None else None
    if g2 is not None:
        outcome_results.append(g2)
    if g2 is not None and g2.ok:
        payload2["kami_guard"] = {"status": "ok", "attempts": 2,
                                  "first_pass_violations": g1.violations}
        return NonStreamOutcome(200, payload2, "ok", prompt_total, output_total, 2,
                                guard_results=outcome_results)

    violations = g1.violations + (g2.violations if g2 is not None else [])
    held = payload2
    try:
        held["choices"][0]["message"]["content"] = FALLBACK
        held["choices"][0]["message"].pop("tool_calls", None)
        held["choices"][0]["finish_reason"] = "stop"
    except (KeyError, IndexError, TypeError):
        held = {"choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": FALLBACK}}]}
    held["kami_guard"] = {"status": "held", "violations": violations, "attempts": 2,
                          "guarded_text": g2.final_text if g2 is not None else FALLBACK}
    return NonStreamOutcome(200, held, "held", prompt_total, output_total, 2, violations,
                            outcome_results)
