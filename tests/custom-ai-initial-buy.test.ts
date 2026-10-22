import { describe, expect, it } from "vitest";
import { MIN_INITIAL_BUY_ETH_WEI, minimumInitialBuyQuote, requireMinimumInitialBuy } from "../lib/custom-ai/initial-buy";

describe("Custom AI launch minimum", () => {
  it("is exactly 0.01 for equal ETH and 18-decimal quote prices", () => {
    for (const price of [1n, 123456789123456789n, 3000n * 10n ** 18n, 10n ** 36n]) {
      expect(minimumInitialBuyQuote(18, price, price)).toBe(MIN_INITIAL_BUY_ETH_WEI);
    }
  });
  it("selects the smallest whole quote unit that covers the required ETH value", () => {
    for (const decimals of [0, 6, 8, 18, 36]) {
      for (const quotePrice of [1n, 3n * 10n ** 18n, 10n ** 36n]) {
        for (const ethPrice of [1n, 2500n * 10n ** 18n + 1n, 10n ** 36n]) {
          const minimum = minimumInitialBuyQuote(decimals, quotePrice, ethPrice);
          const required = MIN_INITIAL_BUY_ETH_WEI * ethPrice * 10n ** BigInt(decimals);
          expect(minimum * quotePrice * 10n ** 18n).toBeGreaterThanOrEqual(required);
          expect((minimum - 1n) * quotePrice * 10n ** 18n).toBeLessThan(required);
          expect(() => requireMinimumInitialBuy(minimum - 1n, decimals, quotePrice, ethPrice)).toThrow();
          expect(requireMinimumInitialBuy(minimum, decimals, quotePrice, ethPrice)).toBe(minimum);
        }
      }
    }
  });
  it("rejects missing or out-of-range conversion inputs", () => {
    for (const [decimals, quote, eth] of [[-1, 1n, 1n], [37, 1n, 1n], [18, 0n, 1n], [18, 1n, 0n],
      [18, 10n ** 36n + 1n, 1n], [18, 1n, 10n ** 36n + 1n]] as const) {
      expect(() => minimumInitialBuyQuote(decimals, quote, eth)).toThrow();
    }
  });
});
