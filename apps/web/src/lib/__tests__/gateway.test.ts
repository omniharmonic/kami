import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion } from "../gateway";

afterEach(() => vi.unstubAllGlobals());
const request = { slug: "creek", messages: [{ role: "user" as const, content: "Hello" }] };

describe("live gateway transport", () => {
  it("does not invent a reply when no gateway is configured", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await chatCompletion(request, "")).toEqual({kind: "asleep", error: "gateway is not configured"});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("treats an Access login page as unavailable instead of a successful empty chat", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } })));
    expect(await chatCompletion(request, "https://gateway.example")).toEqual({ kind: "asleep", error: "upstream did not return an event stream" });
  });
  it("accepts SSE and forwards cancellation while keeping the timeout", async () => {
    const mock = vi.fn().mockResolvedValue(new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream; charset=utf-8" } }));
    vi.stubGlobal("fetch", mock);
    const controller = new AbortController();
    expect((await chatCompletion({ ...request, signal: controller.signal }, "https://gateway.example")).kind).toBe("stream");
    const signal = (mock.mock.calls[0]![1] as RequestInit).signal;
    expect(signal).not.toBe(controller.signal);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
});
