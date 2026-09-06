// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/avatar/rigs", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/avatar/rigs")>();
  const manifest = { ...m.rigManifest, creek: { version: "v0", available: true } };
  return { ...m, rigManifest: manifest, rigFor: (a: string) => m.rigFor(a, manifest) };
});
vi.mock("../avatar/load-runtime", () => ({ loadRiveRuntime: vi.fn() }));

import { Avatar } from "../Avatar";
import { loadRiveRuntime } from "../avatar/load-runtime";
import fixture from "@/fixtures/status/boulder-creek.json";
import type { HealthSnapshot } from "@kami/needs";

const snapshot = fixture.snapshot as HealthSnapshot;
const loader = vi.mocked(loadRiveRuntime);

afterEach(() => {
  cleanup();
  loader.mockReset();
  vi.restoreAllMocks();
});

describe("Avatar when the Rive runtime is unavailable", () => {
  it("keeps the SVG when the dynamic import rejects", async () => {
    loader.mockRejectedValueOnce(new Error("ChunkLoadError"));
    const { container } = render(<Avatar snapshot={snapshot} archetype="creek" name="Boulder Creek" />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/rigs/fallback/creek-asleep.svg");
    await waitFor(() => expect(container.querySelector(".avatar-stage")!.getAttribute("data-avatar-reason")).toBe("import-failed"));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("can't feel my gauge");
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector(".avatar-stage")!.getAttribute("data-avatar-mode")).toBe("svg");
  });

  it("keeps the SVG when the runtime component throws (error boundary)", async () => {
    const Throwing = () => {
      throw new Error("wasm exploded");
    };
    loader.mockResolvedValueOnce({ RiveCanvas: Throwing } as unknown as Awaited<ReturnType<typeof loadRiveRuntime>>);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<Avatar snapshot={snapshot} archetype="creek" name="Boulder Creek" />);
    await waitFor(() => expect(container.querySelector(".avatar-stage")!.getAttribute("data-avatar-reason")).toBe("runtime-error"));
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("/rigs/fallback/creek-asleep.svg");
    expect((img as HTMLImageElement).hidden).toBe(false);
    expect(screen.getByTestId("mood-reason").textContent).toBe("I can't feel my gauge");
  });

  it("keeps the SVG when the rig file fails to load (onFail from the runtime)", async () => {
    const Failing = ({ onFail }: { onFail?: (r: string) => void }) => {
      useEffect(() => {
        onFail?.("load-failed");
      }, [onFail]);
      return null;
    };
    loader.mockResolvedValueOnce({ RiveCanvas: Failing } as unknown as Awaited<ReturnType<typeof loadRiveRuntime>>);
    const { container } = render(<Avatar snapshot={snapshot} archetype="creek" name="Boulder Creek" />);
    await waitFor(() => expect(container.querySelector(".avatar-stage")!.getAttribute("data-avatar-reason")).toBe("load-failed"));
    expect(screen.getByRole("img").getAttribute("src")).toBe("/rigs/fallback/creek-asleep.svg");
  });
});
