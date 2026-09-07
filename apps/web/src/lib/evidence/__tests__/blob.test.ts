import { afterEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => sdk);
import { blobStorage, boundedBytes, signBlobGrant, verifyBlobGrant, writeBlobEvidence } from "../blob";
import { getEvidenceStorage, setEvidenceStorageForTests } from "../storage";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); setEvidenceStorageForTests(null); });
describe("private Blob evidence", () => {
  const grant = () => ({ key: "evidence/creek/claim_1/file_1.jpg", mime: "image/jpeg", bytes: 3, exp: Math.floor(Date.now() / 1000) + 100 });
  it("binds key, MIME, exact size and expiry into each upload capability", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "a-long-test-secret-for-evidence");
    const g = grant(), sig = signBlobGrant(g);
    expect(verifyBlobGrant(g, sig)).toBe(true);
    for (const edit of [{ key: "evidence/other/claim_1/file_1.jpg" }, { mime: "text/html" }, { bytes: 4 }, { exp: g.exp + 1 }]) expect(verifyBlobGrant({ ...g, ...edit }, sig)).toBe(false);
    expect(verifyBlobGrant(g, sig, (g.exp + 1) * 1000)).toBe(false);
  });
  it("writes private immutable objects and never exposes the store token", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "a-long-test-secret-for-evidence");
    const g = grant(); await writeBlobEvidence(g, Buffer.from("abc"));
    expect(sdk.put).toHaveBeenCalledWith(g.key, Buffer.from("abc"), expect.objectContaining({ access: "private", allowOverwrite: false, addRandomSuffix: false }));
    const signed = await blobStorage("https://beings.earth").presignPut(g.key, g.mime, g.bytes);
    expect(signed.url).toContain("/api/evidence/blob/");
    expect(signed.headers).toEqual({ "content-type": "image/jpeg" });
  });
  it("cancels an oversized stream before buffering the rest", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(4)); }, cancel });
    await expect(boundedBytes(stream, 3)).rejects.toThrow("file_too_large"); expect(cancel).toHaveBeenCalled();
  });
  it("fails closed in production without persistent storage", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const key of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "BLOB_READ_WRITE_TOKEN"]) vi.stubEnv(key, "");
    expect(() => getEvidenceStorage()).toThrow("persistent evidence storage");
  });
});
