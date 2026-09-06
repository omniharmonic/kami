#!/usr/bin/env node
/**
 * Generates apps/web/public/rigs/fallback/<archetype>-<mood>.svg (25 files).
 *
 * The bodies and faces below are hand-authored path data; this script only
 * composes them so that a face tweak lands in all five archetypes at once.
 * Run: node rive/fallback-src/gen.mjs   (from the repo root)
 *
 * Rules (architecture §9.4, PRD §6.3): asleep = "listening for a quiet gauge",
 * greyed, never sad; distressed = wide eyes + wavy mouth + a tiny cloud, never
 * gore, never tears of despair; the kami never dies. No shrine iconography.
 * Palette through CSS variables with concrete fallbacks so an inlined SVG can
 * be themed and an <img> or OG render still gets the right colours.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../apps/web/public/rigs/fallback");

const INK = "#26221d";
const CHEEK = "#e9a3a0";
const STALE = "#9a958e";
const SPARK = "#e0a34a";

/** Per-archetype palette: body accent, soft highlight, extra part colour. */
const PALETTE = {
  creek: { accent: "#2f6f8f", soft: "#8fc3d9", extra: "#f2f7f9" },
  mountain: { accent: "#6f7d8c", soft: "#5e8a5a", extra: "#f7f5f1" },
  reservoir: { accent: "#3b7ea1", soft: "#8fc3d9", extra: "#a39a8c" },
  watershed: { accent: "#4f7d4a", soft: "#dbe9f0", extra: "#86b57f" },
  bioregion: { accent: "#e0a34a", soft: "#5e8a5a", extra: "#6f7d8c" },
};
/** Asleep: the stale grey family. Distinct from every mood colour, and labelled. */
const ASLEEP_PALETTE = { accent: STALE, soft: "#c9c4bc", extra: "#b8b3ab" };

const ARCHETYPES = Object.keys(PALETTE);
const MOODS = ["asleep", "content", "concerned", "distressed", "celebrating"];
const MOOD_TITLE = {
  asleep: "asleep (listening for a quiet gauge)",
  content: "content",
  concerned: "concerned",
  distressed: "distressed",
  celebrating: "celebrating",
};
const ARCHETYPE_TITLE = { creek: "Creek", mountain: "Mountain", reservoir: "Reservoir", watershed: "Watershed", bioregion: "Bioregion" };

const r = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Faces. All coordinates relative to a face centre (cx, cy).
// ---------------------------------------------------------------------------
function eyesOpen(cx, cy, rad = 6.5) {
  return [
    `<circle class="i" cx="${cx - 22}" cy="${cy - 6}" r="${rad}"/>`,
    `<circle class="i" cx="${cx + 22}" cy="${cy - 6}" r="${rad}"/>`,
    `<circle class="w" cx="${cx - 20}" cy="${cy - 8}" r="2.2"/>`,
    `<circle class="w" cx="${cx + 24}" cy="${cy - 8}" r="2.2"/>`,
  ].join("");
}
function cheeks(cx, cy, rx = 9, ry = 5.5) {
  return `<ellipse class="c" cx="${cx - 38}" cy="${cy + 8}" rx="${rx}" ry="${ry}"/><ellipse class="c" cx="${cx + 38}" cy="${cy + 8}" rx="${rx}" ry="${ry}"/>`;
}
function sparkle(x, y, s = 1) {
  return `<path class="k" transform="translate(${x} ${y}) scale(${s})" d="M0 -10Q1.5 -1.5 10 0Q1.5 1.5 0 10Q-1.5 1.5 -10 0Q-1.5 -1.5 0 -10z"/>`;
}

