"""The Starlette app: ``create_app(config)``.

Routes: ``POST /p/{slug}/v1/chat/completions``, ``GET /healthz``,
``POST /admin/pause/{slug}``, ``POST /admin/resume/{slug}``, ``GET /admin/state``,
``GET /admin/provenance``.
Order of checks (§5.4): pause 423 → crisis template → daily budget 429 + Retry-After →
concurrency slot (429 ``{"people_ahead": n}``) → upstream.
"""

from __future__ import annotations

import contextlib
import hmac
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

import httpx
from factguard import Gazetteer, StreamingGuard
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from . import crisis
from .budget import BudgetLedger, estimate_tokens
from .config import GateConfig
from .copy import BUDGET_MESSAGE, PAUSED_MESSAGE, QUEUE_FULL_MESSAGE
from .events import EventLog
from .guard_hook import build_sheet, last_user_text, run_nonstream, toolcall_log
from .pause import PauseSet
from .provenance import ProvenanceReporter
from .slots import QueueFull, SlotManager
from .stream import guarded_stream
from .telemetry import Telemetry

CHAT_PATH = "/v1/chat/completions"


def _error(status: int, message: str, type_: str, headers: dict[str, str] | None = None,
           **extra: Any) -> JSONResponse:
    return JSONResponse({"error": {"message": message, "type": type_}, **extra},
                        status_code=status, headers=headers)


