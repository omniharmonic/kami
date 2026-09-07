import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { cronAddCommand, cronCommands, EXPECTED_JOBS, parseCronSpec, shellQuote } from "../src/lib/cron.js";
import { CRON_YAML_PATH } from "../src/lib/paths.js";

const spec = parseCronSpec(fs.readFileSync(CRON_YAML_PATH, "utf8"));
const opts = { slug: "boulder-creek", remoteProfileDir: "/opt/data/profiles/boulder-creek", hermesCmd: "hermes", paused: false };

describe("cron.yaml", () => {
  it("carries the five §5.2 jobs with the §5.2 schedules", () => {
    expect(spec.jobs.map((j) => j.name)).toEqual(EXPECTED_JOBS);
    const by = Object.fromEntries(spec.jobs.map((j) => [j.name, j]));
    expect(by.pulse!.schedule).toBe("0 * * * *");
    expect(by.pulse!.pre_script).toBe("skills/entity-steward/scripts/pulse_precheck.py");
    expect(by["daily-reflection"]!.schedule).toBe("30 6 * * *");
    expect(by["daily-reflection"]!.continuity).toBe(true);
    expect(by["weekly-bounties"]!.schedule).toBe("0 9 * * 1");
    expect(by["weekly-bounties"]!.skill).toBe("entity-steward");
    expect(by["weekly-bounties"]!.continuity).toBe(true);
    expect(by["quarterly-strategy"]!.schedule).toBe("0 9 1 1,4,7,10 *");
    expect(by["quarterly-strategy"]!.context_from).toEqual(["weekly-bounties"]);
    expect(by["quarterly-strategy"]!.reasoning_effort).toBe("high");
    expect(by["donor-report"]!.schedule).toBe("0 9 1 * *");
    expect(spec.timezone).toBe("America/Denver");
  });

  it("pulse prompt caps the utterance at 80 words and uses the scoped platform snapshot and public member IDs", () => {
    const p = spec.jobs[0]!.prompt;
    expect(p).toContain("80 words");
    expect(p).toContain("get_needs_snapshot");
    expect(p).toContain("get_place");
    expect(spec.jobs.map(j => j.prompt).join(" ")).not.toMatch(/get_entity_status|get_alerts/);
    expect(p).toContain("post_update");
  });

  it("refuses required semantics unsupported by installed Hermes", () => {
    expect(() => cronCommands(spec, opts)).toThrow(/compatibility/);
    expect(cronCommands(spec, { ...opts, paused: true })).toEqual([]);
    expect(() => cronAddCommand(spec.jobs[0]!, spec, { ...opts, paused: true })).toThrow(/paused entity/);
  });

  it("renders supported jobs with positional schedule and no fictional flags", () => {
    const simple = { name: "check", schedule: "0 * * * *", prompt: "Check the stream", skill: "entity-steward" };
    const cmd = cronAddCommand(simple, { ...spec, timezone: "", jobs: [simple] }, opts);
    expect(cmd).toBe("hermes --profile 'boulder-creek' cron create '0 * * * *' 'Check the stream' --name 'check' --skill 'entity-steward'");
  });

  it("shell-quotes prompts safely", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    const cmd = cronAddCommand({ name: "x", schedule: "* * * * *", prompt: "say 'hi'; rm -rf /" }, { ...spec, timezone: "" }, opts);
    expect(cmd).toContain(shellQuote("say 'hi'; rm -rf /"));
  });

  it("rejects a spec missing a job or with a bad schedule", () => {
    expect(() => parseCronSpec("version: 1\ntimezone: UTC\njobs:\n  - {name: pulse, schedule: '0 * * * *', prompt: p}\n")).toThrow(/lacks job/);
    const bad = fs.readFileSync(CRON_YAML_PATH, "utf8").replace('"0 * * * *"', '"hourly"');
    expect(() => parseCronSpec(bad)).toThrow(/5-field/);
  });
});
