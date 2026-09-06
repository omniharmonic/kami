"""Candidate extraction from one reply sentence (ADR-E04).

Candidates: numerals (decimals, percent, negatives, thousands separators) with an optional
unit word, spelled-out numbers one–twenty and the tens, ISO dates/datetimes, month-day
forms, ordinal days ("the 7th"), weekday words, today/yesterday, clock times, relative
durations ("N hours ago", "about N hours since"), drought classes (D0–D4), and proper
nouns found in a gazetteer. A candidate whose token also appears in the last user
message is tagged ``echo``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from .gazetteer import Entry, Gazetteer
from .units import UNIT_AFTER_NUMBER_RE, normalize_unit, to_seconds

_SMALL = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20,
}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
         "eighty": 80, "ninety": 90}
_ONES = {k: v for k, v in _SMALL.items() if 1 <= v <= 9}
SPELLED = {**_SMALL, **_TENS}

_MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3, "april": 4,
    "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7, "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9, "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}
WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4,
            "saturday": 5, "sunday": 6}

_month_alt = "|".join(sorted(_MONTHS, key=len, reverse=True))
_spelled_alt = "|".join(sorted(SPELLED, key=len, reverse=True))
_tens_alt = "|".join(_TENS)
_ones_alt = "|".join(_ONES)
_NUM = r"-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"

ISO_RE = re.compile(
    r"(?<![\w-])(?P<y>\d{4})-(?P<mo>\d{2})-(?P<d>\d{2})"
    r"(?:[T ](?P<h>\d{2}):(?P<mi>\d{2})(?::\d{2}(?:\.\d+)?)?\s?(?P<tz>Z|UTC|[+-]\d{2}:?\d{2})?)?"
    r"(?![\w-])", re.IGNORECASE)
MONTH_DAY_RE = re.compile(
    rf"\b(?P<mon>{_month_alt})\.?\s+(?P<d>\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(?P<y>\d{{4}}))?\b",
    re.IGNORECASE)
DAY_MONTH_RE = re.compile(
    rf"\b(?P<d>\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?(?P<mon>{_month_alt})\b"
    rf"(?:,?\s+(?P<y>\d{{4}}))?", re.IGNORECASE)
ORDINAL_DAY_RE = re.compile(r"\b(?:the\s+)(?P<d>\d{1,2})(?:st|nd|rd|th)\b", re.IGNORECASE)
RELATIVE_RE = re.compile(
    rf"\b(?:(?:about|around|roughly|nearly|almost|some|over|under|more than|less than|"
    rf"just over|just under)\s+)?(?P<n>{_NUM}|(?:{_tens_alt})[- ](?:{_ones_alt})|{_spelled_alt}|an?)"
    rf"\s+(?P<u>hours?|hrs?|days?|minutes?|mins?|weeks?)"
    rf"(?=\s+(?:ago|since|old|back|earlier|overdue|late|stale|without)\b)", re.IGNORECASE)
CLOCK_RE = re.compile(
    r"\b(?P<h>\d{1,2}):(?P<mi>\d{2})(?:\s*(?P<tz>Z|UTC|MDT|MST|a\.?m\.?|p\.?m\.?))?(?![\w:])",
    re.IGNORECASE)
WEEKDAY_RE = re.compile(r"\b(?P<w>monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
                        re.IGNORECASE)
RELDAY_RE = re.compile(r"\b(?P<w>today|yesterday|tonight|this morning|this afternoon|this evening)\b",
                       re.IGNORECASE)
DROUGHT_RE = re.compile(r"\bD(?P<n>[0-4])\b")
# Licence identifiers are proper nouns naming a legal document, not measurements.
# The version number in "CC BY-SA 4.0" asserts nothing about a place, so a
# sentence carrying the attribution the soul requires must not be dropped for
# want of a "4.0" atom. These spans are claimed before any number is read.
LICENCE_RE = re.compile(
    r"\b(?:CC[\s-]?BY(?:[\s-]?(?:SA|NC|ND))*[\s-]?\d(?:\.\d+)?"
    r"|CC0(?:[\s-]?\d(?:\.\d+)?)?"
    r"|Apache(?:[\s-]?License)?[\s-]?\d(?:\.\d+)?"
    r"|ODbL(?:[\s-]?\d(?:\.\d+)?)?"
    r"|GPL(?:v?\d(?:\.\d+)?)?"
    r"|MIT[\s-]?License)\b",
    re.IGNORECASE,
)
NUMBER_RE = re.compile(rf"(?<![\w./:-])(?P<n>{_NUM})(?![\w/-])")
SPELLED_RE = re.compile(
    rf"\b(?P<w>(?:{_tens_alt})[- ](?:{_ones_alt})|{_spelled_alt})\b", re.IGNORECASE)


@dataclass
class Candidate:
    kind: str  # number | date | weekday | relday | clock | relative | enum | place | species
    text: str
    span: tuple[int, int]
    value: Any = None
    unit: str | None = None
    decimals: int = 0
    echo: bool = False
    entries: list[Entry] = field(default_factory=list)

    def describe(self) -> str:
        if self.kind == "number":
            v = _fmt_number(self.value, self.decimals)
            return f"{v} {self.unit}" if self.unit else v
        return self.text

    def to_dict(self) -> dict[str, Any]:
        v = self.value
        if isinstance(v, date):
            v = v.isoformat()
        elif isinstance(v, tuple):
            v = list(v)
        return {"kind": self.kind, "text": self.text, "value": v, "unit": self.unit,
                "decimals": self.decimals, "echo": self.echo}


def _fmt_number(v: float, d: int) -> str:
    if d == 0 and float(v).is_integer():
        return str(int(v))
    return f"{v:.{d}f}" if d else str(v)


class _Spans:
    def __init__(self) -> None:
        self.taken: list[tuple[int, int]] = []

    def free(self, a: int, b: int) -> bool:
        return all(b <= s or a >= e for s, e in self.taken)

    def take(self, a: int, b: int) -> None:
        self.taken.append((a, b))


def _today() -> date:
    return datetime.now(UTC).date()


def parse_number_text(text: str) -> tuple[float, int]:
    t = text.replace(",", "")
    d = len(t.split(".", 1)[1]) if "." in t else 0
    return float(t), d


def spelled_value(word: str) -> int | None:
    w = word.lower()
    if w in ("a", "an"):
        return 1
    if w in SPELLED:
        return SPELLED[w]
    parts = re.split(r"[- ]", w)
    if len(parts) == 2 and parts[0] in _TENS and parts[1] in _ONES:
        return _TENS[parts[0]] + _ONES[parts[1]]
    return None


def extract_candidates(sentence: str, *, gazetteer: Gazetteer | None = None,
                       last_user_message: str = "", as_of_date: date | None = None) -> list[Candidate]:
    text = sentence
    spans = _Spans()
    out: list[Candidate] = []

    def add(c: Candidate) -> None:
        spans.take(*c.span)
        out.append(c)

    # 0. Licence identifiers: claim the span so the version number inside it is
    #    never read as a measurement (see LICENCE_RE).
    for m in LICENCE_RE.finditer(text):
        spans.take(*m.span())

    # 1. ISO dates / datetimes
    for m in ISO_RE.finditer(text):
        try:
            d = date(int(m["y"]), int(m["mo"]), int(m["d"]))
        except ValueError:
            continue
        clock = (int(m["h"]), int(m["mi"]), (m["tz"] or "").upper()) if m["h"] else None
        add(Candidate("date", m.group(0), m.span(), value=d, entries=[]))
        if clock:
            out[-1].unit = "datetime"
            out[-1].value = (d, clock)
            out[-1].kind = "datetime"
    # 2. month-day / day-month
    for rx in (MONTH_DAY_RE, DAY_MONTH_RE):
        for m in rx.finditer(text):
            if not spans.free(*m.span()):
                continue
            mon = _MONTHS[m["mon"].lower()]
            day = int(m["d"])
            year = int(m["y"]) if m["y"] else (as_of_date or _today()).year
            try:
                d = date(year, mon, day)
            except ValueError:
                continue
            add(Candidate("date", m.group(0), m.span(), value=d))
    # 3. "the 7th" -> that day of the as_of month
    for m in ORDINAL_DAY_RE.finditer(text):
        if not spans.free(*m.span()):
            continue
        base = as_of_date or _today()
        try:
            d = date(base.year, base.month, int(m["d"]))
        except ValueError:
            continue
        add(Candidate("date", m.group(0), m.span(), value=d))
    # 4. relative durations
    for m in RELATIVE_RE.finditer(text):
        if not spans.free(*m.span()):
            continue
        n_text = m["n"]
        n = spelled_value(n_text)
        if n is None:
            n, _ = parse_number_text(n_text)
        unit_word = m["u"].lower()
        unit = ("h" if unit_word.startswith("h") else "d" if unit_word.startswith("d")
                else "min" if unit_word.startswith("m") else "d")
        secs = to_seconds(float(n), unit) or 0.0
        if unit_word.startswith("w"):
            secs = float(n) * 7 * 86400
        add(Candidate("relative", m.group(0).strip(), m.span(), value=secs, unit="s"))
    # 5. clock times
    for m in CLOCK_RE.finditer(text):
        if not spans.free(*m.span()):
            continue
        h, mi = int(m["h"]), int(m["mi"])
        tz = (m["tz"] or "").replace(".", "").upper()
        if tz == "PM" and h < 12:
            h += 12
        if tz == "AM" and h == 12:
            h = 0
        if h > 23 or mi > 59:
            continue
        add(Candidate("clock", m.group(0), m.span(), value=(h, mi, tz)))
    # 6. weekdays, today/yesterday
    for m in WEEKDAY_RE.finditer(text):
        if spans.free(*m.span()):
            add(Candidate("weekday", m.group(0), m.span(), value=WEEKDAYS[m["w"].lower()]))
    for m in RELDAY_RE.finditer(text):
        if spans.free(*m.span()):
            add(Candidate("relday", m.group(0), m.span(), value=m["w"].lower()))
    # 7. drought classes
    for m in DROUGHT_RE.finditer(text):
        if spans.free(*m.span()):
            add(Candidate("enum", m.group(0), m.span(), value=int(m["n"]), unit="dm"))
    # 8. gazetteer proper nouns
    if gazetteer is not None:
        for a, b, entries in gazetteer.find(text):
            if not spans.free(a, b):
                continue
            kind = "species" if entries and all(e.kind == "species" for e in entries) else "place"
            add(Candidate(kind, text[a:b], (a, b), value=text[a:b], entries=entries))
    # 9. numerals with optional unit
    for m in NUMBER_RE.finditer(text):
        a, b = m.span()
        if not spans.free(a, b):
            continue
        value, d = parse_number_text(m["n"])
        unit = None
        um = UNIT_AFTER_NUMBER_RE.match(text, b)
        if um and spans.free(b, um.end()):
            unit = normalize_unit(um["sym"] or um["word"])
            b = um.end()
        add(Candidate("number", text[a:b], (a, b), value=value, unit=unit, decimals=d))
    # 10. spelled-out numbers
    for m in SPELLED_RE.finditer(text):
        a, b = m.span()
        if not spans.free(a, b):
            continue
        value = spelled_value(m["w"])
        if value is None:
            continue
        unit = None
        um = UNIT_AFTER_NUMBER_RE.match(text, b)
        if um and um["word"] and spans.free(b, um.end()):
            unit = normalize_unit(um["word"])
            b = um.end()
        add(Candidate("number", text[a:b], (a, b), value=float(value), unit=unit, decimals=0))

    out.sort(key=lambda c: c.span[0])
    _tag_echo(out, last_user_message)
    return out


def _tag_echo(cands: list[Candidate], last_user_message: str) -> None:
    if not last_user_message:
        return
    low = last_user_message.lower()
    user_numbers = {parse_number_text(m["n"])[0] for m in NUMBER_RE.finditer(low)}
    for m in SPELLED_RE.finditer(low):
        v = spelled_value(m["w"])
        if v is not None:
            user_numbers.add(float(v))
    for c in cands:
        token = c.text.strip().lower()
        if c.kind == "number":
            num_text = re.match(_NUM, token.lstrip("-")) or re.match(r"[a-z-]+", token)
            core = num_text.group(0) if num_text else token
            if c.value in user_numbers or re.search(rf"(?<![\w.]){re.escape(core)}(?![\w.])", low):
                c.echo = True
        elif re.search(rf"(?<![\w]){re.escape(token)}(?![\w])", low):
            c.echo = True
