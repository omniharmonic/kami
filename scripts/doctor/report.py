"""Result types and the two renderers (text, JSON).

Nothing in this module knows what a check does; it only knows how to say what
happened without lying about it. Four statuses and no fifth:

* ``pass``    — checked, and it is true.
* ``fail``    — checked, and it is not true. Exits non-zero.
* ``warn``    — checked, true enough to continue, not true enough to be quiet.
* ``skipped`` — **not checked**, because something it needs is not configured
  or an earlier check made it meaningless. Never rendered as if it had passed.

Every non-pass step carries ``fix`` (the command or file that changes it) and
``doc`` (where the runbook says more). Every string that leaves here goes
through the redactor first (``context.Secrets``), text and JSON alike.
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

PASS = "pass"
FAIL = "fail"
WARN = "warn"
SKIP = "skipped"

_ORDER = {PASS: 0, WARN: 1, SKIP: 2, FAIL: 3}

_MARK = {PASS: "ok  ", FAIL: "FAIL", WARN: "warn", SKIP: "skip"}
_COLOR = {PASS: "\033[32m", FAIL: "\033[31;1m", WARN: "\033[33m", SKIP: "\033[90m"}
_RESET = "\033[0m"
_DIM = "\033[90m"
_BOLD = "\033[1m"


@dataclass
class Step:
    """One assertion inside a check."""

    id: str
    status: str
    detail: str = ""
    fix: str = ""
    doc: str = ""
    data: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"id": self.id, "status": self.status}
        if self.detail:
            out["detail"] = self.detail
        if self.fix:
            out["fix"] = self.fix
        if self.doc:
            out["doc"] = self.doc
        if self.data:
            out["data"] = self.data
        return out


def ok(id: str, detail: str = "", **data: Any) -> Step:
    return Step(id=id, status=PASS, detail=detail, data=data)


def fail(id: str, detail: str, fix: str = "", doc: str = "", **data: Any) -> Step:
    return Step(id=id, status=FAIL, detail=detail, fix=fix, doc=doc, data=data)


def warn(id: str, detail: str, fix: str = "", doc: str = "", **data: Any) -> Step:
    return Step(id=id, status=WARN, detail=detail, fix=fix, doc=doc, data=data)


def skip(id: str, detail: str, fix: str = "", doc: str = "", **data: Any) -> Step:
    """`skipped (not configured)` — say what is missing, never imply it is fine."""
    return Step(id=id, status=SKIP, detail=detail, fix=fix, doc=doc, data=data)


@dataclass
class CheckResult:
    id: str
    title: str
    steps: List[Step] = field(default_factory=list)
    duration_s: float = 0.0

    @property
    def status(self) -> str:
        if not self.steps:
            return SKIP
        worst = PASS
        for s in self.steps:
            if _ORDER[s.status] > _ORDER[worst]:
                worst = s.status
        return worst

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "duration_s": round(self.duration_s, 3),
            "steps": [s.as_dict() for s in self.steps],
        }


@dataclass
class Report:
    slug: str
    started_at: str
    checks: List[CheckResult] = field(default_factory=list)
    duration_s: float = 0.0
    notes: List[str] = field(default_factory=list)

    def counts(self) -> Dict[str, int]:
        c = {PASS: 0, FAIL: 0, WARN: 0, SKIP: 0}
        for chk in self.checks:
            for s in chk.steps:
                c[s.status] += 1
        return c

    @property
    def failed(self) -> bool:
        return any(s.status == FAIL for chk in self.checks for s in chk.steps)

    def as_dict(self) -> Dict[str, Any]:
        counts = self.counts()
        return {
            "kami_doctor": "1",
            "slug": self.slug,
            "started_at": self.started_at,
            "duration_s": round(self.duration_s, 3),
            "ok": not self.failed,
            "summary": counts,
            "notes": self.notes,
            "checks": [c.as_dict() for c in self.checks],
        }


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------


def render_json(report: Report, redact: Callable[[str], str]) -> str:
    return redact(json.dumps(report.as_dict(), indent=2, sort_keys=False, default=str))


def _wrap(text: str, width: int, indent: str) -> List[str]:
    words = text.split()
    lines: List[str] = []
    cur = ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = w if not cur else cur + " " + w
    if cur:
        lines.append(cur)
    return [indent + line for line in lines] or [indent]


def render_text(report: Report, redact: Callable[[str], str], color: bool = False) -> str:
    def c(code: str, s: str) -> str:
        return f"{code}{s}{_RESET}" if color else s

    out: List[str] = []
    out.append(c(_BOLD, f"kami doctor  ·  entity {report.slug}  ·  {report.started_at}"))
    out.append("")
    for i, chk in enumerate(report.checks, start=1):
        head = f"{i}. {chk.title}"
        out.append(f"{c(_COLOR[chk.status], _MARK[chk.status])}  {c(_BOLD, head)}")
        for s in chk.steps:
            mark = c(_COLOR[s.status], _MARK[s.status])
            line = f"      {mark}  {s.id}"
            if s.detail:
                line += f" — {s.detail}"
            out.append(line)
            if s.status != PASS:
                if s.fix:
                    out.extend(_wrap(f"fix: {s.fix}", 96, "            "))
                if s.doc:
                    out.extend(_wrap(f"see: {s.doc}", 96, "            "))
        out.append("")
    counts = report.counts()
    tail = (
        f"{counts[PASS]} pass · {counts[FAIL]} fail · {counts[WARN]} warn · "
        f"{counts[SKIP]} skipped (not configured)   in {report.duration_s:.1f}s"
    )
    out.append(c(_BOLD, tail))
    if report.notes:
        for n in report.notes:
            out.extend(_wrap(n, 96, "  "))
    if report.failed:
        out.append(c(_COLOR[FAIL], "something is wrong — the failing lines above name the fix."))
    elif counts[SKIP]:
        out.append(
            c(
                _DIM,
                "nothing is broken in what was checked. The skipped lines were not checked at all "
                "— they are not passes.",
            )
        )
    else:
        out.append(c(_COLOR[PASS], "the whole chain answered."))
    return redact("\n".join(out))


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def human_age(seconds: Optional[float]) -> str:
    if seconds is None:
        return "unknown"
    s = int(seconds)
    if s < 0:
        return f"{-s}s in the future"
    if s < 90:
        return f"{s}s"
    if s < 5400:
        return f"{s // 60}m"
    if s < 172800:
        return f"{s // 3600}h"
    return f"{s // 86400}d"
