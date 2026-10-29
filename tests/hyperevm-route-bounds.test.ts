import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const prepare = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/swap/evm-custom", () => ({
  EvmSwapError: class extends Error {},
  prepareHyperEvmSwap: prepare,
  prepareHyperEvmFeeClaim: prepare,
  readHyperEvmSwapDescriptor: vi.fn(),
}));
import { POST as trade } from "@/app/api/swap/evm/prepare/route";
import { POST as fees } from "@/app/api/swap/evm/fees/route";
beforeEach(() => prepare.mockReset());

describe.each([["trade", trade, 4096], ["fees", fees, 2048]] as const)("HyperEVM %s body limits", (_name, route, limit) => {
  it("rejects oversized streams without a content-length or RPC work", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(limit + 1)); }, cancel,
    }, { highWaterMark: 0 });
    const request = new Request("https://programmable.market/api/swap/evm", {
      method: "POST", body: stream, duplex: "half",
    } as RequestInit);
    expect((await route(request)).status).toBe(413);
    expect(prepare).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects malformed JSON before any RPC work", async () => {
    expect((await route(new Request("https://programmable.market/api/swap/evm", { method: "POST", body: "{" }))).status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });
});
