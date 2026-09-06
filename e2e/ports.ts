/** Ports and fixture paths shared by `playwright.config.ts` and the specs. */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.KAMI_E2E_PORT ?? 3100);
export const PAUSED_PORT = Number(process.env.KAMI_E2E_PAUSED_PORT ?? 3101);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const PAUSED_BASE_URL = `http://127.0.0.1:${PAUSED_PORT}`;
export const FIXTURE_DATA_DIR = path.join(here, "fixtures", "data");
export const FIXTURE_STATUS_FILE = path.join(FIXTURE_DATA_DIR, "entity", "boulder-creek", "status.json");
