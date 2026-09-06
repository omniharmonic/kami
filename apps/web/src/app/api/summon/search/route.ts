/**
 * `GET /api/summon/search?q=&kind=&huc=&cursor=` — step 1's place search.
 *
 * The browser never reads the twin: the debounced client calls this, and the
 * server reads `id/index.json` through the shared `TwinClient`, whose 60 s
 * per-path floor is a promise to the twin (ADR-E01). Signed-in only, and
 * rate-limited by the same limiter the chat uses, because it is a search over
 * someone else's published tree.
 */
import { z } from "zod";
import { json } from "@/lib/jobs/common";
import { AuthError, getSession } from "@/lib/session";
import { DEFAULT_LIMIT, MAX_LIMIT, searchPlaces, TwinSearchUnavailable } from "@/lib/summon/places";
import { twinFor } from "@/lib/summon/twin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(120).optional(),
  kind: z.string().max(60).optional(),
  huc: z.string().regex(/^\d{2,12}$/).optional(),
  cursor: z.string().max(12).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  /** the prospective slug, so a second-bioregion summon searches its own twin */
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
});

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) return json(401, { reason: "unauthenticated" });
  } catch (err) {
    if (err instanceof AuthError) return json(401, { reason: "unauthenticated" });
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return json(400, { reason: "bad_request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  const { q, kind, huc, cursor, limit, slug } = parsed.data;
  if (!q && !kind && !huc) return json(400, { reason: "bad_request", message: "a query, a kind or a HUC prefix is required" });

  try {
    const tree = await twinFor(slug ?? "new");
    const result = await searchPlaces(tree, {
      ...(q ? { query: q } : {}),
      ...(kind ? { kind } : {}),
      ...(huc ? { huc } : {}),
      ...(cursor ? { cursor } : {}),
      limit: limit ?? DEFAULT_LIMIT,
    });
    return json(200, result);
  } catch (err) {
    if (err instanceof TwinSearchUnavailable) return json(503, { reason: "twin_unreachable", path: err.path });
    console.warn("[summon/search]", (err as Error).message);
    return json(500, { reason: "search_failed" });
  }
}
