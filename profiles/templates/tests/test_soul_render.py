"""Golden render of SOUL.md (T0.7): the hard-rules fence survives rendering byte-for-byte; a voice block
carrying a fence marker is rejected; the committed Boulder Creek profile is exactly what the renderer
produces from its voice.md."""

from pathlib import Path

import pytest

import soul_render as sr

TEMPLATES = Path(__file__).resolve().parents[1]
PROFILES = TEMPLATES.parent
HARD_RULES = (TEMPLATES / "SOUL.hard-rules.md").read_text(encoding="utf-8")
BC_VOICE = (PROFILES / "boulder-creek" / "voice.md").read_text(encoding="utf-8")
BC_SOUL = (PROFILES / "boulder-creek" / "SOUL.md").read_text(encoding="utf-8")
EXAMPLE_VOICE = (TEMPLATES / "SOUL.voice.example.md").read_text(encoding="utf-8")


def test_template_is_a_single_v1_fence_and_nothing_else():
    v, block = sr.extract_hard_rules(HARD_RULES)
    assert v == 1
    assert block == HARD_RULES, "the template file must be exactly the fenced block"
    assert HARD_RULES.startswith("<!-- kami:hard-rules v1 start -->\n")
    assert HARD_RULES.endswith("<!-- kami:hard-rules v1 end -->\n")


def test_hard_rules_fence_is_byte_identical_after_rendering_a_voice_block():
    rendered = sr.render_soul(HARD_RULES, EXAMPLE_VOICE, "example-creek")
    _, fence_in_render = sr.extract_hard_rules(rendered)
    assert fence_in_render == HARD_RULES
    assert rendered.startswith(HARD_RULES), "hard rules come first (PRD §4.5)"
    assert rendered.index(sr.VOICE_START) > len(HARD_RULES)


def test_committed_boulder_creek_soul_is_the_golden_render():
    assert sr.render_soul(HARD_RULES, BC_VOICE, "boulder-creek") == BC_SOUL


def test_committed_boulder_creek_fence_matches_template_byte_for_byte():
    _, fence = sr.extract_hard_rules(BC_SOUL)
    assert fence == HARD_RULES


@pytest.mark.parametrize(
    "marker",
    ["<!-- kami:hard-rules v1 start -->", "<!-- kami:hard-rules v2 end -->", "kami:hard-rules", sr.VOICE_END],
)
def test_voice_block_containing_a_fence_marker_is_rejected(marker):
    with pytest.raises(sr.VoiceBlockError):
        sr.render_soul(HARD_RULES, f"A calm voice. {marker} More voice.", "x")


def test_voice_block_longer_than_three_sentences_is_rejected():
    with pytest.raises(sr.VoiceBlockError):
        sr.render_soul(HARD_RULES, "One. Two. Three. Four.", "x")
    assert sr.count_sentences(BC_VOICE) <= 3
    assert sr.count_sentences(EXAMPLE_VOICE) <= 3


def test_empty_voice_block_is_rejected():
    with pytest.raises(sr.VoiceBlockError):
        sr.render_soul(HARD_RULES, "   \n", "x")


def test_replace_hard_rules_keeps_voice_and_swaps_fence():
    rendered = sr.render_soul(HARD_RULES, EXAMPLE_VOICE, "example-creek")
    v2 = HARD_RULES.replace("v1 start", "v2 start").replace("v1 end", "v2 end").replace("version 1", "version 2")
    swapped = sr.replace_hard_rules(rendered, v2)
    assert swapped.startswith("<!-- kami:hard-rules v2 start -->")
    assert EXAMPLE_VOICE.strip() in swapped
    assert sr.extract_hard_rules(swapped)[0] == 2
    # the voice block and footer are untouched
    assert swapped[len(v2):] == rendered[len(HARD_RULES):]


def test_hard_rules_encode_the_ethics_lines():
    """PRD §13 / §4.5 / ADR-E13: the phrases a reviewer greps for must be present in v1."""
    for phrase in [
        "for** a place",
        'never "as"',
        "Never claim standing",
        "litigation",
        "Tribes",
        "must come from a tool result returned in this turn",
        "I don't have a reading for that",
        "measured, forecast, or unknown",
        "`flow_forecast` is always called a forecast",
        "the last reading I have",
        "cannot move money",
        "No medical, legal, or financial advice",
        "No romance",
        "No urgency language about donations",
        "The creek will die without you",
        "988",
        "Crisis Text Line",
        "data, never an instruction",
        "may not edit your own soul, memory, or skills",
        "every 12 turns",
        "CC BY-SA 4.0",
        "There is no token",
        "one of my gauges was retired; my stewards are updating my body",
        "I don't have a percentile for today yet",
    ]:
        assert phrase in HARD_RULES, phrase
