# Commissioning brief — Kami avatar rigs (Rive)

**Project:** Kami — AI voices *for* places (creeks, mountains, reservoirs,
watersheds), grounded in public sensor data and tended by human guardians.
**Owner / contact:** Benjamin Life (@omniharmonic).
**Task reference:** implementation plan T1.8 (creek first), T3.4 (the rest).
**Runtime:** Rive, `@rive-app/react-canvas` 4.34.x with data binding.

## 1. What this is

Each kami has a small, friendly 2D character whose pose follows measured
conditions — streamflow percentile, snowpack, air quality, drought class,
alerts — computed by code, never by the character or by an AI. Think of a
Tamagotchi that **cannot die** and is **never sad because a sensor went
offline**. The character sits at the top of a phone-first web page above the
line "I'm an AI voice for Boulder Creek, built on public sensor data — not the
creek, not a legal person."

We are commissioning **four rigs** (one per archetype), with an optional fifth:

| Archetype | Character idea (from our fallbacks — improve on them freely) |
|---|---|
| `creek` | a ribbon of water that swells into a round face, a little riffle of foam as a hat |
| `mountain` (mountain/ridge) | a snow-capped peak with rosy cheeks and a couple of trees at its foot |
| `reservoir` | a round pool with a dam wall as a brim and a small spill below |
| `watershed` | a leaf-shaped basin whose tributaries are veins |
| `bioregion` *(optional)* | a soft sun rising behind a range silhouette |

Our hand-drawn SVG fallbacks for every archetype × mood are in
`apps/web/public/rigs/fallback/` — they set the tone (rounded, warm, small
faces, no outlines heavier than 5 units at 240) but you are free to redraw the
bodies as long as the archetype stays recognisable at 120 px.

## 2. Deliverables per rig

1. One `.rev` source and one `.riv` export, under `rive/<archetype>/<version>/`
   in this repository (we copy the `.riv` to `apps/web/public/rigs/…`).
2. One artboard, square, designed at 240×240 units, transparent background.
3. A state machine named **`Mood`** and a ViewModel named **`Kami`** with the
   properties in `rive/INPUT-CONTRACT.md` §3 — **names verbatim**; the runtime
   binds by exact name and the dev page reports any missing property.
4. **Five mood poses**, each distinct at a glance and in greyscale:
   - `content` — soft smile, open eyes.
   - `concerned` — tilted brows, small frown.
   - `distressed` — wide eyes, wavy mouth, a tiny storm cloud. Weather, not
     grief.
   - `celebrating` — closed happy eyes, sparkles (human-caused only — a bounty
     was completed).
   - `asleep` = **"listening for a quiet gauge"** — eyes closed, attentive: a
     hand cupped to the ear or a tilted head, a faint "…" bubble, a grey
     palette. **Never sad, never the distressed pose, never tears.** This is
     the pose for a gauge that has gone silent; it must read as patience.
5. **Four seasons** (`season` 0 freeze, 1 runoff, 2 monsoon, 3 fall) that change
   the scene and palette, not the face.
6. **~8 swappable parts and colour bindings** — e.g. hat/crown, eyes, mouth,
   cheeks, body highlight, scene prop, sky tint, water tint — so the creation
   flow can vary characters without new art. Document the part names in the
   version README.
7. **Cosmetic slots** `cosmetic_hat`, `cosmetic_scarf`, `cosmetic_badge`,
   `cosmetic_garland` (Number; 0 = none; unknown → none), each with at least
   two variants. Cosmetics are earned by human actions, never by data.
8. A **`stale` look distinct from `distressed`**: grey family, closed eyes; may
   coexist with any season.
9. A **reduced-motion rest pose**: with the state machine *not started*, the
   bound `mood` value must already show the right pose (bind the pose to the
   data, not only to transitions). No looping idle motion is required for
   acceptance; if you add idle breathing, keep it under 2 % scale.
10. `paused` and `gpu_online = false` each add a small cue on top of the
    asleep pose (e.g. a tiny pause glyph; a dim lamp). Small — the word is
    shown as text beside the avatar anyway.
11. Numbers at **−1 mean unknown**: any meter or scene element driven by a
    `*_pct` input must show an "unknown" treatment (dashed, grey), never zero.
