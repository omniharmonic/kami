#!/usr/bin/env node
/**
 * CLAUDE.md — "Mark anything unverified with *verify* and add it to `docs/verify.md`."
 *
 * Report only. This walks every `*verify*` marker in `docs/planning/**` (and, with `--all`, the
 * whole tree), extracts the distinctive words around it, and looks for a row in `docs/verify.md`
 * that mentions them. It never edits `docs/verify.md` — that file is owned elsewhere — and it
 * exits 0 by default so a fuzzy match can never block a build. `--strict` makes an unmatched
 * marker exit 1, for whoever wants it as a gate.
 *
 * Matching is deliberately generous: a marker counts as covered when a verify.md row shares two
 * or more distinctive words with it, or when the marker's own line names a docs/verify.md row
 * number. What it is good at is finding markers nobody has written down at all.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const strict = process.argv.includes("--strict");
const scanAll = process.argv.includes("--all");
const verifyFile = path.join(root, "docs", "verify.md");

if (!existsSync(verifyFile)) {
  console.error("FAIL: docs/verify.md does not exist");
  process.exit(1);
}

const verifyText = readFileSync(verifyFile, "utf8");
const verifyRows = verifyText
  .split("\n")
  .filter((l) => /^\s*\|\s*\d+\s*\|/.test(l))
  .map((l) => ({ n: Number(/^\s*\|\s*(\d+)/.exec(l)[1]), text: l.toLowerCase() }));

const STOP = new Set(
  ("the a an and or of to in on for with by from is are was were be been it its this that these those " +
    "verify not no yes if then than as at any all one two per via which what when where who whom how " +
    "we our you your they their he she his her i me my mine do does did done can could should would " +
    "will shall may might must have has had having but so such only same other another each every " +
    "into over under before after between during without within about against because while both few " +
    "more most some own too very just also still yet ever never always").split(/\s+/),
);

function words(s) {
  return [
    ...new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9._/#-]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !STOP.has(w)),
    ),
  ];
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", ".next", "dist", ".venv", "__pycache__", "coverage", "state", "test-results"].includes(entry)) continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = scanAll ? walk(root) : walk(path.join(root, "docs", "planning"));

const markers = [];
for (const file of files) {
  if (path.resolve(file) === path.resolve(verifyFile)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!/\*verify\*/i.test(line)) return;
    // The clause around the marker is what carries the meaning.
    const context = line.replace(/\|/g, " ").slice(Math.max(0, line.toLowerCase().indexOf("*verify*") - 140));
    markers.push({ file: path.relative(root, file), line: i + 1, text: line.trim(), keys: words(context) });
  });
}

const uncovered = [];
const covered = [];
for (const m of markers) {
  const named = /docs\/verify\.md\s*#?(\d+)/i.exec(m.text);
  if (named && verifyRows.some((r) => r.n === Number(named[1]))) {
    covered.push({ ...m, row: Number(named[1]) });
    continue;
  }
  let best = null;
  for (const row of verifyRows) {
    const hits = m.keys.filter((k) => row.text.includes(k)).length;
    if (!best || hits > best.hits) best = { row: row.n, hits };
  }
  if (best && best.hits >= 2) covered.push({ ...m, row: best.row });
  else uncovered.push(m);
}

console.log(`verify markers: ${markers.length} in ${scanAll ? "the tree" : "docs/planning"}; docs/verify.md has ${verifyRows.length} rows`);
console.log(`  matched to a row: ${covered.length}`);
console.log(`  no obvious row:   ${uncovered.length}`);
for (const m of uncovered) {
  console.log(`    ${m.file}:${m.line}  ${m.text.replace(/\s+/g, " ").slice(0, 150)}`);
}
if (uncovered.length) {
  console.log("");
  console.log("  These are candidates for a docs/verify.md row. Matching is by keyword, so some");
  console.log("  will already be covered by a row worded differently — read before adding.");
  console.log("  This check never edits docs/verify.md.");
}

process.exit(strict && uncovered.length ? 1 : 0);
