/** Regenerates test/expected/entity-status-needs.json from the stale fixture. Review the diff before committing. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTool } from "../src/server.js";
import { FIXTURE_STALE, makeCtx, PKG } from "../test/helpers.js";

const out = await runTool(await makeCtx(FIXTURE_STALE), "get_entity_status", {});
writeFileSync(join(PKG, "test/expected/entity-status-needs.json"), JSON.stringify(out["needs"], null, 2) + "\n");
console.log("wrote test/expected/entity-status-needs.json");
