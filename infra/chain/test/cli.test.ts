import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";
import { chainFromId, unverifiedAddresses } from "../src/addresses.js";

describe("cli", () => {
  it("parses command, --flag value, --flag=value and bare --dry-run", () => {
    expect(parseArgs(["deploy-safe", "--entity", "boulder-creek", "--owners=a,b,c", "--dry-run"])).toEqual({
      command: "deploy-safe",
      flags: { entity: "boulder-creek", owners: "a,b,c", "dry-run": true },
    });
  });
  it("defaults to Base Sepolia and refuses unknown chains", () => {
    expect(chainFromId(undefined).chainId).toBe(84532);
    expect(chainFromId("8453").chainId).toBe(8453);
    expect(() => chainFromId(1)).toThrow(/unsupported/);
  });
  it("every address still carries the verify flag until a human ticks docs/verify.md", () => {
    expect(unverifiedAddresses(chainFromId(84532)).map((u) => u.key)).toEqual(["usdc", "eas", "schemaRegistry", "hats", "rolesModifierMastercopy", "moduleProxyFactory"]);
  });
});
