import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connect as copy, errors } from "@/copy";
import { getDb } from "@/db/client";
import { entityBySlug, slugOk } from "@/lib/jobs/common";
import { connectAccess, type ConnectAccess } from "@/lib/connect/access";
import { buildConnectBundle, bundleFilename, type ConnectBundle } from "@/lib/connect/bundle";
import { AUTH_HEADER_TEMPLATE, mcpEndpoint, platformOrigin, SLUG_ENV_VAR, TOKEN_ENV_VAR } from "@/lib/connect/endpoint";
import { hermesProfile, type HermesProfile } from "@/lib/connect/hermes";
import { connectStatus } from "@/lib/connect/status";
import { tokenState } from "@/lib/connect/token";
import { toolCatalog, type ToolCatalog } from "@/lib/connect/tools";
import { getSoul } from "@/lib/entities";
import { loadHardRules } from "@/lib/summon/soul";
import { getSession } from "@/lib/session";
import { ConnectTabs } from "@/components/connect/ConnectTabs";
import { Copyable } from "@/components/connect/Copyable";
import { FileList } from "@/components/connect/FileList";
import { StatusPanel } from "@/components/connect/StatusPanel";
import { ToolTable } from "@/components/connect/ToolTable";
import { TokenPanel } from "@/components/connect/TokenPanel";
import { mintConnectTokenAction } from "./actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const db = getDb();
  const entity = db && slugOk(slug) ? await entityBySlug(db, slug) : null;
  return { title: entity ? copy.title(entity.name) : errors.notFound, robots: { index: false } };
}

function roleLine(access: ConnectAccess): string | null {
  if (access.role === "admin") return copy.roleAdmin;
  if (access.role === "steward") return copy.roleSteward;
  if (access.role === "creator") return copy.roleCreator;
  if (access.role === "guardian") return copy.roleGuardian;
  return null;
}

/** Tab one: what any MCP client needs — the config stanza and the bundle. */
function GenericPanel({ bundle, slug }: { bundle: ConnectBundle | null; slug: string }) {
  const mcpJson = bundle?.files.find((f) => f.path === "mcp.json") ?? null;
  return (
    <div className="stack" data-testid="panel-generic">
      <div className="sunken">
        <h4 style={{ marginTop: 0 }}>{copy.claude.heading}</h4>
        <p className="muted">{copy.claude.what}</p>
        <Copyable label="Terminal" value={copy.claude.command} block />
        <p className="muted">{copy.claude.verify}</p>
      </div>
      {mcpJson ? (
        <Copyable label="mcp.json" value={mcpJson.content} block hint={copy.bundle.noToken} testId="mcp-json" />
      ) : (
        <p className="sunken">{copy.bundle.unavailable}</p>
      )}
      <p>
        <a className="btn" href={`/api/entities/${slug}/connect/bundle`} data-testid="bundle-download-top">
          {copy.bundle.download}
        </a>
      </p>
    </div>
  );
}

/** Tab two: the same thing, as this project's own box runs it. */
function HermesPanel({ profile, slug }: { profile: HermesProfile | null; slug: string }) {
  if (!profile) return <p className="sunken">{copy.bundle.unavailable}</p>;
  return (
    <div className="stack" data-testid="panel-hermes">
      <p className="muted">{copy.hermes.what}</p>

      <h4 style={{ marginBottom: 0 }}>{copy.hermes.configHeading}</h4>
      <p className="muted" style={{ marginTop: "0.2rem" }}>{copy.hermes.configWhat}</p>
      <Copyable label="config.yaml" value={profile.config_yaml} block testId="config-yaml" />

      <h4 style={{ marginBottom: 0 }}>{copy.hermes.envHeading}</h4>
      <p className="muted" style={{ marginTop: "0.2rem" }}>{copy.hermes.envWhat}</p>
      <Copyable label=".env" value={profile.env_example} block testId="hermes-env" />

      <h4 style={{ marginBottom: 0 }}>{copy.hermes.cronHeading}</h4>
      <p className="muted" style={{ marginTop: "0.2rem" }}>{copy.hermes.cronWhat}</p>
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }} data-testid="cron-jobs">
        {profile.jobs.map((job) => (
          <li key={job.name} className="sunken" data-cron={job.name}>
            <code style={{ fontWeight: 600 }}>{job.name}</code>{" "}
            <span className="chip" style={{ fontSize: "0.78rem" }}>{job.schedule}</span>{" "}
            <span className="faint" style={{ fontSize: "0.8rem" }}>{profile.timezone}</span>
          </li>
        ))}
      </ul>

      <details className="sunken">
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>{copy.hermes.commandsHeading}</summary>
      <p className="muted" style={{ marginTop: "0.2rem" }}>{copy.hermes.commandsWhat}</p>
      <Copyable label="shell" value={copy.hermes.commands(slug).join("\n")} block testId="hermes-commands" />
      <p className="sunken">{copy.hermes.unverified}</p>
      <p className="faint" style={{ fontSize: "0.85rem" }}>{copy.hermes.provisionNote}</p>
      </details>
    </div>
  );
}

