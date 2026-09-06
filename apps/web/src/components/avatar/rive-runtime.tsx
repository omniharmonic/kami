"use client";
/**
 * The Rive canvas for one rig. Loaded lazily by `load-runtime.ts` so the SVG
 * fallback paints first and the runtime (wasm + JS) never blocks first paint.
 */
import { useEffect, useRef } from "react";
import type { AvatarViewModel } from "@/lib/avatar/inputs";
import { applyViewModel, useKamiRive, useKamiViewModelInstance, type ApplyResult } from "./rive-adapter";

export type RiveCanvasProps = {
  src: string;
  viewModel: AvatarViewModel;
  label: string;
  /** the state machine should run (false = reduced-motion rest pose) */
  play: boolean;
  onReady?: () => void;
  onFail?: (reason: string) => void;
  onBinding?: (result: ApplyResult) => void;
};

export function RiveCanvas({ src, viewModel, label, play, onReady, onFail, onBinding }: RiveCanvasProps) {
  const { rive, RiveComponent } = useKamiRive({
    src,
    autoplay: play,
    onLoad: onReady,
    onLoadError: () => onFail?.("load-failed"),
  });
  const instance = useKamiViewModelInstance(rive);
  const onBindingRef = useRef(onBinding);
  onBindingRef.current = onBinding;

  useEffect(() => {
    if (!instance) return;
    const result = applyViewModel(instance, viewModel);
    onBindingRef.current?.(result);
  }, [instance, viewModel]);

  return <RiveComponent role="img" aria-label={label} style={{ width: "100%", height: "100%", display: "block" }} />;
}
