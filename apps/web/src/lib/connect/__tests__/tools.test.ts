/**
 * The tool list on the connect page is generated, not written.
 *
 * Two failures this guards against, both of which are the same failure: a page
 * that tells an operator their agent can do something it cannot, or omits
 * something it can.
 *
 *  - the platform half is read out of the live MCP server, so a tool added in
 *    `src/lib/mcp/server.ts` appears without anyone editing this page;
 *  - the twin half is the captured public hosted discovery contract, independent
 *    of the older vendored local implementation.
 */
import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PLATFORM_TOOLS } from "@/lib/mcp/server";
import { firstSentence, includedTools, listMcpTools, toolCatalog } from "../tools";
import { TWIN_TOOLS } from "../twin-tools";

function fakeRegistry(): McpServer {
  const server = new McpServer({ name: "fake", version: "0.0.0" }, { capabilities: { tools: {} } });
  server.registerTool(
    "count_frogs",
    { title: "Count frogs", description: "Counts frogs at a place. Nothing else.", annotations: { readOnlyHint: true } },
    () => ({ content: [{ type: "text", text: "{}" }] }),
  );
  server.registerTool(
    "release_frogs",
    { title: "Release frogs", description: "Puts frogs back. This changes the world.", inputSchema: { n: z.number() }, annotations: { readOnlyHint: false } },
    () => ({ content: [{ type: "text", text: "{}" }] }),
  );
  return server;
}

describe("connect · the tool catalogue comes from the registries", () => {
  it("lists exactly the nine tools the platform MCP registers, in the registry's own words", async () => {
    const catalog = await toolCatalog();
    expect(catalog.platform.map((t) => t.name).sort()).toEqual([...PLATFORM_TOOLS].sort());
    const snapshot = catalog.platform.find((t) => t.name === "get_needs_snapshot")!;
    expect(snapshot.summary.length).toBeGreaterThan(10);
    expect(snapshot.description).toContain("HealthSnapshot");
  });

  it("says which tools change something, from the annotations rather than from a hand-kept list", async () => {
    const catalog = await toolCatalog();
    const writes = catalog.platform.filter((t) => t.writes).map((t) => t.name).sort();
    expect(writes).toEqual(["draft_bounty", "post_update"]);
    for (const t of catalog.twin) expect(t.writes).toBe(false);
  });

  it("picks up a tool added to the registry — it cannot drift from the code", async () => {
    const catalog = await toolCatalog({ platformServer: fakeRegistry, twinTools: [...TWIN_TOOLS, { name: "get_moon", description: "The moon. One sentence." }] });
    expect(catalog.platform.map((t) => t.name)).toEqual(["count_frogs", "release_frogs"]);
    expect(catalog.platform.find((t) => t.name === "count_frogs")!.writes).toBe(false);
    expect(catalog.platform.find((t) => t.name === "release_frogs")!.writes).toBe(true);
    expect(catalog.twin.map((t) => t.name)).toContain("get_moon");
    expect(catalog.twin.find((t) => t.name === "get_moon")!.summary).toBe("The moon.");
  });

  it("treats an unannotated tool as one that changes something — unknown is never resolved the flattering way", async () => {
    const server = new McpServer({ name: "fake", version: "0.0.0" }, { capabilities: { tools: {} } });
    server.registerTool("mystery", { description: "Who knows." }, () => ({ content: [{ type: "text", text: "{}" }] }));
    const tools = await listMcpTools(server);
    expect(tools[0]!.writes).toBe(true);
  });

  it("reads the Hermes include lists out of the rendered template", () => {
    const yaml = [
      "mcp_servers:",
      "  twin:",
      "    type: stdio",
      "    tools:",
      "      include: [get_entity_status, get_alerts]",
      "  platform:",
      "    type: http",
      "    tools:",
      "      include: [get_needs_snapshot, post_update]",
      "cron:",
      "  model: x",
    ].join("\n");
    expect(includedTools(yaml, "twin")).toEqual(["get_entity_status", "get_alerts"]);
    expect(includedTools(yaml, "platform")).toEqual(["get_needs_snapshot", "post_update"]);
    expect(includedTools(yaml, "treasury")).toEqual([]);
  });

  it("trims a summary to one sentence", () => {
    expect(firstSentence("One. Two. Three.")).toBe("One.");
    expect(firstSentence("")).toBe("");
  });

  it("exposes the published discovery contract, including species and polygon queries", () => {
    expect(TWIN_TOOLS).toHaveLength(20);
    expect(new Set(TWIN_TOOLS.map(t => t.name)).size).toBe(20);
    for (const name of ["list_datasets", "query_ecology", "find_species", "get_species", "read_artifact"])
      expect(TWIN_TOOLS.find(t => t.name === name)?.description).toBeTruthy();
  });
});
