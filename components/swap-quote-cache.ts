import type { SwapReview } from "@/lib/swap/types";

type Quote = { review: SwapReview; receivedAt: number };
export const swapQuoteExpiresAt = ({ review, receivedAt }: Quote) =>
  Math.min(Number(review.expiresAt) * 1_000 - 5_000, receivedAt + 30_000);

/** Holds only already-verified, unexpired quotes in the current trade panel.
 * The key includes wallet, chain, token, side, input, slippage and refresh revision.
 * Sending still performs the existing independent preparation check. */
export function createSwapQuoteCache(now = Date.now) {
  const saved = new Map<string, Quote>();
  return {
    get(key: string) {
      const quote = saved.get(key);
      if (quote && now() < swapQuoteExpiresAt(quote)) return quote;
      saved.delete(key);
      return undefined;
    },
    set(key: string, quote: Quote) {
      if (now() >= swapQuoteExpiresAt(quote)) return;
      saved.delete(key);
      saved.set(key, quote);
      if (saved.size > 8) saved.delete(saved.keys().next().value!);
    },
    clear() { saved.clear(); },
  };
}
