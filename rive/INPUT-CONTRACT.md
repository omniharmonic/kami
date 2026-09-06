# Rive input contract — what every Kami rig must implement

Source of truth: `docs/planning/02-technical-architecture.md` §9.2 (quoted
verbatim in §1) and `packages/needs/src/rive.ts` (`snapshotToRiveInputs`).
The web app binds these through `apps/web/src/lib/avatar/inputs.ts`
(`riveInputsToViewModel`) and `apps/web/src/components/avatar/rive-adapter.ts`.
If this file and the code disagree, the code is wrong — fix the code.

## 1. Architecture §9.2, verbatim

> Numbers `flow_pct, snow_pct, air_pct, temp_pct` (0–100 or −1 for absent),
> `alert_level` 0–3, `drought` 0–4, `mood` enum 0 asleep / 1 content /
> 2 concerned / 3 distressed / 4 celebrating, booleans `stale`, `paused`,
> `gpu_online`, `season` 0–3, `cosmetic_*`. Data-bound text: `headline_label`
> (the anchor need's label). The binding is one function
> `snapshotToRiveInputs()` with a unit test per rule below.

## 2. Names the runtime code expects

| Thing | Exact name | Notes |
|---|---|---|
| Artboard | *(default / first)* | one artboard per file; 1:1 aspect, 240×240 design units recommended |
| State machine | `Mood` | started by the runtime with `autoplay`; **not** started under reduced motion |
| ViewModel | `Kami` | the **default instance** is bound (`useViewModelInstance(…, { useDefault: true, rive })`) |
| Data enum for `mood` | `Mood` | values, in this order: `asleep`, `content`, `concerned`, `distressed`, `celebrating` |
| Runtime file | `apps/web/public/rigs/<archetype>/<version>/<archetype>.riv` | e.g. `/rigs/creek/v0/creek.riv` |

The code binds by data binding (ViewModel properties). State-machine inputs
are deprecated in the 4.34 runtime and are **not** read; if you also expose
them for editor testing that is fine, but the ViewModel is the contract.

## 3. ViewModel `Kami` — properties

Every property below must exist with exactly this name and type. Missing
properties are tolerated (skipped) by the runtime and listed on the dev page;
a rig is not accepted with any missing.

| Property | Rive type | Range / values | Meaning |
|---|---|---|---|
| `flow_pct` | Number | 0–100, or **−1 = absent** | percentile of streamflow vs record; −1 must read as "unknown", never as zero |
| `snow_pct` | Number | 0–100 or −1 | percentile of snow-water equivalent |
| `air_pct` | Number | 0–100 or −1 | **raw** percentile of the pollutant (high = more polluted than usual); do not invert in the rig |
| `temp_pct` | Number | 0–100 or −1 | reserved; −1 today |
| `alert_level` | Number | 0, 1, 2, 3 | NWS alert severity intersecting the boundary (3 = Extreme/Severe) |
| `drought` | Number | −1, 0, 1, 2, 3, 4 | USDM class (D0–D4); −1 = unknown |
| `mood` | Enum `Mood` | `asleep` (0) · `content` (1) · `concerned` (2) · `distressed` (3) · `celebrating` (4) | the pose; computed upstream, never by the rig |
| `stale` | Boolean | | a driving reading is stale → the grey "can't feel my gauge" look; always arrives with `mood = asleep` |
| `paused` | Boolean | | guardians paused the kami; asleep pose + a small cue |
| `gpu_online` | Boolean | | false = "my thinking machine is off"; asleep pose + a small cue |
| `season` | Number | 0 freeze · 1 runoff · 2 monsoon · 3 fall | scene and palette, not the face |
| `headline_label` | String | ≤ 120 chars, may be `""` | the anchor need's label, e.g. `15.4 cfs at Orodell, 2026-09-04 20:15Z, stale` |
| `cosmetic_hat` | Number | 0 = none, 1…n = variant | earned by humans (bounties, donations) |
| `cosmetic_scarf` | Number | 0 = none, 1…n | |
| `cosmetic_badge` | Number | 0 = none, 1…n | |
| `cosmetic_garland` | Number | 0 = none, 1…n | |

Additional `cosmetic_<name>` Number properties may be added; the runtime pushes
every `cosmetic_*` key it receives and skips unknown ones. Unknown variant
numbers must fall back to 0 (nothing) inside the rig.

## 4. Behavioural rules the rig must honour

1. **Mood is an input, not a decision.** The rig never infers mood from the
   numbers. `flow_pct = 3` with `mood = content` shows a content face.
2. **`stale` never looks distressed.** When `stale = true` (which only arrives
   with `mood = asleep`) the character is grey, eyes closed, listening — a
   cupped hand, a tilted head, a faint "…" — never crying, never the storm.
3. **Distressed is weather, not grief.** Wide eyes, a wavy mouth, a small
   cloud. No tears of despair, no gore, no death. The kami never dies.
4. **−1 means unknown.** Meters or scene elements driven by a `*_pct` input
   must show an "unknown" treatment at −1 (e.g. a dashed grey ring), never an
   empty bar.
5. **Reduced-motion rest pose.** With the state machine not started, the
   artboard's initial state must already show the mood pose for the bound
   `mood` value (put the pose on the data binding, not only on transitions).
6. **Seasons change the scene, not the face.** Freeze: snow/ice details;
   runoff: fuller water; monsoon: clouds and green; fall: warm palette.
7. **Colour never carries meaning alone.** Every state must survive greyscale.
8. **Performance.** 60 fps on a mid-range phone; `.riv` ≤ 250 KB; vectors only,
   no raster images, no fonts beyond one embedded or system fallback for
   `headline_label`.

## 5. How the runtime binds (for reference)

```
useRive({ src, stateMachines: "Mood", autoplay: !reducedMotion, autoBind: false, … })
viewModel = useViewModel(rive, { name: "Kami" }) ?? useViewModel(rive, { useDefault: true })
instance  = useViewModelInstance(viewModel, { useDefault: true, rive })
for each property: instance.number|boolean|string|enum(name).value = …
   (enum: by value name; falls back to valueIndex = the §9.2 number)
```

Runtime pinned: `@rive-app/react-canvas` 4.34.1 (`@rive-app/canvas` 2.42.0).
*verify* on each runtime upgrade: the hook names above and the
`ViewModelInstance.number/boolean/string/enum(path)` setters — the adapter is
the one file to change.
