/**
 * GET /api/og/<slug> — the 1200×630 Open Graph card (architecture §9.4: the
 * SVG fallback is also the OG image). Composes the archetype × mood SVG with
 * the entity name, the mood word + mood_reason, the headline label and the
 * disclosure line (ADR-E13: rendered by layout, never by prompt).
 *
 * Node runtime; reads the status file through `loadStatus` (never throws).
 */
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { readFallbackSvg } from "@/lib/avatar/fallback-file";
import { ogCardModel } from "@/lib/avatar/og";
import { resolveCssVars, svgToDataUri } from "@/lib/avatar/svg";
import { loadStatus, slugIsValid } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BG = "#f7f2ea";
const INK = "#26221d";
const SOFT = "#5d554b";
const FAINT = "#8a8176";
const LINE = "#ddd3c4";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugIsValid(slug)) return new Response("not found", { status: 404 });
  const status = await loadStatus(slug);
  if (!status) return new Response("not found", { status: 404 });

  const card = ogCardModel(status, slug);
  const svg = await readFallbackSvg(card.archetype, card.mood, { origin: req.nextUrl?.origin ?? null });
  const avatar = svg ? svgToDataUri(resolveCssVars(svg)) : null;

  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: BG, color: INK, padding: "56px 64px", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 420, height: 518 }}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} width={400} height={400} alt="" />
        ) : (
          <div style={{ width: 400, height: 400, borderRadius: 200, background: LINE }} />
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", marginLeft: 48, flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 22, letterSpacing: 2, textTransform: "uppercase", color: FAINT }}>Kami · an AI voice for a place</div>
        <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05, marginTop: 10 }}>{card.name}</div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 22, fontSize: 32 }}>
          <div style={{ display: "flex", padding: "4px 18px", borderRadius: 999, border: `2px solid ${card.mood === "asleep" ? "#9a958e" : LINE}`, background: card.mood === "asleep" ? "#e3dfd9" : "#fffdf9", fontSize: 26, marginRight: 16 }}>
            {card.moodWord}
          </div>
          <div style={{ color: SOFT }}>{card.reason}</div>
        </div>
        {card.headline ? <div style={{ fontSize: 26, color: SOFT, marginTop: 14, lineHeight: 1.3 }}>{card.headline}</div> : null}
        <div style={{ height: 2, background: LINE, marginTop: 28, marginBottom: 20, width: 120 }} />
        <div style={{ fontSize: 22, color: FAINT, lineHeight: 1.35 }}>{card.disclosure}</div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
    },
  );
}
