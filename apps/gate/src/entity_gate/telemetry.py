"""Thin telemetry: JSON spans/events to stdout. Swap ``exporter`` for an OTel exporter later."""

from __future__ import annotations

import contextlib
import json
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

Exporter = Callable[[dict[str, Any]], None]


def _stdout_exporter(record: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(record, default=str) + "\n")
    sys.stdout.flush()


class Telemetry:
    def __init__(self, exporter: Exporter | None = None, service: str = "entity-gate") -> None:
        self.exporter: Exporter = exporter or _stdout_exporter
        self.service = service
        self.records: list[dict[str, Any]] = []  # last few, for /healthz and tests
        self._keep = 200

    def emit(self, record: dict[str, Any]) -> None:
        record.setdefault("service", self.service)
        record.setdefault("ts", datetime.now(UTC).isoformat())
        self.records.append(record)
        if len(self.records) > self._keep:
            del self.records[: len(self.records) - self._keep]
        with contextlib.suppress(OSError, ValueError, TypeError):  # never break a request
            self.exporter(record)

    def event(self, name: str, **attrs: Any) -> None:
        self.emit({"kind": "event", "name": name, **attrs})

    @contextlib.contextmanager
    def span(self, name: str, **attrs: Any):
        start = time.perf_counter()
        span: dict[str, Any] = {"kind": "span", "name": name, **attrs}
        try:
            yield span
            span.setdefault("status", "ok")
        except Exception as exc:
            span["status"] = "error"
            span["error"] = repr(exc)
            raise
        finally:
            span["duration_ms"] = round((time.perf_counter() - start) * 1000, 2)
            self.emit(span)


class NullTelemetry(Telemetry):
    def __init__(self) -> None:
        super().__init__(exporter=lambda _r: None)
