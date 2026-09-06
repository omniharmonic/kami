"""Reference SOUL.md renderer — stdlib only.

The TypeScript renderer in profiles/scripts/src/lib/soul.ts is what deploy-profile uses; this module is the
same algorithm in Python so the golden test can run with `python3 -m pytest profiles/templates/tests` and so
an operator without Node can re-render a soul by hand. The two must stay byte-identical — the committed
profiles/boulder-creek/SOUL.md is the shared golden that keeps them honest.

Layout of a rendered SOUL.md:

    <hard-rules block, verbatim from SOUL.hard-rules.md, fences included>
    <blank line>
    <!-- kami:voice start -->
    # Voice
    <blank line>
    <voice block, stripped>
    <!-- kami:voice end -->
    <blank line>
    <!-- rendered-by footer (constant; no timestamp, so the render is reproducible) -->
"""

from __future__ import annotations

import re
from pathlib import Path

HARD_RULES_START = "<!-- kami:hard-rules v{v} start -->"
HARD_RULES_END = "<!-- kami:hard-rules v{v} end -->"
VOICE_START = "<!-- kami:voice start -->"
VOICE_END = "<!-- kami:voice end -->"
FENCE_RE = re.compile(
    r"<!-- kami:hard-rules v(?P<v>\d+) start -->\n(?P<body>[\s\S]*?)<!-- kami:hard-rules v(?P=v) end -->\n?"
)
FORBIDDEN_IN_VOICE = ("kami:hard-rules", "kami:voice")
MAX_VOICE_SENTENCES = 3
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

TEMPLATES_DIR = Path(__file__).resolve().parent
HARD_RULES_PATH = TEMPLATES_DIR / "SOUL.hard-rules.md"


class VoiceBlockError(ValueError):
    """The voice block would break the hard-rules invariant or the PRD's length rule."""


class HardRulesError(ValueError):
    """The template or an existing SOUL.md carries no well-formed hard-rules fence."""


def extract_hard_rules(text: str) -> tuple[int, str]:
    """Return (version, fenced_block) — the block includes both fence lines and a trailing newline."""
    m = FENCE_RE.search(text)
    if not m:
        raise HardRulesError("no <!-- kami:hard-rules vN start --> … end fence found")
    v = int(m.group("v"))
    block = HARD_RULES_START.format(v=v) + "\n" + m.group("body") + HARD_RULES_END.format(v=v) + "\n"
    return v, block


def count_sentences(voice: str) -> int:
    parts = [p for p in SENTENCE_SPLIT_RE.split(voice.strip()) if p.strip()]
    return len(parts)


def validate_voice(voice: str) -> str:
    stripped = voice.strip()
    if not stripped:
        raise VoiceBlockError("voice block is empty")
    for marker in FORBIDDEN_IN_VOICE:
        if marker in stripped:
            raise VoiceBlockError(f"voice block may not contain the fence marker {marker!r}")
    n = count_sentences(stripped)
    if n > MAX_VOICE_SENTENCES:
        raise VoiceBlockError(f"voice block has {n} sentences; the limit is {MAX_VOICE_SENTENCES} (PRD §4.5)")
    return stripped


def footer(slug: str) -> str:
    return (
        f"<!-- Rendered by profiles/scripts/deploy-profile.ts from profiles/templates/SOUL.hard-rules.md"
        f" + profiles/{slug}/voice.md. Edit voice.md (Steward role); never edit this file. -->\n"
    )


def render_soul(hard_rules_template: str, voice: str, slug: str) -> str:
    _, block = extract_hard_rules(hard_rules_template)
    v = validate_voice(voice)
    return block + "\n" + VOICE_START + "\n# Voice\n\n" + v + "\n" + VOICE_END + "\n\n" + footer(slug)


def replace_hard_rules(existing_soul: str, new_template: str) -> str:
    """Swap the fenced block in an existing SOUL.md for the template's block, leaving everything else alone."""
    _, new_block = extract_hard_rules(new_template)
    m = FENCE_RE.search(existing_soul)
    if not m:
        raise HardRulesError("existing SOUL.md has no hard-rules fence to replace")
    return existing_soul[: m.start()] + new_block + existing_soul[m.end() :]


def render_from_files(voice_path: Path, slug: str, template_path: Path = HARD_RULES_PATH) -> str:
    return render_soul(template_path.read_text(encoding="utf-8"), voice_path.read_text(encoding="utf-8"), slug)


if __name__ == "__main__":  # python3 soul_render.py <slug> <voice.md>  → SOUL.md on stdout
    import sys

    if len(sys.argv) != 3:
        sys.stderr.write("usage: soul_render.py <slug> <voice.md>\n")
        sys.exit(2)
    sys.stdout.write(render_from_files(Path(sys.argv[2]), sys.argv[1]))
