import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ get: vi.fn(), rows: [] as Array<{ id: string }> }));
vi.mock("@/db/client", () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => mock.rows }) }) }) }) }));
vi.mock("../blob", () => ({ BlobPublisher: class { get = mock.get; } }));
import { loadStatus } from "@/lib/status";
import fixture from "@/fixtures/status/boulder-creek.json";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); mock.rows = []; });
describe("private publication visibility", () => {
  it("never reads a private publication when DB finds no currently released entity", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-private-token");
    expect(await loadStatus("boulder-creek")).toBeNull();
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("reads a released publication only after the database gate", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-private-token");
    mock.rows = [{ id: "entity/boulder-creek" }];
    mock.get.mockResolvedValue({ body: JSON.stringify(fixture) });
    expect((await loadStatus("boulder-creek"))?.as_of).toBe(fixture.as_of);
    expect(mock.get).toHaveBeenCalledWith("entity/boulder-creek/status.json");
  });
});
