"""Append-only JSONL writers for ``usage_events`` and ``guard_events`` (phase 0 sink)."""

from __future__ import annotations

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class EventLog:
    def __init__(self, events_dir: str | Path) -> None:
        self.dir = Path(events_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.usage_path = self.dir / "usage_events.jsonl"
        self.guard_path = self.dir / "guard_events.jsonl"

    def _append(self, path: Path, record: dict[str, Any]) -> None:
        record = {"ts": datetime.now(UTC).isoformat(), **record}
        line = json.dumps(record, default=str, ensure_ascii=False)
        with self._lock, open(path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    def usage(self, **fields: Any) -> None:
        self._append(self.usage_path, fields)

    def guard(self, **fields: Any) -> None:
        self._append(self.guard_path, fields)

    @staticmethod
    def read(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        with open(path, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]

    def usage_events(self) -> list[dict[str, Any]]:
        return self.read(self.usage_path)

    def guard_events(self) -> list[dict[str, Any]]:
        return self.read(self.guard_path)
