import "server-only";
import { getAddress, type Address } from "viem";
import { assessAnyQuoteAssetV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { FOUNDATION_NO_FUNDING_POOL, type FoundationEthFunding } from "@/lib/module-foundation/atomic-launch";
import { FOUNDATION_WETH } from "@/lib/module-foundation/native-funding";

/** The ETH input is a spending ceiling. A 1% output margin leaves any unspent ETH refundable. */
export async function readFoundationEthFunding(quote: Address, maximumEth: bigint): Promise<FoundationEthFunding> {
  if (getAddress(quote) === FOUNDATION_WETH) return { maximumEth, quoteAmount: maximumEth, pool: FOUNDATION_NO_FUNDING_POOL };
  const result = await assessAnyQuoteAssetV1({ quoteAsset: quote, probeEthAmount: maximumEth });
  if (result.status !== "compatible") throw new Error("An ETH route for this quote token is unavailable. Choose ETH or launch without an initial buy.");
  const hops = result.routes.buy.hops, hop = hops[0];
  if (hops.length !== 1 || hop.protocol !== "V4" || hop.hookData !== "0x"
    || getAddress(hop.tokenIn) !== FOUNDATION_WETH || getAddress(hop.tokenOut) !== getAddress(quote)) {
    throw new Error("This quote token needs a route that is not supported for an ETH initial buy yet. Choose ETH or launch without an initial buy.");
  }
  const quoteAmount = BigInt(result.routes.buy.amountOut) * 99n / 100n;
  if (quoteAmount <= 0n) throw new Error("The initial buy is too small. Increase it or enter 0.");
  return { maximumEth, quoteAmount, pool: hop.key };
}
