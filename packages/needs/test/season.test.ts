import { describe, expect, it } from "vitest";
import { FREEZE_SNOWLINE_M, RUNOFF_SNOWLINE_M, season } from "../src/index.js";

const d = (iso: string) => new Date(iso);

describe("season by date", () => {
  it.each([
    ["2026-01-15", 0],
    ["2026-02-15", 0],
    ["2026-03-15", 0],
    ["2026-04-15", 1],
    ["2026-05-15", 1],
    ["2026-06-30", 1],
    ["2026-07-01", 2],
    ["2026-08-15", 2],
    ["2026-09-06", 2],
    ["2026-10-15", 3],
    ["2026-11-01", 0],
    ["2026-12-25", 0],
  ])("%s → %s", (date, s) => {
    expect(season(d(`${date}T12:00:00Z`), null)).toBe(s);
  });
});

describe("snowline nudges only the edges", () => {
  it("March with the snowline above the runoff line → runoff early", () => {
    expect(season(d("2026-03-20T12:00:00Z"), RUNOFF_SNOWLINE_M)).toBe(1);
    expect(season(d("2026-03-20T12:00:00Z"), RUNOFF_SNOWLINE_M - 1)).toBe(0);
  });
  it("April with snow still on the plains → freeze holds", () => {
    expect(season(d("2026-04-05T12:00:00Z"), FREEZE_SNOWLINE_M - 1)).toBe(0);
    expect(season(d("2026-04-05T12:00:00Z"), FREEZE_SNOWLINE_M)).toBe(1);
    expect(season(d("2026-04-05T12:00:00Z"), null)).toBe(1);
  });
  it("October with a low snowline → freeze early", () => {
    expect(season(d("2026-10-25T12:00:00Z"), 1800)).toBe(0);
    expect(season(d("2026-10-25T12:00:00Z"), 3200)).toBe(3);
    expect(season(d("2026-10-25T12:00:00Z"), null)).toBe(3);
  });
  it("snowline never moves the other months", () => {
    expect(season(d("2026-07-15T12:00:00Z"), 1000)).toBe(2);
    expect(season(d("2026-01-15T12:00:00Z"), 4000)).toBe(0);
    expect(season(d("2026-05-15T12:00:00Z"), 1000)).toBe(1);
  });
});
