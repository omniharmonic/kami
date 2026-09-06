"""``python -m entity_gate.check_upstream --config gate.yaml`` — is this upstream usable?

Run this **before** anything else when pointing the gate at a new provider. Hosted
OpenAI-compatible endpoints agree on the URL and disagree on everything that matters here:
whether they emit a well-formed ``tool_calls`` array, whether they stream, whether they
return a ``usage`` object. The gate needs all four; the first two are fatal.

    a) answers at all      — a 200 with a choices array          FAIL → exit 1
    b) returns a tool call  — choices[0].message.tool_calls[0]   FAIL → exit 1
    c) streams              — SSE chunks and a [DONE]            warn
    d) reports usage        — usage.prompt_tokens / completion   warn

(c) and (d) warn rather than fail because the gate degrades honestly without them: a
non-streaming provider makes chat feel slow, and a provider with no usage object makes the
daily budget fall back to a character-count estimate. A provider that cannot call a tool
cannot be a kami — every number it says has to come from a tool result (ADR-E04).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from .config import GateConfig, load_config

CHAT_PATH = "/v1/chat/completions"

PROBE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_entity_status",
        "description": "Current readings for one ecological entity. Call this before answering.",
        "parameters": {
            "type": "object",
            "properties": {
                "entity": {"type": "string",
                           "description": "entity id, e.g. entity/boulder-creek"},
            },
            "required": ["entity"],
        },
    },
}

PROBE_MESSAGES: list[dict[str, str]] = [
    {"role": "system",
     "content": "You answer only from tool results. Call get_entity_status before replying."},
    {"role": "user", "content": "Call get_entity_status for entity/boulder-creek."},
]

PASS, WARN, FAIL = "PASS", "WARN", "FAIL"


@dataclass
class Check:
    key: str
    label: str
    status: str
    detail: str

    @property
    def fatal(self) -> bool:
        return self.status == FAIL and self.key in ("answers", "tool_call")


@dataclass
class Report:
    checks: list[Check]

    @property
    def exit_code(self) -> int:
        return 1 if any(c.fatal for c in self.checks) else 0

    def get(self, key: str) -> Check | None:
        return next((c for c in self.checks if c.key == key), None)


def probe_body(model: str, *, stream: bool) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model, "messages": [dict(m) for m in PROBE_MESSAGES],
        "tools": [PROBE_TOOL], "tool_choice": "auto",
        "max_tokens": 128, "temperature": 0, "stream": stream,
    }
    if stream:
        body["stream_options"] = {"include_usage": True}
    return body


def _tool_call_of(payload: dict[str, Any]) -> tuple[str | None, str]:
    """(name, detail) for the first tool call in a non-streamed completion."""
    try:
        message = payload["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return None, "no choices[0].message in the reply"
    calls = message.get("tool_calls")
    if not calls:
        said = (message.get("content") or "").strip().replace("\n", " ")
        return None, (f"answered in prose instead of calling the tool: {said[:120]!r}"
                      if said else "no tool_calls and no content")
    fn = (calls[0] or {}).get("function") or {}
    name = fn.get("name")
    if not name:
        return None, f"tool_calls[0] has no function.name: {json.dumps(calls[0])[:160]}"
    args = fn.get("arguments")
    if isinstance(args, str):
        try:
            json.loads(args or "{}")
        except ValueError:
            return None, f"{name} arguments are not JSON: {args[:120]!r}"
    elif args is not None and not isinstance(args, dict):
        return None, f"{name} arguments are neither a JSON string nor an object"
    return name, f"{name}({args if isinstance(args, str) else json.dumps(args or {})})"


def _usage_detail(usage: Any) -> tuple[bool, str]:
    if not isinstance(usage, dict):
        return False, "no usage object"
    prompt = usage.get("prompt_tokens")
    completion = usage.get("completion_tokens")
    if prompt is None and completion is None:
        return False, f"usage present but empty: {json.dumps(usage)[:120]}"
    return True, f"prompt_tokens={prompt}, completion_tokens={completion}"


async def run_check(config: GateConfig, client: httpx.AsyncClient, *, model: str,
                    env: dict[str, str] | None = None) -> Report:
    headers = config.upstream_request_headers(env)
    url = CHAT_PATH if client.base_url else config.upstream_url + CHAT_PATH
    timeout = config.timeout_s
    checks: list[Check] = []
    payload: dict[str, Any] = {}

    # (a) answers at all
    started = time.perf_counter()
    try:
        resp = await client.post(url, json=probe_body(model, stream=False), headers=headers,
                                 timeout=timeout)
        elapsed = time.perf_counter() - started
        try:
            payload = resp.json()
        except ValueError:
            payload = {}
        if resp.status_code != 200:
            body = config.redact(resp.text[:200].replace("\n", " "), env)
            checks.append(Check("answers", "answers at all", FAIL,
                                f"HTTP {resp.status_code}: {body}"))
        elif not payload.get("choices"):
            checks.append(Check("answers", "answers at all", FAIL,
                                f"HTTP 200 with no choices: {json.dumps(payload)[:200]}"))
        else:
            checks.append(Check("answers", "answers at all", PASS,
                                f"HTTP 200 in {elapsed:.1f} s, model {payload.get('model')!r}"))
    except httpx.HTTPError as exc:
        checks.append(Check("answers", "answers at all", FAIL,
                            config.redact(f"could not reach it: {exc!r}", env)))

    # (b) a well-formed tool call
    if checks[0].status == FAIL:
        checks.append(Check("tool_call", "returns a tool call", FAIL,
                            "not attempted — it did not answer"))
    else:
        name, detail = _tool_call_of(payload)
        checks.append(Check("tool_call", "returns a tool call",
                            PASS if name else FAIL, detail))

    if checks[0].status == FAIL:
        # Nothing to learn from (c) and (d) when it never answered; saying so beats two
        # warnings about a connection that was never made.
        checks.append(Check("streams", "streams", WARN, "not attempted — it did not answer"))
        checks.append(Check("usage", "reports usage", WARN, "not attempted — it did not answer"))
        return Report(checks)

    # (c) streams
    chunks = 0
    saw_done = False
    stream_usage: Any = None
    stream_error: str | None = None
    try:
        async with client.stream("POST", url, json=probe_body(model, stream=True),
                                 headers=headers, timeout=timeout) as resp:
            if resp.status_code != 200:
                stream_error = f"HTTP {resp.status_code}"
                await resp.aread()
            else:
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        saw_done = True
                        continue
                    try:
                        doc = json.loads(data)
                    except ValueError:
                        continue
                    chunks += 1
                    if doc.get("usage"):
                        stream_usage = doc["usage"]
    except httpx.HTTPError as exc:
        stream_error = config.redact(repr(exc), env)
    if stream_error:
        checks.append(Check("streams", "streams", WARN,
                            f"{stream_error} — chat will have to wait for whole replies"))
    elif chunks >= 2 and saw_done:
        checks.append(Check("streams", "streams", PASS,
                            f"{chunks} chunks and a [DONE]"))
    else:
        checks.append(Check("streams", "streams", WARN,
                            f"{chunks} chunk(s), [DONE] {'seen' if saw_done else 'missing'} — "
                            "the sentence-by-sentence guard needs a real stream"))

    # (d) usage
    ok_nonstream, detail_nonstream = _usage_detail(payload.get("usage"))
    ok_stream, detail_stream = _usage_detail(stream_usage)
    if ok_nonstream and ok_stream:
        checks.append(Check("usage", "reports usage", PASS, detail_nonstream))
    elif ok_nonstream or ok_stream:
        which = "streamed" if ok_stream else "non-streamed"
        checks.append(Check("usage", "reports usage", WARN,
                            f"only on the {which} path ({detail_stream if ok_stream else detail_nonstream}) — "
                            "the other path falls back to an estimated token count"))
    else:
        checks.append(Check("usage", "reports usage", WARN,
                            f"{detail_nonstream} — daily budgets will use a character estimate"))
    return Report(checks)


def render(config: GateConfig, model: str, report: Report,
           write: Callable[[str], None], env: dict[str, str] | None = None) -> None:
    p = config.provenance
    where = p.placement + (f", {p.provider}" if p.provider else "")
    write("entity-gate upstream check")
    write(f"  upstream    {config.upstream_url}  ({where})")
    write(f"  model sent  {model}")
    if config.upstream_api_key_env:
        have = "set" if config.upstream_api_key(env) else "NOT SET — expect a 401"
        write(f"  auth        Bearer key from ${config.upstream_api_key_env} ({have})")
    else:
        write("  auth        none (no upstream_api_key_env in gate.yaml)")
    if config.upstream_headers:
        write(f"  headers     {', '.join(sorted(config.upstream_headers))}")
    write("")
    for c in report.checks:
        write(f"  {c.label:<20} {c.status}  {c.detail}")
    write("")
    if report.exit_code == 0:
        warns = [c for c in report.checks if c.status == WARN]
        write("Usable. " + ("Everything the gate needs is here."
                            if not warns else
                            f"{len(warns)} warning(s) above — the gate will work, less well."))
    else:
        write("Not usable as a kami's upstream. The gate needs a model that answers and "
              "calls tools; every number it says has to come from a tool result.")


def main(argv: list[str] | None = None, *, write: Callable[[str], None] | None = None,
         client: httpx.AsyncClient | None = None) -> int:
    parser = argparse.ArgumentParser(prog="entity-gate check-upstream")
    parser.add_argument("--config", default=None, help="gate.yaml")
    parser.add_argument("--upstream", default=None, help="override upstream_url")
    parser.add_argument("--model", default=None,
                        help="model name to send (default: upstream_model, then provenance.model)")
    args = parser.parse_args(argv)
    out = write or (lambda line: print(line))
    try:
        config = load_config(args.config, upstream_url=args.upstream)
    except (OSError, ValueError) as exc:
        out(f"could not load {args.config or 'the config'}: {exc}")
        return 2
    model = args.model or config.upstream_model or config.provenance.model or "default"

    async def go() -> Report:
        own = client is None
        c = client or httpx.AsyncClient(base_url=config.upstream_url, timeout=config.timeout_s)
        try:
            return await run_check(config, c, model=model)
        finally:
            if own:
                await c.aclose()

    report = asyncio.run(go())
    render(config, model, report, out)
    return report.exit_code


if __name__ == "__main__":
    sys.exit(main())
