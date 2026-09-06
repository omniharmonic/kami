"""kami-factguard: the fact-sheet matcher (ADR-E04)."""

from .atoms import (
    CountAtom,
    EnumAtom,
    FactSheet,
    NumberAtom,
    PlaceAtom,
    SpeciesAtom,
    TimeAtom,
)
from .extract import Candidate, extract_candidates
from .gazetteer import Gazetteer
from .guard import FALLBACK, GATE_LINE, STALE_TEMPLATE, GuardResult, StreamingGuard, guard_text
from .match import MatchResult, match_sentence
from .sentences import SentenceSplitter, split_sentences

__all__ = [
    "FALLBACK",
    "GATE_LINE",
    "STALE_TEMPLATE",
    "Candidate",
    "CountAtom",
    "EnumAtom",
    "FactSheet",
    "Gazetteer",
    "GuardResult",
    "MatchResult",
    "NumberAtom",
    "PlaceAtom",
    "SentenceSplitter",
    "SpeciesAtom",
    "StreamingGuard",
    "TimeAtom",
    "extract_candidates",
    "guard_text",
    "match_sentence",
    "split_sentences",
]
