/**
 * Key custody (T2.3): backend selection, the production refusal, and the
 * log-scrub guarantee — no private key ever survives `JSON.stringify` of a
 * backend or `String(err)` of anything the signing service throws.
 */
import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { hashTypedData, recoverTypedDataAddress, verifyMessage, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  AwsKmsBackend,
  LocalKeyBackend,
  NotConfigured,
  PrivyServerWalletBackend,
  SigningError,
  UnknownRole,
  accountFor,
  isKeyRole,
  jsonTypedData,
  proposerRole,
  roleFingerprint,
  scrub,
  type PrivyEthereumApiLike,
} from "../kms";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const KEY_BODY = KEY.slice(2);

const typed: TypedDataDefinition = {
  domain: { chainId: 84532, verifyingContract: "0x1111111111111111111111111111111111111111" },
  types: { SafeTx: [{ name: "nonce", type: "uint256" }] },
  primaryType: "SafeTx",
  message: { nonce: 7n },
};

/** Any 32-byte hex run in a log line is treated as key material. */
const KEY_LIKE = /(?:0x)?[0-9a-fA-F]{64}/;
function containsKeyMaterial(text: string): boolean {
  return text.includes(KEY_BODY) || KEY_LIKE.test(text);
}

describe("roles", () => {
  it("accepts the five role shapes and rejects anything else", () => {
    for (const r of ["attester", "relayer", "deployer", "keeper", "proposer:boulder-creek"]) expect(isKeyRole(r)).toBe(true);
    for (const r of ["proposer", "proposer:Boulder Creek", "owner", ""]) expect(isKeyRole(r)).toBe(false);
    expect(proposerRole("boulder-creek")).toBe("proposer:boulder-creek");
    expect(() => proposerRole("Boulder Creek")).toThrow(SigningError);
  });
});

describe("LocalKeyBackend", () => {
  it("refuses to start in production", () => {
    expect(() => new LocalKeyBackend({ env: { NODE_ENV: "production" } as NodeJS.ProcessEnv })).toThrow(NotConfigured);
  });

  it("signs typed data, messages and transactions with the configured key", async () => {
    const backend = new LocalKeyBackend({ keys: { attester: KEY }, ephemeral: false, env: { NODE_ENV: "test" } as NodeJS.ProcessEnv });
    const expected = privateKeyToAccount(KEY).address;
    expect(await backend.getAddress("attester")).toBe(expected);
    const sig = await backend.signTypedData("attester", typed);
    expect(await recoverTypedDataAddress({ ...typed, signature: sig })).toBe(expected);
    expect(await verifyMessage({ address: expected, message: "hello", signature: await backend.signMessage("attester", "hello") })).toBe(true);
    const raw = await backend.signTransaction("attester", { chainId: 84532, to: "0x1111111111111111111111111111111111111111", value: 1n, type: "eip1559" });
    expect(raw.startsWith("0x02")).toBe(true);
    await expect(backend.getAddress("relayer")).rejects.toBeInstanceOf(UnknownRole);
  });

  it("generates ephemeral keys per role in dev and keeps them stable", async () => {
    const backend = LocalKeyBackend.fromEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    const a = await backend.getAddress("proposer:boulder-creek");
    expect(await backend.getAddress("proposer:boulder-creek")).toBe(a);
    expect(await backend.getAddress("proposer:another-creek")).not.toBe(a);
  });

  it("rejects a malformed KAMI_LOCAL_KEYS_JSON without echoing it", () => {
    expect(() => LocalKeyBackend.fromEnv({ NODE_ENV: "test", KAMI_LOCAL_KEYS_JSON: "{" } as NodeJS.ProcessEnv)).toThrow(/not valid JSON/);
    expect(() => LocalKeyBackend.fromEnv({ NODE_ENV: "test", KAMI_LOCAL_KEYS_JSON: JSON.stringify({ owner: KEY }) } as NodeJS.ProcessEnv)).toThrow(/unknown role/);
    try {
      LocalKeyBackend.fromEnv({ NODE_ENV: "test", KAMI_LOCAL_KEYS_JSON: JSON.stringify({ attester: `${KEY}ff` }) } as NodeJS.ProcessEnv);
      throw new Error("should have thrown");
    } catch (err) {
      expect(String(err)).not.toContain(KEY_BODY);
    }
  });
});