def create_app(config: GateConfig, *, upstream_client: httpx.AsyncClient | None = None,
               clock: Callable[[], datetime] | None = None,
               telemetry: Telemetry | None = None,
               pause_client_factory: Callable[[], httpx.AsyncClient] | None = None,
               provenance_client_factory: Callable[[], httpx.AsyncClient] | None = None,
               env: dict[str, str] | None = None) -> Starlette:
    tel = telemetry or Telemetry()
    events = EventLog(config.events_dir)
    ledger = BudgetLedger(config.budgets, config.default_budget, config.tz, clock)
    slots = SlotManager(config.concurrency.per_entity, config.concurrency.queue)
    gazetteer = Gazetteer.from_file(config.gazetteer_path) if config.gazetteer_path else None
    upstream = upstream_client or httpx.AsyncClient(base_url=config.upstream_url,
                                                    timeout=config.timeout_s)
    chat_url = (CHAT_PATH if upstream.base_url else config.upstream_url + CHAT_PATH)
    # Authorization (from the env var named in gate.yaml) plus any static headers a hosted
    # provider wants. Computed once at startup: a key that appears mid-run was not there
    # when the operator read /healthz, and silently picking it up would make the report lie.
    upstream_headers = config.upstream_request_headers(env)

    def _on_pause_change(action: str, info: dict[str, Any]) -> None:
        events.guard(action=action, **info)
        tel.event(f"pause.{action}", **info)

    pause_set = PauseSet(config.paused, config.platform, pause_client_factory, _on_pause_change)

    def _on_provenance(name: str, info: dict[str, Any]) -> None:
        tel.event(name, **info)

    reporter = ProvenanceReporter(config, provenance_client_factory, _on_provenance)

    # ---- helpers ----------------------------------------------------------------
    def _admin_ok(request: Request) -> Response | None:
        host = request.client.host if request.client else None
        if host not in config.admin_allow_hosts:
            return _error(403, "admin endpoints are loopback-only", "forbidden")
        secret = config.admin_secret()
        if not secret:
            return _error(503, f"admin secret {config.admin_secret_env} is not set",
                          "admin_unavailable")
        given = request.headers.get("x-gate-admin", "")
        if not hmac.compare_digest(given, secret):
            return _error(401, "bad admin secret", "unauthorized")
        return None

    # ---- routes -----------------------------------------------------------------
    async def chat_completions(request: Request) -> Response:
        slug = request.path_params["slug"]
        job = "cron" if request.headers.get("x-kami-job", "").lower() == "cron" else "chat"
        started = time.perf_counter()
        try:
            body = await request.json()
        except ValueError:
            return _error(400, "body must be JSON", "invalid_request")
        if not isinstance(body, dict) or not isinstance(body.get("messages"), list):
            return _error(400, "messages[] required", "invalid_request")
        messages: list[dict[str, Any]] = body["messages"]
        stream = bool(body.get("stream"))
        reporter.note_request_model(body.get("model"))
        # The only rewrite the gate makes to a request body: the name the *upstream* calls
        # the model, when it differs from the name the profile uses. Everything else passes
        # through untouched.
        body = config.apply_upstream_model(body)

        # 1. pause (never skipped)
        if pause_set.is_paused(slug):
            events.guard(action="paused", slug=slug, job=job)
            tel.event("gate.paused", slug=slug, job=job)
            return _error(423, PAUSED_MESSAGE, "entity_paused", slug=slug)

        # 2. crisis (chat only; no upstream call, no tokens)
        last_user = last_user_text(messages)
        if config.crisis_enabled and job == "chat":
            phrase = crisis.detect(last_user)
            if phrase:
                events.guard(action="crisis", slug=slug, matched=phrase)
                tel.event("guard.crisis", slug=slug, matched=phrase)
                model = body.get("model")
                if stream:
                    async def frames():
                        for f in crisis.stream_frames(model):
                            yield f
                    return StreamingResponse(frames(), media_type="text/event-stream",
                                             headers={"X-Guard": "crisis",
                                                      "Cache-Control": "no-cache"})
                return JSONResponse(crisis.nonstream_payload(model), headers={"X-Guard": "crisis"})

        # 3. budget
        decision = ledger.check(slug, job, estimate_tokens(messages))
        if not decision.ok:
            events.guard(action="budget", slug=slug, job=job, reason=decision.reason,
                         retry_after=decision.retry_after_s)
            tel.event("gate.budget_exhausted", slug=slug, job=job, reason=decision.reason)
            return _error(429, BUDGET_MESSAGE, "budget_exhausted",
                          headers={"Retry-After": str(decision.retry_after_s)},
                          retry_after=decision.retry_after_s, reason=decision.reason)

        # 4. concurrency slot
        try:
            slot = await slots.acquire(slug)
        except QueueFull as qf:
            events.guard(action="queue_full", slug=slug, people_ahead=qf.people_ahead)
            return _error(429, QUEUE_FULL_MESSAGE, "queue_full", people_ahead=qf.people_ahead)

        sheet = build_sheet(messages) if not config.passthrough else None
        log = toolcall_log(messages)
        now = clock() if clock else None

        def record_usage(prompt_tokens: int, output_tokens: int, **extra: Any) -> None:
            ledger.record(slug, job, prompt_tokens, output_tokens)
            events.usage(slug=slug, job=job, prompt_tokens=prompt_tokens,
                         output_tokens=output_tokens,
                         latency_ms=round((time.perf_counter() - started) * 1000, 1), **extra)

        if stream:
            guard = None
            if sheet is not None:
                guard = StreamingGuard(sheet, last_user, now=now, tz=config.tz,
                                       gazetteer=gazetteer)

            def on_done(summary: dict[str, Any]) -> None:
                usage = summary.get("usage") or {}
                prompt_tokens = int(usage.get("prompt_tokens") or estimate_tokens(messages))
                output_tokens = int(usage.get("completion_tokens")
                                    or max(1, summary.get("raw_chars", 0) // 4))
                record_usage(prompt_tokens, output_tokens, stream=True,
                             guard_released=summary.get("released"),
                             guard_dropped=summary.get("dropped"),
                             status=summary.get("status"))
                for ev in summary.get("events") or []:
                    events.guard(action="drop", slug=slug, job=job, **ev)
                tel.event("gate.completion", slug=slug, job=job, stream=True,
                          prompt_tokens=prompt_tokens, output_tokens=output_tokens,
                          guard_dropped=summary.get("dropped"), status=summary.get("status"))

            async def body_iter():
                try:
                    async for frame in guarded_stream(body, upstream, chat_url, guard=guard,
                                                      toolcalls=log, on_done=on_done,
                                                      timeout=config.timeout_s,
                                                      headers=upstream_headers):
                        yield frame
                finally:
                    slot.release()

            return StreamingResponse(body_iter(), media_type="text/event-stream", headers={
                "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                "X-Guard": "passthrough" if guard is None else "stream"})

        try:
            outcome = await run_nonstream(body, upstream, chat_url, sheet=sheet or build_sheet([]),
                                          last_user=last_user, gazetteer=gazetteer,
                                          tz=config.tz, now=now, passthrough=sheet is None,
                                          timeout=config.timeout_s, headers=upstream_headers)
        except httpx.HTTPError as exc:
            slot.release()
            return _error(502, config.redact(f"upstream unreachable: {exc!r}", env),
                          "upstream_error")
        finally:
            with contextlib.suppress(Exception):
                slot.release()
        record_usage(outcome.prompt_tokens, outcome.output_tokens, stream=False,
                     guard=outcome.guard_status, attempts=outcome.attempts)
        for g in outcome.guard_results:
            for ev in g.events:
                events.guard(action="drop", slug=slug, job=job, **ev)
        if outcome.guard_status == "held":
            events.guard(action="held", slug=slug, job=job, violations=outcome.violations)
        tel.event("gate.completion", slug=slug, job=job, stream=False,
                  guard=outcome.guard_status, attempts=outcome.attempts,
                  prompt_tokens=outcome.prompt_tokens, output_tokens=outcome.output_tokens)
        return JSONResponse(outcome.payload, status_code=outcome.status_code,
                            headers=outcome.headers)

    async def healthz(_: Request) -> Response:
        return JSONResponse({"ok": True, "upstream_url": config.upstream_url,
                             "passthrough": config.passthrough,
                             "provenance": reporter.doc(),
                             "pause": pause_set.state(), "slots": slots.state()})

    async def admin_provenance(request: Request) -> Response:
        """What is actually serving, and whether the platform has been told."""
        denied = _admin_ok(request)
        if denied:
            return denied
        return JSONResponse(reporter.state())

    async def admin_pause(request: Request) -> Response:
        denied = _admin_ok(request)
        if denied:
            return denied
        slug = request.path_params["slug"]
        by = None
        with contextlib.suppress(Exception):
            doc = await request.json()
            if isinstance(doc, dict):
                by = doc.get("by") or doc.get("guardian")
        pause_set.pause(slug, by)
        return JSONResponse({"ok": True, "slug": slug, "paused": sorted(pause_set.paused)})

    async def admin_resume(request: Request) -> Response:
        denied = _admin_ok(request)
        if denied:
            return denied
        slug = request.path_params["slug"]
        try:
            doc = await request.json()
        except ValueError:
            doc = None
        guardians = doc.get("guardians") if isinstance(doc, dict) else None
        if not isinstance(guardians, list):
            return _error(400, 'body must be {"guardians": [a, b]}', "invalid_request")
        try:
            pause_set.resume(slug, guardians)
        except ValueError as exc:
            return _error(400, str(exc), "two_guardians_required")
        still = slug in pause_set.paused
        return JSONResponse({"ok": True, "slug": slug, "guardians": guardians,
                             "still_paused_by_platform": still,
                             "paused": sorted(pause_set.paused)})

    async def admin_state(request: Request) -> Response:
        denied = _admin_ok(request)
        if denied:
            return denied
        return JSONResponse({"pause": pause_set.state(), "budgets": ledger.snapshot(),
                             "slots": slots.state(), "passthrough": config.passthrough})

    @contextlib.asynccontextmanager
    async def lifespan(_app: Starlette):
        await pause_set.start()
        await reporter.start()
        try:
            yield
        finally:
            await reporter.stop()
            await pause_set.stop()
            if upstream_client is None:
                await upstream.aclose()

    app = Starlette(routes=[
        Route("/p/{slug}" + CHAT_PATH, chat_completions, methods=["POST"]),
        Route("/healthz", healthz, methods=["GET"]),
        Route("/admin/pause/{slug}", admin_pause, methods=["POST"]),
        Route("/admin/resume/{slug}", admin_resume, methods=["POST"]),
        Route("/admin/state", admin_state, methods=["GET"]),
        Route("/admin/provenance", admin_provenance, methods=["GET"]),
    ], lifespan=lifespan)
    app.state.config = config
    app.state.pause_set = pause_set
    app.state.ledger = ledger
    app.state.slots = slots
    app.state.events = events
    app.state.telemetry = tel
    app.state.upstream = upstream
    app.state.upstream_headers = upstream_headers
    app.state.provenance = reporter
    return app
