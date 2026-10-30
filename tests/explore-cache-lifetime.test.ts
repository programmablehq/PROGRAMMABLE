import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ ethereum: vi.fn(), robinhood: vi.fn(), base: vi.fn(), hyperevm: vi.fn(), all: vi.fn() }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumLaunches: reads.ethereum }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodLaunches: reads.robinhood }));
vi.mock("@/lib/server/base-explore", () => ({ readBaseLaunches: reads.base }));
vi.mock("@/lib/server/hyperevm-explore", () => ({ readHyperEvmLaunches: reads.hyperevm }));
vi.mock("@/lib/server/unified-explore", () => ({ readUnifiedLaunches: reads.all }));
import { GET as ethereum } from "@/app/api/explore/ethereum/route";
import { GET as robinhood } from "@/app/api/explore/robinhood/route";
import { GET as base } from "@/app/api/explore/base/route";
import { GET as hyperevm } from "@/app/api/explore/hyperevm/route";
import { GET as all } from "@/app/api/explore/launches/route";

const now = Date.parse("2026-10-30T12:00:00Z");
const at = (ageMs: number) => new Date(now - ageMs).toISOString();
function feed(marketAge = 890_000, indexAge = 1_000) {
  return { status: "ready", updatedAt: at(indexAge), items: [{ tokenAddress: "0x" + "ab".repeat(20) }],
    presentations: [{ market: { observedAt: at(marketAge) } }] };
}
beforeEach(() => { vi.useFakeTimers({ now }); for (const read of Object.values(reads)) read.mockReset().mockResolvedValue(feed()); });
afterEach(() => vi.useRealTimers());

describe("Explore response lifetime across every network", () => {
  it.each(Object.entries({ ethereum, robinhood, base, hyperevm, all }))(
    "%s cannot cache prices beyond their remaining valid lifetime", async (name, get) => {
      const response = await get(new Request(`https://website.invalid/api/explore/${name}`));
      expect(response.status).toBe(200);
      const cache = response.headers.get("cache-control")!;
      const fresh = Number(/s-maxage=(\d+)/u.exec(cache)?.[1] ?? 0);
      const stale = Number(/stale-while-revalidate=(\d+)/u.exec(cache)?.[1] ?? 0);
      expect(fresh + stale).toBeLessThanOrEqual(8);
      expect(reads[name as keyof typeof reads]).toHaveBeenCalledOnce();
    },
  );
  it.each(Object.entries({ ethereum, robinhood, base, hyperevm, all }))(
    "%s does not cache a price that expires while assembling the page", async (name, get) => {
      reads[name as keyof typeof reads].mockResolvedValue(feed(899_000));
      const response = await get(new Request(`https://website.invalid/api/explore/${name}`));
      expect(response.headers.get("cache-control")).toBe("no-store");
      // Optional market freshness does not change the verified launch identity status.
      expect((await response.json()).status).toBe("ready");
    },
  );
  it("does not retain an all-chain ready status beyond the oldest index", async () => {
    reads.all.mockResolvedValue(feed(1_000, 299_000));
    const response = await all(new Request("https://website.invalid/api/explore/launches"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).status).toBe("stale");
  });
});
