import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ session: null as null | { user: { email: string } } }));
vi.mock("@/lib/session", () => ({ getSession: async () => state.session }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("../(auth)/sign-in/SignInForm", () => ({ SignInForm: () => <form>Sign-in form</form> }));
import RootLayout from "../layout";
import SignInPage from "../(auth)/sign-in/page";

beforeEach(() => { state.session = null; });

describe("account navigation after a magic link", () => {
  it("shows sign in to a visitor", async () => {
    const html = renderToStaticMarkup(await RootLayout({ children: <p>World</p> }));
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toContain('href="/me"');
    expect(renderToStaticMarkup(await SignInPage())).toContain("Sign-in form");
  });
  it("shows the verified account and redirects away from sign in", async () => {
    state.session = { user: { email: "steward@example.org" } };
    const html = renderToStaticMarkup(await RootLayout({ children: <p>World</p> }));
    expect(html).toContain('href="/me"');
    expect(html).toContain("My account: steward@example.org");
    expect(html).not.toContain('href="/sign-in"');
    await expect(SignInPage()).rejects.toThrow("redirect:/me");
  });
});
