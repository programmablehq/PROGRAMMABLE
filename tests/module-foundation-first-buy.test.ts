import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { readFoundationSuggestedBuy } from "@/lib/module-foundation/first-buy";

function client(answer: bigint, age = 30n, answeredInRound = 1n) {
  const updatedAt = BigInt(Math.floor(Date.now() / 1000)) - age;
  return { readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === "decimals"
    ? 8 : [1n, answer, updatedAt, updatedAt, answeredInRound]) } as unknown as PublicClient;
}

describe("first buy suggestion", () => {
  it.each([[2500n, "0.0014"], [3500n, "0.001"], [4000n, "0.000875"]])("converts $3.50 using the current $%s ETH price", async (usd, eth) => {
    expect(await readFoundationSuggestedBuy(client(usd * 100_000_000n))).toBe(eth);
  });
  it("rejects stale, invalid and incomplete feed rounds", async () => {
    for (const feed of [client(0n), client(-1n), client(350_000_000_000n, 86_401n), client(350_000_000_000n, -10n), client(350_000_000_000n, 30n, 0n)]) {
      await expect(readFoundationSuggestedBuy(feed)).rejects.toThrow("current ETH price");
    }
  });
});
