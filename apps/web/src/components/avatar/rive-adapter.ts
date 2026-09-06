/**
 * The ONLY file that imports `@rive-app/react-canvas`. Everything the avatar
 * needs from the runtime goes through the three functions below, so a rename
 * in a future runtime version is a one-file change.
 *
 * Verified against @rive-app/react-canvas 4.34.1 (dist/types/index.d.ts):
 *  - `useRive(params, opts)` → `{ rive, RiveComponent }`; params accept
 *    `src, stateMachines, autoplay, autoBind, layout, onLoad, onLoadError`.
 *  - `useViewModel(rive, { name } | { useDefault })` → `ViewModel | null`.
 *  - `useViewModelInstance(viewModel, { useDefault, rive })` → instance, bound
 *    to `rive` when `rive` is passed.
 *  - Typed property hooks exist too (`useViewModelInstanceNumber/Boolean/
 *    Enum/String(path, instance)`), but hooks cannot be called in a loop over
 *    a dynamic `cosmetic_*` set, so values are pushed through the imperative
 *    `ViewModelInstance.number|boolean|enum|string(path).value` setters from
 *    `@rive-app/canvas` 2.42.0 instead — same objects the hooks wrap.
 *  - State-machine inputs (`useStateMachineInput`) are deprecated in 4.34 in
 *    favour of data binding; this adapter does not use them.
 */
import { useMemo, useRef } from "react";
import {
  Alignment,
  Fit,
  Layout,
  useRive,
  useViewModel,
  useViewModelInstance,
  type Rive,
  type ViewModelInstance,
} from "@rive-app/react-canvas";
import type { AvatarViewModel } from "@/lib/avatar/inputs";
import { STATE_MACHINE, VIEW_MODEL } from "@/lib/avatar/rigs";

export type RiveHandle = {
  rive: Rive | null;
  RiveComponent: ReturnType<typeof useRive>["RiveComponent"];
};

export type UseKamiRiveOptions = {
  src: string;
  /** false = do not start the state machine (reduced-motion rest pose) */
  autoplay: boolean;
  onLoad?: () => void;
  onLoadError?: (error: unknown) => void;
};

/** Creates the runtime for one rig; callbacks are read through refs so the latest ones fire. */
export function useKamiRive({ src, autoplay, onLoad, onLoadError }: UseKamiRiveOptions): RiveHandle {
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onLoadError);
  onLoadRef.current = onLoad;
  onErrorRef.current = onLoadError;

  const params = useMemo(
    () => ({
      src,
      stateMachines: STATE_MACHINE,
      autoplay,
      // we bind the instance ourselves (useKamiViewModelInstance) so the name is explicit
      autoBind: false,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onLoad: () => onLoadRef.current?.(),
      onLoadError: (e: unknown) => onErrorRef.current?.(e),
    }),
    [src, autoplay],
  );

  const { rive, RiveComponent } = useRive(params, { shouldResizeCanvasToContainer: true });
  return { rive, RiveComponent };
}

/** The `Kami` ViewModel's default instance, bound to the rive instance; falls back to the file's default ViewModel. */
export function useKamiViewModelInstance(rive: Rive | null): ViewModelInstance | null {
  const named = useViewModel(rive, { name: VIEW_MODEL });
  const fallback = useViewModel(rive, { useDefault: true });
  const viewModel = named ?? fallback;
  return useViewModelInstance(viewModel, { useDefault: true, rive });
}

export type ApplyResult = { applied: string[]; missing: string[] };

/**
 * Push every value into the instance by exact property name. A rig missing a
 * property is not an error (v0 rigs may implement a subset); it is reported
 * in `missing` so the dev page can show it.
 */
export function applyViewModel(instance: ViewModelInstance | null, viewModel: AvatarViewModel): ApplyResult {
  const applied: string[] = [];
  const missing: string[] = [];
  if (!instance) return { applied, missing: Object.keys(viewModel) };
  for (const entry of Object.values(viewModel)) {
    try {
      switch (entry.kind) {
        case "number": {
          const p = instance.number(entry.name);
          if (!p) break;
          p.value = entry.value;
          applied.push(entry.name);
          continue;
        }
        case "boolean": {
          const p = instance.boolean(entry.name);
          if (!p) break;
          p.value = entry.value;
          applied.push(entry.name);
          continue;
        }
        case "string": {
          const p = instance.string(entry.name);
          if (!p) break;
          p.value = entry.value;
          applied.push(entry.name);
          continue;
        }
        case "enum": {
          const p = instance.enum(entry.name);
          if (!p) break;
          if (p.values.includes(entry.value)) p.value = entry.value;
          else p.valueIndex = entry.index;
          applied.push(entry.name);
          continue;
        }
      }
    } catch {
      /* fall through to missing */
    }
    missing.push(entry.name);
  }
  return { applied, missing };
}

/** Reduced-motion: leave the pose static. */
export function pauseRive(rive: Rive | null): void {
  try {
    rive?.pause();
  } catch {
    /* already torn down */
  }
}
