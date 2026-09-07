/** Published hosted contract, captured from public discovery on 2026-09-07.
 * The older vendored stdio implementation is a separate, local contract.
 * Refresh published-twin-tools.json from its source URL when the twin changes.
 */
import published from "./published-twin-tools.json";

export type TwinToolDef = { name: string; description: string; deprecated?: boolean };
export const TWIN_TOOLS: readonly TwinToolDef[] = published.tools.map(({ name, description }) => ({ name, description }));
export const TWIN_IS_READ_ONLY = true;
export const TWIN_MCP_URL = "https://mcp.bioregionaltwin.org/mcp";
export const TWIN_DEFAULT_TREE = "https://data.bioregionaltwin.org";
