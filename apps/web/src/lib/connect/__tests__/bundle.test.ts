/**
 * The bundle is the thing a creator actually walks away with, so the property
 * that matters is that it cannot disagree with what the platform would deploy.
 * `SOUL.md` is asserted byte-for-byte against what `provisionEntity` writes to
 * disk — if the two ever diverge, one of them is lying about what this kami is.
 *
 * The second property is that no secret is in it. A bundle is a file people
 * email themselves and paste into issues; the token is minted on the page and
 * shown once, and everything here carries the environment expansion instead.
 */
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import { provisionEntity } from "@/lib/provisioning";
import { buildConnectBundle, bundleFilename, PLATFORM_SERVER_KEY, SKILL_FILES, TWIN_SERVER_KEY } from "../bundle";
import { zip } from "../zip";
import { connectTestDb, seedConnectEntity } from "./helpers";

const ORIGIN = "https://kami.test";
const NOW = new Date("2026-09-06T12:00:00Z");

let db: TestDb;

beforeAll(async () => {
  db = await connectTestDb();
  await seedConnectEntity(db, "boulder-creek");
});
afterAll(async () => {
  await closeTestDb(db);
});

/** Read a zip back out: local headers only, which is all this writer emits. */
function readZip(archive: Uint8Array): Map<string, string> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const out = new Map<string, string>();
  let at = 0;
  while (at + 4 <= archive.length && view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const compressed = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(archive.slice(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extraLen;
    const raw = archive.slice(start, start + compressed);
    out.set(name, new TextDecoder().decode(method === 8 ? inflateRawSync(raw) : raw));
    at = start + compressed;
  }
  return out;
}

describe("connect · the bundle", () => {
  it("carries every named file, and each one says what it is for", async () => {
    const bundle = await buildConnectBundle(db, "boulder-creek", { origin: ORIGIN, now: NOW });
    const paths = bundle.files.map((f) => f.path);
    expect(paths).toContain("SOUL.md");
    expect(paths).toContain("binding.json");
    expect(paths).toContain("mcp.json");
    expect(paths).toContain("README.md");
    expect(paths).toContain(".env.example");
    for (const rel of SKILL_FILES) expect(paths).toContain(`skills/entity-steward/${rel}`);
    for (const f of bundle.files) expect(f.purpose.length, f.path).toBeGreaterThan(10);
  });

  it("renders a SOUL.md byte-identical to the one provisioning writes", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kami-connect-"));
    // mintToken: false — a preview must not rotate a live token (the same rule
    // `GET /api/admin/profiles` follows).
    await provisionEntity("boulder-creek", db, { outDir, boxHost: null, mintToken: false, now: NOW });
    const fromProvisioning = readFileSync(path.join(outDir, "SOUL.md"), "utf8");
    const bundle = await buildConnectBundle(db, "boulder-creek", { origin: ORIGIN, now: NOW });
    expect(bundle.files.find((f) => f.path === "SOUL.md")!.content).toBe(fromProvisioning);
  });

  it("renders a binding.json byte-identical to the one provisioning writes", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "kami-connect-"));
    await provisionEntity("boulder-creek", db, { outDir, boxHost: null, mintToken: false, now: NOW });
    const bundle = await buildConnectBundle(db, "boulder-creek", { origin: ORIGIN, now: NOW });
    expect(bundle.files.find((f) => f.path === "binding.json")!.content).toBe(readFileSync(path.join(outDir, "binding.json"), "utf8"));
  });

  it("writes an mcp.json that parses and names both servers, with the token left as an expansion", async () => {
    const bundle = await buildConnectBundle(db, "boulder-creek", { origin: ORIGIN, now: NOW });
    const raw = bundle.files.find((f) => f.path === "mcp.json")!.content;
    const parsed = JSON.parse(raw) as { mcpServers: Record<string, { type: string; url?: string; command?: string; args?: string[]; headers?: Record<string, string> }> };
    expect(Object.keys(parsed.mcpServers).sort()).toEqual([PLATFORM_SERVER_KEY, TWIN_SERVER_KEY].sort());
    expect(parsed.mcpServers[PLATFORM_SERVER_KEY]!.url).toBe("https://kami.test/mcp");
    expect(parsed.mcpServers[PLATFORM_SERVER_KEY]!.headers!.Authorization).toBe("Bearer ${PLATFORM_MCP_TOKEN}");
    expect(parsed.mcpServers[TWIN_SERVER_KEY]!.command).toBe("npx");
    expect(parsed.mcpServers[TWIN_SERVER_KEY]!.args).toContain("@bioregionaltwin/mcp");
  });

  it("contains no token value anywhere in it", async () => {
    const bundle = await buildConnectBundle(db, "boulder-creek", { origin: ORIGIN, now: NOW });
    for (const f of bundle.files) expect(f.content, f.path).not.toMatch(/kami_[a-z0-9-]+_[0-9a-f]{48}/);
  });

  it("names the hard rules an agent must honour in its README", async () => {
    const bundle = await buildConnectBundle(db, "boulder-creek", { origin: ORIGIN, now: NOW });
    const readme = bundle.files.find((f) => f.path === "README.md")!.content;
    expect(readme).toContain("tool call in the same turn");
    expect(readme).toContain("never signs anything");
    expect(readme).toContain("binding v1 (approved)");
    for (const f of bundle.files) if (f.path !== "README.md") expect(readme).toContain(f.path);
  });

  it("refuses an entity with no soul row rather than inventing one", async () => {
    await seedConnectEntity(db, "no-soul-creek", { withSoul: false });
    await expect(buildConnectBundle(db, "no-soul-creek", { origin: ORIGIN, now: NOW })).rejects.toThrow(/no soul row/);
  });

  it("zips into an archive that reads back file for file", async () => {
    const bundle = await buildConnectBundle(db, "boulder-creek", { origin: ORIGIN, now: NOW });
    const archive = zip(bundle.files.map((f) => ({ path: f.path, content: f.content })), NOW);
    const back = readZip(archive);
    expect([...back.keys()].sort()).toEqual(bundle.files.map((f) => f.path).sort());
    for (const f of bundle.files) expect(back.get(f.path), f.path).toBe(f.content);
    expect(bundleFilename("boulder-creek", NOW)).toBe("kami-boulder-creek-connect-2026-09-06.zip");
  });
});
