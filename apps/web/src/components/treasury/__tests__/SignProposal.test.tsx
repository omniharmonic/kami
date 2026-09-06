// @vitest-environment jsdom
/**
 * The Sign button: it signs the server-built typed data with the injected
 * provider (or an injected `signWith`, which is where Privy plugs in), posts
 * the signature to /api/treasury/confirm, and never invents typed data itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SignProposal, signWithProvider, type Eip1193Like } from "../SignProposal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HASH = `0x${"1".repeat(64)}`;
const TYPED = JSON.stringify({ primaryType: "SafeTx", domain: { chainId: 84532 }, types: {}, message: { nonce: "7" } });
const SIG = `0x${"ab".repeat(65)}`;

function fakeProvider(signature = SIG): Eip1193Like & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async request({ method, params }) {
      calls.push(method);
      if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
      if (method === "eth_signTypedData_v4") {
        expect((params as string[])[1]).toBe(TYPED);
        return signature;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

describe("SignProposal", () => {
  it("signs with the injected wallet and posts the signature", async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", (async (url: string, init: RequestInit) => {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ confirmations: 2, required: 2 }), { status: 200 });
    }) as unknown as typeof fetch);
    const provider = fakeProvider();

    render(<SignProposal safeTxHash={HASH} typedDataJson={TYPED} confirmations={1} required={2} status="pending" safeWalletUrl="https://app.safe.global/x" provider={provider} />);
    expect(screen.getByText("1 of 2 signatures")).toBeTruthy();
    screen.getByRole("button", { name: /sign this payout/i }).click();

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.url).toBe("/api/treasury/confirm");
    expect(posted[0]!.body).toEqual({ safe_tx_hash: HASH, signature: SIG });
    expect(provider.calls).toEqual(["eth_requestAccounts", "eth_signTypedData_v4"]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/relayer will execute/i));
    expect(screen.getByRole("link", { name: /safe\{wallet\}/i }).getAttribute("href")).toBe("https://app.safe.global/x");
  });

  it("uses an injected signWith (the Privy seam) when given one", async () => {
    vi.stubGlobal("fetch", (async () => new Response(JSON.stringify({ confirmations: 1, required: 2 }), { status: 200 })) as unknown as typeof fetch);
    const signWith = vi.fn(async ({ typedDataJson }: { typedDataJson: string }) => {
      expect(typedDataJson).toBe(TYPED);
      return SIG;
    });
    render(<SignProposal safeTxHash={HASH} typedDataJson={TYPED} confirmations={0} required={2} status="pending" safeWalletUrl={null} signWith={signWith} />);
    screen.getByRole("button", { name: /sign this payout/i }).click();
    await waitFor(() => expect(signWith).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/more guardian signature/i));
  });

  it("says so when the wallet declines and when the server refuses", async () => {
    vi.stubGlobal("fetch", (async () => new Response(JSON.stringify({ detail: "guardians only" }), { status: 403 })) as unknown as typeof fetch);
    const declining: Eip1193Like = {
      async request() {
        throw new Error("user rejected");
      },
    };
    const { unmount } = render(<SignProposal safeTxHash={HASH} typedDataJson={TYPED} confirmations={0} required={2} status="pending" safeWalletUrl={null} provider={declining} />);
    screen.getByRole("button", { name: /sign this payout/i }).click();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/declined to sign/i));
    unmount();

    render(<SignProposal safeTxHash={HASH} typedDataJson={TYPED} confirmations={0} required={2} status="pending" safeWalletUrl={null} provider={fakeProvider()} />);
    screen.getByRole("button", { name: /sign this payout/i }).click();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("guardians only"));
  });

  it("disables signing once the proposal is no longer pending", () => {
    render(<SignProposal safeTxHash={HASH} typedDataJson={null} confirmations={2} required={2} status="executed" safeWalletUrl={null} />);
    expect((screen.getByRole("button", { name: /sign this payout/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/no longer waiting for signatures/i)).toBeTruthy();
  });

  it("signWithProvider asks for accounts before signing", async () => {
    const provider = fakeProvider();
    const out = await signWithProvider(provider, TYPED);
    expect(out).toEqual({ signature: SIG, address: "0x1111111111111111111111111111111111111111" });
  });
});
