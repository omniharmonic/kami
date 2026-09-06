/**
 * The tool list, rendered from whatever `toolCatalog()` returned. Every row is
 * a registry row: nothing here is written by hand, so a tool added to
 * `src/lib/mcp/server.ts` or to the twin package appears here without anyone
 * remembering to come back.
 *
 * The read/write chip is the load-bearing part. An agent operator needs to know
 * which calls are free to make and which land on a public page and in an audit
 * log, and an unannotated tool is shown as one that changes something —
 * unknown is never resolved in the reassuring direction.
 */
import { connect as copy } from "@/copy";
import type { ToolInfo } from "@/lib/connect/tools";

type Props = {
  tools: ToolInfo[];
  /** tool names the Hermes profile template includes, when that matters here */
  included?: readonly string[] | null;
  testId?: string;
};

export function ToolTable({ tools, included = null, testId }: Props) {
  if (tools.length === 0) return <p className="sunken">{copy.tools.noneListed}</p>;
  return (
    <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }} data-testid={testId}>
      {tools.map((t) => (
        <li key={`${t.server}:${t.name}`} className="sunken" data-tool={t.name} data-writes={t.writes ? "true" : "false"}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
            <code style={{ fontWeight: 600 }}>{t.name}</code>
            <span className={t.writes ? "chip" : "chip chip-live"} title={t.writes ? copy.tools.writeWhat : copy.tools.readWhat}>
              {t.writes ? copy.tools.write : copy.tools.read}
            </span>
            {included && included.includes(t.name) ? (
              <span className="chip" style={{ fontSize: "0.75rem" }}>{copy.tools.includedLabel}</span>
            ) : null}
          </div>
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.9rem" }}>{t.summary}</p>
        </li>
      ))}
    </ul>
  );
}
