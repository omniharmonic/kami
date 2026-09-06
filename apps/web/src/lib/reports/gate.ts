/**
 * Asking the entity for the report's one paragraph, through the same relay
 * `src/lib/gateway.ts` uses (`HERMES_GATEWAY_URL`), on the non-streaming path
 * the gate keeps for cron jobs.
 *
 * The fact sheet is sent as a `role: "tool"` message **after** the last
 * `role: "user"` message, which is where `factguard`'s `FactSheet.from_tool_messages`
 * looks (`packages/factguard/src/factguard/atoms.py`). Every number the model
 * may utter is therefore one of the report's own numbers.
 *
 * `X-Guard: held` (both passes failed the guard), a non-200, a tunnel error or
 * an unreadable body all give the same answer: use the template, and record
 * that the template was used. An unguarded number is never published.
 */
import { env as appEnv } from "@/env";
import type { TreasuryDeps } from "@/lib/treasury/deps";
import { reportCopy } from "./copy";
import type { FactSheet, ReportData } from "./donor-report";

export type ParagraphResult = {
  text: string;
  source: "entity" | "template";
  /** what the gate said, as `drafts.ts` spells it */
  guard: "pass" | "held" | "dropped";
  reason?: "held" | "tunnel_error" | "http_error" | "empty" | "paused" | "over_budget";
};

export const PARAGRAPH_TIMEOUT_MS = 45_000;

function templateResult(data: ReportData, guard: ParagraphResult["guard"], reason: ParagraphResult["reason"]): ParagraphResult {
  return { text: reportCopy.templateParagraph(data), source: "template", guard, reason };
}

function extractText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown };
  const content = first?.message?.content ?? first?.text;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function guardStatus(headers: Headers, body: unknown): string | null {
  const fromBody = typeof body === "object" && body !== null ? (body as { kami_guard?: { status?: unknown } }).kami_guard?.status : undefined;
  if (typeof fromBody === "string") return fromBody.toLowerCase();
  const h = headers.get("x-guard");
  return h ? h.toLowerCase() : null;
}

export type AskInput = { slug: string; name: string; month: string; factSheet: FactSheet; data: ReportData };

export async function askEntityForParagraph(deps: TreasuryDeps, input: AskInput, baseUrl: string = appEnv.HERMES_GATEWAY_URL): Promise<ParagraphResult> {
  const monthLabel = input.data.month_label;

  if (baseUrl.startsWith("fake:")) {
    const mode = baseUrl.slice("fake:".length);
    if (mode === "held") return templateResult(input.data, "held", "held");
    if (mode === "asleep") return templateResult(input.data, "held", "tunnel_error");
    return {
      text: `In ${monthLabel} I received $${input.data.inflow_totals.gross_usd} and paid out $${input.data.payout_total_usd} USDC. Every payment was signed by two guardians.`,
      source: "entity",
      guard: "pass",
    };
  }

  const url = `${baseUrl.replace(/\/$/, "")}/p/${encodeURIComponent(input.slug)}/v1/chat/completions`;
  const messages = [
    { role: "system", content: `You are an AI voice for ${input.name}. You are writing the monthly note to donors. Cite only numbers you were given this turn.` },
    { role: "user", content: reportCopy.prompt(input.name, monthLabel) },
    // after the last user message, which is where the guard builds its sheet
    { role: "tool", tool_call_id: "donor_report_facts", content: JSON.stringify(input.factSheet) },
  ];

  let res: Response;
  try {
    res = await deps.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-kami-job": "cron",
        authorization: `Bearer ${appEnv.HERMES_API_SERVER_KEY ?? ""}`,
      },
      body: JSON.stringify({ model: input.slug, messages, stream: false }),
      signal: AbortSignal.timeout(PARAGRAPH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    deps.log(`gate unreachable for ${input.slug} report paragraph: ${(err as Error).message.slice(0, 140)} — using the template`);
    return templateResult(input.data, "held", "tunnel_error");
  }

  if (res.status === 423) return templateResult(input.data, "held", "paused");
  if (res.status === 429) return templateResult(input.data, "held", "over_budget");

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    deps.log(`gate returned ${res.status} for ${input.slug} report paragraph — using the template`);
    return templateResult(input.data, "held", "http_error");
  }

  const status = guardStatus(res.headers, body);
  if (status === "held") {
    deps.log(`guard held the ${input.slug} ${input.month} paragraph — using the template`);
    return templateResult(input.data, "held", "held");
  }

  const text = extractText(body);
  if (!text) return templateResult(input.data, "held", "empty");
  return { text, source: "entity", guard: status === "dropped" ? "dropped" : "pass" };
}
