import { describe, expect, it } from "vitest";
import { resolveCssVars, svgToDataUri } from "../svg";

describe("resolveCssVars", () => {
  it("replaces var(--x, fallback) with the fallback, including nested ones", () => {
    expect(resolveCssVars(".b{fill:var(--kami-accent,#2f6f8f)}")).toBe(".b{fill:#2f6f8f}");
    expect(resolveCssVars("stroke:var( --kami-ink , #26221d )")).toBe("stroke:#26221d");
    expect(resolveCssVars("fill:var(--a,var(--b,#fff))")).toBe("fill:#fff");
  });
  it("leaves everything else alone", () => {
    const s = '<svg viewBox="0 0 240 240"><circle r="1"/></svg>';
    expect(resolveCssVars(s)).toBe(s);
  });
});

describe("svgToDataUri", () => {
  it("base64-encodes as image/svg+xml", () => {
    const uri = svgToDataUri("<svg/>");
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(uri.split(",")[1]!, "base64").toString("utf8")).toBe("<svg/>");
  });
});
