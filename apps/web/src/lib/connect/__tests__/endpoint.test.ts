/**
 * The address an agent is told to use. Getting this wrong is a support ticket
 * that looks like a broken token, so the order of preference is pinned:
 * whatever provisioning writes into a profile wins, because a bundle and a
 * profile must not disagree about where the platform is.
 */
import { describe, expect, it } from "vitest";
import { DEV_ORIGIN, mcpEndpoint, platformOrigin } from "../endpoint";

describe("connect · the endpoint", () => {
  it("prefers PLATFORM_URL, then BETTER_AUTH_URL, then the request, then the dev default", () => {
    const req = { proto: "https", host: "preview.kami.test" };
    expect(platformOrigin(req, { PLATFORM_URL: "https://kami.example/", BETTER_AUTH_URL: "https://auth.example" } as unknown as NodeJS.ProcessEnv)).toBe("https://kami.example");
    expect(platformOrigin(req, { BETTER_AUTH_URL: "https://auth.example/" } as unknown as NodeJS.ProcessEnv)).toBe("https://auth.example");
    expect(platformOrigin(req, {} as unknown as NodeJS.ProcessEnv)).toBe("https://preview.kami.test");
    expect(platformOrigin(null, {} as unknown as NodeJS.ProcessEnv)).toBe(DEV_ORIGIN);
  });

  it("does not invent https for a local host, and takes the first forwarded proto", () => {
    expect(platformOrigin({ proto: null, host: "127.0.0.1:3000" }, {} as unknown as NodeJS.ProcessEnv)).toBe("http://127.0.0.1:3000");
    expect(platformOrigin({ proto: "https,http", host: "kami.test" }, {} as unknown as NodeJS.ProcessEnv)).toBe("https://kami.test");
  });

  it("puts the MCP at /mcp — the one path the profile template and the proxy both name", () => {
    expect(mcpEndpoint("https://kami.example/")).toBe("https://kami.example/mcp");
  });
});
