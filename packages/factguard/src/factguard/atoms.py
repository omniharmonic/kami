"""Atoms and the fact sheet (facts-1.0).

``FactSheet.from_tool_messages`` extracts atoms from every ``role: "tool"`` message that
follows the last ``role: "user"`` message of an OpenAI chat request (ADR-E04). Tool content
is JSON text and is walked generically:

* any object with ``value`` and (``unit`` or ``property``) is a **number** atom;
* keys ``time`` / ``as_of`` / ``valid_until`` / ``until`` / ``deadline`` / ``period_end``
  are **time** atoms;
* objects with an ``id`` matching ``^[a-z_]+/[a-z0-9-]+$`` and a ``name`` are **place**
  atoms (bare ``place_id`` strings yield id-only place atoms);
* every JSON array yields a **count** atom ``of=<key>``;
* keys ``dm`` / ``drought_class`` / ``flood_category`` / ``source_status`` / ``mood``
  (and ``drought_max_dm``) yield **enum** atoms;
* objects under a ``species`` key, or with ``kind: "species"``, yield **species** atoms;
* other numeric leaves (e.g. ``staleness_s``, ``detections_24h``, ``week.min``) become
  number atoms with ``property=<key>``; a unit is inferred from a key suffix
  (``_s`` → s, ``_pct`` → %, ...) or inherited from the enclosing reading for
  ``min/max/last/mean/median``.

A document already in facts-1.0 shape (``schema_version: "1.0"`` + ``atoms``) is accepted
verbatim.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

PLACE_ID_RE = re.compile(r"^[a-z_]+/[a-z0-9-]+$")
_ISOISH_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")

TIME_KEYS = {"time", "as_of", "valid_until", "until", "deadline", "period_end"}
ENUM_KEYS = {"dm", "drought_class", "flood_category", "source_status", "mood", "drought_max_dm"}
PLACE_REF_KEYS = {"place_id", "id", "parent_id", "anchor", "place", "superseded_by"}
_INHERIT_UNIT_KEYS = {"min", "max", "last", "mean", "median", "value"}
_KEY_UNIT_SUFFIX = (
    ("_pct", "%"), ("_percent", "%"), ("_cfs", "[ft_i]3/s"), ("_mm", "mm"), ("_cm", "cm"),
    ("_in", "[in_i]"), ("_ft", "ft"), ("_m", "m"), ("_hours", "h"), ("_h", "h"),
    ("_days", "d"), ("_d", "d"), ("_min", "min"), ("_s", "s"), ("_c", "Cel"), ("_f", "[degF]"),
    ("_sqkm", None),
)
_SKIP_NUMERIC_KEYS = {"schema_version", "limit", "cursor", "ttl_ms", "ttlms", "status_code",
                      "lat", "lon", "latitude", "longitude", "zoom", "page", "page_size",
                      "index", "idx", "version", "contract_version"}

CONFIG_PREFIX = "KAMI_ENTITY_CONFIG:"


# ---------------------------------------------------------------------------------------
# atom kinds
# ---------------------------------------------------------------------------------------
@dataclass
class NumberAtom:
    value: float
    unit: str | None = None
    property: str | None = None
    place_id: str | None = None
    time: str | None = None
    stale: bool = False
    staleness_s: float | None = None
    source_id: str | None = None
    forecast: bool = False
    label: str | None = None
    kind: str = field(default="number", init=False)


@dataclass
class TimeAtom:
    value: str
    role: str | None = None
    place_id: str | None = None
    property: str | None = None
    kind: str = field(default="time", init=False)


@dataclass
class PlaceAtom:
    id: str
    name: str
    aliases: list[str] = field(default_factory=list)
    kind: str = field(default="place", init=False)


@dataclass
class SpeciesAtom:
    name: str
    scientific: str | None = None
    note_path: str | None = None
    kind: str = field(default="species", init=False)


@dataclass
class CountAtom:
    value: int
    of: str
    place_id: str | None = None
    kind: str = field(default="count", init=False)


@dataclass
class EnumAtom:
    name: str
    value: str | int
    place_id: str | None = None
    kind: str = field(default="enum", init=False)


Atom = NumberAtom | TimeAtom | PlaceAtom | SpeciesAtom | CountAtom | EnumAtom


def atom_to_dict(atom: Atom) -> dict[str, Any]:
    d = asdict(atom)
    d = {"kind": d.pop("kind"), **d}
    return d


def atom_from_dict(d: dict[str, Any]) -> Atom | None:
    kind = d.get("kind")
    try:
        if kind == "number":
            return NumberAtom(
                value=float(d["value"]), unit=d.get("unit"), property=d.get("property"),
                place_id=d.get("place_id"), time=d.get("time"), stale=bool(d.get("stale", False)),
                staleness_s=d.get("staleness_s"), source_id=d.get("source_id"),
                forecast=bool(d.get("forecast", False)), label=d.get("label"))
        if kind == "time":
            return TimeAtom(value=str(d["value"]), role=d.get("role"), place_id=d.get("place_id"),
                            property=d.get("property"))
        if kind == "place":
            return PlaceAtom(id=d["id"], name=d.get("name", ""), aliases=list(d.get("aliases") or []))
        if kind == "species":
            return SpeciesAtom(name=d["name"], scientific=d.get("scientific"),
                               note_path=d.get("note_path"))
        if kind == "count":
            return CountAtom(value=int(d["value"]), of=d["of"], place_id=d.get("place_id"))
        if kind == "enum":
            return EnumAtom(name=d["name"], value=d["value"], place_id=d.get("place_id"))
    except (KeyError, TypeError, ValueError):
        return None
    return None


# ---------------------------------------------------------------------------------------
# the fact sheet
# ---------------------------------------------------------------------------------------
@dataclass
class _Ctx:
    place_id: str | None = None
    unit: str | None = None
    time: str | None = None
    stale: bool = False
    staleness_s: float | None = None
    source_id: str | None = None
    property: str | None = None
    in_reading: bool = False


@dataclass
class FactSheet:
    as_of: str | None = None
    atoms: list[Atom] = field(default_factory=list)
    source_tool: str | None = None
    tree_generated_at: str | None = None
    schema_version: str = "1.0"

    # ---- views ------------------------------------------------------------------
    @property
    def numbers(self) -> list[NumberAtom]:
        return [a for a in self.atoms if isinstance(a, NumberAtom)]

    @property
    def times(self) -> list[TimeAtom]:
        return [a for a in self.atoms if isinstance(a, TimeAtom)]

    @property
    def places(self) -> list[PlaceAtom]:
        return [a for a in self.atoms if isinstance(a, PlaceAtom)]

    @property
    def species(self) -> list[SpeciesAtom]:
        return [a for a in self.atoms if isinstance(a, SpeciesAtom)]

    @property
    def counts(self) -> list[CountAtom]:
        return [a for a in self.atoms if isinstance(a, CountAtom)]

    @property
    def enums(self) -> list[EnumAtom]:
        return [a for a in self.atoms if isinstance(a, EnumAtom)]

    def __len__(self) -> int:
        return len(self.atoms)

    # ---- (de)serialisation --------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "as_of": self.as_of,
            "tree_generated_at": self.tree_generated_at,
            "source_tool": self.source_tool,
            "atoms": [atom_to_dict(a) for a in self.atoms],
        }

    @classmethod
    def from_dict(cls, doc: dict[str, Any]) -> FactSheet:
        sheet = cls(as_of=doc.get("as_of"), source_tool=doc.get("source_tool"),
                    tree_generated_at=doc.get("tree_generated_at"))
        for raw in doc.get("atoms") or []:
            if isinstance(raw, dict):
                atom = atom_from_dict(raw)
                if atom is not None:
                    sheet.atoms.append(atom)
        return sheet

    @staticmethod
    def is_facts_document(doc: Any) -> bool:
        return (isinstance(doc, dict) and doc.get("schema_version") == "1.0"
                and isinstance(doc.get("atoms"), list))

    # ---- construction -------------------------------------------------------------
    @classmethod
    def from_tool_messages(cls, messages: list[dict[str, Any]], *,
                           include_config: bool = True) -> FactSheet:
        """Atoms from every tool message after the last user message, plus the
        platform-injected ``KAMI_ENTITY_CONFIG:`` system block (if any)."""
        sheet = cls()
        last_user = -1
        for i, m in enumerate(messages):
            if m.get("role") == "user":
                last_user = i
        for m in messages[last_user + 1:]:
            if m.get("role") != "tool":
                continue
            doc = parse_json_text(content_text(m.get("content")))
            if doc is None:
                continue
            sheet.ingest(doc)
        if include_config:
            for m in messages:
                if m.get("role") != "system":
                    continue
                text = content_text(m.get("content")).lstrip()
                if text.startswith(CONFIG_PREFIX):
                    cfg = parse_json_text(text[len(CONFIG_PREFIX):])
                    if isinstance(cfg, dict):
                        sheet.add_config(cfg)
        return sheet

    @classmethod
    def from_json_text(cls, text: str) -> FactSheet:
        sheet = cls()
        doc = parse_json_text(text)
        if doc is not None:
            sheet.ingest(doc)
        return sheet

    def ingest(self, doc: Any) -> None:
        """Add the atoms of one tool result (facts-1.0 verbatim, or a generic JSON walk)."""
        if self.is_facts_document(doc):
            other = FactSheet.from_dict(doc)
            self.atoms.extend(other.atoms)
            self._bump_as_of(other.as_of)
            if other.tree_generated_at and not self.tree_generated_at:
                self.tree_generated_at = other.tree_generated_at
            return
        # MCP result envelopes: {"content": [{"type": "text", "text": "<json>"}]}
        if isinstance(doc, dict) and isinstance(doc.get("content"), list) and all(
                isinstance(p, dict) and p.get("type") == "text" for p in doc["content"]):
            for part in doc["content"]:
                inner = parse_json_text(part.get("text", ""))
                if inner is not None:
                    self.ingest(inner)
            if "structuredContent" in doc:
                self.ingest(doc["structuredContent"])
            return
        if isinstance(doc, dict):
            if isinstance(doc.get("as_of"), str):
                self._bump_as_of(doc["as_of"])
            if isinstance(doc.get("tree_generated_at"), str) and not self.tree_generated_at:
                self.tree_generated_at = doc["tree_generated_at"]
        self._walk(doc, None, _Ctx())

    def add_config(self, cfg: dict[str, Any]) -> None:
        """The platform-injected entity config block (caps, guardian names, ...)."""
        self._walk(cfg, "config", _Ctx())

    def _bump_as_of(self, value: str | None) -> None:
        if isinstance(value, str) and (self.as_of is None or value > self.as_of):
            self.as_of = value

    # ---- the generic walk -----------------------------------------------------------
    def _walk(self, node: Any, key: str | None, ctx: _Ctx) -> None:
        if isinstance(node, dict):
            self._walk_dict(node, key, ctx)
        elif isinstance(node, list):
            for item in node:
                if isinstance(item, str):
                    if key == "species":
                        self.atoms.append(SpeciesAtom(name=item))
                    elif PLACE_ID_RE.match(item):
                        self._add_place(item, None)
                else:
                    self._walk(item, key, ctx)

    def _walk_dict(self, d: dict[str, Any], key: str | None, ctx: _Ctx) -> None:
        # species objects
        if d.get("kind") == "species" or key == "species":
            name = d.get("name") or d.get("title") or d.get("common_name")
            if isinstance(name, str):
                self.atoms.append(SpeciesAtom(name=name, scientific=d.get("scientific")
                                              or d.get("scientific_name"),
                                              note_path=d.get("note_path") or d.get("path")))
            if key == "species" and d.get("kind") != "species":
                pass  # still walk: a species note may carry readings
        ctx = _Ctx(**{k: getattr(ctx, k) for k in _Ctx.__dataclass_fields__})
        # place objects and place references
        for ref_key in ("place_id", "id"):
            v = d.get(ref_key)
            if isinstance(v, str) and PLACE_ID_RE.match(v):
                ctx.place_id = v
                name = d.get("name") if ref_key == "id" else None
                aliases = d.get("aliases") if ref_key == "id" else None
                self._add_place(v, name if isinstance(name, str) else None,
                                aliases if isinstance(aliases, list) else None)
                break
        for ref_key in PLACE_REF_KEYS - {"place_id", "id"}:
            v = d.get(ref_key)
            if isinstance(v, str) and PLACE_ID_RE.match(v):
                self._add_place(v, None)
        # reading context
        if isinstance(d.get("time"), str):
            ctx.time = d["time"]
        if isinstance(d.get("stale"), bool):
            ctx.stale = d["stale"]
        if isinstance(d.get("staleness_s"), (int, float)) and not isinstance(d["staleness_s"], bool):
            ctx.staleness_s = float(d["staleness_s"])
        if isinstance(d.get("source_id"), str):
            ctx.source_id = d["source_id"]
        if isinstance(d.get("property"), str):
            ctx.property = d["property"]
        is_reading = "value" in d and ("unit" in d or "property" in d)
        if is_reading:
            ctx.in_reading = True
            ctx.unit = d.get("unit") if isinstance(d.get("unit"), str) else None
            v = d.get("value")
            if _is_number(v):
                self.atoms.append(NumberAtom(
                    value=float(v), unit=ctx.unit, property=ctx.property, place_id=ctx.place_id,
                    time=ctx.time, stale=ctx.stale, staleness_s=ctx.staleness_s,
                    source_id=ctx.source_id, forecast=bool(d.get("forecast", False)),
                    label=d.get("label") if isinstance(d.get("label"), str) else None))
            elif isinstance(v, str) and ctx.property in ENUM_KEYS:
                self.atoms.append(EnumAtom(name=ctx.property, value=v, place_id=ctx.place_id))
        for k, v in d.items():
            if isinstance(v, bool) or v is None:
                continue
            if k in TIME_KEYS and isinstance(v, str) and _ISOISH_RE.match(v):
                role = "reading_time" if k == "time" else k
                self.atoms.append(TimeAtom(value=v, role=role, place_id=ctx.place_id,
                                           property=ctx.property))
                continue
            if k in ENUM_KEYS and isinstance(v, (str, int, float)):
                val: str | int = v if isinstance(v, str) else int(v)
                self.atoms.append(EnumAtom(name=k, value=val, place_id=ctx.place_id))
                if k in ("dm", "drought_max_dm") and _is_number(v):
                    self.atoms.append(NumberAtom(value=float(v), property=k, place_id=ctx.place_id))
                continue
            if k == "species":
                if isinstance(v, str):
                    self.atoms.append(SpeciesAtom(name=v))
                else:
                    self._walk(v, k, ctx)
                continue
            if isinstance(v, list):
                self.atoms.append(CountAtom(value=len(v), of=k, place_id=ctx.place_id))
                self._walk(v, k, ctx)
                continue
            if isinstance(v, dict):
                self._walk(v, k, ctx)
                continue
            if _is_number(v):
                if is_reading and k == "value":
                    continue
                if k.lower() in _SKIP_NUMERIC_KEYS:
                    continue
                unit, inherit = _unit_for_key(k, ctx)
                self.atoms.append(NumberAtom(
                    value=float(v), unit=unit, property=k, place_id=ctx.place_id,
                    time=ctx.time if inherit else None, stale=ctx.stale if inherit else False,
                    staleness_s=ctx.staleness_s if inherit else None,
                    source_id=ctx.source_id if inherit else None))

    def _add_place(self, pid: str, name: str | None, aliases: list[str] | None = None) -> None:
        for a in self.atoms:
            if isinstance(a, PlaceAtom) and a.id == pid:
                if name and (not a.name or a.name == _humanise(pid)):
                    a.name = name
                if aliases:
                    for al in aliases:
                        if al not in a.aliases:
                            a.aliases.append(al)
                return
        self.atoms.append(PlaceAtom(id=pid, name=name or _humanise(pid),
                                    aliases=list(aliases or [])))


# ---------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------
def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _unit_for_key(key: str, ctx: _Ctx) -> tuple[str | None, bool]:
    """(unit, inherit_reading_context) for a bare numeric leaf."""
    lk = key.lower()
    if lk in _INHERIT_UNIT_KEYS and ctx.in_reading:
        return ctx.unit, True
    for suffix, unit in _KEY_UNIT_SUFFIX:
        if lk.endswith(suffix):
            return unit, False
    if lk in ("staleness", "age"):
        return "s", False
    return None, False


def _humanise(pid: str) -> str:
    slug = pid.split("/", 1)[-1]
    return " ".join(p.capitalize() for p in slug.split("-"))


def content_text(content: Any) -> str:
    """OpenAI message content as text (string or list of text parts)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict) and isinstance(p.get("text"), str):
                parts.append(p["text"])
            elif isinstance(p, str):
                parts.append(p)
        return "\n".join(parts)
    return ""


def parse_json_text(text: str) -> Any | None:
    """Parse JSON text; also tolerates a JSON object embedded in surrounding prose."""
    if not isinstance(text, str):
        return None
    t = text.strip()
    if not t:
        return None
    try:
        return json.loads(t)
    except ValueError:
        pass
    start = min((i for i in (t.find("{"), t.find("[")) if i != -1), default=-1)
    if start == -1:
        return None
    dec = json.JSONDecoder()
    try:
        obj, _ = dec.raw_decode(t[start:])
        return obj
    except ValueError:
        return None
