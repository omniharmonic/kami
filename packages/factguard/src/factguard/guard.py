"""The chat guard policy over a text or a token stream (ADR-E04 "on failure — chat").

* failing sentences are withheld;
* if anything was dropped, the reply ends with the gate line;
* if nothing survives, the reply is the fallback;
* a ``stale_without_time`` drop appends the templated "can't feel my gauge" line with the
  reading's time rendered like ``Friday afternoon (2026-09-04 20:15Z)``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from .atoms import FactSheet
from .extract import Candidate
from .gazetteer import Gazetteer
from .match import DEFAULT_TZ, MatchResult, match_sentence, parse_instant
from .sentences import SentenceSplitter

GATE_LINE = "I dropped a sentence because it contained something I hadn't measured."
FALLBACK = "I don't have a reading for that."
STALE_TEMPLATE = "The last reading I have is from {time}; I can't feel my gauge right now."
UNKNOWN_TIME = "an unknown time"


def render_time(iso: str | None, tz: str = DEFAULT_TZ) -> str:
    """'Friday afternoon (2026-09-04 20:15Z)' — weekday and part of day in ``tz``."""
    t = parse_instant(iso)
    if t is None:
        return UNKNOWN_TIME
    if not isinstance(t, datetime):
        return f"{t.strftime('%A')} ({t.isoformat()})"
    local = t.astimezone(ZoneInfo(tz))
    h = local.hour
    part = "morning" if 5 <= h < 12 else "afternoon" if 12 <= h < 17 else \
        "evening" if 17 <= h < 21 else "night"
    utc = t.astimezone(UTC)
    return f"{local.strftime('%A')} {part} ({utc.strftime('%Y-%m-%d %H:%MZ')})"


@dataclass
class GuardResult:
    released: list[str] = field(default_factory=list)
    dropped: list[tuple[str, list[Candidate]]] = field(default_factory=list)
    final_text: str = ""
    stale_lines: list[str] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    tail: str = ""

    @property
    def ok(self) -> bool:
        return not self.dropped

    @property
    def violations(self) -> list[str]:
        out = []
        for sentence, cands in self.dropped:
            if cands:
                out.append(f"{sentence.strip()} — unmatched: "
                           + ", ".join(c.describe() for c in cands))
            else:
                out.append(f"{sentence.strip()} — stale reading cited without its time")
        return out

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "released": [s.strip() for s in self.released],
            "dropped": [{"sentence": s.strip(), "unmatched": [c.to_dict() for c in cands]}
                        for s, cands in self.dropped],
            "stale_lines": self.stale_lines,
            "final_text": self.final_text,
            "events": self.events,
        }


class StreamingGuard:
    """Feed text chunks; get released raw segments back; ``finish()`` gives the tail."""

    def __init__(self, sheet: FactSheet, last_user_message: str = "",
                 now: datetime | None = None, tz: str = DEFAULT_TZ,
                 gazetteer: Gazetteer | None = None) -> None:
        self.sheet = sheet
        self.last_user_message = last_user_message
        self.now = now
        self.tz = tz
        self.gazetteer = gazetteer
        self.splitter = SentenceSplitter()
        self.result = GuardResult()
        self.matches: list[tuple[str, MatchResult]] = []
        self._finished = False

    def feed(self, chunk: str) -> list[str]:
        return [seg for seg in self.splitter.feed(chunk) if self._judge(seg)]

    def finish(self) -> str:
        """Flush the splitter; returns the released remainder + tail text (may be '')."""
        if self._finished:
            return ""
        self._finished = True
        rest = "".join(seg for seg in self.splitter.flush() if self._judge(seg))
        tail = self._compose_tail()
        self.result.tail = tail
        body = "".join(self.result.released).strip()
        if body:
            self.result.final_text = body + (("\n\n" + tail) if tail else "")
        else:
            self.result.final_text = tail
        return rest + (("\n\n" + tail) if (tail and rest.strip()) else
                       (tail if tail and not self.result.released else
                        ("\n\n" + tail if tail else "")))

    # ---- internals ----------------------------------------------------------------
    def _judge(self, seg: str) -> bool:
        if not seg.strip():
            self.result.released.append(seg)
            return True
        mr = match_sentence(seg.strip(), self.sheet, self.last_user_message, self.now,
                            self.tz, self.gazetteer)
        self.matches.append((seg, mr))
        if mr.ok:
            self.result.released.append(seg)
            return True
        self.result.dropped.append((seg, mr.unmatched))
        if mr.reason == "stale_without_time":
            for t in mr.stale_times:
                line = STALE_TEMPLATE.format(time=render_time(t, self.tz))
                if line not in self.result.stale_lines:
                    self.result.stale_lines.append(line)
        self.result.events.append({
            "kind": "guard_drop",
            "reason": mr.reason,
            "sentence": seg.strip(),
            "unmatched": [c.describe() for c in mr.unmatched],
            "stale_times": mr.stale_times,
        })
        return False

    def _compose_tail(self) -> str:
        r = self.result
        survived = any(s.strip() for s in r.released)
        parts: list[str] = []
        if not survived:
            parts.append(FALLBACK)
            parts.extend(r.stale_lines)
        else:
            parts.extend(r.stale_lines)
            if r.dropped:
                parts.append(GATE_LINE)
        return " ".join(parts)


def guard_text(text: str, sheet: FactSheet, last_user_message: str = "",
               now: datetime | None = None, tz: str = DEFAULT_TZ,
               gazetteer: Gazetteer | None = None) -> GuardResult:
    g = StreamingGuard(sheet, last_user_message, now, tz, gazetteer)
    g.feed(text)
    g.finish()
    return g.result