12. Performance: **60 fps on a mid-range phone**, `.riv` ≤ 250 KB, vectors
    only, no raster images. One text run for `headline_label` (≤ 120 chars,
    two lines, must not overflow).

## 3. What you must never draw

- **Death, dying, decay-to-nothing, gravestones, skulls.** The kami never dies.
- **Crying rivers, tears of despair, wailing.** Distress is weather, not grief.
- **Shrine, torii, religious or Shinto iconography, halos, prayer.** The word
  "kami" names the product; the entities are software and claim no religious
  authority (docs/naming.md).
- **Anything implying legal standing or authority**: gavels, scales of
  justice, badges of office, uniforms, flags, borders, seals, "official" marks.
- **Humans or human-like bodies** beyond a small stylised hand; no faces that
  read as a specific person or people.
- **Money, coins, tokens, charts of value.** No token, ever.
- Text inside the artwork other than the bound `headline_label`.

## 4. Style

Rounded, warm, small. Two to three body colours plus ink (`#26221d`) and a
cheek pink (`#e9a3a0`). Stale grey is `#9a958e` with `#c9c4bc` highlights; do
not reuse it for anything else. Our page palette is in
`apps/web/src/app/globals.css` (`--accent #2f6f8f`, `--moss #4f7d4a`,
`--warm #b8743a`, `--stale #9a958e`). Colour must never be the only carrier of
a state.

## 5. Acceptance

The dev page **`/dev/rig/<archetype>`** in the web app drives every input with
sliders and toggles, shows your rig beside our SVG fallbacks, reports missing
ViewModel properties, and carries this checklist (kept in
`apps/web/src/lib/avatar/checklist.ts`):

1. Five moods, each a distinct pose at a glance.
2. Asleep reads as listening for a quiet gauge — never sad.
3. `stale = true` visibly distinct from `distressed`, in colour and greyscale.
4. Four seasons change scene and palette, not the face.
5. `−1` renders as unknown, never as zero.
6. `alert_level` and `drought` change scene details without changing the pose.
7. `headline_label` binds and wraps at two lines.
8. Each `cosmetic_*` slot swaps its part; 0 shows nothing.
9. `paused` and `gpu_online = false` share the asleep pose with their own cue.
10. Reduced-motion rest pose shows the correct mood with the machine stopped.
11. 60 fps on a mid-range phone; `.riv` ≤ 250 KB.
12. Greyscale check passes for every mood.
13. Nothing from §3 appears.

A rig is accepted when every box is ticked on a real phone by the owner; the
creek rig gates phase 1, the other three are due by phase 3.

## 6. Timeline

| When | What |
|---|---|
| Week 0 | Brief accepted; licence chosen (§7); artist receives repo access to `rive/` |
| Week 1 | Creek: body + five mood poses as stills for review (any format) |
| Week 2 | Creek `.riv` with `Mood` state machine and `Kami` ViewModel — checklist run on the dev page |
| Week 3 | Creek revisions; seasons, cosmetics, parts documented → **creek accepted** |
| Weeks 4–8 | Mountain, reservoir, watershed, one per ~10 working days, same loop |
| Optional | Bioregion |

## 7. Licence — owner to choose one before work starts

*verify* Rive's current plan tiers and runtime licence terms before signing
(implementation plan risk #9, docs/verify.md #15).

- **Option A — Apache-2.0 for the rig files.** The `.rev`/`.riv` are licensed
  like the rest of the repository; anyone may reuse them with attribution.
  Simplest; matches the project's "public infrastructure" stance.
- **Option B — a named art licence.** Artwork under CC BY 4.0 (or CC BY-SA 4.0
  to match the commons prose), attribution to the artist by name in
  `rive/<archetype>/<version>/README.md` and on the "How I work" page. The
  project holds a perpetual, irrevocable licence to use, modify and
  redistribute the rigs within Kami.
- Either way: the artist retains portfolio rights; the artist's name is
  credited in the version README; no exclusivity is required of the artist.

## 8. Handover checklist

- [ ] `rive/<archetype>/<version>/<archetype>.rev` and `.riv` committed
- [ ] `rive/<archetype>/<version>/README.md` — artist, licence, part names,
      cosmetic variants, known limits
- [ ] all 13 checklist items ticked on `/dev/rig/<archetype>` on a phone
- [ ] `rigManifest[<archetype>].available = true` in a reviewed change
