from factguard import SentenceSplitter, split_sentences


def test_split_basic_and_abbreviations():
    text = ("Flow at Orodell is 15.4 cfs, the last reading I have, from Friday. That's about "
            "30% below normal for September. See e.g. the 7th! Really? Yes.")
    assert split_sentences(text) == [
        "Flow at Orodell is 15.4 cfs, the last reading I have, from Friday.",
        "That's about 30% below normal for September.",
        "See e.g. the 7th!",
        "Really?",
        "Yes.",
    ]


def test_unit_abbreviation_ends_sentence_but_decimals_do_not():
    assert split_sentences("Flow is 15.4 cfs. Storage is 72 percent.") == [
        "Flow is 15.4 cfs.", "Storage is 72 percent."]
    assert split_sentences("It rose from 0.4 to 0.44 cubic metres a second.") == [
        "It rose from 0.4 to 0.44 cubic metres a second."]


def test_streaming_token_boundaries_reproduce_text():
    text = "Flow is 15.4 cfs. Snow at Niwot is 0.0 in. Dr. Smith agrees, i.e. it's dry.\nNew line."
    tokens = [text[i:i + 3] for i in range(0, len(text), 3)]
    s = SentenceSplitter()
    segs = []
    for t in tokens:
        segs.extend(s.feed(t))
    segs.extend(s.flush())
    assert "".join(segs) == text
    assert [x.strip() for x in segs] == [
        "Flow is 15.4 cfs.", "Snow at Niwot is 0.0 in.",
        "Dr. Smith agrees, i.e. it's dry.", "New line."]


def test_terminator_at_chunk_end_waits_for_more():
    s = SentenceSplitter()
    assert s.feed("Flow is 15.") == []
    assert s.feed("4 cfs") == []
    assert s.feed(". Next") == ["Flow is 15.4 cfs."]
    assert s.flush() == [" Next"]
    assert s.flush() == []
