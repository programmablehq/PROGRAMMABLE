import "server-only";
import type { Address, Hex } from "viem";
import { readAnyQuoteUsdPriceV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { FOUNDATION_START_MARKET_CAP_USD, parseFoundationStartPrice } from "@/lib/module-foundation/start-price";

export async function readFoundationStartPrice(quote: { address: Address; decimals: number; codeHash: Hex }) {
  try {
    const reference = await readAnyQuoteUsdPriceV1({ quoteAsset: quote.address });
    return parseFoundationStartPrice({ ...reference, quoteCodeHash: quote.codeHash, targetMarketCapUsd: FOUNDATION_START_MARKET_CAP_USD.toString() }, quote);
  } catch {
    throw new Error("A current price for this quote token is unavailable. Try again or choose another quote token.");
  }
}
