from factguard import FALLBACK, GATE_LINE, StreamingGuard, guard_text


def test_guard_releases_first_drops_second_and_appends_gate_line(sheet_stale, gazetteer):
    text = ("Flow at Orodell is 15.4 cfs, the last reading I have, from Friday. "
            "That's about 30% below normal for September.")
    g = guard_text(text, sheet_stale, gazetteer=gazetteer)
    assert [s.strip() for s in g.released] == [
        "Flow at Orodell is 15.4 cfs, the last reading I have, from Friday."]
    assert len(g.dropped) == 1 and [c.describe() for c in g.dropped[0][1]] == ["30 %"]
    assert g.final_text == ("Flow at Orodell is 15.4 cfs, the last reading I have, from Friday."
                            "\n\n" + GATE_LINE)
    assert g.events[0]["reason"] == "unmatched"


def test_guard_fallback_when_nothing_survives(sheet_fresh, gazetteer):
    g = guard_text("Flow is 99 cfs. Snow is 3 inches.", sheet_fresh, gazetteer=gazetteer)
    assert g.released == []
    assert g.final_text == FALLBACK


def test_streaming_guard_releases_sentence_by_sentence(sheet_fresh, gazetteer):
    g = StreamingGuard(sheet_fresh, gazetteer=gazetteer)
    out = []
    for tok in ["Flow at ", "Orodell is 15.4", " cfs. Snow", " at Niwot is 9 inches.",
                " Gross Reservoir is at 72 %."]:
        out.extend(g.feed(tok))
    assert [s.strip() for s in out] == ["Flow at Orodell is 15.4 cfs."]
    tail = g.finish()
    assert "Gross Reservoir is at 72 %." in tail and tail.rstrip().endswith(GATE_LINE)
    assert g.result.final_text.endswith(GATE_LINE)


def test_guard_passthrough_when_everything_matches(sheet_fresh, gazetteer):
    g = guard_text("Gross Reservoir is at 72 %. Water is 12 °C.", sheet_fresh, gazetteer=gazetteer)
    assert g.ok and g.final_text == "Gross Reservoir is at 72 %. Water is 12 °C."
