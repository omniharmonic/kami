"use client";

/**
 * Two audiences, one page. The generic path is the default and the first tab:
 * the platform is the thing you connect *to*, and Hermes is one worked example
 * of connecting to it, not the assumed case.
 *
 * Both panels are rendered server-side and kept in the DOM; the tab only
 * toggles `hidden`. So the Hermes instructions are present for search, for
 * print, and for a browser with no JavaScript — which will show both panels
 * rather than neither.
 */
import { useState } from "react";
import { connect as copy } from "@/copy";

type Props = { generic: React.ReactNode; hermes: React.ReactNode };

export function ConnectTabs({ generic, hermes }: Props) {
  const [tab, setTab] = useState<"any" | "hermes">("any");
  return (
    <>
      <div onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "any" : event.key === "End" ? "hermes" : tab === "any" ? "hermes" : "any";
        setTab(next);
        document.getElementById(`tab-${next}`)?.focus();
      }} role="tablist" aria-label={copy.tabs.label} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
        <button
          role="tab"
          type="button"
          id="tab-any"
          aria-selected={tab === "any"}
          tabIndex={tab === "any" ? 0 : -1}
          aria-controls="panel-any"
          className={tab === "any" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("any")}
        >
          {copy.tabs.any}
        </button>
        <button
          role="tab"
          type="button"
          id="tab-hermes"
          aria-selected={tab === "hermes"}
          tabIndex={tab === "hermes" ? 0 : -1}
          aria-controls="panel-hermes"
          className={tab === "hermes" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("hermes")}
        >
          {copy.tabs.hermes}
        </button>
      </div>
      <p className="faint" style={{ fontSize: "0.85rem", marginTop: "0.4rem" }}>
        {tab === "any" ? copy.tabs.anyHint : copy.tabs.hermesHint}
      </p>
      <div role="tabpanel" id="panel-any" aria-labelledby="tab-any" hidden={tab !== "any"}>
        {generic}
      </div>
      <div role="tabpanel" id="panel-hermes" aria-labelledby="tab-hermes" hidden={tab !== "hermes"}>
        {hermes}
      </div>
    </>
  );
}
