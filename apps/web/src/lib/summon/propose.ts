/**
 * Step 1's server half: from "this place" to a reviewable proposal.
 *
 *   picked id → membership query + GNIS id (the twin's own props, when it has
 *   them) → `proposeBinding` (@kami/binding) → `validateBindingForTwin`
 *   (rules 1–6 against *this* entity's twin) → what it could sense today →
 *   siblings already bound to the same anchor.
 *
 * The output is the platform's guess and says so: `provenance` is recorded
 * with the binding and the row is written `pending_review`. A steward
 * approves before anything goes live (architecture §3).
 */
import { PROVENANCE, proposeBinding, bindingSha256, slugify, type Archetype, type Binding } from "@kami/binding";
import { TwinUnreachable, type TwinClient } from "@kami/twin-client";
import type { DbOrTx } from "@/db/events";
import { describeSensing } from "./sensing";
import { siblingsForAnchor, type SiblingEntity } from "./siblings";
import { TwinSearchUnavailable } from "./places";
import { idsSchemaFor, validateBindingForTwin } from "./twin";
import type { PlaceChoice } from "./draft";

const CUT_AT = /\s+(near|at|below|above|blw|abv|bl|ab|nr)\s+/i;
const STREAM_WORD = /(creek|river|ditch|reservoir|lake|gulch|brook|run|fork|wash|arroyo)/i;

/** Title case that leaves already-mixed-case words alone ("BOULDER CREEK" → "Boulder Creek"). */
export function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (/[a-z]/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * The membership query a picked place implies. A gauge's own name carries the
 * stream ("BOULDER CREEK NEAR ORODELL, CO." → "Boulder Creek"); a watershed's
 * name carries it with a position word attached ("Headwaters Boulder Creek").
 * The creator sees the result and can edit it: this is a guess, like the rest.
 */
export function deriveQuery(name: string): string {
  let s = name.trim().replace(/\s+/g, " ");
  s = s.split(",")[0]!;
  const cut = CUT_AT.exec(s);
  if (cut) s = s.slice(0, cut.index);
  if (s.includes("-")) {
    const parts = s.split("-").map((p) => p.trim());
    const stream = parts.find((p) => STREAM_WORD.test(p));
    if (stream) s = stream;
  }
  s = s.replace(/^(headwaters|outlet)\s+/i, "");
  return titleCase(s);
}

export type PlaceContext = {
  id: string;
  name: string;
  kind: string;
  /** the twin's own stream name for a gauge, when published */
  water_source: string | null;
  gnis_id: string | null;
  query: string;
  archetype: Archetype;
};

const ARCHETYPE_BY_KIND: Record<string, Archetype> = {
  watershed: "watershed",
  reservoir: "reservoir",
  lake: "reservoir",
  waterbody: "reservoir",
  peak: "mountain",
  ridge: "mountain",
  bioregion: "bioregion",
  stream_reach: "creek",
  monitoring_site: "creek",
};

/** Read the picked place's page for the props that make a better guess. */
export async function placeContext(tree: TwinClient, placeId: string): Promise<PlaceContext> {
  let page = null;
  try {
    page = await tree.placePage(placeId);
  } catch (err) {
    if (!(err instanceof TwinUnreachable)) throw err;
  }
  const index = await tree.index().catch(() => null);
  const entry = index?.data.places.find((p) => p.id === placeId);
  const name = (page?.data.name ?? entry?.name ?? placeId).trim();
  const kind = page?.data.kind ?? entry?.kind ?? "other";
  const props = (page?.data.props ?? {}) as Record<string, unknown>;
  const water_source = typeof props["cdwr_water_source"] === "string" ? titleCase(props["cdwr_water_source"] as string) : null;
  const gnis_id = typeof props["cdwr_stream_gnis_id"] === "string" ? (props["cdwr_stream_gnis_id"] as string) : null;
  return {
    id: placeId,
    name,
    kind,
    water_source,
    gnis_id,
    query: water_source ?? deriveQuery(name),
    archetype: ARCHETYPE_BY_KIND[kind] ?? "creek",
  };
}

export type ProposeInput = {
  place_id: string;
  /** overrides the derived membership query */
  query?: string | undefined;
  gnis_id?: string | null | undefined;
  archetype?: string | undefined;
  /** the kami's display name; defaults to the derived query */
  name?: string | undefined;
  slug?: string | undefined;
  now?: Date | undefined;
};

export type Proposal = { place: PlaceChoice; siblings: SiblingEntity[]; context: PlaceContext };

export class ProposalFailed extends Error {
  override name = "ProposalFailed";
  constructor(
    public readonly code: "twin_unreachable" | "no_members" | "binding_invalid",
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
  }
}

/** Everything step 1 stores in the draft, computed from the twin the entity will read. */
export async function proposeForPlace(tree: TwinClient, input: ProposeInput, opts: { db?: DbOrTx | null; slugTaken?: (slug: string) => Promise<boolean> } = {}): Promise<Proposal> {
  const context = await placeContext(tree, input.place_id);
  const query = (input.query ?? context.query).trim();
  const gnisId = input.gnis_id === undefined ? context.gnis_id : input.gnis_id;
  const archetype = (input.archetype ?? context.archetype) as Archetype;
  const name = (input.name ?? query).trim() || query;
  const slug = (input.slug ?? slugify(name)).trim();

  let proposal;
  try {
    proposal = await proposeBinding({
      query,
      tree,
      archetype,
      slug,
      ...(gnisId ? { gnisId } : {}),
      ...(input.now ? { now: input.now } : {}),
    });
  } catch (err) {
    if (err instanceof TwinUnreachable || err instanceof TwinSearchUnavailable) {
      throw new ProposalFailed("twin_unreachable", "the twin is not answering, so no binding can be proposed");
    }
    throw new ProposalFailed("no_members", (err as Error).message);
  }

  // The picked place must actually be in its own binding; if the membership
  // rule missed it, say so rather than quietly binding something else.
  const binding: Binding = proposal.binding;
  const notes = [...proposal.notes];
  if (context.kind === "monitoring_site" && !binding.members.some((m) => m.id === context.id)) {
    notes.push(`${context.name} is not in the proposed membership — it publishes no reading today, or the membership rule missed it. A steward can add it.`);
  }
  if (binding.anchor !== context.id && context.kind === "monitoring_site") {
    notes.push(`the anchor is ${binding.anchor}, the main-stem gauge with the longest record, not the place you picked`);
  }

  const validation = await validateBindingForTwin(binding, tree);
  const sensing = await describeSensing(binding, tree);
  const idsSchema = await idsSchemaFor(tree);
  const siblings = await siblingsForAnchor(binding.anchor, null, opts.db ?? undefined);

  const place: PlaceChoice = {
    picked_id: context.id,
    picked_name: context.name,
    picked_kind: context.kind,
    query,
    gnis_id: gnisId ?? null,
    archetype,
    name,
    slug,
    binding,
    binding_sha256: bindingSha256(binding),
    provenance: PROVENANCE,
    notes,
    stats: proposal.stats as unknown as Record<string, number>,
    sensing: sensing.rows,
    gaps: sensing.gaps,
    twin_base_url: tree.localDir ?? tree.baseUrl,
    ids_schema_from: idsSchema.from,
    validation: {
      ok: validation.ok,
      errors: validation.errors.map((e) => ({ path: e.path, message: e.message })),
      warnings: validation.warnings.map((e) => ({ path: e.path, message: e.message })),
    },
    siblings_seen: siblings.length,
  };
  return { place, siblings, context };
}
