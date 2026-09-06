import { disclosureLabel } from "@/copy";

/**
 * ADR-E13: the disclosure is a rendering invariant. Rendered by `EntityShell`
 * on every `/e/*` route and again at the top of every chat session.
 */
export function DisclosureLabel({ name, archetype }: { name: string; archetype: string }) {
  return (
    <p className="disclosure" role="note" data-disclosure="ai-voice" data-testid="disclosure">
      {disclosureLabel(name, archetype)}
    </p>
  );
}
