# kami-factguard

The fact-sheet matcher behind `entity-gate` (ADR-E04). A sentence is released only when
every candidate it contains — numbers, dates, weekdays, relative durations, gazetteer
place and species names — matches an atom extracted from a `role: tool` message that
followed the last `role: user` message of the same turn.

```
python -m factguard check --sheet request_or_facts.json --text "Flow at Orodell is 15.4 cfs." [--user "..."] [--gazetteer g.json]
```

`schemas/facts-1.0.json` is a byte-identical copy of `packages/facts-schema/facts-1.0.json`
(a test asserts it).
