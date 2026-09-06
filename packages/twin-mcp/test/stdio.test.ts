import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseArgs } from "../src/stdio.js";
import { BINDING_FILE, FIXTURE_STALE, PKG } from "./helpers.js";

describe("stdio smoke (dist/stdio.js)", () => {
  beforeAll(() => {
    if (!existsSync(join(PKG, "dist/stdio.js"))) execSync("pnpm exec tsc -p tsconfig.build.json", { cwd: PKG, stdio: "inherit" });
  }, 120_000);

  it("spawns with --tree fixtures/public --binding boulder-creek.yaml and answers initialize, tools/list, get_entity_status", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(PKG, "dist/stdio.js"), "--tree", FIXTURE_STALE, "--binding", BINDING_FILE], stderr: "pipe" });
    const c = new Client({ name: "smoke", version: "0" });
    await c.connect(transport);
    expect(c.getServerVersion()?.name).toBe("bioregionaltwin-mcp");
    const tools = await c.listTools();
    expect(tools.tools.length).toBe(15);
    expect((tools as { _meta?: Record<string, unknown> })._meta?.["contract_version"]).toBe("1.0");
    const res = await c.callTool({ name: "get_entity_status", arguments: {} });
    expect(res.isError).toBeFalsy();
    const out = JSON.parse((res.content as { text: string }[])[0]!.text);
    expect(out.entity_id).toBe("entity/boulder-creek");
    expect(out.needs.length).toBe(6);
    expect(out.needs[0]).toMatchObject({ need: "flow", value: 15.4, stale: true });
    expect(out.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    const listed = await c.callTool({ name: "list_entities", arguments: {} });
    expect(JSON.parse((listed.content as { text: string }[])[0]!.text).entities[0].slug).toBe("boulder-creek");
    const resources = await c.listResources();
    expect(resources.resources.map((r) => r.uri).sort()).toEqual(["twin://about", "twin://boundary/v1", "twin://glossary", "twin://licence"]);
    const lic = await c.readResource({ uri: "twin://licence" });
    expect((lic.contents[0] as { text: string }).text).toContain("CC BY-SA 4.0");
    await transport.close();
  }, 30_000);

  it("parses the CLI flags", () => {
    const a = parseArgs(["--tree", "https://data.bioregionaltwin.org", "--binding", "a.yaml", "--binding=b.json", "--contact", "x@y.z"]);
    expect(a).toMatchObject({ tree: "https://data.bioregionaltwin.org", bindings: ["a.yaml", "b.json"], contact: "x@y.z" });
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });
});
