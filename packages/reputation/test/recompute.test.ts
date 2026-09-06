import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical.js";
import { diffJson, parseArgs, recomputeFromInputs, run } from "../src/recompute.js";
import { OfflineBundle, ReputationFile } from "../src/types.js";
import { buildNightlyFile, writeNightlyFile } from "../src/v1.js";
import { NOW, agedIso, att, prediction, resetSeq } from "./fixtures.js";

beforeEach(resetSeq);

const scenario = () => {
  const deposit = att({ verification_tier: 4, usd_at_stake: 120, attested_at: agedIso(40) });
  const attestations = [
    att(),
    att({ outcome: 1, usd_at_stake: 10, attested_at: agedIso(200) }),
    att({ subject: "bob", outcome: 2, verification_tier: 3 }),
    att({ subject: "bob", entity_id: "entity/coal-creek", usd_at_stake: 300 }),
    deposit,
    att({ verification_tier: 4, usd_at_stake: 80, follow_up_of: deposit.uid }),
    att({ outcome: 3 }),
    att({ revoked: true, outcome: 2 }),
  ];
  const predictions = [prediction(), prediction({ observed_direction: "up" })];
  const passport = new Map([["alice", 31.5], ["bob", 4]]);
  return { attestations, predictions, passport };
};

describe("recompute round-trip (T2.13: byte-for-byte)", () => {
  it("nightly writer → offline recompute → identical bytes (pure API)", () => {
    const { attestations, predictions, passport } = scenario();
    const { file, json } = buildNightlyFile(attestations, { now: NOW, passport, predictions });
    // The published file goes through JSON (as it would from R2) before recompute.
    const published = ReputationFile.parse(JSON.parse(json));
    const res = recomputeFromInputs(published, [...attestations].reverse(), { predictions, passport });
    expect(res.identical).toBe(true);
    expect(res.recomputedJson).toBe(json);
    expect(res.publishedJson).toBe(json);
    expect(res.carried).toEqual([]);
    expect(res.diff).toEqual([]);
    expect(json).toBe(canonicalJson(file));
    expect(json).not.toMatch(/\s/);
  });

  it("carries passport_ok and entity_scores when their inputs are not supplied, and still reproduces", () => {
    const { attestations, predictions, passport } = scenario();
    const { json } = buildNightlyFile(attestations, { now: NOW, passport, predictions });
    const published = ReputationFile.parse(JSON.parse(json));
    const res = recomputeFromInputs(published, attestations);
    expect(res.carried).toEqual(["passport_ok", "entity_scores"]);
    expect(res.identical).toBe(true);
  });

  it("detects a tampered score, a missing attestation, and a passport change", () => {
    const { attestations, predictions, passport } = scenario();
    const { json } = buildNightlyFile(attestations, { now: NOW, passport, predictions });

    const tampered = ReputationFile.parse(JSON.parse(json));
    const rowIdx = tampered.scores.findIndex((s) => s.subject === "bob" && s.entity === null);
    tampered.scores[rowIdx]!.score = 99;
    const r1 = recomputeFromInputs(tampered, attestations, { predictions, passport });
    expect(r1.identical).toBe(false);
    expect(r1.diff.map((d) => d.path)).toEqual([`$.scores[${rowIdx}].score`]);
    expect(r1.diff[0]!.published).toBe(99);

    const published = ReputationFile.parse(JSON.parse(json));
    const r2 = recomputeFromInputs(published, attestations.slice(1), { predictions, passport });
    expect(r2.identical).toBe(false);
    expect(r2.diff.some((d) => d.path.startsWith("$.inputs"))).toBe(true);
    expect(r2.diff.some((d) => d.path === "$.root_of_uids")).toBe(true);

    const r3 = recomputeFromInputs(published, attestations, { predictions, passport: new Map([["alice", 0], ["bob", 4]]) });
    expect(r3.identical).toBe(false);
    expect(r3.diff.every((d) => d.path.endsWith(".passport_ok"))).toBe(true);
  });

  it("CLI: writeNightlyFile → kami-reputation-recompute --offline → exit 0; tampered → exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kami-reputation-"));
    const { attestations, predictions, passport } = scenario();
    const scoresPath = join(dir, "2026-09-06.json");
    const { json } = await writeNightlyFile(scoresPath, attestations, { now: NOW, passport, predictions });
    expect(await readFile(scoresPath, "utf8")).toBe(json);

    const bundlePath = join(dir, "bundle.json");
    const bundle = { attestations, predictions, passport: Object.fromEntries(passport) };
    OfflineBundle.parse(bundle);
    await writeFile(bundlePath, JSON.stringify(bundle, null, 2));

    const out: string[] = [];
    const err: string[] = [];
    const deps = { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) };

    expect(await run([scoresPath, "--offline", bundlePath], deps)).toBe(0);
    expect(out.join("\n")).toMatch(/IDENTICAL/);
    expect(err).toEqual([]);

    out.length = 0;
    expect(await run([`file://${scoresPath}`, "--offline", bundlePath, "--json"], deps)).toBe(0);
    expect(JSON.parse(out.join("\n"))).toMatchObject({ identical: true, carried: [], diff: [] });

    // Tamper with one byte of the published file: a pretty-printed copy with a changed n.
    const tampered = JSON.parse(json) as ReputationFile;
    tampered.scores[1]!.n = 123.456;
    const tamperedPath = join(dir, "tampered.json");
    await writeFile(tamperedPath, JSON.stringify(tampered, null, 2));
    out.length = 0;
    expect(await run([tamperedPath, "--offline", bundlePath], deps)).toBe(1);
    expect(out.join("\n")).toMatch(/DIFFERS — 1 difference/);
    expect(out.join("\n")).toMatch(/\$\.scores\[1\]\.n/);
  });

  it("CLI: usage and I/O errors exit 2", async () => {
    const err: string[] = [];
    const deps = { stdout: () => {}, stderr: (s: string) => err.push(s) };
    expect(await run([], deps)).toBe(2);
    expect(err.join("\n")).toMatch(/usage:/);
    expect(await run(["--help"], deps)).toBe(2);
    expect(await run(["/nonexistent/reputation.json", "--offline", "/nonexistent/bundle.json"], deps)).toBe(2);
    expect(await run(["x.json", "--bogus"], deps)).toBe(2);
  });

  it("parseArgs", () => {
    expect(parseArgs(["f.json"])).toEqual({ source: "f.json", easGraphql: "https://base.easscan.org/graphql", json: false });
    expect(parseArgs(["f.json", "--eas-graphql", "http://x/graphql", "--offline", "b.json", "--passport-min", "15", "--json"])).toEqual({
      source: "f.json", easGraphql: "http://x/graphql", offline: "b.json", passportMin: 15, json: true,
    });
  });

  it("diffJson reports paths for scalars, arrays and missing keys", () => {
    expect(diffJson({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3, 4] })).toEqual([
      { path: "$.b[1]", published: 2, recomputed: 3 },
      { path: "$.b[2]", published: undefined, recomputed: 4 },
    ]);
    expect(diffJson({ a: { x: 1 } }, { a: { x: 1 } })).toEqual([]);
  });
});
