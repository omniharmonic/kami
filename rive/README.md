# rive/ — avatar rigs

Everything about the Kami avatars that is not code: the commissioning brief,
the input contract the rigs must implement, the rig sources, and the generator
for the SVG fallbacks.

## Layout

```
rive/
  README.md              this file
  BRIEF.md               the commissioning brief (implementation plan T1.8)
  INPUT-CONTRACT.md      the §9.2 inputs verbatim + the names the code expects
  fallback-src/gen.mjs   generates apps/web/public/rigs/fallback/*.svg (25 files)
  <archetype>/<version>/ one folder per delivered rig version:
    README.md            status, artist, licence, checklist result
    <archetype>.rev      Rive source (editor file)  — committed
    <archetype>.riv      runtime export             — committed AND copied to
                         apps/web/public/rigs/<archetype>/<version>/<archetype>.riv
```

Archetypes: `creek`, `mountain`, `reservoir`, `watershed` (commissioned) and
`bioregion` (optional). Versions are `v0`, `v1`, … — never overwrite a version
the site has shipped; add the next one and bump `rigManifest` in
`apps/web/src/lib/avatar/rigs.ts`.

## The fallback rule

The static SVGs under `apps/web/public/rigs/fallback/<archetype>-<mood>.svg`
are **authoritative** for an archetype until

1. a `.riv` exists at `apps/web/public/rigs/<archetype>/<version>/<archetype>.riv`,
2. every item on the dev checklist page `/dev/rig/<archetype>` is ticked, and
3. `rigManifest[<archetype>].available` is flipped to `true` in a reviewed change.

Even then the SVG stays in the page: it paints first, it is the pose when the
viewer prefers reduced motion, it is what the OG image is made from, and it is
what renders when the runtime fails to load or throws (architecture §9.4).

Regenerate the SVGs with `node rive/fallback-src/gen.mjs` from the repo root;
they must stay ≤ 6 KB each, `viewBox="0 0 240 240"`, with a `<title>`, no
scripts and no external references (tested in
`apps/web/src/lib/avatar/__tests__/svgs.test.ts`).

## Rules that bind every asset here

- The kami **never dies**. No death, no decay-to-nothing, no gravestones.
- **Stale ≠ sad.** `asleep` is "listening for a quiet gauge": eyes closed,
  attentive, grey palette. Never the distressed pose, never tears.
- No shrine or religious iconography (docs/naming.md). The word "kami" names
  the product; the entities are software.
- Nothing that implies legal standing, threat, or speaking *as* the place.
- Cosmetics are earned by humans (bounties, donations) — never by data.
- Colour never carries meaning alone; every state also has a shape or a word.
