"use client";
/**
 * The avatar stage (architecture §9.4, ADR-E09).
 *
 * Order of rendering, always:
 *  1. the static SVG for archetype × mood — server-rendered, paints first;
 *  2. if a rig is available AND the viewer does not prefer reduced motion,
 *     the Rive runtime is imported lazily and drawn on top; the SVG hides only
 *     once the rig has loaded;
 *  3. any failure — rig missing, import rejected, load error, runtime throw —
 *     leaves the SVG in place. `data-avatar-reason` says why, for the dev page.
 *
 * Reduced motion: the runtime is not started at all; the SVG is the rest pose.
 * The `aria-label` is always present (on the img, or on the canvas).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fallbackSrc,
  moodName,
  prefersReducedMotion,
  riveInputsToViewModel,
  type RiveInputs,
} from "@/lib/avatar/inputs";
import { rigFor } from "@/lib/avatar/rigs";
import { AvatarErrorBoundary } from "./AvatarErrorBoundary";
import { loadRiveRuntime, type RiveRuntimeModule } from "./load-runtime";

export type AvatarReason = "" | "rig-unavailable" | "reduced-motion" | "import-failed" | "load-failed" | "runtime-error";

export type RiveAvatarProps = {
  archetype: string;
  inputs: RiveInputs;
  /** full accessible name: mood_reason + headline (see ariaLabel) */
  label: string;
  /** override the media query (the dev page's "force reduced motion") */
  reducedMotion?: boolean;
  /** CSS pixel size of the square stage; the img keeps intrinsic 240 */
  size?: number;
  /** dev page hook: which properties the rig accepted */
  onBinding?: (result: { applied: string[]; missing: string[] }) => void;
};

export function RiveAvatar({ archetype, inputs, label, reducedMotion, size = 240, onBinding }: RiveAvatarProps) {
  const rig = rigFor(archetype);
  const mood = moodName(inputs.mood);
  const src = fallbackSrc(rig.archetype, mood);
  const viewModel = useMemo(() => riveInputsToViewModel(inputs), [inputs]);

  const [runtime, setRuntime] = useState<RiveRuntimeModule | null>(null);
  const [ready, setReady] = useState(false);
  const [reason, setReason] = useState<AvatarReason>(rig.available ? "" : "rig-unavailable");

  const fail = useCallback((why: AvatarReason) => {
    setRuntime(null);
    setReady(false);
    setReason(why);
  }, []);

  useEffect(() => {
    if (!rig.available) {
      setReason("rig-unavailable");
      return;
    }
    const reduced = reducedMotion ?? prefersReducedMotion();
    if (reduced) {
      setRuntime(null);
      setReady(false);
      setReason("reduced-motion");
      return;
    }
    let cancelled = false;
    setReason("");
    loadRiveRuntime()
      .then((mod) => {
        if (!cancelled) setRuntime(() => mod);
      })
      .catch(() => {
        if (!cancelled) fail("import-failed");
      });
    return () => {
      cancelled = true;
    };
  }, [rig.available, rig.src, reducedMotion, fail]);

  const stale = inputs.stale === true;
  const mode = runtime && ready ? "rive" : "svg";

  return (
    <div
      className="avatar-stage"
      data-avatar-mode={mode}
      data-avatar-reason={reason}
      data-mood={mood}
      data-stale={stale ? "true" : "false"}
      style={{ position: "relative", width: `min(60vw, ${size}px)`, aspectRatio: "1 / 1" }}
    >
      <img
        src={src}
        alt=""
        role="img"
        aria-label={label}
        width={240}
        height={240}
        hidden={mode === "rive"}
        className="avatar-fallback"
        style={{ width: "100%", height: "100%" }}
      />
      {runtime ? (
        <AvatarErrorBoundary fallback={null} onError={() => fail("runtime-error")}>
          <div style={{ position: "absolute", inset: 0 }} aria-hidden={mode !== "rive"}>
            <runtime.RiveCanvas
              src={rig.src}
              viewModel={viewModel}
              label={label}
              play
              onReady={() => setReady(true)}
              onFail={() => fail("load-failed")}
              onBinding={onBinding}
            />
          </div>
        </AvatarErrorBoundary>
      ) : null}
    </div>
  );
}
