import { describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock("@vercel/blob", () => sdk);
import { BlobPublisher } from "../blob";
import { CACHE_CONTROL, etagFor } from "../publisher";
describe("private Blob publications", () => {
  it("round-trips an envelope with truthful cache metadata, never a public object", async () => {
    const publisher = new BlobPublisher();
    await publisher.put("entity/creek/status.json", "{}", { contentType: "application/json", cacheControl: CACHE_CONTROL.latest });
    expect(sdk.put).toHaveBeenCalledWith("publications/entity/creek/status.json", expect.any(String), expect.objectContaining({ access: "private", allowOverwrite: true, addRandomSuffix: false }));
    const envelope = sdk.put.mock.calls[0]![1];
    sdk.get.mockResolvedValue({ statusCode: 200, stream: new Response(envelope).body });
    expect(await publisher.get("entity/creek/status.json")).toEqual({ body: "{}", contentType: "application/json", cacheControl: CACHE_CONTROL.latest, etag: etagFor("{}") });
  });
  it("refuses corrupted publications", async () => {
    sdk.get.mockResolvedValue({ statusCode: 200, stream: new Response(JSON.stringify({ body: "{}", etag: "wrong" })).body });
    expect(await new BlobPublisher().get("entity/creek/status.json")).toBeNull();
  });
});
