/**
 * Next 16 proxy (the renamed middleware; Node runtime). It keeps the two URLs
 * the architecture publishes as the contract, where the App Router's file
 * layout cannot serve them directly:
 *
 *   POST /e/[slug]/chat  →  /api/e/[slug]/chat   (a page and a route handler
 *                                                 cannot share a segment)
 *   /mcp                 →  /api/mcp             (§6.2 and the Hermes profile
 *                                                 template both name `/mcp`;
 *                                                 PLATFORM_URL is also the base
 *                                                 for `/api/entities/...`, so it
 *                                                 cannot absorb the prefix)
 *
 * *verify*: `proxy.ts` is the Next 16 convention (`PROXY_FILENAME = 'proxy'`
 * in next/dist/lib/constants); `middleware.ts` still works with a warning.
 */
import { NextResponse, type NextRequest } from "next/server";

const CHAT = /^\/e\/([a-z0-9-]{1,64})\/chat\/?$/;

export default function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/mcp" || req.nextUrl.pathname === "/mcp/") {
    const url = req.nextUrl.clone();
    url.pathname = "/api/mcp";
    return NextResponse.rewrite(url);
  }
  if (req.method === "POST") {
    const m = CHAT.exec(req.nextUrl.pathname);
    if (m) {
      const url = req.nextUrl.clone();
      url.pathname = `/api/e/${m[1]}/chat`;
      return NextResponse.rewrite(url);
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/e/:slug/chat", "/mcp"] };