/**
 * `/e/[slug]/connect` — the on-ramp (PRD §4.5, §5 J1; architecture §6.2).
 *
 * Four questions in the order someone actually has them: what do I point my
 * agent at, what can it do once connected, what is this kami's brain supposed
 * to be, and is it working. The role gate is a redirect rather than a 403:
 * someone without a role on this kami wanted the public page, and that is what
 * they get.
 */
export default async function ConnectPage({ params }: Props) {
  const { slug } = await params;
  if (!slugOk(slug)) notFound();

  const db = getDb();
  if (!db) {
    return (
      <div className="stack">
        <h2>{copy.link}</h2>
        <p className="sunken">{copy.noDb}</p>
      </div>
    );
  }

  const entity = await entityBySlug(db, slug);
  if (!entity) notFound();

  const session = await getSession();
  const access = await connectAccess({ id: entity.id, created_by: entity.createdBy }, session?.user ?? null);
  if (!access.may_view) redirect(`/e/${slug}`);

  const hdrs = await headers();
  const origin = platformOrigin({ proto: hdrs.get("x-forwarded-proto"), host: hdrs.get("host") });
  const endpoint = mcpEndpoint(origin);
  const paused = entity.pausedAt !== null;

  const [token, catalog, soul, hardRules, status] = await Promise.all([
    tokenState(db, slug),
    toolCatalog().catch((): ToolCatalog => ({ platform: [], twin: [] })),
    getSoul(entity.id),
    loadHardRules().catch(() => null),
    connectStatus(db, { id: entity.id, slug: entity.slug, paused_at: entity.pausedAt }),
  ]);
  // A kami with no binding or no soul row cannot have a bundle yet; the page
  // says so rather than throwing, because everything else on it is still true.
  const bundle = await buildConnectBundle(db, slug, { origin }).catch(() => null);
  const profile = await hermesProfile(db, { id: entity.id, slug: entity.slug, paused }, { platformUrl: origin }).catch(() => null);

  return (
    <div className="stack">
      <h2 style={{ margin: "1rem 0 0" }}>{copy.title(entity.name)}</h2>
      <p>{copy.intro}</p>
      <p className="muted">{copy.cannotSee}</p>
      {roleLine(access) ? <p className="faint" style={{ fontSize: "0.85rem" }} data-testid="role-line">{roleLine(access)}</p> : null}
      {paused ? <p className="notice" role="status" data-testid="connect-paused">{copy.paused}</p> : null}

      {/* 1 — where to point it */}
      <section className="section" aria-labelledby="endpoint-h">
        <h3 id="endpoint-h">{copy.endpoint.heading}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{copy.endpoint.what}</p>
        <Copyable label={copy.endpoint.endpointLabel} value={endpoint} testId="mcp-endpoint" />
        <Copyable label={copy.endpoint.slugLabel} value={entity.slug} testId="entity-slug" />
        <Copyable label={copy.endpoint.headerLabel} value={`Authorization: ${AUTH_HEADER_TEMPLATE}`} testId="auth-header" />
        <p className="faint" style={{ fontSize: "0.85rem" }}>{copy.endpoint.transport}</p>
        <p className="faint" style={{ fontSize: "0.85rem" }}>{copy.endpoint.rate}</p>

        <TokenPanel
          token={token}
          mayMint={access.may_mint}
          slug={entity.slug}
          tokenVar={TOKEN_ENV_VAR}
          slugVar={SLUG_ENV_VAR}
          action={mintConnectTokenAction}
        />

        <ConnectTabs generic={<GenericPanel bundle={bundle} slug={slug} />} hermes={<HermesPanel profile={profile} slug={slug} />} />
      </section>

      {/* 2 — what it can do */}
      <section className="section" aria-labelledby="tools-h">
        <h3 id="tools-h">{copy.tools.heading}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{copy.tools.what}</p>
        <h4 style={{ marginBottom: 0 }}>{copy.tools.platformHeading}</h4>
        <p className="muted" style={{ marginTop: "0.2rem" }}>{copy.tools.platformWhat}</p>
        <ToolTable tools={catalog.platform} included={profile?.included.platform ?? null} testId="tools-platform" />
        <h4 style={{ marginBottom: 0 }}>{copy.tools.twinHeading(catalog.twin.length)}</h4>
        <p className="muted" style={{ marginTop: "0.2rem" }}>{copy.tools.twinWhat}</p>
        <ToolTable tools={catalog.twin} included={profile?.included.twin ?? null} testId="tools-twin" />
        {profile ? (
          <p className="faint" style={{ fontSize: "0.85rem" }}>
            {copy.tools.hermesIncluded(profile.included.platform.length + profile.included.twin.length, catalog.platform.length + catalog.twin.length)}
          </p>
        ) : null}
        <p className="sunken">{copy.tools.factRule}</p>
      </section>

      {/* 3 — what the brain is supposed to be */}
      <section className="section" aria-labelledby="soul-h">
        <h3 id="soul-h">{copy.soul.heading}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{copy.soul.what}</p>
        {hardRules ? (
          <>
            <h4 style={{ marginBottom: 0 }}>{copy.soul.hardRulesHeading(hardRules.version)}</h4>
            <p className="faint" style={{ marginTop: "0.2rem", fontSize: "0.85rem" }}>{copy.soul.hardRulesWhat}</p>
            <div className="sunken" role="region" aria-readonly="true" aria-label={copy.soul.hardRulesHeading(hardRules.version)} tabIndex={0} style={{ maxHeight: "22rem", overflow: "auto" }} data-testid="hard-rules">
              <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>{hardRules.block}</pre>
            </div>
          </>
        ) : null}
        {soul ? (
          <>
            <h4 style={{ marginBottom: 0 }}>{copy.soul.voiceHeading(soul.version)}</h4>
            <div className="sunken" data-testid="voice-block">
              <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: "0.85rem" }}>{soul.voice_md.trim()}</pre>
            </div>
          </>
        ) : (
          <p className="sunken" data-testid="no-soul">{copy.soul.voiceMissing}</p>
        )}
        <p className="faint" style={{ fontSize: "0.85rem" }}>{copy.soul.ifYouChange}</p>

        <h4 style={{ marginBottom: 0 }}>{copy.bundle.heading}</h4>
        <p className="muted" style={{ marginTop: "0.2rem" }}>{copy.bundle.what}</p>
        {bundle ? (
          <>
            <p className="eyebrow">{copy.bundle.contains}</p>
            <FileList files={bundle.files} />
            <p className="faint" style={{ fontSize: "0.85rem" }}>
              {copy.bundle.provenance(bundle.binding_version, bundle.binding_review, bundle.soul_version, bundle.hard_rules_version)}
            </p>
            {bundle.binding_review !== "approved" ? <p className="sunken">{copy.bundle.bindingPending}</p> : null}
            <p>
              <a className="btn btn-primary" href={`/api/entities/${slug}/connect/bundle`} data-testid="bundle-download">
                {copy.bundle.download}
              </a>{" "}
              <span className="faint" style={{ fontSize: "0.82rem" }}>{copy.bundle.downloadHint(bundleFilename(slug, new Date()))}</span>
            </p>
          </>
        ) : (
          <p className="sunken" data-testid="no-bundle">{copy.bundle.unavailable}</p>
        )}
      </section>

      {/* 4 — is it working */}
      <StatusPanel initial={status} endpoint={`/api/entities/${slug}/connect/status`} />

      <p className="faint" style={{ fontSize: "0.85rem" }}>
        <Link href={`/e/${slug}`}>{entity.name}</Link>
      </p>
    </div>
  );
}
