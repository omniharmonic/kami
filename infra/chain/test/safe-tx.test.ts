import { type Address, decodeFunctionData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  type ApiKitLike,
  ERC20_ABI,
  InsufficientConfirmations,
  type MultisigTxLike,
  SAFE_ABI,
  SAFE_TX_TYPEHASH,
  buildUsdcTransferTx,
  computeSafeTxHash,
  executeWithRelayer,
  listPendingTransactions,
  packSignatures,
  proposeTransaction,
  safeTxTypedData,
  toSafeTransactionData,
} from "../src/safe-tx.js";

const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const safe = "0x2000000000000000000000000000000000000002" as Address;
const to = "0x3000000000000000000000000000000000000003" as Address;
const proposer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("buildUsdcTransferTx", () => {
  it("encodes transfer(address,uint256) to the USDC contract with zero value", () => {
    const tx = buildUsdcTransferTx(usdc, to, 25_000_000n);
    expect(tx.to).toBe(usdc);
    expect(tx.value).toBe("0");
    expect(tx.operation).toBe(0);
    const d = decodeFunctionData({ abi: ERC20_ABI, data: tx.data });
    expect(d.functionName).toBe("transfer");
    expect(d.args).toEqual([to, 25_000_000n]);
  });
  it("rejects a non-positive amount", () => {
    expect(() => buildUsdcTransferTx(usdc, to, 0n)).toThrow();
  });
});

describe("SafeTx hashing", () => {
  it("uses the Safe SafeTx typehash", () => {
    expect(SAFE_TX_TYPEHASH).toBe("0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8");
  });
  it("is deterministic and nonce-sensitive", () => {
    const tx = toSafeTransactionData(buildUsdcTransferTx(usdc, to, 1n), 7);
    const h1 = computeSafeTxHash({ chainId: 84532, safeAddress: safe, tx });
    const h2 = computeSafeTxHash({ chainId: 84532, safeAddress: safe, tx: { ...tx, nonce: 8 } });
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
    expect(h1).toBe(computeSafeTxHash({ chainId: 84532, safeAddress: safe, tx }));
  });
});

function fakeApiKit(confirmations: number, required = 2): ApiKitLike & { proposed: unknown[] } {
  const owners = ["0xB000000000000000000000000000000000000001", "0xA000000000000000000000000000000000000002"];
  const tx: MultisigTxLike = {
    safeTxHash: "0x" + "11".repeat(32),
    safe,
    to: usdc,
    value: "0",
    data: buildUsdcTransferTx(usdc, to, 5_000_000n).data,
    operation: 0,
    safeTxGas: 0,
    baseGas: 0,
    gasPrice: "0",
    gasToken: "0x0000000000000000000000000000000000000000",
    refundReceiver: "0x0000000000000000000000000000000000000000",
    nonce: 3,
    confirmationsRequired: required,
    confirmations: owners.slice(0, confirmations).map((o, i) => ({ owner: o, signature: `0x${(i + 1).toString(16).padStart(2, "0").repeat(65)}` })),
    isExecuted: false,
  };
  const proposed: unknown[] = [];
  return {
    proposed,
    getNextNonce: async () => 3,
    proposeTransaction: async (p) => { proposed.push(p); },
    getTransaction: async () => tx,
    getPendingTransactions: async () => ({ results: [tx] }),
    getIncomingTransactions: async () => ({ results: [] }),
  };
}

describe("executeWithRelayer", () => {
  it("refuses at 1 of 2 confirmations and sends nothing", async () => {
    const apiKit = fakeApiKit(1);
    let sent = 0;
    await expect(executeWithRelayer({ apiKit, safeTxHash: "0x" + "11".repeat(32) as `0x${string}`, relayerSend: async () => { sent += 1; return "0x01"; } })).rejects.toBeInstanceOf(InsufficientConfirmations);
    expect(sent).toBe(0);
  });
  it("proceeds at 2 of 2 with owner signatures packed in ascending owner order", async () => {
    const apiKit = fakeApiKit(2);
    let captured: { to: Address; data: `0x${string}` } | undefined;
    const r = await executeWithRelayer({ apiKit, safeTxHash: "0x" + "11".repeat(32) as `0x${string}`, relayerSend: async (t) => { captured = t; return "0xbeef"; } });
    expect(r.txHash).toBe("0xbeef");
    expect(captured!.to).toBe(safe);
    const d = decodeFunctionData({ abi: SAFE_ABI, data: captured!.data });
    expect(d.functionName).toBe("execTransaction");
    const sigs = d.args![9] as `0x${string}`;
    // owner 0xA0… sorts before 0xB0…, so its signature (0x02…) comes first
    expect(sigs.slice(2, 4)).toBe("02");
    expect(sigs.length).toBe(2 + 65 * 2 * 2);
  });
  it("packSignatures sorts by owner address", () => {
    const packed = packSignatures([
      { owner: "0xB000000000000000000000000000000000000001", signature: "0xbb" },
      { owner: "0xA000000000000000000000000000000000000002", signature: "0xaa" },
    ]);
    expect(packed).toBe("0xaabb");
  });
});

describe("proposeTransaction", () => {
  it("signs the SafeTx EIP-712 hash with the proposer and posts it as pending", async () => {
    const apiKit = fakeApiKit(0);
    const tx = buildUsdcTransferTx(usdc, to, 5_000_000n);
    const r = await proposeTransaction({ apiKit, chainId: 84532, safeAddress: safe, tx, proposer });
    expect(apiKit.proposed).toHaveLength(1);
    const p = apiKit.proposed[0] as { safeTxHash: string; senderAddress: string; senderSignature: `0x${string}` };
    expect(p.safeTxHash).toBe(r.safeTxHash);
    expect(p.senderAddress).toBe(proposer.address);
    const recovered = await recoverTypedDataAddress({ ...safeTxTypedData({ chainId: 84532, safeAddress: safe, tx: r.safeTransactionData }), signature: p.senderSignature });
    expect(recovered).toBe(proposer.address);
  });
  it("dry-run posts nothing", async () => {
    const apiKit = fakeApiKit(0);
    await proposeTransaction({ apiKit, chainId: 84532, safeAddress: safe, tx: buildUsdcTransferTx(usdc, to, 1n), proposer, dryRun: true });
    expect(apiKit.proposed).toHaveLength(0);
  });
  it("listPendingTransactions summarises confirmations vs required", async () => {
    const r = await listPendingTransactions({ apiKit: fakeApiKit(1), safeAddress: safe });
    expect(r).toEqual([expect.objectContaining({ nonce: 3, confirmations: 1, required: 2 })]);
  });
});
