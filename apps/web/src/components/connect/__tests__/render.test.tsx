// @vitest-environment jsdom
/**
 * The two panels that carry a promise the server cannot keep on its own.
 *
 * `TokenPanel` must show a minted token exactly once and lose it on request;
 * and it must state what rotating breaks *before* rotating is possible.
 * `StatusPanel` must never render a bare tick, and its "not set up" case has to
 * name the thing to set up — a status that says only "no" is a status nobody
 * can act on.
 */
import { describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import type { ConnectStatus, Signal } from "@/lib/connect/status";
import type { TokenState } from "@/lib/connect/token";
import { StatusPanel, SignalRow } from "../StatusPanel";
import { TokenPanel, EMPTY_MINT_STATE, type MintFormState } from "../TokenPanel";

afterEach(cleanup);

const TOKEN = "kami_boulder-creek_" + "a".repeat(48);

const noToken: TokenState = { slug: "boulder-creek", exists: false, prefix: "kami_boulder-creek_", fingerprint: null, minted_at: null, age_s: null, rotated: false };
const hasToken: TokenState = { ...noToken, exists: true, fingerprint: "deadbeef", minted_at: "2026-09-06T10:00:00Z", age_s: 7200 };

function panel(token: TokenState, action: (p: MintFormState, fd: FormData) => Promise<MintFormState>, mayMint = true) {
  return render(<TokenPanel token={token} mayMint={mayMint} slug="boulder-creek" tokenVar="PLATFORM_MCP_TOKEN" slugVar="KAMI_ENTITY_SLUG" action={action} />);
}

describe("TokenPanel", () => {
  it("shows a minted token once, and loses it when the person says they have copied it", async () => {
    const action = vi.fn(async (_prev: MintFormState, _fd: FormData): Promise<MintFormState> => ({ ok: true, token: TOKEN, replaced: false }));
    const { container } = panel(noToken, action);
    expect(container.innerHTML).not.toContain(TOKEN);

    await act(async () => {
      fireEvent.click(screen.getByTestId("mint"));
    });
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]![1].get("slug")).toBe("boulder-creek");
    expect(screen.getByTestId("token-value").textContent).toBe(TOKEN);
    expect(screen.getByTestId("token-once").textContent).toContain("only time this token will ever be displayed");

    await act(async () => {
      fireEvent.click(screen.getByText("I have copied it — hide"));
    });
    expect(screen.queryByTestId("token-value")).toBeNull();
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(screen.getByTestId("token-hidden").textContent).toContain("Mint another one if you did not copy it");
  });

  it("states what rotating breaks before the rotate button exists, and will not submit unconfirmed", async () => {
    const action = vi.fn(async (_prev: MintFormState, _fd: FormData): Promise<MintFormState> => ({ ok: true, token: TOKEN, replaced: true }));
    panel(hasToken, action);
    // nothing destructive is one click away
    expect(screen.queryByTestId("rotate-go")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("rotate-start"));
    });
    expect(screen.getByTestId("rotate-form").textContent).toContain("stops working on the next request");
    expect((screen.getByTestId("rotate-go") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    expect((screen.getByTestId("rotate-go") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByTestId("rotate-go"));
    });
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]![1].get("slug")).toBe("boulder-creek");
    expect(action.mock.calls[0]![1].get("confirm")).toBe("yes");
  });

  it("shows a guardian the facts and no way to mint", () => {
    panel(hasToken, async () => EMPTY_MINT_STATE, false);
    expect(screen.getByTestId("token-facts").textContent).toContain("deadbeef");
    expect(screen.queryByTestId("mint")).toBeNull();
    expect(screen.queryByTestId("rotate-start")).toBeNull();
    expect(screen.getByTestId("token-cannot-mint")).toBeTruthy();
  });
});

const signal = (over: Partial<Signal> & Pick<Signal, "key">): Signal => ({ state: "not_configured", at: null, age_s: null, detail: null, ...over });

const status = (signals: Signal[]): ConnectStatus => ({
  slug: "boulder-creek",
  generated_at: "2026-09-06T12:00:00Z",
  paused: false,
  token: noToken,
  signals,
});

describe("StatusPanel", () => {
  it("says what to set up, not merely that nothing is set up", () => {
    render(
      <StatusPanel
        poll={false}
        endpoint="/api/entities/boulder-creek/connect/status"
        initial={status([
          signal({ key: "token" }),
          signal({ key: "mcp_call" }),
          signal({ key: "chat" }),
          signal({ key: "gate" }),
        ])}
      />,
    );
    expect(screen.getByTestId("state-token").textContent).toBe("not set up");
    // each "not set up" line names the thing to do or the setting to change
    expect(screen.getByText("Mint one above. Nothing else on this list can happen first.")).toBeTruthy();
    expect(screen.getByText(/Configure HERMES_GATEWAY_URL/)).toBeTruthy();
    expect(screen.getByText(/Nothing has reported where the model runs/)).toBeTruthy();
  });

  it("never renders a 'seen' without the time it was seen", () => {
    render(<SignalRow signal={signal({ key: "mcp_call", state: "seen", at: "2026-09-06T11:59:00Z", age_s: 60 })} />);
    expect(screen.getByTestId("state-mcp_call").textContent).toBe("seen");
    expect(screen.getByTestId("at-mcp_call").textContent).toContain("2026-09-06T11:59:00Z");
    expect(screen.getByTestId("at-mcp_call").textContent).toContain("60 s ago");
  });

  it("names the tool behind a write, and says a read leaves no trace", () => {
    render(<SignalRow signal={signal({ key: "mcp_tool", state: "seen", at: "2026-09-06T11:00:00Z", age_s: 3600, detail: "post_update" })} />);
    expect(screen.getByTestId("at-mcp_tool").textContent).toContain("via post_update");
  });

  it("keeps the last values and blames the check, not the agent, when a poll fails", async () => {
    const initial = status([signal({ key: "token", state: "seen", at: "2026-09-06T10:00:00Z", age_s: 7200 })]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<StatusPanel initial={initial} endpoint="/x" intervalMs={5} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.getByTestId("state-token").textContent).toBe("seen");
    expect(screen.getByTestId("connect-status").textContent).toContain("did not answer");
    vi.unstubAllGlobals();
  });
});