const FACE = {
  content: (cx, cy) =>
    eyesOpen(cx, cy) + cheeks(cx, cy) + `<path class="l" d="M${cx - 14} ${cy + 12}q14 13 28 0"/>`,

  concerned: (cx, cy) =>
    eyesOpen(cx, cy, 6) +
    cheeks(cx, cy, 8, 4.5) +
    // worried brows: inner ends raised
    `<path class="l" d="M${cx - 34} ${cy - 20}l18 -6M${cx + 16} ${cy - 26}l18 6"/>` +
    // small frown
    `<path class="l" d="M${cx - 11} ${cy + 19}q11 -8 22 0"/>`,

  distressed: (cx, cy) =>
    // wide eyes: sclera ring + pupil
    `<circle class="wr" cx="${cx - 22}" cy="${cy - 6}" r="9.5"/><circle class="wr" cx="${cx + 22}" cy="${cy - 6}" r="9.5"/>` +
    `<circle class="i" cx="${cx - 22}" cy="${cy - 5}" r="4"/><circle class="i" cx="${cx + 22}" cy="${cy - 5}" r="4"/>` +
    // raised brows
    `<path class="l" d="M${cx - 34} ${cy - 28}q12 -10 24 -4M${cx + 10} ${cy - 32}q12 -6 24 4"/>` +
    cheeks(cx, cy, 8, 4.5) +
    // wavy mouth
    `<path class="l" d="M${cx - 16} ${cy + 17}q4 -6 8 0t8 0t8 0t8 0"/>` +
    // a tiny storm cloud with two rain dashes — weather, not grief
    `<g transform="translate(${cx + 46} ${cy - 62})"><circle class="g" cx="0" cy="0" r="9"/><circle class="g" cx="12" cy="-6" r="12"/><circle class="g" cx="25" cy="0" r="9"/><rect class="g" x="-4" y="0" width="38" height="9" rx="4.5"/><path class="q" d="M6 15l-3 8M20 15l-3 8"/></g>`,

  celebrating: (cx, cy) =>
    // closed happy eyes (∩)
    `<path class="l" d="M${cx - 30} ${cy - 4}q8 -13 16 0M${cx + 14} ${cy - 4}q8 -13 16 0"/>` +
    cheeks(cx, cy, 10, 6) +
    // big open smile
    `<path class="i" d="M${cx - 16} ${cy + 10}h32q-16 24 -32 0z"/>` +
    sparkle(cx - 62, cy - 50, 1) +
    sparkle(cx + 60, cy - 58, 1.2) +
    sparkle(cx + 56, cy + 36, 0.7),

  asleep: (cx, cy) =>
    // eyes closed, relaxed (soft U) — listening, not grieving
    `<path class="l" d="M${cx - 30} ${cy - 6}q8 8 16 0M${cx + 14} ${cy - 6}q8 8 16 0"/>` +
    cheeks(cx, cy, 8, 4.5) +
    // small calm smile
    `<path class="l" d="M${cx - 8} ${cy + 15}q8 5 16 0"/>` +
    // a cupped hand at the ear
    `<g transform="translate(${cx + 46} ${cy - 2}) rotate(-20)"><ellipse class="hd" rx="10" ry="14"/><circle class="hd" cx="-9" cy="7" r="4.5"/><path class="q" d="M-4 -11v9M1 -12v10M6 -10v8"/></g>` +
    // faint sound arcs: "listening for a quiet gauge"
    `<path class="q" d="M${cx + 64} ${cy - 16}a16 16 0 0 1 0 28M${cx + 74} ${cy - 24}a24 24 0 0 1 0 44"/>` +
    // a "…" thought bubble
    `<g transform="translate(${cx + 34} ${cy - 76})"><rect class="bb" x="0" y="0" width="46" height="26" rx="13"/><path class="bb" d="M10 24l-4 10 12 -8z"/><circle class="g" cx="13" cy="13" r="3"/><circle class="g" cx="23" cy="13" r="3"/><circle class="g" cx="33" cy="13" r="3"/></g>`,
};

// ---------------------------------------------------------------------------
// Bodies. Each returns { before, after, face: [cx, cy] } — parts drawn under
// and over the face.
// ---------------------------------------------------------------------------
const BODY = {
  creek: () => ({
    // a ribbon of water that swells into a round belly where the face lives
    before:
      `<path class="rb" d="M18 44C56 40 76 66 100 92"/>` +
      `<path class="rb" d="M140 146C166 170 186 198 224 196"/>` +
      `<circle class="b" cx="120" cy="116" r="60"/>` +
      // shimmer streaks
      `<path class="rs" d="M28 46c14 0 24 8 34 18M154 158c12 12 26 26 42 30"/>` +
      `<path class="rs" d="M80 84q10 -16 30 -22"/>` +
      // riffle hat: three little crests of foam
      `<path class="x" d="M72 70a16 16 0 0 1 32 0a16 16 0 0 1 32 0a16 16 0 0 1 32 0z"/>` +
      `<circle class="x" cx="66" cy="78" r="3.5"/><circle class="x" cx="175" cy="77" r="3"/>`,
    after: "",
    face: [120, 122],
  }),

  mountain: () => ({
    before:
      // little trees at the foot
      `<path class="s" d="M46 200l10 -24 10 24zM172 200l10 -24 10 24z"/>` +
      // the peak
      `<path class="b" d="M120 36C128 36 134 46 140 58L206 176C214 190 208 200 192 200H48C32 200 26 190 34 176L100 58C106 46 112 36 120 36Z"/>` +
      // snow cap with a scalloped edge
      `<path class="x" d="M120 36C128 36 134 46 140 58L159 92Q150 80 142 96Q132 84 122 100Q112 84 100 96Q92 82 81 92L100 58C106 46 112 36 120 36Z"/>`,
    after: "",
    face: [120, 142],
  }),

  reservoir: () => ({
    before:
      // the pool
      `<circle class="b" cx="120" cy="104" r="72"/>` +
      `<path class="rs" d="M72 66q14 -12 30 -8M62 88q10 -10 22 -8"/>` +
      // the dam wall as a brim, with a spillway and a little spill below
      `<path class="s" d="M110 190q4 18 -4 30h28q-8 -12 -4 -30z"/>` +
      `<rect class="x" x="24" y="160" width="192" height="34" rx="14"/>` +
      `<rect class="s" x="104" y="160" width="32" height="7" rx="3"/>`,
    after: "",
    face: [120, 104],
  }),

  watershed: () => ({
    before:
      // stem
      `<path class="st" d="M52 194q-10 10 -14 24"/>` +
      // leaf-shaped basin
      `<path class="b" d="M190 44C100 34 30 98 50 196C140 208 208 130 190 44Z"/>` +
      // tributaries as veins, joining the midrib
      `<path class="v" d="M58 188L182 52M96 148l-30 -22M120 124l-32 -32M148 94l-24 -34M108 134l30 24M136 106l32 16M162 78l20 10"/>` +
      // a calm pool for the face
      `<circle class="b" cx="116" cy="118" r="40"/>`,
    after: "",
    face: [116, 118],
  }),

  bioregion: () => ({
    before:
      // sun rays
      `<path class="ry" d="M120 22v14M62 46l10 10M178 46l-10 10M36 104h14M204 104h-14"/>` +
      // the sun
      `<circle class="b" cx="120" cy="104" r="58"/>`,
    after:
      // back range and front hills, drawn over the sun's lower half
      `<path class="x" d="M0 178C30 142 62 134 92 156C122 124 162 118 200 156C220 146 232 154 240 166V216H0Z"/>` +
      `<path class="s" d="M0 204C40 180 80 176 120 196C160 174 200 178 240 200V228H0Z"/>`,
    face: [120, 96],
  }),
};

