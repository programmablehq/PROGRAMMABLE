import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const sync = vi.hoisted(() => vi.fn());
vi.mock("../lib/custom-ai/index.server", () => ({ syncCustomAIIndex: sync }));
import { GET } from "../app/api/ops/custom-ai-index/route";

const secret = "custom-ai-index-test-secret-with-32-characters";
const request = () => new Request("https://programmable.market/api/ops/custom-ai-index", {
  headers: { authorization: `Bearer ${secret}` },
});
beforeEach(() => { vi.stubEnv("CRON_SECRET", secret); sync.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Custom AI scheduled index catch-up", () => {
  it("rejects unauthorized requests before any indexing", async () => {
    expect((await GET(new Request("https://programmable.market/api/ops/custom-ai-index"))).status).toBe(401);
    expect(sync).not.toHaveBeenCalled();
  });
  it("drains multiple finalized ranges on a fast chain while stopping an up-to-date chain", async () => {
    let robinhood = 0;
    sync.mockImplementation(async (chainId: number) => chainId === 1
      ? { status: "current", added: 0 }
      : { status: ++robinhood < 3 ? "syncing" : "current", added: 1 });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([
      { chainId: 1, status: "current", added: 0, batches: 1 },
      { chainId: 4663, status: "current", added: 3, batches: 3 },
    ]);
  });
  it("keeps a bounded backlog marked syncing instead of claiming it is current", async () => {
    sync.mockResolvedValue({ status: "syncing", added: 0 });
    const results = (await (await GET(request())).json()).results;
    expect(results.every((row: { status: string; batches: number }) => row.status === "syncing" && row.batches === 8)).toBe(true);
    expect(sync).toHaveBeenCalledTimes(16);
  });
  it("stops before starting another range when the time budget is exhausted", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    sync.mockImplementation(async () => { now += 40_001; return { status: "syncing", added: 2 }; });
    const results = (await (await GET(request())).json()).results;
    expect(results.every((row: { status: string; batches: number; added: number }) => row.status === "syncing" && row.batches === 1 && row.added === 2)).toBe(true);
  });
  it("reports a failing chain without losing another chain's completed work", async () => {
    sync.mockImplementation(async (chainId: number) => {
      if (chainId === 4663) throw Error("provider unavailable");
      return { status: "current", added: 1 };
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect((await response.json()).results).toEqual([
      { chainId: 1, status: "current", added: 1, batches: 1 },
      { chainId: 4663, status: "unavailable", added: 0, batches: 0 },
    ]);
  });
});
