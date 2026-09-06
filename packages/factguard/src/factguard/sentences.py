"""Incremental sentence splitter usable on a token stream.

``feed(chunk)`` returns the raw segments that were completed by this chunk (leading
whitespace preserved so the concatenation of all segments reproduces the stream);
``flush()`` returns the remainder at end of stream. A boundary is a run of ``.!?…``
(optionally followed by closing quotes/brackets) that is followed by whitespace, unless
the token before it is a decimal, an initial, or a known abbreviation ("e.g.", "vs.",
"approx.", month abbreviations). Unit abbreviations such as "cfs." *do* end a sentence.
Newlines also end a sentence.
"""

from __future__ import annotations

import re

_ABBREV = {
    "e.g", "i.e", "etc", "vs", "cf", "approx", "ca", "mr", "mrs", "ms", "dr", "prof",
    "st", "mt", "fig", "u.s", "a.m", "p.m", "jan", "feb", "mar", "apr", "jun", "jul",
    "aug", "sep", "sept", "oct", "nov", "dec", "inc", "ltd",
}
_TERMINATOR = re.compile(r"[.!?…]+[\"'”’)\]]*")
_WORD_BEFORE = re.compile(r"([A-Za-z][\w.]*)$")


class SentenceSplitter:
    def __init__(self) -> None:
        self._buf = ""

    def feed(self, chunk: str) -> list[str]:
        if not chunk:
            return []
        self._buf += chunk
        out: list[str] = []
        while True:
            idx = self._boundary(self._buf)
            if idx is None:
                break
            out.append(self._buf[:idx])
            self._buf = self._buf[idx:]
        return out

    def flush(self) -> list[str]:
        rest, self._buf = self._buf, ""
        return [rest] if rest.strip() else []

    @property
    def pending(self) -> str:
        return self._buf

    @staticmethod
    def _boundary(buf: str) -> int | None:
        # newline boundary: text before a newline that has content
        nl = buf.find("\n")
        first_nl = nl if nl != -1 and buf[:nl].strip() else None
        for m in _TERMINATOR.finditer(buf):
            end = m.end()
            if first_nl is not None and end > first_nl:
                break
            if end >= len(buf):
                return None  # cannot decide yet (decimal? abbreviation?) — wait for more
            if not buf[end].isspace():
                continue  # "15.4", "e.g.x", URLs
            before = buf[: m.start()]
            wm = _WORD_BEFORE.search(before)
            if wm and m.group(0).startswith("."):
                word = wm.group(1).lower().rstrip(".")
                if word in _ABBREV or (len(word) == 1 and word.isalpha() and before[-2:-1] in ("", " ")):
                    continue
            return end
        if first_nl is not None:
            return first_nl
        return None


def split_sentences(text: str) -> list[str]:
    s = SentenceSplitter()
    parts = s.feed(text) + s.flush()
    return [p.strip() for p in parts if p.strip()]