function styleBlock(p, mood) {
  const soft = mood === "asleep" ? "#7f7a73" : INK;
  const cheek = mood === "asleep" ? "#cfc4c0" : CHEEK;
  return (
    `<style>` +
    `.b{fill:var(--kami-accent,${p.accent})}` +
    `.s{fill:var(--kami-accent-soft,${p.soft})}` +
    `.x{fill:var(--kami-extra,${p.extra})}` +
    `.i{fill:var(--kami-ink,${soft})}` +
    `.w{fill:#fff}` +
    `.wr{fill:#fff;stroke:var(--kami-ink,${soft});stroke-width:3}` +
    `.c{fill:var(--kami-cheek,${cheek})}` +
    `.l{fill:none;stroke:var(--kami-ink,${soft});stroke-width:5;stroke-linecap:round;stroke-linejoin:round}` +
    `.q{fill:none;stroke:var(--kami-stale,${STALE});stroke-width:3;stroke-linecap:round}` +
    `.g{fill:var(--kami-stale,${STALE})}` +
    `.k{fill:var(--kami-spark,${SPARK})}` +
    `.hd{fill:var(--kami-accent,${p.accent});stroke:var(--kami-ink,${soft});stroke-width:3}` +
    `.bb{fill:#fff;stroke:var(--kami-stale,${STALE});stroke-width:2}` +
    `.rb{fill:none;stroke:var(--kami-accent,${p.accent});stroke-width:40;stroke-linecap:round}` +
    `.rs{fill:none;stroke:var(--kami-accent-soft,${p.soft});stroke-width:6;stroke-linecap:round;opacity:.9}` +
    `.v{fill:none;stroke:var(--kami-accent-soft,${p.soft});stroke-width:4;stroke-linecap:round}` +
    `.st{fill:none;stroke:var(--kami-extra,${p.extra});stroke-width:6;stroke-linecap:round}` +
    `.ry{fill:none;stroke:var(--kami-accent,${p.accent});stroke-width:7;stroke-linecap:round}` +
    `</style>`
  );
}

function svg(archetype, mood) {
  const p = mood === "asleep" ? ASLEEP_PALETTE : PALETTE[archetype];
  const body = BODY[archetype]();
  const [cx, cy] = body.face;
  const title = `${ARCHETYPE_TITLE[archetype]} — ${MOOD_TITLE[mood]}`;
  const desc =
    mood === "asleep"
      ? "Eyes closed, a hand cupped to the ear, listening for a quiet gauge. Grey because the reading is stale, not because anything is wrong."
      : `A friendly ${archetype} character, ${mood}.`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t" data-archetype="${archetype}" data-mood="${mood}">` +
    `<title id="t">${title}</title><desc>${desc}</desc>` +
    styleBlock(p, mood) +
    body.before +
    FACE[mood](cx, cy) +
    body.after +
    `</svg>\n`
  );
}

mkdirSync(OUT, { recursive: true });
let max = 0;
for (const a of ARCHETYPES) {
  for (const m of MOODS) {
    const out = svg(a, m);
    max = Math.max(max, Buffer.byteLength(out));
    writeFileSync(join(OUT, `${a}-${m}.svg`), out);
  }
}
console.log(`wrote ${ARCHETYPES.length * MOODS.length} SVGs to ${OUT}; largest ${max} bytes`);
