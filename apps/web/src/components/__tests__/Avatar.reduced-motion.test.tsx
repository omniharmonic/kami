// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// A rig IS available in this file, so the only thing standing between the
// component and the runtime is prefers-reduced-motion.
vi.mock("@/lib/avatar/rigs", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/avatar/rigs")>();
  const manifest = { ...m.rigManifest, creek: { version: "v0", available: true } };
  return { ...m, rigManifest: manifest, rigFor: (a: string) => m.rigFor(a, manifest) };
});
vi.mock("../avatar/load-runtime", () => ({ loadRiveRuntime: vi.fn(() => Promise.reject(new Error("should not be called"))) }));

import { Avatar } from "../Avatar";
import { loadRiveRuntime } from "../avatar/load-runtime";
import fixture from "@/fixtures/status/boulder-creek.json";
import type { HealthSnapshot } from "@kami/needs";

const snapshot = fixture.snapshot as HealthSnapshot;

describe("Avatar under prefers-reduced-motion", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }));
    window.matchMedia = globalThis.matchMedia as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.mocked(loadRiveRuntime).mockClear();
  });

  it("renders the static SVG pose and never imports the runtime", async () => {
    const { container } = render(<Avatar snapshot={snapshot} archetype="creek" name="Boulder Creek" />);
    await waitFor(() => expect(container.querySelector(".avatar-stage")!.getAttribute("data-avatar-reason")).toBe("reduced-motion"));
    expect(screen.getByRole("img").getAttribute("src")).toBe("/rigs/fallback/creek-asleep.svg");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("can't feel my gauge");
    expect(container.querySelector("canvas")).toBeNull();
    expect(loadRiveRuntime).not.toHaveBeenCalled();
  });
});
