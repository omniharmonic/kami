/**
 * The Safe EIP-712 payload the guardian screen serves: viem's `hashTypedData`
 * must agree with an independent 0x1901 computation and with `@kami/chain`'s
 * `computeSafeTxHash`, for a fixed known vector.
 */
import { describe, expect, it } from "vitest";
import { hashTypedData, parseUnits, type Address } from "viem";
import { buildUsdcTransferTx, computeSafeTxHash, toSafeTransactionData } from "@kami/chain";
import { payoutSafeTransactionData, safeTxHashManual, safeTxHashOf, safeTypedDataFor, safeTypedDataJson, safeWalletUrl } from "../safe-typed-data";

const SAFE: Address = "0x1111111111111111111111111111111111111111";
const TO: Address = "0x2222222222222222222222222222222222222222";
const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia (*verify* #41)
const CHAIN_ID = 84532;

describe("Safe SafeTx typed data", () => {
  it("hashes the known vector identically in viem, by hand and in @kami/chain", () => {
    const tx = payoutSafeTransactionData({ usdc: USDC, to: TO, amountUsdc6: parseUnits("25", 6), nonce: 7 });
    const typed = safeTypedDataFor({ chainId: CHAIN_ID, safeAddress: SAFE, tx });
    const viemHash = hashTypedData(typed);
    expect(safeTxHashOf(typed)).toBe(viemHash);
    expect(safeTxHashManual({ chainId: CHAIN_ID, safeAddress: SAFE, tx })).toBe(viemHash);
    expect(computeSafeTxHash({ chainId: CHAIN_ID, safeAddress: SAFE, tx })).toBe(viemHash);
    // The vector is stable: same inputs, same hash, forever.
    expect(viemHash).toBe("0xa7c37f34552694f60fe82e3abc23dbaad90abfc65fcfe8039b556fba89d0de1f");
  });

  it("builds the same tx data as buildUsdcTransferTx and a domain of exactly chainId + verifyingContract", () => {
    const direct = toSafeTransactionData(buildUsdcTransferTx(USDC, TO, parseUnits("25", 6)), 7);
    expect(payoutSafeTransactionData({ usdc: USDC, to: TO, amountUsdc6: parseUnits("25", 6), nonce: 7 })).toEqual(direct);
    const typed = safeTypedDataFor({ chainId: CHAIN_ID, safeAddress: SAFE, tx: direct });
    expect(Object.keys(typed.domain)).toEqual(["chainId", "verifyingContract"]);
    expect(typed.primaryType).toBe("SafeTx");
  });

  it("serialises for eth_signTypedData_v4 with EIP712Domain and decimal uints", () => {
    const tx = payoutSafeTransactionData({ usdc: USDC, to: TO, amountUsdc6: parseUnits("25", 6), nonce: 7 });
    const json = JSON.parse(safeTypedDataJson(safeTypedDataFor({ chainId: CHAIN_ID, safeAddress: SAFE, tx }))) as {
      types: Record<string, unknown>;
      message: Record<string, string>;
      domain: Record<string, unknown>;
    };
    expect(json.types.EIP712Domain).toEqual([
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ]);
    expect(json.message.nonce).toBe("7");
    expect(json.message.value).toBe("0");
    expect(json.domain.chainId).toBe(84532);
  });

  it("links to Safe{Wallet} with the right chain prefix", () => {
    expect(safeWalletUrl(84532, SAFE)).toContain("basesep:0x1111");
    expect(safeWalletUrl(8453, SAFE)).toContain("base:0x1111");
  });
});
