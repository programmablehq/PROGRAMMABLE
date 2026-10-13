import "server-only";
import { getAddress, type Address } from "viem";
import { assessAnyQuoteAssetV1, type AnyQuoteUsdReferenceV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { assertFoundationFundingPath, type FoundationEthFunding } from "@/lib/module-foundation/atomic-launch";
import { requireAnyQuoteNativeUnlockRouteV1 } from "@/lib/module-engine/any-quote/route";
import { foundationChainProfile, type FoundationChainId } from "@/lib/module-foundation/chains";

export class FoundationQuoteMarketError extends Error {
  readonly retryable: boolean;
  constructor(readonly code: string) {
    const thin = ["MARKET_PRICE_IMPACT_TOO_HIGH", "MARKET_DEPTH_UNAVAILABLE", "MARKET_LIQUIDITY_UNAVAILABLE"].includes(code);
    const missing = ["NATIVE_V4_EXECUTABLE_ROUTE_UNAVAILABLE", "MARKET_ROUTE_UNAVAILABLE"].includes(code);
    const retryable = /PROVIDER|RPC_|CHECKPOINT|EXPIRED/.test(code) && !/MISMATCH|INVALID/.test(code);
    super(thin ? "The available ETH route has too little liquidity for this quote token. Choose ETH or another pool pair."
      : missing ? "No supported ETH route was found for this quote token. Choose ETH or another pool pair."
        : retryable ? "The quote token's market could not be verified. Try again in a moment."
          : "A verified ETH route is unavailable for this quote token. Choose ETH or another pool pair.");
    this.retryable = retryable;
  }
}

/** The ETH input is a spending ceiling. A 1% output margin leaves any unspent ETH refundable. */
export async function readFoundationEthFunding(quote: Address, maximumEth: bigint, chainId: FoundationChainId = 4663): Promise<FoundationEthFunding & { priceReference?: AnyQuoteUsdReferenceV1 }> {
  const FOUNDATION_WETH = foundationChainProfile(chainId).wrappedEth.address;
  if (getAddress(quote) === FOUNDATION_WETH) return { maximumEth, quoteAmount: maximumEth, path: [] };
  const result = await assessAnyQuoteAssetV1({ quoteAsset: quote, probeEthAmount: maximumEth }, { chainId, pricePurpose: "module-launch" });
  if (result.status !== "compatible") throw new FoundationQuoteMarketError(result.code);
  const hops = requireAnyQuoteNativeUnlockRouteV1(result.routes.buy, "buy", chainId);
  if (getAddress(hops.at(-1)!.tokenOut) !== getAddress(quote)) throw new Error("The ETH route ends in another quote token.");
  const path = hops.map(hop => ({ intermediateCurrency: hop.tokenIn, fee: hop.key.fee,
    tickSpacing: hop.key.tickSpacing, hooks: hop.key.hooks, hookData: hop.hookData }));
  assertFoundationFundingPath(quote, path, chainId);
  const quoteAmount = BigInt(result.routes.buy.amountOut) * 99n / 100n;
  if (quoteAmount <= 0n) throw new Error("The first buy is too small for this token. Increase the ETH amount.");
  // The same independently verified market supplies both funding and the starting price.
  return { maximumEth, quoteAmount, path, priceReference: { chainId: result.chainId,
    quoteAsset: result.quoteAsset, decimals: result.token.decimals, checkpoint: result.checkpoint, price: result.price } };
}
