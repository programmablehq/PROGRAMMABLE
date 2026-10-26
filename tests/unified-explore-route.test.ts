import { beforeEach, describe, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/unified-explore", () => ({ readUnifiedLaunches: read }));
import { GET } from "@/app/api/explore/launches/route";
beforeEach(() => read.mockReset().mockResolvedValue({ scope: "all", status: "ready", items: [], presentations: [], page: {} }));

describe("Unified Explore HTTP contract", () => {
  it("defaults to global highest market cap and ten slots", async () => {
    const response = await GET(new Request("https://website.invalid/api/explore/launches"));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledExactlyOnceWith(1, "", { sort: "highest", mode: "all" }, 10);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=120");
  });
  it.each(["chain=invalid", "page=0", "sort=highest&sort=newest", "pageSize=500", "mode=classic"])
    ("does not accept a chain filter or ambiguous request: %s", async query => {
      expect((await GET(new Request(`https://website.invalid/api/explore/launches?${query}`))).status).toBe(400);
      expect(read).not.toHaveBeenCalled();
    });
  it.each([1, 4663, 8453])("accepts a global chain filter for %s", async chain => {
    const response = await GET(new Request(`https://website.invalid/api/explore/launches?chain=${chain}`));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledExactlyOnceWith(1, "", { sort: "highest", mode: "all", chain }, 10);
  });
  it.each(["stale", "partial", "syncing", "unavailable"])("does not cache %s as a complete catalog", async status => {
    read.mockResolvedValue({ status });
    const response = await GET(new Request("https://website.invalid/api/explore/launches"));
    expect(response.status).toBe(status === "unavailable" ? 503 : 200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
