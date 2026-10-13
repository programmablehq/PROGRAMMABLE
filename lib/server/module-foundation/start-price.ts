import "server-only";
import type { Address, Hex } from "viem";
import { readAnyQuoteUsdPriceV1, type AnyQuoteUsdReferenceV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { FOUNDATION_START_MARKET_CAP_USD, isFoundationQuotePrice, parseFoundationStartPrice } from "@/lib/module-foundation/start-price";
import { type FoundationChainId } from "@/lib/module-foundation/chains";

export async function readFoundationStartPrice(quote: { address: Address; decimals: number; codeHash: Hex }, chainId: FoundationChainId = 4663, verifiedReference?: AnyQuoteUsdReferenceV1) {
  try {
    const reference = verifiedReference ?? await readAnyQuoteUsdPriceV1({ quoteAsset: quote.address }, { chainId, pricePurpose: "module-launch" });
    const result = parseFoundationStartPrice({ ...reference, quoteCodeHash: quote.codeHash, targetMarketCapUsd: FOUNDATION_START_MARKET_CAP_USD.toString() }, { ...quote, chainId });
    if (isFoundationQuotePrice(result)) throw new Error("Expected a verified USD reference.");
    return result;
  } catch {
    throw new Error("A current price for this quote token is unavailable. Set the starting value in quote tokens or choose another pool pair.");
  }
}
