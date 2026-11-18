import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSwapToken } from "@/lib/swap/client";
import { SWAP_TOKEN_SCHEMA } from "@/lib/swap/types";

const address = "0x1111111111111111111111111111111111111111";
const input = { address, chainId: 1 as const };
const descriptor = { schemaVersion: SWAP_TOKEN_SCHEMA, chainId: 1, token: { address, name: "Token", symbol: "TOK", decimals: 18 },
  manageHref: null, status: "ready", route: { kind: "classic", hook: address, poolId: `0x${"11".repeat(32)}`, launchModel: "classic" } };
const unavailable = () => Response.json({ error: "Temporarily unavailable", code: "ROUTE_UNAVAILABLE" }, { status: 503 });
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => { vi.useFakeTimers(); fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded swap route recovery", () => {
  it("recovers a short outage without another user action and stops after success", async () => {
    fetcher.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(Response.json(descriptor));
    const result = fetchSwapToken(input);
    await vi.advanceTimersByTimeAsync(800);
    expect(await result).toEqual(descriptor);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining(`chain=1`), expect.objectContaining({ cache: "no-store", redirect: "error" }));
  });
  it("caps persistent outages at three total requests", async () => {
    fetcher.mockImplementation(async () => unavailable());
    const result = expect(fetchSwapToken(input)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([408, 429, 502, 504])("recovers HTTP %s even when the proxy returned HTML", async status => {
    fetcher.mockResolvedValueOnce(new Response("upstream unavailable", { status })).mockResolvedValueOnce(Response.json(descriptor));
    const result = fetchSwapToken(input);
    await vi.advanceTimersByTimeAsync(800);
    expect(await result).toEqual(descriptor);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("recovers a network fetch failure", async () => {
    fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(Response.json(descriptor));
    const result = fetchSwapToken(input);
    await vi.advanceTimersByTimeAsync(800);
    expect(await result).toEqual(descriptor);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([[400, "INVALID_ADDRESS"], [404, "TOKEN_NOT_FOUND"], [422, "NO_VERIFIED_MARKET"], [503, "TRADE_PROVIDER_DISAGREEMENT"], [503, "SWAP_STAMP_BINDING_CHANGED"]])("does not retry terminal responses or conflicting evidence (%s %s)", async (status, code) => {
    fetcher.mockResolvedValue(Response.json({ error: "Not available", code }, { status: Number(status) }));
    await expect(fetchSwapToken(input)).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retry a valid response for an unsupported route", async () => {
    const unsupported = { ...descriptor, status: "unavailable", route: null, reason: "No ETH pool" };
    fetcher.mockResolvedValue(Response.json(unsupported));
    expect(await fetchSwapToken(input)).toEqual(unsupported);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects the wrong token without retrying or accepting its route", async () => {
    fetcher.mockResolvedValue(Response.json({ ...descriptor, token: { ...descriptor.token, address: `0x${"22".repeat(20)}` } }));
    await expect(fetchSwapToken(input)).rejects.toThrow("another token or network");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("cancels a queued retry when the user leaves or selects another coin", async () => {
    const controller = new AbortController();
    fetcher.mockImplementation(async () => unavailable());
    const result = expect(fetchSwapToken({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start a lookup that is already cancelled", async () => {
    await expect(fetchSwapToken({ ...input, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
