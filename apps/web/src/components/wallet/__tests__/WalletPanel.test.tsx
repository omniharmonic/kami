// @vitest-environment jsdom
/**
 * `/me/wallet`'s panel. It must say plainly whose key it is, offer the
 * off-ramp as somebody else's service, and never render anything that looks
 * like a key or a way to give us one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { walletCopy } from "../copy";
import { WalletPanel } from "../WalletPanel";

const ADDRESS = "0x5555555555555555555555555555555555555555";

afterEach(cleanup);

function renderPanel(over: Partial<Parameters<typeof WalletPanel>[0]> = {}) {
  render(
    <WalletPanel
      address={ADDRESS}
      chainName="Base Sepolia"
      chainId={84532}
      offrampUrl="https://offramp.example.org/coinbase"
      createSlot={null}
      tax={{ cumulative_usd: 120, threshold_usd: 1500, collected: false, collector: "platform" }}
      {...over}
    />,
  );
  return document.body.textContent ?? "";
}

describe("WalletPanel", () => {
  it("shows the address, the network, and the off-ramp as a third party's", () => {
    const text = renderPanel();
    expect(text).toContain(ADDRESS);
    expect(text).toContain("Base Sepolia");
    expect(text).toContain(walletCopy.offramp.body);
    const link = screen.getByRole("link", { name: walletCopy.offramp.link });
    expect(link.getAttribute("href")).toBe("https://offramp.example.org/coinbase");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("says the key is the person's, that we never hold it, and how to export or disconnect", () => {
    const text = renderPanel();
    for (const line of walletCopy.keys.body) expect(text).toContain(line);
    expect(text).toContain(walletCopy.keys.export);
    expect(text.toLowerCase()).toContain("the key is yours, not ours");
    // no field anywhere invites a key or a seed phrase
    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(text.toLowerCase()).not.toContain("seed phrase");
    expect(text.toLowerCase()).not.toContain("private key to");
  });

  it("offers a create button only where one can be created", () => {
    const text = renderPanel({ address: null, createSlot: null });
    expect(text).toContain(walletCopy.addressNone);
    expect(text).toContain(walletCopy.notConfigured);

    cleanup();
    renderPanel({ address: null, createSlot: <button type="button">{walletCopy.create}</button> });
    expect(screen.getByRole("button", { name: walletCopy.create })).toBeTruthy();
  });

  it("shows the tax position without giving advice, and stands down under a fiscal sponsor", () => {
    expect(renderPanel()).toContain(walletCopy.tax.body("120.00", "1500.00"));
    expect(renderPanel()).toContain(walletCopy.tax.notAdvice);
    cleanup();
    expect(renderPanel({ tax: { cumulative_usd: 9000, threshold_usd: 1500, collected: false, collector: "sponsor" } })).toContain(walletCopy.tax.sponsor);
  });

  it("forgets the wallet on disconnect and says nothing on chain changed", async () => {
    const disconnect = vi.fn(async () => ({ ok: true }));
    renderPanel({ disconnect });
    screen.getByRole("button", { name: walletCopy.keys.disconnect }).click();
    await waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    await waitFor(() => expect(document.body.textContent).toContain(walletCopy.keys.disconnected));
    expect(document.body.textContent).not.toContain(ADDRESS);
  });

  it("says the off-ramp is unset rather than inventing one", () => {
    expect(renderPanel({ offrampUrl: null })).toContain(walletCopy.offramp.none);
    expect(screen.queryByRole("link", { name: walletCopy.offramp.link })).toBeNull();
  });
});
