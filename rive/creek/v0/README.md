# creek / v0 — pending commission

There is **no `.riv` here yet.** The creek rig is commissioned (see
`rive/BRIEF.md`; implementation plan T1.8) and cannot be authored in this
repository: a Rive file needs the Rive editor and an artist.

Until the commissioned `creek.riv` lands in this folder and is copied to
`apps/web/public/rigs/creek/v0/creek.riv`, **the SVG fallback is
authoritative**: `apps/web/public/rigs/fallback/creek-<mood>.svg` renders on the page, in the OG image and on
the dev bench. `rigManifest.creek.available` is `false` in
`apps/web/src/lib/avatar/rigs.ts` and must stay `false` until the checklist at
`/dev/rig/creek` passes on a phone.

What the T1.7 "placeholder rig (a one-state test `.riv`)" would have verified —
that the runtime loads, binds `mood` and `stale`, and holds 60 fps — is
therefore deferred to the first delivery; the loading, binding and fallback
paths are covered by unit tests with the runtime mocked instead
(`apps/web/src/components/__tests__/`).

When the rig arrives, fill in:

- **Artist:**
- **Licence:** (Apache-2.0 or the named art licence — BRIEF.md §7)
- **Swappable parts:**
- **Cosmetic variants:** `cosmetic_hat` …, `cosmetic_scarf` …, `cosmetic_badge` …, `cosmetic_garland` …
- **Checklist run:** date, device, result
