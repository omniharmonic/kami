import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";

describe("env", () => {
  it("parses a full development environment", () => {
    const env = parseEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://u:p@localhost/kami",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      HERMES_GATEWAY_URL: "fake:",
    } as NodeJS.ProcessEnv);
    expect(env.DATABASE_URL).toContain("localhost");
    expect(env.HERMES_GATEWAY_URL).toBe("fake:");
  });
  it("throws on an invalid value without SKIP_ENV_VALIDATION", () => {
    expect(() => parseEnv({ NODE_ENV: "development", BETTER_AUTH_URL: "not a url" } as NodeJS.ProcessEnv)).toThrow(
      /BETTER_AUTH_URL/,
    );
  });
  it("requires secrets in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });
  it("lets a CI build through with SKIP_ENV_VALIDATION=1", () => {
    const env = parseEnv({ NODE_ENV: "production", SKIP_ENV_VALIDATION: "1", BETTER_AUTH_URL: "nope" } as NodeJS.ProcessEnv);
    expect(env.DATABASE_URL).toBeUndefined();
  });
});

it("requires an explicit opt-in to a fake gateway", () => {
  expect(parseEnv({NODE_ENV: "test"}).HERMES_GATEWAY_URL).toBe("");
});
