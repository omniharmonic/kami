"use client";

import { useId, useRef, useState, type ReactNode } from "react";

export type HabitatTab = { id: string; label: string; icon: string; content: ReactNode; detail?: string };

/** Server-rendered data panels, with a small accessible client-side instrument dock. */
export function HabitatConsole({ tabs }: { tabs: HabitatTab[] }) {
  const prefix = useId();
  const [active, setActive] = useState(tabs[0]?.id);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className="habitat-console">
      <div className="habitat-console-top"><span>Field journal</span><span className="habitat-console-hint">Observe · understand · care</span></div>
      <div className="habitat-tabs" role="tablist" aria-label="Field journal sections">
        {tabs.map((tab, index) => (
          <button key={tab.id} ref={(node) => { refs.current[index] = node; }} type="button" role="tab"
            id={`${prefix}-tab-${tab.id}`} aria-controls={`${prefix}-panel-${tab.id}`} aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1} onClick={() => setActive(tab.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault(); setActive(tabs[next]!.id); refs.current[next]?.focus();
            }}>
            <span aria-hidden="true" className="habitat-tab-icon">{tab.icon}</span><span>{tab.label}</span>
            {tab.detail && <small>{tab.detail}</small>}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} className="habitat-panel" role="tabpanel" id={`${prefix}-panel-${tab.id}`}
          aria-labelledby={`${prefix}-tab-${tab.id}`} hidden={active !== tab.id} tabIndex={0}>{tab.content}</div>
      ))}
    </div>
  );
}
