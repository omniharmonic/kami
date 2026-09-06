"""1. Upstream model — is there a model at all, and can it call a tool?

Everything downstream is theatre without this: the gate has nothing to guard,
the pulse has nothing to write, and the evals have nothing to measure. So this
runs first and the rest of the chain reads its verdict.

Four things are proven here, in this order:

* the endpoint answers and names its models;
* a **real tool call round-trips** — the model returns a parsed `tool_calls`
  entry, because a kami that cannot call `get_entity_status` cannot say
  anything at all (every number it utters has to come back from a tool);
* streaming works, frame by frame, because the whole chat path is SSE;
* `usage` is reported, because the gate's daily budget is counted from it
  (without it the gate falls back to a chars/4 estimate — docs/verify.md #29).

If `python -m entity_gate.check_upstream` exists (the gate's own hosted-upstream
checker) it is the authority and is run first; the probes here are the fallback
for a box where it is not installed.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import report
from context import Ctx
from net import Resp, request, sse_events, stream_sse
from report import CheckResult, Step, fail, ok, skip, warn

DOC = "docs/deploy/first-entity.md checkpoint 1; infra/mac/upstream-examples/"

PROVIDERS = {
    "api.openai.com": "OpenAI",
    "openrouter.ai": "OpenRouter",
    "api.together.xyz": "Together",
    "api.groq.com": "Groq",
    "api.deepinfra.com": "DeepInfra",
    "api.fireworks.ai": "Fireworks",
    "api.mistral.ai": "Mistral",
    "api.cerebras.ai": "Cerebras",
    "api.anyscale.com": "Anyscale",
    "api.hyperbolic.xyz": "Hyperbolic",
    "api.novita.ai": "Novita",
    "api.lambdalabs.com": "Lambda",
}

KEY_ENV_CANDIDATES = (
    "KAMI_UPSTREAM_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "TOGETHER_API_KEY",
    "GROQ_API_KEY",
    "DEEPINFRA_API_KEY",
    "FIREWORKS_API_KEY",
    "HYPERBOLIC_API_KEY",
    "NOVITA_API_KEY",
)

TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_entity_status",
        "description": "Current readings for the entity's member places.",
        "parameters": {
            "type": "object",
            "properties": {"entity": {"type": "string"}},
            "required": [],
        },
    },
}


def provider_name(host: str, port: Optional[int]) -> str:
    host = (host or "").lower()
    if host in PROVIDERS:
        return PROVIDERS[host]
    if host in {"127.0.0.1", "localhost", "::1"}:
        if port == 1234:
            return "LM Studio (local)"
        if port == 8000:
            return "vLLM (local)"
        if port == 11434:
            return "Ollama (local)"
        return f"local:{port}"
    return host or "unknown"


def api_join(base: str, path: str) -> str:
    return base.rstrip("/") + "/" + path.lstrip("/")


class UpstreamConfig:
    def __init__(self, ctx: Ctx) -> None:
        self.base: Optional[str] = None
        self.base_from = ""
        self.key: Optional[str] = None
        self.key_env: Optional[str] = None
        self.model: Optional[str] = None
        self.model_from = ""
        self.headers: Dict[str, str] = {}
        self.timeout: float = 60.0

        gate_url = ctx.gate("upstream_url")
        env_url = ctx.get("KAMI_UPSTREAM_URL", "OPENAI_BASE_URL", "OPENAI_API_BASE")
        if env_url:
            self.base, self.base_from = env_url.rstrip("/"), ctx.source_of(
                "KAMI_UPSTREAM_URL", "OPENAI_BASE_URL", "OPENAI_API_BASE"
            ) or "environment"
        elif isinstance(gate_url, str) and gate_url:
            self.base, self.base_from = gate_url.rstrip("/"), "gate.yaml upstream_url"

        # the hosted-upstream contract: gate.yaml names the env var, never the key
        named = ctx.gate("upstream_api_key_env")
        if isinstance(named, str) and named:
            self.key_env = named
            self.key = ctx.get(named)
        else:
            for candidate in KEY_ENV_CANDIDATES:
                if ctx.get(candidate):
                    self.key_env, self.key = candidate, ctx.get(candidate)
                    break

        headers = ctx.gate("upstream_headers")
        if isinstance(headers, dict):
            for key, value in headers.items():
                if isinstance(value, str):
                    # values of the form ${ENV} are resolved from the environment
                    if value.startswith("${") and value.endswith("}"):
                        resolved = ctx.get(value[2:-1])
                        if resolved:
                            self.headers[str(key)] = resolved
                    else:
                        self.headers[str(key)] = value

        model = ctx.get("KAMI_UPSTREAM_MODEL", "OPENAI_MODEL")
        if model:
            self.model, self.model_from = model, "environment"
        else:
            gate_model = ctx.gate("upstream_model")
            if isinstance(gate_model, str) and gate_model:
                self.model, self.model_from = gate_model, "gate.yaml upstream_model"
            else:
                profile_model = _profile_model(ctx)
                if profile_model:
                    self.model, self.model_from = profile_model, f"profiles/{ctx.slug}/config.yaml"

        timeout = ctx.gate("request_timeout_s") or ctx.gate("upstream_timeout_s")
        try:
            self.timeout = float(timeout) if timeout else 60.0
        except (TypeError, ValueError):
            self.timeout = 60.0

    @property
    def configured(self) -> bool:
        return bool(self.base)

    def auth_headers(self) -> Dict[str, str]:
        out = dict(self.headers)
        if self.key:
            out.setdefault("Authorization", f"Bearer {self.key}")
        return out


def _profile_model(ctx: Ctx) -> Optional[str]:
    path = ctx.root / "profiles" / ctx.slug / "config.yaml"
    if not path.exists():
        return None
    try:
        from yamlish import load_yaml

        data = load_yaml(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if isinstance(data, dict):
        model = data.get("model")
        if isinstance(model, dict) and isinstance(model.get("default"), str):
            return model["default"]
    return None


# ---------------------------------------------------------------------------
# the gate's own checker, when it is installed
# ---------------------------------------------------------------------------


def _python_with_entity_gate(ctx: Ctx) -> Optional[List[str]]:
    """The first interpreter that can import `entity_gate.check_upstream`."""
    candidates: List[List[str]] = []
    venv = ctx.root / ".venv" / "bin" / "python"
    if venv.exists():
        candidates.append([str(venv)])
    if shutil.which("uv"):
        candidates.append(["uv", "run", "--package", "kami-gate", "python"])
    candidates.append([os.environ.get("KAMI_DOCTOR_PYTHON") or "python3"])
    for argv in candidates:
        try:
            proc = subprocess.run(
                argv + ["-c", "import entity_gate.check_upstream"],
                cwd=str(ctx.root),
                capture_output=True,
                timeout=90,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if proc.returncode == 0:
            return argv
    return None


def _run_check_upstream(ctx: Ctx, python: List[str]) -> Tuple[int, str, str]:
    args = python + ["-m", "entity_gate.check_upstream"]
    if ctx.gate_yaml_path:
        args += ["--config", str(ctx.gate_yaml_path)]
    try:
        proc = subprocess.run(args, cwd=str(ctx.root), capture_output=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 124, "", f"{type(exc).__name__}: {exc}"
    out = proc.stdout.decode("utf-8", "replace").strip()
    err = proc.stderr.decode("utf-8", "replace").strip()
    if proc.returncode == 2 and ("unrecognized arguments" in err or err.startswith("usage:")):
        # our guess at its flags was wrong; ask it with no arguments at all
        try:
            proc = subprocess.run(
                python + ["-m", "entity_gate.check_upstream"], cwd=str(ctx.root), capture_output=True, timeout=180
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return 124, "", f"{type(exc).__name__}: {exc}"
        out = proc.stdout.decode("utf-8", "replace").strip()
        err = proc.stderr.decode("utf-8", "replace").strip()
    return proc.returncode, out, err


# ---------------------------------------------------------------------------
# direct probes
# ---------------------------------------------------------------------------


def _probe_models(cfg: UpstreamConfig) -> Tuple[Step, List[str]]:
    resp = request(api_join(cfg.base or "", "models"), headers=cfg.auth_headers(), timeout=min(cfg.timeout, 30))
    if resp.status in (401, 403):
        return (
            fail(
                "upstream.auth",
                f"the provider refused the key ({resp.why()})",
                fix=f"check ${cfg.key_env or 'the API key variable'} — regenerate it at the provider and put it in the "
                "file your launchd plist loads (infra/mac/kami.env), then `launchctl kickstart -k gui/$UID/com.kami.gate`",
                doc=DOC,
            ),
            [],
        )
    if not resp.ok:
        return (
            fail(
                "upstream.reachable",
                f"{cfg.base}/models did not answer: {resp.why()}",
                fix="check the base URL and that this Mac has outbound HTTPS; `curl -sS "
                f"{cfg.base}/models -H 'Authorization: Bearer $KEY' | head`",
                doc=DOC,
            ),
            [],
        )
    data = resp.json() or {}
    models: List[str] = []
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        models = [m.get("id") for m in data["data"] if isinstance(m, dict) and m.get("id")]
    return ok("upstream.reachable", f"{len(models)} models offered", models=models[:40]), models


def _chat(cfg: UpstreamConfig, payload: Dict[str, Any], timeout: Optional[float] = None) -> Resp:
    return request(
        api_join(cfg.base or "", "chat/completions"),
        method="POST",
        headers=cfg.auth_headers(),
        body=payload,
        timeout=timeout or cfg.timeout,
    )


def _probe_toolcall(cfg: UpstreamConfig) -> Step:
    base_payload: Dict[str, Any] = {
        "model": cfg.model,
        "stream": False,
        "max_tokens": 256,
        "temperature": 0,
        "tools": [TOOL_SCHEMA],
        "messages": [
            {"role": "system", "content": "Call get_entity_status before answering anything about readings."},
            {"role": "user", "content": "How is the creek right now?"},
        ],
    }
    attempts = [
        dict(base_payload, tool_choice="auto"),
        dict(base_payload, tool_choice={"type": "function", "function": {"name": "get_entity_status"}}),
    ]
    last: Optional[Resp] = None
    for i, payload in enumerate(attempts):
        resp = _chat(cfg, payload)
        last = resp
        if not resp.ok:
            continue
        data = resp.json() or {}
        choices = data.get("choices") or []
        message = (choices[0] or {}).get("message", {}) if choices else {}
        calls = message.get("tool_calls") or []
        if calls:
            fn = (calls[0] or {}).get("function", {})
            name = fn.get("name")
            try:
                json.loads(fn.get("arguments") or "{}")
                parsed = True
            except Exception:
                parsed = False
            if name == "get_entity_status" and parsed:
                served = data.get("model") or cfg.model
                forced = " (tool_choice had to be forced)" if i else ""
                return ok(
                    "upstream.toolcall",
                    f"{served} returned a parsed tool call{forced}",
                    served_model=served,
                    forced=bool(i),
                )
            return fail(
                "upstream.toolcall",
                f"a tool call came back but it was not usable (name={name!r}, arguments parsed={parsed})",
                fix="pick a model with working OpenAI-style tool calling — a kami cannot say a number it did not "
                "fetch, so tool calls are not optional",
                doc=DOC,
            )
    detail = "the model answered but never called the tool" if last and last.ok else (
        f"the tool-call request failed: {last.why() if last else 'no response'}"
    )
    return fail(
        "upstream.toolcall",
        detail,
        fix="try a model that supports tool calling (Qwen-class instruct models do); set `upstream_model` in "
        "gate.yaml. See infra/mac/upstream-examples/ for two working fragments",
        doc=DOC,
    )


def _probe_stream(cfg: UpstreamConfig) -> List[Step]:
    payload: Dict[str, Any] = {
        "model": cfg.model,
        "stream": True,
        "max_tokens": 48,
        "temperature": 0,
        "stream_options": {"include_usage": True},
        "messages": [{"role": "user", "content": "Count from one to eight, one word per line."}],
    }
    envelope, frames = stream_sse(
        api_join(cfg.base or "", "chat/completions"),
        headers=cfg.auth_headers(),
        body=payload,
        timeout=min(cfg.timeout, 90),
    )
    if envelope.status == 400 and "stream_options" in envelope.text(600):
        payload.pop("stream_options", None)
        envelope, frames = stream_sse(
            api_join(cfg.base or "", "chat/completions"),
            headers=cfg.auth_headers(),
            body=payload,
            timeout=min(cfg.timeout, 90),
        )
        usage_unsupported = True
    else:
        usage_unsupported = False

    if not envelope.ok:
        return [
            fail(
                "upstream.stream",
                f"streaming failed: {envelope.why()}",
                fix="the whole chat path is server-sent events; a provider that cannot stream cannot drive the page. "
                "Check the provider's streaming support and any proxy in front of it",
                doc=DOC,
            )
        ]

    deltas = 0
    usage: Optional[Dict[str, Any]] = None
    saw_done = False
    for _, data in sse_events(frames):
        if data == "[DONE]":
            saw_done = True
            continue
        try:
            chunk = json.loads(data)
        except Exception:
            continue
        if isinstance(chunk, dict):
            if chunk.get("usage"):
                usage = chunk["usage"]
            for choice in chunk.get("choices") or []:
                if (choice.get("delta") or {}).get("content"):
                    deltas += 1

    steps: List[Step] = []
    if deltas >= 2:
        steps.append(
            ok(
                "upstream.stream",
                f"{deltas} content frames{' and a [DONE]' if saw_done else ''} in {envelope.elapsed_s:.1f}s",
                frames=deltas,
            )
        )
    else:
        steps.append(
            fail(
                "upstream.stream",
                f"only {deltas} content frames came back — the endpoint answered but did not stream",
                fix="check for a buffering proxy between this Mac and the provider; the gate needs token-by-token "
                "frames to guard sentence by sentence",
                doc=DOC,
            )
        )

    if usage:
        steps.append(
            ok(
                "upstream.usage",
                f"prompt {usage.get('prompt_tokens')} / completion {usage.get('completion_tokens')} tokens reported",
                usage=usage,
            )
        )
    else:
        steps.append(
            warn(
                "upstream.usage",
                "no usage block in the stream"
                + (" (the provider rejected stream_options)" if usage_unsupported else ""),
                fix="the gate then estimates tokens at chars/4 and the daily budget is approximate. If the provider "
                "supports `stream_options.include_usage`, turn it on; otherwise expect budget drift "
                "(docs/verify.md #29)",
                doc="apps/gate/README.md; docs/verify.md #29",
            )
        )
    return steps


# ---------------------------------------------------------------------------


def run(ctx: Ctx, prior: Dict[str, CheckResult]) -> CheckResult:
    result = CheckResult(id="upstream", title="Upstream model — the thing that actually speaks")
    cfg = UpstreamConfig(ctx)

    if not cfg.configured:
        result.steps.append(
            skip(
                "upstream.config",
                "no upstream is configured",
                fix="set `upstream_url` in apps/gate/gate.yaml (and `upstream_api_key_env`), or export "
                "KAMI_UPSTREAM_URL / OPENAI_API_KEY for a one-off check. Copy a fragment from "
                "infra/mac/upstream-examples/",
                doc=DOC,
            )
        )
        return result

    from net import host_port

    host, port = host_port(cfg.base or "")
    provider = provider_name(host, port)
    key_note = f"key from ${cfg.key_env}" if cfg.key else "no API key found"
    result.steps.append(
        ok(
            "upstream.config",
            f"{provider} at {cfg.base} (from {cfg.base_from}), model {cfg.model or 'unset'}"
            f" (from {cfg.model_from or 'nowhere'}), {key_note}",
            provider=provider,
            base_url=cfg.base,
            model=cfg.model,
            key_env=cfg.key_env,
        )
    )

    if not cfg.key and not cfg.headers and host not in {"127.0.0.1", "localhost", "::1"}:
        result.steps.append(
            skip(
                "upstream.auth",
                f"no API key in the environment for {provider}",
                fix="put the key in the file the launchd plist loads (infra/mac/kami.env, chmod 600) and name that "
                "variable in gate.yaml as `upstream_api_key_env`. Never inline a key in gate.yaml",
                doc=DOC,
            )
        )
        return result

    if not cfg.model:
        result.steps.append(
            warn(
                "upstream.model",
                "no model name is configured; probes will use the provider's default and may fail",
                fix=f"set `upstream_model` in gate.yaml, or `model.default` in profiles/{ctx.slug}/config.yaml",
                doc=DOC,
            )
        )

    # The gate's own checker is the authority when it exists.
    python = _python_with_entity_gate(ctx)
    if python:
        code, out, err = _run_check_upstream(ctx, python)
        summary = (out or err).strip().splitlines()
        head = " | ".join(line.strip() for line in summary[:4]) if summary else "(no output)"
        parsed: Optional[Any] = None
        try:
            parsed = json.loads(out) if out.startswith("{") else None
        except Exception:
            parsed = None
        detail = head if not parsed else json.dumps(parsed)[:400]
        if code == 0:
            result.steps.append(
                ok("upstream.check_upstream", f"`python -m entity_gate.check_upstream` passed — {detail}")
            )
            result.steps.append(
                ok(
                    "upstream.roundtrip",
                    "covered by the gate's own checker (run it directly for its detail)",
                )
            )
            return result
        if code in (2, 124) and ("usage:" in err or "unrecognized" in err or not out):
            result.steps.append(
                warn(
                    "upstream.check_upstream",
                    f"`python -m entity_gate.check_upstream` did not run cleanly (exit {code}); "
                    "falling back to this tool's own probes",
                    fix="run it by hand to see why: "
                    f"{' '.join(python)} -m entity_gate.check_upstream",
                    doc="apps/gate/README.md",
                )
            )
        else:
            result.steps.append(
                fail(
                    "upstream.check_upstream",
                    f"`python -m entity_gate.check_upstream` failed (exit {code}) — {detail}",
                    fix="fix what it names before going further; the probes below repeat the same ground",
                    doc="apps/gate/README.md",
                )
            )

    step, models = _probe_models(cfg)
    result.steps.append(step)
    if step.status == report.FAIL:
        return result

    if cfg.model and models and cfg.model not in models:
        result.steps.append(
            warn(
                "upstream.model",
                f"{cfg.model!r} is not in the provider's model list ({len(models)} offered)",
                fix="the name may still work (many gateways accept aliases); if the next probe fails, take a name "
                "from `curl $UPSTREAM/models`",
                doc=DOC,
            )
        )

    result.steps.append(_probe_toolcall(cfg))
    result.steps.extend(_probe_stream(cfg))
    return result
