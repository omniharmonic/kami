/** Read-only production proof. Never calls platform MCP mutation tools. */
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const slug = process.env.AUDIT_EXPECTED_SLUG;
const token = process.env.PLATFORM_MCP_TOKEN;
const base = new URL(process.env.PLATFORM_URL ?? "https://beings.earth");
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("Set AUDIT_EXPECTED_SLUG to the exact intended entity slug.");
if (!token) throw new Error("PLATFORM_MCP_TOKEN is required; supply it through the environment, never an argument.");
if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("HTTPS is required for remote audit targets.");
const expectedId = `entity/${slug}`;
const checks: Array<{ check: string; verdict: "pass" | "fail" | "blocked"; evidence: unknown }> = [];
let id = 0;
function record(check: string, pass: boolean, evidence: unknown) { checks.push({ check, verdict: pass ? "pass" : "fail", evidence }); }
async function request(path: string, body?: unknown, authenticated = true) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(45_000),
    headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2024-11-05" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { throw new Error(`Non-JSON response (${response.status}) at ${path}; response body withheld.`); }
  return { status: response.status, data };
}
async function rpc(method: string, params: unknown) {
  const reply = await request("/api/mcp", { jsonrpc: "2.0", id: ++id, method, params });
  if (reply.status !== 200 || reply.data.error) throw new Error(`MCP ${method} failed (${reply.status}); details withheld.`);
  return reply.data.result;
}
async function call(name: string, args: unknown = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  const value = result.structuredContent ?? JSON.parse(result.content.find((item: any) => item.type === "text").text);
  if (value.entity_id !== expectedId) throw new Error("Entity scope mismatch; refusing further audit calls.");
  record(`${name}: disclosure`, typeof value.disclosure === "string" && value.disclosure.includes("AI voice for"), { present: Boolean(value.disclosure) });
  return { value, isError: result.isError === true };
}

async function main() {
  const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "beings-production-audit", version: "1.0.0" } });
  record("MCP initialize", Boolean(init.serverInfo), { server: init.serverInfo?.name, protocol: init.protocolVersion });
  const tools = (await rpc("tools/list", {})).tools;
  const expected = ["get_needs_snapshot", "get_entity_config", "list_open_bounties", "draft_bounty", "list_submissions", "read_evidence_summary", "post_update", "get_strategy", "get_attestation_summary"];
  record("Nine platform tools registered", expected.every(name => tools.some((tool: any) => tool.name === name)), { names: tools.map((tool: any) => tool.name) });
  const config = (await call("get_entity_config")).value.config;
  if (config.entity.slug !== slug) throw new Error("Configuration slug mismatch.");
  record("Reviewed binding available", config.binding_active === true && config.binding_review === "approved", { version: config.binding_version, members: config.members, need_mappings: config.need_mappings?.length, paused: config.paused, guardians: config.guardians?.length, evaluators: config.evaluators });
  const needs = (await call("get_needs_snapshot")).value;
  const required = ["value", "unit", "time", "source_id", "stale", "staleness_s", "source_status"];
  record("Snapshot provenance", Boolean(needs.snapshot) && needs.snapshot.needs.every((need: any) => required.every(key => key in need)), { snapshot_id: needs.snapshot_id, snapshot_hash: needs.snapshot_hash, as_of: needs.as_of, mood: needs.snapshot?.mood, stale_driving: needs.snapshot?.stale_driving, gpu_online: needs.snapshot?.gpu_online, needs: needs.snapshot?.needs.map((need: any) => ({ need: need.need, stale: need.stale, source_status: need.source_status, time: need.time })) });
  for (const name of ["get_strategy", "list_open_bounties", "list_submissions", "get_attestation_summary"]) {
    const result = await call(name);
    const value = result.value;
    record(name, !result.isError, name === "get_strategy" ? { ratified: Boolean(value.strategy), draft: Boolean(value.latest_draft) } : name === "get_attestation_summary" ? { total: value.total } : { count: (value.bounties ?? value.submissions)?.length });
  }
  const missing = `audit-nonexistent-${randomUUID()}`;
  const evidence = await call("read_evidence_summary", { submission_id: missing });
  record("Missing evidence is refused", evidence.isError && evidence.value.error === "not_found", { error: evidence.value.error });
  for (const name of ["post_update", "draft_bounty"]) checks.push({ check: name, verdict: "blocked", evidence: "Mutation deliberately not invoked. Inspect and test the deployed pause guard before a separately authorized write proof; this audit remains read-only." });
  for (const route of ["balance", "pending"]) {
    const result = await request(`/api/treasury/${slug}/${route}`);
    record(`Treasury ${route}`, result.status === 200 && result.data.entity === slug, route === "balance" ? { http: result.status, balance_usdc: result.data.balance_usdc, reason: result.data.reason } : { http: result.status, count: result.data.count });
  }
  const state = await request(`/api/entities/${slug}/state`);
  record("Treasury pause preflight", state.status === 200 && (state.data.paused === true || state.data.state === "paused") === config.paused, { http: state.status, paused: state.data.paused ?? state.data.state === "paused" });
  // This request cannot create a proposal: a random absent submission ID is used,
  // and source inspection confirms pause is checked before submission lookup/signing.
  if (config.paused && state.status === 200 && (state.data.paused || state.data.state === "paused")) {
    const refusal = await request("/api/treasury/propose", { entity: slug, submission_id: missing });
    record("Treasury refuses paused proposal", refusal.status >= 400 && refusal.data.reason === "entity_paused", { http: refusal.status, reason: refusal.data.reason });
  } else checks.push({ check: "Treasury proposal refusal", verdict: "blocked", evidence: "Entity is not confirmed paused; no proposal request sent." });
  const anonymous = await request("/api/mcp", { jsonrpc: "2.0", id: ++id, method: "tools/list", params: {} }, false);
  record("Anonymous token refusal", anonymous.status === 401, { http: anonymous.status });
  const wrongScope = await request(`/api/treasury/audit-other-${randomUUID()}/balance`);
  record("Cross-entity treasury refusal", wrongScope.status === 403 || wrongScope.status === 401, { http: wrongScope.status });
}
try { await main(); } catch (error) { record("Audit execution", false, error instanceof Error ? error.message.replaceAll(token, "[redacted]") : "Unknown error"); }
const report = { generated_at: new Date().toISOString(), origin: base.origin, entity: expectedId, mode: "read-only plus guaranteed-invalid treasury refusal", checks, evidence_sha256: createHash("sha256").update(JSON.stringify(checks)).digest("hex") };
const output = JSON.stringify(report, null, 2);
if (process.env.AUDIT_OUTPUT) await writeFile(process.env.AUDIT_OUTPUT, output + "\n", { mode: 0o600 });
console.log(output);
if (checks.some(check => check.verdict === "fail")) process.exitCode = 1;
