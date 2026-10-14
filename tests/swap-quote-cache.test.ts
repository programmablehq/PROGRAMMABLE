import { describe, expect, it } from "vitest";
import type { SwapReview } from "@/lib/swap/types";
import { createSwapQuoteCache } from "@/components/swap-quote-cache";

describe("verified trade quote reuse", () => {
  const start = 1_000_000;
  const quote = (expiresAt = 1_025n) => ({ review: { expiresAt } as SwapReview, receivedAt: start });
  it("reuses the exact quote while keeping other wallets, sides and refreshes separate", () => {
    const cache = createSwapQuoteCache(() => start), value = quote();
    cache.set("1:token:alice:buy:1:300:0", value);
    expect(cache.get("1:token:alice:buy:1:300:0")).toBe(value);
    for (const key of ["1:token:bob:buy:1:300:0", "4663:token:alice:buy:1:300:0", "1:token:alice:sell:1:300:0", "1:token:alice:buy:1:300:1"])
      expect(cache.get(key)).toBeUndefined();
  });
  it("expires before the executable deadline and never extends the original receipt time", () => {
    let now = start;
    const cache = createSwapQuoteCache(() => now), value = quote();
    cache.set("quote", value);
    now += 19_999;
    expect(cache.get("quote")?.receivedAt).toBe(start);
    now++;
    expect(cache.get("quote")).toBeUndefined();
    cache.set("old", value);
    expect(cache.get("old")).toBeUndefined();
  });
  it("bounds memory and clears consumed quotes", () => {
    const cache = createSwapQuoteCache(() => start);
    for (let i = 0; i < 9; i++) cache.set(String(i), quote(2_000n));
    expect(cache.get("0")).toBeUndefined();
    expect(cache.get("8")).toBeDefined();
    cache.clear();
    expect(cache.get("8")).toBeUndefined();
  });
});
