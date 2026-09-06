import type { TreeReader } from "./tree.js";
import type { Binding } from "./binding.js";

export type Mode = "stdio" | "worker" | "test";

/** What every tool handler gets besides its validated input. */
export interface ToolContext {
  reader: TreeReader;
  /** Configured bindings keyed by entity slug (the part after `entity/`). */
  bindings: Map<string, Binding>;
  /** Origins a `binding_url` may be fetched from by `resolve_entity`. */
  bindingOrigins: string[];
  mode: Mode;
  /** Injectable clock (ms since epoch) so fixture runs are deterministic. */
  now: () => number;
}

export interface ToolOutcome {
  payload: Record<string, unknown>;
  /** Tree path whose `generated_at`/`schema_version` stamp the envelope. */
  source_path?: string;
}
