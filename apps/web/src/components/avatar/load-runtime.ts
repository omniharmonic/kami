/**
 * The one dynamic import of the Rive runtime. Kept in its own module so tests
 * can make it reject (runtime unavailable) without touching the component.
 */
export type RiveRuntimeModule = typeof import("./rive-runtime");

export function loadRiveRuntime(): Promise<RiveRuntimeModule> {
  return import("./rive-runtime");
}
