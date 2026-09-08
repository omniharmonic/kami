import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getEntityBySlug: vi.fn(), mayPreview: vi.fn() }));
vi.mock("@/lib/entities", () => ({ getEntityBySlug: mocks.getEntityBySlug, getConfigNumber: vi.fn() }));
vi.mock("@/lib/entity-access", () => ({ mayPreview: mocks.mayPreview }));
import { productionChatDeps } from "../chat-deps";

const entity = { id: "entity/creek", slug: "creek", name: "Creek", archetype: "creek", paused: false, retired: false, from_db: true, published_at: null };
beforeEach(() => { vi.clearAllMocks(); mocks.getEntityBySlug.mockResolvedValue(entity); mocks.mayPreview.mockResolvedValue(false); });

describe("public chat visibility", () => {
  it("does not expose an unpublished being to an anonymous visitor", async () => {
    expect(await productionChatDeps.getEntity("creek")).toBeNull();
    expect(mocks.mayPreview).toHaveBeenCalledWith(entity.id);
  });
  it("allows an authorized guardian to preview chat", async () => {
    mocks.mayPreview.mockResolvedValue(true);
    expect(await productionChatDeps.getEntity("creek")).toMatchObject({ id: entity.id });
  });
  it("allows published beings without a preview role", async () => {
    mocks.getEntityBySlug.mockResolvedValue({ ...entity, published_at: "2026-09-06" });
    expect(await productionChatDeps.getEntity("creek")).toMatchObject({ id: entity.id });
    expect(mocks.mayPreview).not.toHaveBeenCalled();
  });
  it("allows steward-published status files but not retired beings", async () => {
    mocks.getEntityBySlug.mockResolvedValue({ ...entity, from_db: false });
    expect(await productionChatDeps.getEntity("creek")).toMatchObject({ id: entity.id });
    mocks.getEntityBySlug.mockResolvedValue({ ...entity, retired: true, published_at: "2026-09-06" });
    expect(await productionChatDeps.getEntity("creek")).toBeNull();
  });
});
