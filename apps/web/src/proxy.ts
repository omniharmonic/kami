/**
 * Next 16 proxy (the renamed middleware; Node runtime). One job: keep the
 * architected URL `POST /e/[slug]/chat` while the page and the route handler
 * cannot share a segment — POSTs are rewritten to `/api/e/[slug]/chat`.
 * *verify*: `proxy.ts` is the Next 16 convention (`PROXY_FILENAME = 'proxy'`
 * in next/dist/lib/constants); `middleware.ts` still works with a warning.
 */
import { NextResponse, type NextRequest } from "next/server";

const CHAT = /^\/e\/([a-z0-9-]{1,64})\/chat\/?$/;

export default function proxy(req: NextRequest) {
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

export const config = { matcher: ["/e/:slug/chat"] };
