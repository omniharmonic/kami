import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ogCardModel, titleFromSlug } from "../og";
import { readFallbackSvg } from "../fallback-file";
import { parseStatus } from "@/lib/status";
import fixtureJson from "@/fixtures/status/boulder-creek.json";
import { GET } from "@/app/api/og/[slug]/route";

const status = parseStatus(JSON.stringify(fixtureJson))!;

describe("ogCardModel", () => {
  it("composes name, mood word, mood_reason, headline and the disclosure line", () => {
    const card = ogCardModel(status, "boulder-creek");
    expect(card).toMatchObject({
      name: "Boulder Creek",
      archetype: "creek",
      mood: "asleep",
      moodWord: "asleep",
      reason: "I can't feel my gauge",
      headline: "Flow: 15.4 cfs at Orodell, 2026-09-04 20:15Z, stale",
    });
    expect(card.disclosure).toBe("I'm an AI voice for Boulder Creek, built on public sensor data — not the creek, not a legal person.");
  });
  it("falls back to a title from the slug and the asleep pose without a status", () => {
    expect(titleFromSlug("south-boulder-creek")).toBe("South Boulder Creek");
    expect(ogCardModel(null, "x-y")).toMatchObject({ name: "X Y", mood: "asleep", archetype: "creek" });
  });
});

describe("readFallbackSvg", () => {
  it("reads from public/ on disk", async () => {
    const svg = await readFallbackSvg("creek", "asleep");
    expect(svg).toContain("<title");
    expect(svg).toContain('viewBox="0 0 240 240"');
  });
  it("returns null when nothing is on disk and no origin is given", async () => {
    expect(await readFallbackSvg("creek", "asleep", { publicDir: "/nonexistent" })).toBeNull();
  });
});

describe("GET /api/og/[slug]", () => {
  it("renders a PNG for the fixture entity", async () => {
    const req = new NextRequest("http://localhost:3000/api/og/boulder-creek");
    const res = await GET(req, { params: Promise.resolve({ slug: "boulder-creek" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(5000);
    // PNG magic
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 60_000);

  it("404s for an unknown or invalid slug", async () => {
    const bad = await GET(new NextRequest("http://localhost:3000/api/og/nope"), { params: Promise.resolve({ slug: "nope-no-such-kami" }) });
    expect(bad.status).toBe(404);
    const invalid = await GET(new NextRequest("http://localhost:3000/api/og/x"), { params: Promise.resolve({ slug: "Bad Slug!" }) });
    expect(invalid.status).toBe(404);
  });
});
