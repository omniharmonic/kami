import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  visible: vi.fn(), db: vi.fn(), twin: vi.fn(), page: vi.fn(), record: vi.fn(),
  parse: vi.fn(), query: vi.fn(),
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/entity-access", () => ({ requireVisibleEntity: mocks.visible }));
vi.mock("@/db/client", () => ({ withDb: mocks.db }));
vi.mock("@/lib/summon/twin", () => ({ twinFor: mocks.twin }));
vi.mock("@kami/binding", () => ({ BindingSchema: { safeParse: mocks.parse } }));
import { getVisibleWorldLocation } from "../world-location";

describe("world locations respect visibility and ecological privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.visible.mockResolvedValue({ entity: { id: "entity/creek", archetype: "creek" } });
    mocks.parse.mockReturnValue({ success: true, data: { anchor: "place/creek" } });
    const chain: Record<string, unknown> = {};
    for (const key of ["select", "from", "innerJoin", "where"]) chain[key] = vi.fn(() => chain);
    chain.limit = mocks.query.mockResolvedValue([{ binding: {} }]);
    mocks.db.mockImplementation((fn: (db: unknown) => unknown) => fn(chain));
    mocks.page.mockResolvedValue({ data: { centroid: [-105.3, 40.0] } });
    mocks.record.mockResolvedValue({ data: { sensitivity: "public" } });
    mocks.twin.mockResolvedValue({ placePage: mocks.page, idRecord: mocks.record });
  });
  it("refuses unauthorized private beings before reading any binding or location", async () => {
    mocks.visible.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(getVisibleWorldLocation("private-creek")).rejects.toThrow("NOT_FOUND");
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.twin).not.toHaveBeenCalled();
  });
  it.each(["species", "animal", "elk", "bird"])("never looks up wildlife archetype %s", async (archetype) => {
    mocks.visible.mockResolvedValue({ entity: { id: "entity/wildlife", archetype } });
    expect(await getVisibleWorldLocation("wildlife")).toBeNull();
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.twin).not.toHaveBeenCalled();
  });
  it("uses the approved anchor's published centroid without substituting other positions", async () => {
    expect(await getVisibleWorldLocation("creek")).toEqual({ longitude: -105.3, latitude: 40 });
    expect(mocks.page).toHaveBeenCalledWith("place/creek");
  });
  it.each([[181, 40], [-105, 91], [Number.NaN, 40], null].map(centroid => ({ centroid })))("does not invent coordinates from invalid centroid $centroid", async ({ centroid }) => {
    mocks.page.mockResolvedValue({ data: { centroid } });
    expect(await getVisibleWorldLocation("creek")).toBeNull();
  });
  it("has no location when the binding cannot be validated", async () => {
    mocks.parse.mockReturnValue({ success: false });
    expect(await getVisibleWorldLocation("creek")).toBeNull();
    expect(mocks.twin).not.toHaveBeenCalled();
  });
});
