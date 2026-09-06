"use client";

/**
 * The whole donation page, as one presentational component so the ethics test
 * can render exactly what a donor sees (`__tests__/copy.test.tsx`).
 * `src/app/e/[slug]/donate/page.tsx` does the reads and renders this.
 *
 * What is deliberately absent: a countdown, a goal bar, a progress meter, a
 * recurring option, a pre-selected amount, a matched-gift banner, and any
 * sentence that tells you what will happen to a creek if you do not give.
 */
import { treasury } from "@/copy";
import { donateCopy } from "@/lib/donations/copy";
import { DirectUsdc, type DirectUsdcProps } from "./DirectUsdc";
import { DonateForm, type DonateFormProps } from "./DonateForm";

export type DonatePanelProps = {
  name: string;
  slug: string;
  /** `config.legal_entity_name`, or null when there is no wrapper yet */
  legalEntityName: string | null;
  minUsd: number;
  maxUsd: number;
  cardEnabled: boolean;
  direct: Omit<DirectUsdcProps, "name">;
  notice?: "thanks" | "cancelled" | null;
  formProps?: Partial<Pick<DonateFormProps, "submitImpl" | "navigate">>;
};

export function DonatePanel({ name, slug, legalEntityName, minUsd, maxUsd, cardEnabled, direct, notice, formProps }: DonatePanelProps) {
  return (
    <>
      <section className="section" aria-labelledby="donate-h">
        <p className="eyebrow">{donateCopy.eyebrow}</p>
        <h1 id="donate-h">{donateCopy.title(name)}</h1>
        <p>{donateCopy.intro(name)}</p>
        <p className="faint" style={{ margin: 0 }}>{donateCopy.disclosureNote}</p>
        {notice === "thanks" && (
          <div className="card stack" role="status">
            <strong>{donateCopy.thanks.heading}</strong>
            <p style={{ margin: 0 }}>{donateCopy.thanks.body(name)}</p>
          </div>
        )}
        {notice === "cancelled" && (
          <div className="card stack" role="status">
            <strong>{donateCopy.cancelled.heading}</strong>
            <p style={{ margin: 0 }}>{donateCopy.cancelled.body}</p>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="can-h">
        <h2 id="can-h">{donateCopy.can.heading}</h2>
        <ul>{donateCopy.can.items.map((i) => <li key={i}>{i}</li>)}</ul>
        <h2 id="cannot-h">{donateCopy.cannot.heading}</h2>
        <ul>{donateCopy.cannot.items.map((i) => <li key={i}>{i}</li>)}</ul>
      </section>

      <section className="section" aria-labelledby="fees-h">
        <h2 id="fees-h">{donateCopy.fees.heading}</h2>
        <ul>
          <li>{donateCopy.fees.card}</li>
          <li>{donateCopy.fees.stablecoin}</li>
          <li>{donateCopy.fees.direct}</li>
        </ul>
        <p>{donateCopy.fees.platform}</p>
        <p className="faint" style={{ margin: 0 }}>{donateCopy.fees.verify}</p>
      </section>

      <section className="section" aria-labelledby="wrapper-h">
        <h2 id="wrapper-h">{donateCopy.wrapper.heading}</h2>
        <p>{legalEntityName ? donateCopy.wrapper.named(legalEntityName) : donateCopy.wrapper.none}</p>
      </section>

      <section className="section" aria-labelledby="human-h">
        <h2 id="human-h">{donateCopy.humanSigns.heading}</h2>
        <p>{donateCopy.humanSigns.body}</p>
      </section>

      <section className="section" aria-labelledby="amount-h">
        <h2 id="amount-h">{donateCopy.amount.heading}</h2>
        <div className="card">
          <DonateForm slug={slug} minUsd={minUsd} maxUsd={maxUsd} cardEnabled={cardEnabled} {...(formProps ?? {})} />
        </div>
      </section>

      <DirectUsdc name={name} {...direct} />

      <section className="section" aria-labelledby="report-h">
        <h2 id="report-h">{donateCopy.report.heading}</h2>
        <p>{donateCopy.report.body}</p>
        <p>{donateCopy.report.noToken}</p>
        <p className="muted">{donateCopy.report.refund}</p>
        <p className="faint" style={{ margin: 0 }}>{treasury.noRecurring}</p>
      </section>
    </>
  );
}
