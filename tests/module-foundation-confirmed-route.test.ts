import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { verify, save, find, indexed } = vi.hoisted(() => ({ verify: vi.fn(), save: vi.fn(), find: vi.fn(), indexed: vi.fn() }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ hasFinalizedRobinhoodFoundationReceipt: indexed }));
vi.mock("@/lib/server/module-foundation/confirmed-launch", () => ({ confirmFoundationLaunch: verify }));
vi.mock("@/lib/server/module-foundation/recent-launch-store", () => ({ saveRecentFoundationLaunch: save, findRecentFoundationLaunch: find }));
const token = `0x${"12".repeat(20)}`, transactionHash = `0x${"34".repeat(32)}`;
const body = { chainId: 1, token, transactionHash };
const request = (data: unknown, origin?: string) => new Request("https://programmable.market/api/module-foundation/confirmed", {
  method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
});
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); save.mockResolvedValue(undefined); find.mockResolvedValue(null); });
describe("confirmed launch hint", () => {
  it("acknowledges an already finalized Robinhood receipt without replaying its historical verification", async () => {
    const { POST } = await import("@/app/api/module-foundation/confirmed/route");
    indexed.mockResolvedValue(true);
    expect((await POST(request({ ...body, chainId: 4663 }))).status).toBe(200);
    expect(indexed).toHaveBeenCalledExactlyOnceWith(token, transactionHash);
    expect(verify).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it("reuses a persisted receipt after its block was rechecked, including on a fresh server instance", async () => {
    const { POST } = await import("@/app/api/module-foundation/confirmed/route");
    find.mockResolvedValue({ row: { transactionHash } });
    expect((await POST(request(body))).status).toBe(200);
    expect(find).toHaveBeenCalledExactlyOnceWith(1, token);
    expect(verify).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it("coalesces duplicate hints and stores only server-verified data", async () => {
    const { POST } = await import("@/app/api/module-foundation/confirmed/route");
    const check = Promise.withResolvers<object>();
    verify.mockReturnValue(check.promise);
    const first = POST(request(body)), second = POST(request(body));
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(save).not.toHaveBeenCalled();
    const record = { verified: true };
    check.resolve(record);
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(save).toHaveBeenCalledExactlyOnceWith(record);
    await POST(request(body));
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it("does not publish a failed receipt and does not expose RPC errors", async () => {
    const { POST } = await import("@/app/api/module-foundation/confirmed/route");
    verify.mockRejectedValue(new Error("private RPC credentials"));
    const result = await POST(request(body));
    expect(result.status).toBe(503);
    expect(result.headers.get("retry-after")).toBe("15");
    expect(await result.text()).not.toContain("credentials");
    expect(save).not.toHaveBeenCalled();
  });
  it("respects the server cooldown and can recover the same receipt after a failed batch", async () => {
    vi.useFakeTimers();
    const attempt = vi.fn().mockImplementation(async () => new Response(null, {
      status: 503, headers: { "retry-after": "15" },
    }));
    vi.stubGlobal("fetch", attempt);
    try {
      const { announceFoundationLaunch } = await import("@/lib/module-foundation/announce-launch");
      const receipt = { chainId: 1 as const, token: token as `0x${string}`, transactionHash: transactionHash as `0x${string}` };
      const first = announceFoundationLaunch(receipt);
      expect(announceFoundationLaunch(receipt)).toBe(first);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(attempt).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempt).toHaveBeenCalledTimes(2);
      await vi.runAllTimersAsync();
      await first;
      expect(attempt).toHaveBeenCalledTimes(3);
      attempt.mockResolvedValue(new Response(null, { status: 200 }));
      await announceFoundationLaunch(receipt);
      await announceFoundationLaunch(receipt);
      expect(attempt).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
  it("rejects cross-site and oversized or malformed hints before any RPC", async () => {
    const { POST } = await import("@/app/api/module-foundation/confirmed/route");
    expect((await POST(request(body, "https://elsewhere.test"))).status).toBe(403);
    for (const invalid of [{ ...body, chainId: 2 }, { ...body, symbol: "FAKE" }, { ...body, transactionHash: "0x00" }, "x".repeat(600)]) {
      expect((await POST(request(invalid))).status).toBe(400);
    }
    expect(verify).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