describe("log scrub", () => {
  it("never leaks key material through serialisation, inspection or errors", async () => {
    const backend = new LocalKeyBackend({ keys: { attester: KEY, "proposer:boulder-creek": generatePrivateKey() }, ephemeral: false, env: { NODE_ENV: "test" } as NodeJS.ProcessEnv });
    const account = await accountFor(backend, "attester");

    const surfaces = [
      JSON.stringify(backend),
      JSON.stringify({ backend }),
      JSON.stringify(backend.toJSON()),
      inspect(backend, { depth: 10 }),
      String(backend),
      JSON.stringify(account),
      inspect(account, { depth: 10 }),
      String(await roleFingerprint(backend, "attester")),
    ];
    for (const s of surfaces) {
      expect(s, s.slice(0, 120)).not.toContain(KEY_BODY);
      expect(s).not.toContain(KEY);
    }
    // and the roles are still discoverable, so a log line can name what signed
    expect(JSON.stringify(backend)).toContain("proposer:boulder-creek");

    // errors: the scrubber replaces anything that looks like 32 bytes
    const err = new SigningError(`refusing to use key ${KEY} for attester`, "attester");
    expect(String(err)).not.toContain(KEY_BODY);
    expect(String(err)).toContain("[redacted-32-bytes]");
    expect(JSON.stringify(err.toJSON())).not.toContain(KEY_BODY);
    expect(scrub(`x ${KEY_BODY} y`)).toBe("x [redacted-32-bytes] y");
    expect(containsKeyMaterial(String(err))).toBe(false);
  });
});

describe("PrivyServerWalletBackend", () => {
  it("routes each role to its wallet id and returns the wallet's signature", async () => {
    const calls: Array<{ method: string; walletId: string }> = [];
    const api: PrivyEthereumApiLike = {
      async signMessage(input) {
        calls.push({ method: "signMessage", walletId: input.walletId });
        return { signature: `0x${"11".repeat(65)}` };
      },
      async signTypedData(input) {
        calls.push({ method: "signTypedData", walletId: input.walletId });
        expect(input.typedData.types).toHaveProperty("EIP712Domain");
        expect((input.typedData.message as { nonce: string }).nonce).toBe("7");
        return { signature: `0x${"22".repeat(65)}` };
      },
      async signTransaction(input) {
        calls.push({ method: "signTransaction", walletId: input.walletId });
        expect(input.transaction).toMatchObject({ chainId: 84532, type: 2 });
        return { signedTransaction: `0x02${"33".repeat(10)}` };
      },
    };
    const backend = new PrivyServerWalletBackend({
      api,
      wallets: { attester: { walletId: "w-att", address: "0x1111111111111111111111111111111111111111" } },
    });
    expect(await backend.getAddress("attester")).toBe("0x1111111111111111111111111111111111111111");
    expect(await backend.signTypedData("attester", typed)).toBe(`0x${"22".repeat(65)}`);
    await backend.signTransaction("attester", { chainId: 84532, to: "0x1111111111111111111111111111111111111111", type: "eip1559", value: 1n, gas: 21000n });
    await backend.signMessage("attester", "hi");
    expect(calls.map((c) => c.walletId)).toEqual(["w-att", "w-att", "w-att"]);
    await expect(backend.getAddress("relayer")).rejects.toBeInstanceOf(UnknownRole);
    expect(JSON.stringify(backend)).toBe('{"kind":"privy","roles":["attester"]}');
  });

  it("refuses to build from env without an authorization key", async () => {
    await expect(PrivyServerWalletBackend.fromEnv({ PRIVY_APP_ID: "a", PRIVY_APP_SECRET: "b" })).rejects.toBeInstanceOf(NotConfigured);
  });
});

describe("AwsKmsBackend", () => {
  it("is an explicit stub that names the SDK it would use", async () => {
    const backend = AwsKmsBackend.fromEnv({ AWS_KMS_KEY_IDS_JSON: JSON.stringify({ attester: "arn:aws:kms:…" }) });
    await expect(backend.getAddress("attester")).rejects.toBeInstanceOf(NotConfigured);
    await backend.signMessage("attester", "x").catch((err: Error) => {
      expect(err.message).toContain("@aws-sdk/client-kms");
      expect(err.message).not.toContain(KEY_BODY);
    });
    expect(JSON.stringify(backend)).toBe('{"kind":"aws-kms","roles":["attester"]}');
  });
});

describe("jsonTypedData", () => {
  it("keeps the hash intact through the JSON round trip", () => {
    const json = jsonTypedData(typed);
    expect(json.message.nonce).toBe("7");
    const roundTripped: TypedDataDefinition = {
      domain: { chainId: 84532, verifyingContract: "0x1111111111111111111111111111111111111111" },
      types: { SafeTx: [{ name: "nonce", type: "uint256" }] },
      primaryType: "SafeTx",
      message: { nonce: BigInt(json.message.nonce as string) },
    };
    expect(hashTypedData(typed)).toBe(hashTypedData(roundTripped));
  });
});
