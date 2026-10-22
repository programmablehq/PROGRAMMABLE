import { formatUnits } from "viem";
import { CustomAIError } from "./types";

export const MIN_INITIAL_BUY_ETH_WEI = 10n ** 16n;

/** Matches the factory: gross quote input, rounded up, excluding transaction gas. */
export function minimumInitialBuyQuote(decimals: number, quoteUsdE18: bigint, ethUsdE18: bigint): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36
    || quoteUsdE18 <= 0n || quoteUsdE18 > 10n ** 36n || ethUsdE18 <= 0n || ethUsdE18 > 10n ** 36n) {
    throw new CustomAIError("price", "A fresh quote and ETH price are required for the initial buy.");
  }
  const numerator = MIN_INITIAL_BUY_ETH_WEI * ethUsdE18 * 10n ** BigInt(decimals);
  const denominator = quoteUsdE18 * 10n ** 18n;
  return (numerator + denominator - 1n) / denominator;
}

export function requireMinimumInitialBuy(amount: bigint, decimals: number, quoteUsdE18: bigint, ethUsdE18: bigint): bigint {
  const minimum = minimumInitialBuyQuote(decimals, quoteUsdE18, ethUsdE18);
  if (amount < minimum) throw new CustomAIError("initial-buy-minimum",
    `The initial buy must be at least ${formatUnits(minimum, decimals)} quote tokens (0.01 ETH). Gas is separate.`);
  return minimum;
}
