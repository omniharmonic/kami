import { chat } from "@/copy";

/** SB 243 reminder / any system-rendered line. Never produced by the model. */
export function Reminder({ text, kind = "reminder" }: { text: string; kind?: "reminder" | "state" | "crisis" }) {
  return (
    <div className="msg msg-system" role="status" data-system={kind} data-reminder={kind === "reminder" ? "true" : undefined}>
      <span className="eyebrow">{chat.systemLabel}</span>
      <p style={{ margin: "0.2rem 0 0" }}>{text}</p>
    </div>
  );
}
