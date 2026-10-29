import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedEvmFetch } from "@/lib/server/evm-bounded-fetch";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllGlobals());

describe("bounded EVM provider responses", () => {
  it("preserves the response body and provider error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"rate limited"}', {
      status: 429, headers: { "retry-after": "30", "content-type": "application/json" },
    })));
    const response = await boundedEvmFetch("https://rpc.example");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toEqual({ error: "rate limited" });
  });

  it("cancels an oversized streaming response before parsing it", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1_048_576)); },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(boundedEvmFetch("https://rpc.example")).rejects.toThrow("RPC response exceeded its read limit");
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("preserves responses without a body", async () => {
    const response = new Response(null, { status: 204 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await boundedEvmFetch("https://rpc.example")).toBe(response);
  });
});
