"use client";

/**
 * The step-3 preview chat. It talks to `<slug>-staging` through the gate, so
 * it is guarded exactly like production, and it is labelled a preview
 * everywhere it appears. If the gateway cannot be reached it says so — it
 * never invents a reply.
 */
import { useState } from "react";
import { summon } from "@/lib/summon/copy";

type Reply =
  | { kind: "ok"; text: string; disclosure: string; looked_at: unknown[]; guard_dropped: number }
  | { kind: "unavailable"; message: string };

export function PreviewChat({ slug, name, voice, archetype }: { slug: string; name: string; voice: string; archetype: string }) {
  const [message, setMessage] = useState("What is the flow right now?");
  const [reply, setReply] = useState<Reply | null>(null);
  const [pending, setPending] = useState(false);

  const send = async () => {
    if (!voice.trim()) {
      setReply({ kind: "unavailable", message: summon.soul.previewNoSoul });
      return;
    }
    setPending(true);
    setReply(null);
    try {
      const res = await fetch("/api/summon/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, voice, name, slug, archetype }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        setReply({
          kind: "ok",
          text: String(body.text ?? ""),
          disclosure: String(body.disclosure ?? ""),
          looked_at: (body.looked_at as unknown[]) ?? [],
          guard_dropped: Number(body.guard_dropped ?? 0),
        });
      } else {
        setReply({ kind: "unavailable", message: String(body.message ?? summon.soul.previewUnavailable) });
      }
    } catch {
      setReply({ kind: "unavailable", message: summon.soul.previewUnavailable });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="preview-h">
      <h3 id="preview-h" style={{ fontSize: "1rem", margin: 0 }}>
        {summon.soul.previewHeading} <span className="chip">{summon.soul.previewBadge}</span>
      </h3>
      <p className="muted" style={{ margin: 0 }}>{summon.soul.previewIntro}</p>
      <label>
        <span className="eyebrow">{summon.soul.previewLabel}</span>
        <textarea className="field" style={{ minHeight: "3.5rem", paddingBlock: "0.5rem" }} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <p style={{ margin: 0 }}>
        <button type="button" className="btn" onClick={send} disabled={pending || message.trim().length === 0}>
          {pending ? "…" : summon.soul.previewSend}
        </button>
      </p>
      <div aria-live="polite">
        {reply?.kind === "unavailable" ? <p className="sunken" style={{ margin: 0 }}>{reply.message}</p> : null}
        {reply?.kind === "ok" ? (
          <div className="msg msg-ai" style={{ maxWidth: "100%" }}>
            <p className="eyebrow" style={{ margin: 0 }}>{summon.soul.previewBadge}</p>
            <p style={{ margin: "0.25rem 0" }} data-generated="ai">{reply.text}</p>
            <p className="disclosure" style={{ marginTop: "0.5rem" }}>{reply.disclosure}</p>
            <p className="footer-looked" style={{ marginBottom: 0 }}>
              {reply.looked_at.length} tool call{reply.looked_at.length === 1 ? "" : "s"}; {reply.guard_dropped} sentence
              {reply.guard_dropped === 1 ? "" : "s"} withheld by the guard. Nothing here is stored.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
