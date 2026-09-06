"""Per-sentence matching against the fact sheet (ADR-E04, precisely).

* number: after unit conversion from the fixed table,
  ``|reply − fact| ≤ 0.5 × 10^(−d)`` (d = displayed decimals) **and** relative error ≤ 2 %;
  a reply integer against a count atom or an integer-valued atom matches exactly;
* time: same ``America/Denver`` calendar day as an atom (dates, weekdays, today/yesterday),
  or the same hour ±1 h for relative forms and clock times; weekdays resolve to the most
  recent such weekday at or before the sheet's ``as_of``;
* place / species: by id or exact title (case-insensitive); a gazetteer name with no atom
  this turn fails;
* stale rule: a sentence using a ``stale: true`` number atom must also contain that
  atom's time (any accepted time form) or it fails with ``reason="stale_without_time"``;
* ``echo`` candidates (present in the last user message) always pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .atoms import Atom, CountAtom, EnumAtom, FactSheet, NumberAtom, PlaceAtom, SpeciesAtom
from .extract import Candidate, extract_candidates
from .gazetteer import Gazetteer
from .units import candidate_units, convert, is_time_unit, to_seconds

DEFAULT_TZ = "America/Denver"
REL_TOLERANCE = 0.02
HOUR = 3600.0


@dataclass
class MatchResult:
    ok: bool
    unmatched: list[Candidate] = field(default_factory=list)
    used_atoms: list[Atom] = field(default_factory=list)
    reason: str | None = None  # None | "unmatched" | "stale_without_time"
    stale_times: list[str | None] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "reason": self.reason,
            "unmatched": [c.to_dict() for c in self.unmatched],
            "stale_times": self.stale_times,
        }


# ---------------------------------------------------------------------------------------
# time helpers
# ---------------------------------------------------------------------------------------
def parse_instant(value: str | None) -> datetime | date | None:
    """ISO datetime -> aware datetime (UTC assumed when naive); date-only -> date."""
    if not value or not isinstance(value, str):
        return None
    v = value.strip()
    if len(v) == 10:
        try:
            return date.fromisoformat(v)
        except ValueError:
            return None
    if v.endswith(("Z", "z")):
        v = v[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def local_day(t: datetime | date, tz: ZoneInfo) -> date:
    if isinstance(t, datetime):
        return t.astimezone(tz).date()
    return t


def resolve_weekday(weekday: int, as_of: datetime | date, tz: ZoneInfo) -> date:
    """The most recent ``weekday`` (Mon=0) at or before ``as_of`` in ``tz``."""
    base = local_day(as_of, tz)
    return base - timedelta(days=(base.weekday() - weekday) % 7)


def _as_of_instant(sheet: FactSheet, now: datetime | None) -> datetime:
    t = parse_instant(sheet.as_of)
    if isinstance(t, datetime):
        return t
    if isinstance(t, date):
        return datetime(t.year, t.month, t.day, 12, tzinfo=UTC)
    return now or datetime.now(UTC)


# ---------------------------------------------------------------------------------------
# tolerance
# ---------------------------------------------------------------------------------------
def within_tolerance(reply: float, fact: float, decimals: int) -> bool:
    diff = abs(reply - fact)
    abs_tol = 0.5 * 10 ** (-decimals) + 1e-9
    if diff > abs_tol:
        return False
    if fact == 0:
        return diff <= abs_tol and abs(reply) <= abs_tol
    return diff <= REL_TOLERANCE * abs(fact) + 1e-12


def _is_integer_form(c: Candidate) -> bool:
    return c.decimals == 0 and float(c.value).is_integer()


# ---------------------------------------------------------------------------------------
# matchers per candidate kind
# ---------------------------------------------------------------------------------------
def _match_number(c: Candidate, sheet: FactSheet) -> list[Atom]:
    hits: list[Atom] = []
    units = candidate_units(c.unit) if c.unit else []
    for a in sheet.numbers:
        if units:
            if a.unit is None:
                continue
            for u in units:
                conv = convert(a.value, a.unit, u)
                if conv is not None and within_tolerance(c.value, conv, c.decimals):
                    hits.append(a)
                    break
        else:
            if _is_integer_form(c) and float(a.value).is_integer():
                if int(c.value) == int(a.value):
                    hits.append(a)
            elif within_tolerance(c.value, a.value, c.decimals):
                hits.append(a)
    if not c.unit and _is_integer_form(c):
        n = int(c.value)
        hits.extend(a for a in sheet.counts if a.value == n)
        hits.extend(a for a in sheet.enums if isinstance(a.value, int) and a.value == n)
    return hits


def _time_atoms(sheet: FactSheet) -> list[tuple[datetime | date, Atom]]:
    out: list[tuple[datetime | date, Atom]] = []
    for a in sheet.times:
        t = parse_instant(a.value)
        if t is not None:
            out.append((t, a))
    for a in sheet.numbers:
        t = parse_instant(a.time)
        if t is not None:
            out.append((t, a))
    return out


def _same_day_hits(day: date, sheet: FactSheet, tz: ZoneInfo) -> list[Atom]:
    return [a for t, a in _time_atoms(sheet) if local_day(t, tz) == day]


def _relative_hits(secs: float, sheet: FactSheet, now: datetime) -> list[Atom]:
    hits: list[Atom] = []
    target = now - timedelta(seconds=secs)
    for t, a in _time_atoms(sheet):
        if isinstance(t, datetime) and abs((target - t).total_seconds()) <= HOUR:
            hits.append(a)
    for a in sheet.numbers:
        if is_time_unit(a.unit):
            s = to_seconds(a.value, a.unit)
            if s is not None and abs(s - secs) <= HOUR:
                hits.append(a)
    return hits


def _clock_hits(c: Candidate, sheet: FactSheet, tz: ZoneInfo) -> list[Atom]:
    h, mi, tzword = c.value
    want = h * 60 + mi
    hits: list[Atom] = []
    for t, a in _time_atoms(sheet):
        if not isinstance(t, datetime):
            continue
        lt = t.astimezone(UTC) if tzword in ("Z", "UTC") else t.astimezone(tz)
        have = lt.hour * 60 + lt.minute
        delta = min(abs(want - have), 1440 - abs(want - have))
        if delta <= 60:
            hits.append(a)
    return hits


def _datetime_hits(c: Candidate, sheet: FactSheet, tz: ZoneInfo) -> list[Atom]:
    d, (h, mi, tzword) = c.value
    day_hits = _same_day_hits(d, sheet, tz) if tzword not in ("Z", "UTC") else [
        a for t, a in _time_atoms(sheet) if local_day(t, ZoneInfo("UTC")) == d]
    clock = Candidate("clock", c.text, c.span, value=(h, mi, tzword))
    clock_hits = _clock_hits(clock, sheet, tz)
    return [a for a in day_hits if any(a is b for b in clock_hits)]


def _enum_hits(c: Candidate, sheet: FactSheet) -> list[Atom]:
    n = int(c.value)
    hits: list[Atom] = []
    for a in sheet.enums:
        if a.name in ("dm", "drought_class", "drought_max_dm"):
            v = a.value
            if (isinstance(v, int) and v == n) or (isinstance(v, str) and v.upper() == f"D{n}"):
                hits.append(a)
    hits.extend(a for a in sheet.numbers if a.property in ("dm", "drought_max_dm")
                and float(a.value) == n)
    return hits


def _place_hits(c: Candidate, sheet: FactSheet) -> list[Atom]:
    text = c.text.strip().lower()
    ids = {e.id for e in c.entries if e.id}
    names = {text} | {e.name.lower() for e in c.entries} | {
        al.lower() for e in c.entries for al in e.aliases}
    hits: list[Atom] = []
    for a in sheet.places:
        if a.id in ids or a.name.lower() in names or any(al.lower() in names for al in a.aliases):
            hits.append(a)
    return hits


def _species_hits(c: Candidate, sheet: FactSheet) -> list[Atom]:
    text = c.text.strip().lower()
    names = {text} | {e.name.lower() for e in c.entries} | {
        al.lower() for e in c.entries for al in e.aliases}
    return [a for a in sheet.species
            if a.name.lower() in names or (a.scientific and a.scientific.lower() in names)]


def _sheet_gazetteer(sheet: FactSheet, gazetteer: Gazetteer | None) -> Gazetteer:
    g = Gazetteer()
    for a in sheet.places:
        if a.name:
            g.add(a.name, a.id, "place", a.aliases)
    for s in sheet.species:
        g.add(s.name, None, "species", [s.scientific] if s.scientific else ())
    return g.merged(gazetteer)


# ---------------------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------------------
def match_sentence(sentence: str, sheet: FactSheet, last_user_message: str = "",
                   now: datetime | None = None, tz: str = DEFAULT_TZ,
                   gazetteer: Gazetteer | None = None) -> MatchResult:
    zone = ZoneInfo(tz)
    as_of = _as_of_instant(sheet, now)
    now = now or as_of
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    as_of_day = local_day(as_of, zone)
    gaz = _sheet_gazetteer(sheet, gazetteer)
    cands = extract_candidates(sentence, gazetteer=gaz, last_user_message=last_user_message,
                               as_of_date=as_of_day)

    unmatched: list[Candidate] = []
    used: list[Atom] = []
    time_hits_by_cand: list[list[Atom]] = []
    number_hits: list[tuple[Candidate, list[Atom]]] = []

    for c in cands:
        if c.echo:
            continue
        hits: list[Atom]
        if c.kind == "number":
            hits = _match_number(c, sheet)
            number_hits.append((c, hits))
        elif c.kind == "date":
            hits = _same_day_hits(c.value, sheet, zone)
            time_hits_by_cand.append(hits)
        elif c.kind == "datetime":
            hits = _datetime_hits(c, sheet, zone)
            time_hits_by_cand.append(hits)
        elif c.kind == "weekday":
            hits = _same_day_hits(resolve_weekday(c.value, as_of, zone), sheet, zone)
            time_hits_by_cand.append(hits)
        elif c.kind == "relday":
            day = as_of_day - timedelta(days=1) if c.value == "yesterday" else as_of_day
            hits = _same_day_hits(day, sheet, zone)
            time_hits_by_cand.append(hits)
        elif c.kind == "relative":
            hits = _relative_hits(c.value, sheet, now)
            time_hits_by_cand.append(hits)
        elif c.kind == "clock":
            hits = _clock_hits(c, sheet, zone)
            time_hits_by_cand.append(hits)
        elif c.kind == "enum":
            hits = _enum_hits(c, sheet)
        elif c.kind == "place":
            hits = _place_hits(c, sheet)
        elif c.kind == "species":
            hits = _species_hits(c, sheet)
        else:
            hits = []
        if hits:
            used.extend(h for h in hits if not any(h is u for u in used))
        else:
            unmatched.append(c)

    if unmatched:
        return MatchResult(False, unmatched, used, "unmatched", candidates=cands)

    # the stale rule
    stale_missing: list[str | None] = []
    for c, hits in number_hits:
        if not hits or any(not (isinstance(h, NumberAtom) and h.stale) for h in hits):
            continue  # a fresh atom (or a count/enum) explains this number
        for h in hits:
            assert isinstance(h, NumberAtom)
            if not _stale_time_present(h, time_hits_by_cand) and h.time not in stale_missing:
                stale_missing.append(h.time)
    if stale_missing:
        return MatchResult(False, [], used, "stale_without_time", stale_times=stale_missing,
                           candidates=cands)
    return MatchResult(True, [], used, None, candidates=cands)


def _stale_time_present(atom: NumberAtom, time_hits_by_cand: list[list[Atom]]) -> bool:
    """Did some time candidate in the sentence match this atom's own time?"""
    if atom.time is None:
        return False
    for hits in time_hits_by_cand:
        for h in hits:
            if h is atom:
                return True
            h_time = getattr(h, "time", None) if isinstance(h, NumberAtom) else getattr(h, "value", None)
            if h_time and parse_instant(h_time) == parse_instant(atom.time):
                return True
    return False


__all__ = [
    "CountAtom",
    "EnumAtom",
    "MatchResult",
    "PlaceAtom",
    "SpeciesAtom",
    "local_day",
    "match_sentence",
    "parse_instant",
    "resolve_weekday",
    "within_tolerance",
]
