/**
 * One `TwinClient` per process (its 60 s per-path floor is a promise to the
 * twin, so it must be shared). `TWIN_TREE_DIR` reads a fixture tree from disk
 * (the sandbox cannot reach `data.bioregionaltwin.org`); `TWIN_BASE_URL`
 * overrides the origin.
 */
import { TwinClient } from "@kami/twin-client";
import { jobsEnv } from "./common";

export const TWIN_USER_AGENT_VERSION = "0.1";

let cached: TwinClient | null = null;

export function makeTwinClient(opts: { baseUrl?: string; localDir?: string; contact?: string; fetchImpl?: typeof fetch; now?: () => number } = {}): TwinClient {
  const env = jobsEnv();
  const contact = opts.contact ?? env.KAMI_PULSE_CONTACT;
  const localDir = opts.localDir ?? env.TWIN_TREE_DIR;
  const client = new TwinClient({
    ...(localDir ? { localDir } : {}),
    ...(opts.baseUrl ?? env.TWIN_BASE_URL ? { baseUrl: opts.baseUrl ?? env.TWIN_BASE_URL } : {}),
    userAgent: `kami-web/${TWIN_USER_AGENT_VERSION} (${contact})`,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return client;
}

export function getTwinClient(): TwinClient {
  if (!cached) cached = makeTwinClient();
  return cached;
}

export function setTwinClientForTests(c: TwinClient | null): void {
  cached = c;
}
