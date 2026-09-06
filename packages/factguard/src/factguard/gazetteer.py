"""Gazetteer: place names/ids and commons titles used to recognise proper nouns in a reply.

Built from ``id/index.json`` names, commons place-note titles and commons species titles
(ADR-E04). Case-insensitive, multi-word, longest match wins.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Entry:
    name: str
    id: str | None = None
    kind: str = "place"  # "place" | "species"
    aliases: tuple[str, ...] = field(default_factory=tuple)


class Gazetteer:
    def __init__(self, entries: Iterable[Entry] = ()):
        self._by_name: dict[str, list[Entry]] = {}
        self._regex: re.Pattern[str] | None = None
        for e in entries:
            self.add_entry(e)

    # ---- construction -------------------------------------------------------------
    def add(self, name: str, id: str | None = None, kind: str = "place",
            aliases: Iterable[str] = ()) -> None:
        self.add_entry(Entry(name=name, id=id, kind=kind, aliases=tuple(aliases)))

    def add_entry(self, entry: Entry) -> None:
        for n in (entry.name, *entry.aliases):
            key = _norm(n)
            if not key:
                continue
            bucket = self._by_name.setdefault(key, [])
            if entry not in bucket:
                bucket.append(entry)
        self._regex = None

    @classmethod
    def from_places(cls, places: Iterable[dict]) -> Gazetteer:
        g = cls()
        for p in places:
            name = p.get("name")
            if not name:
                continue
            g.add(name, p.get("id"), "place", p.get("aliases") or ())
        return g

    @classmethod
    def from_dict(cls, doc: dict | list) -> Gazetteer:
        """``{"places": [{id, name, aliases?}], "species": [str | {name, scientific?}]}``
        or a bare list of place records (the shape of ``id/index.json``)."""
        if isinstance(doc, list):
            return cls.from_places(doc)
        g = cls.from_places(doc.get("places") or [])
        for s in doc.get("species") or []:
            if isinstance(s, str):
                g.add(s, None, "species")
            elif isinstance(s, dict) and s.get("name"):
                aliases = list(s.get("aliases") or [])
                if s.get("scientific"):
                    aliases.append(s["scientific"])
                g.add(s["name"], s.get("id"), "species", aliases)
        return g

    @classmethod
    def from_file(cls, path: str | Path) -> Gazetteer:
        with open(path, encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))

    def merged(self, other: Gazetteer | None) -> Gazetteer:
        g = Gazetteer()
        for bucket in self._by_name.values():
            for e in bucket:
                g.add_entry(e)
        if other is not None:
            for bucket in other._by_name.values():
                for e in bucket:
                    g.add_entry(e)
        return g

    # ---- queries ------------------------------------------------------------------
    def __len__(self) -> int:
        return len(self._by_name)

    def lookup(self, text: str) -> list[Entry]:
        return list(self._by_name.get(_norm(text), []))

    def _pattern(self) -> re.Pattern[str] | None:
        if self._regex is None and self._by_name:
            names = sorted(self._by_name, key=len, reverse=True)
            alt = "|".join(_flex(n) for n in names)
            self._regex = re.compile(rf"(?<![\w])(?:{alt})(?![\w])", re.IGNORECASE)
        return self._regex

    def find(self, text: str) -> list[tuple[int, int, list[Entry]]]:
        """All non-overlapping gazetteer mentions in ``text`` as (start, end, entries)."""
        pat = self._pattern()
        if pat is None:
            return []
        out = []
        for m in pat.finditer(text):
            out.append((m.start(), m.end(), self.lookup(m.group(0))))
        return out


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def _flex(norm_name: str) -> str:
    # whitespace in names matches any run of whitespace
    return r"\s+".join(re.escape(part) for part in norm_name.split(" "))
