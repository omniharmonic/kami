"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chat as copy, crisis, disclosure, states } from "@/copy";
import type { ToolcallsEvent } from "@/lib/gateway";
import { DisclosureLabel } from "./DisclosureLabel";
import { Reminder } from "./Reminder";

export type ChatProps = {
  slug: string;
  name: string;
  archetype: string;
  paused: boolean;
  gpuOnline: boolean;
  compact?: boolean;
};

type Msg =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; toolcalls: ToolcallsEvent | null; done: boolean }
  | { id: string; role: "system"; content: string; kind: "reminder" | "state" | "crisis" };

let counter = 0;
const nextId = () => `m${++counter}-${Date.now()}`;

/** Parse one SSE frame into {event, data}. */
export function parseFrame(frame: string): { event: string; data: string } {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.join("\n") };
}

export function Chat({ slug, name, archetype, paused, gpuOnline, compact = false }: ChatProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"ok" | "paused" | "asleep" | "over_budget" | "rate_limited">(paused ? "paused" : gpuOnline ? "ok" : "asleep");
  const endRef = useRef<HTMLDivElement>(null);
  type HistoryItem = { role: "user" | "assistant"; content: string };
  const historyRef = useRef<HistoryItem[]>([]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  const pushSystem = useCallback((content: string, kind: "reminder" | "state" | "crisis" = "state") => {
    setMessages((m) => [...m, { id: nextId(), role: "system", content, kind }]);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const userMsg: Msg = { id: nextId(), role: "user", content: text };
    const aiId = nextId();
    setMessages((m) => [...m, userMsg, { id: aiId, role: "assistant", content: "", toolcalls: null, done: false }]);
    const userItem: HistoryItem = { role: "user", content: text };
    historyRef.current = [...historyRef.current, userItem].slice(-40);

    try {
      const res = await fetch(`/e/${slug}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ messages: historyRef.current }),
      });
      if (!res.ok) {
        let reason = "error";
        let peopleAhead: number | null = null;
        try {
          const j = (await res.json()) as { reason?: string; people_ahead?: number | null };
          reason = j.reason ?? reason;
          peopleAhead = j.people_ahead ?? null;
        } catch {
          /* no body */
        }
        setMessages((m) => m.filter((x) => x.id !== aiId));
        if (res.status === 423 || reason === "paused") {
          setState("paused");
          pushSystem(copy.paused);
        } else if (reason === "over_budget") {
          setState("over_budget");
          pushSystem(peopleAhead ? `${states.peopleAhead(peopleAhead)} — ${copy.overBudget}` : copy.overBudget);
        } else if (reason === "rate_limited") {
          setState("rate_limited");
          pushSystem(copy.rateLimited);
        } else {
          pushSystem(copy.networkError);
        }
        return;
      }
      if (res.headers.get("x-kami-state") === "asleep") setState("asleep");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no body");
      const dec = new TextDecoder();
      let buf = "";
      let assistant = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const { event, data } = parseFrame(frame);
          if (event === "toolcalls") {
            let tc: ToolcallsEvent = { calls: [], guard_dropped: 0 };
            try {
              tc = JSON.parse(data) as ToolcallsEvent;
            } catch {
              /* keep empty */
            }
            setMessages((m) => m.map((x) => (x.id === aiId && x.role === "assistant" ? { ...x, toolcalls: tc } : x)));
          } else if (event === "reminder") {
            let text: string = disclosure.reminder(name);
            try {
              text = (JSON.parse(data) as { text?: string }).text ?? text;
            } catch {
              /* default */
            }
            setMessages((m) => [...m, { id: nextId(), role: "system", content: text, kind: "reminder" }]);
          } else if (event === "system") {
            let text: string = copy.asleep;
            try {
              text = (JSON.parse(data) as { text?: string }).text ?? text;
            } catch {
              /* default */
            }
            setMessages((m) => m.filter((x) => x.id !== aiId).concat({ id: nextId(), role: "system", content: text, kind: "state" }));
          } else if (event === "crisis") {
            setMessages((m) => [...m, { id: nextId(), role: "system", content: crisis.intro, kind: "crisis" }]);
          } else if (data && data !== "[DONE]") {
            try {
              const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
              const c = j.choices?.[0]?.delta?.content;
              if (c) {
                assistant += c;
                const snapshot = assistant;
                setMessages((m) => m.map((x) => (x.id === aiId && x.role === "assistant" ? { ...x, content: snapshot } : x)));
              }
            } catch {
              /* ignore non-JSON */
            }
          }
        }
      }
      setMessages((m) => m.map((x) => (x.id === aiId && x.role === "assistant" ? { ...x, done: true } : x)));
      if (assistant) {
        const aiItem: HistoryItem = { role: "assistant", content: assistant };
        historyRef.current = [...historyRef.current, aiItem].slice(-40);
      }
    } catch {
      setMessages((m) => m.filter((x) => x.id !== aiId));
      pushSystem(copy.networkError);
    } finally {
      setBusy(false);
    }
  }, [busy, input, name, pushSystem, slug]);

  const disabled = state === "paused";

  return (
    <div className="chat" data-chat-state={state}>
      {/* The disclosure label opens every session (ADR-E13). */}
      <DisclosureLabel name={name} archetype={archetype} />
      <Reminder text={disclosure.reminderFirst(name)} kind="state" />
      {state === "paused" && <Reminder text={copy.paused} kind="state" />}
      {state === "asleep" && messages.length === 0 && <Reminder text={copy.asleep} kind="state" />}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", minHeight: compact ? "8rem" : "40dvh" }} aria-live="polite">
        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="msg msg-user">
                <span className="sr-only">{copy.youLabel}: </span>
                {m.content}
              </div>
            );
          }
          if (m.role === "system") {
            return (
              <div key={m.id}>
                <Reminder text={m.content} kind={m.kind} />
                {m.kind === "crisis" && (
                  <ul className="msg msg-system" style={{ marginTop: "0.4rem" }}>
                    {crisis.resources.map((r) => (
                      <li key={r.name}>
                        {r.url ? <a href={r.url}>{r.name}</a> : r.name} — {r.how}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          }
          return (
            <div key={m.id} className="msg msg-ai" data-generated="ai" aria-label={disclosure.generatedMarker}>
              <span className="sr-only">{name} (AI): </span>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.content || (m.done ? "" : copy.sending)}</p>
              {m.done && (
                <footer className="footer-looked" data-looked-at>
                  <strong>{copy.lookedAt}</strong>
                  {m.toolcalls && m.toolcalls.calls.length > 0 ? (
                    <ul>
                      {m.toolcalls.calls.map((c, i) => (
                        <li key={i}>
                          <code>{c.place_id ?? "—"}</code> · {c.time ?? "no time"} · {c.source_id ?? "no source"} · {c.stale === null ? "staleness unknown" : c.stale ? states.cantFeelIt : "live"}
                          {c.source_status ? ` (${c.source_status})` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: "0.2rem 0 0" }}>{copy.lookedAtNone}</p>
                  )}
                  {m.toolcalls && m.toolcalls.guard_dropped > 0 && <p style={{ margin: "0.2rem 0 0" }}>{copy.guardDropped(m.toolcalls.guard_dropped)}</p>}
                </footer>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor={`chat-input-${slug}`} className="sr-only">{copy.placeholder}</label>
        <textarea
          id={`chat-input-${slug}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={copy.placeholder}
          rows={compact ? 1 : 2}
          disabled={disabled}
          maxLength={4000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={disabled || busy || !input.trim()}>
          {busy ? copy.sending : copy.send}
        </button>
      </form>
      <p className="faint" style={{ fontSize: "0.8rem", margin: 0 }}>
        {copy.anonymousNotice} {copy.retention}
      </p>
      <details>
        <summary className="tap" style={{ cursor: "pointer", fontSize: "0.9rem" }}>{crisis.heading}</summary>
        <p className="muted">{crisis.intro}</p>
        <ul>
          {crisis.resources.map((r) => (
            <li key={r.name}>
              {r.url ? <a href={r.url}>{r.name}</a> : r.name} — {r.how}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
