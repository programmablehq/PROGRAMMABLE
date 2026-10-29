import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ chart: vi.fn(), robinhood: vi.fn(), ethereum: vi.fn(), base: vi.fn(), hyperevm: vi.fn() }));
vi.mock("@/lib/server/codex-market", () => ({ readCodexChart: mocks.chart }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodToken: mocks.robinhood }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumExploreCatalog: mocks.ethereum }));
vi.mock("@/lib/server/base-explore", () => ({ readBaseToken: mocks.base }));
vi.mock("@/lib/server/hyperevm-explore", () => ({ readHyperEvmToken: mocks.hyperevm }));
import { GET } from "@/app/api/market/chart/route";
const address = `0x${"ab".repeat(20)}`;
afterEach(() => vi.resetAllMocks());
it.each(["token=bad", `token=${address}&range=all`, `token=${address}&chain=10`, `token=${address}&query=arbitrary`,
  `token=${address}&token=${address}`, `token=${address}&range=1m&range=1D`])("rejects invalid chart inputs without provider calls: %s", async query => {
  expect((await GET(new Request(`https://example.com/api/market/chart?${query}`))).status).toBe(400);
  expect(mocks.chart).not.toHaveBeenCalled();
});
describe("verified chart identity", () => {
  it("serves a verified last-minute chart with a bounded shared cache", async () => {
    mocks.robinhood.mockResolvedValue({ token: { tokenAddress: address } });
    mocks.chart.mockResolvedValue({ tokenAddress: address, chainId: 4663, range: "1m", source: "codex", points: [{ time: 1, price: 1 }] });
    const response = await GET(new Request(`https://example.com/api/market/chart?token=${address}&range=1m`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=30");
    expect(mocks.chart).toHaveBeenCalledExactlyOnceWith(address, 4663, "1m");
    expect(await response.json()).toMatchObject({ range: "1m", source: "codex" });
  });
  it("binds a Base chart to the verified Base token record", async () => {
    mocks.base.mockResolvedValue({ chainId: 8453, status: "ready", token: { tokenAddress: address } });
    mocks.chart.mockResolvedValue({ tokenAddress: address, chainId: 8453, range: "1m", source: "codex", points: [{ time: 1, price: 1 }] });
    const response = await GET(new Request(`https://example.com/api/market/chart?token=${address}&chain=8453&range=1m`));
    expect(response.status).toBe(200);
    expect(mocks.base).toHaveBeenCalledExactlyOnceWith(address);
    expect(mocks.chart).toHaveBeenCalledExactlyOnceWith(address, 8453, "1m");
    expect(mocks.robinhood).not.toHaveBeenCalled();
    expect(mocks.ethereum).not.toHaveBeenCalled();
  });
  it("does not request Codex for an address outside either launch index", async () => {
    mocks.robinhood.mockResolvedValue({ token: null }); mocks.ethereum.mockResolvedValue({ entries: [] }); mocks.base.mockResolvedValue({ token: null });
    for (const chain of [1,4663,8453]) expect((await GET(new Request(`https://example.com/api/market/chart?token=${address}&chain=${chain}`))).status).toBe(404);
    expect(mocks.chart).not.toHaveBeenCalled();
  });
  it("does not report a missing launch when its index is unavailable", async () => {
    mocks.robinhood.mockResolvedValue({ token: null, status: "unavailable" });
    mocks.ethereum.mockResolvedValue({ entries: [], status: "partial" });
    for (const chain of [1, 4663]) {
      const response = await GET(new Request(`https://example.com/api/market/chart?token=${address}&chain=${chain}`));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(mocks.chart).not.toHaveBeenCalled();
  });
  it("returns bounded cacheable chart data and hides provider failures", async () => {
    mocks.robinhood.mockResolvedValue({ token: { tokenAddress: address } });
    mocks.chart.mockResolvedValue({ tokenAddress: address, chainId: 4663, range: "1D", source: "codex", points: [{ time: 1, price: 1 }] });
    const url = `https://example.com/api/market/chart?token=${address}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    mocks.chart.mockRejectedValue(new Error("private provider response"));
    const failed = await GET(new Request(url));
    expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("private provider response");
    expect(failed.headers.get("retry-after")).toBe("15");
  });
  it("shares an empty history for two minutes instead of rebilling every refresh", async () => {
    mocks.robinhood.mockResolvedValue({ token: { tokenAddress: address } });
    mocks.chart.mockResolvedValue({ tokenAddress: address, chainId: 4663, range: "1D", source: "codex", points: [] });
    const response = await GET(new Request(`https://example.com/api/market/chart?token=${address}`));
    expect(response.headers.get("cache-control")).toContain("max-age=15, s-maxage=120");
  });
});
