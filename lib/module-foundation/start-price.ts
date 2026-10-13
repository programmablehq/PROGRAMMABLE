import { formatUnits, getAddress, type Address, type Hex } from "viem";
import type { AnyQuoteCheckpointV1, AnyQuotePriceEvidenceV1 } from "@/lib/module-engine/any-quote/types";
import { moduleHash, moduleRecord } from "@/lib/module-mode/release";
import { foundationChainProfile, type FoundationChainId } from "./chains";
import { foundationPriceCheckpointMaxAge, foundationPriceLifetime } from "./price-freshness";
import { planFoundationPrice } from "./price";

export const FOUNDATION_START_MARKET_CAP_USD = 5_000n;
export interface FoundationUsdStartPrice {
  chainId: FoundationChainId;
  quoteAsset: Address;
  quoteCodeHash: Hex;
  decimals: number;
  targetMarketCapUsd: "5000";
  checkpoint: AnyQuoteCheckpointV1;
  price: AnyQuotePriceEvidenceV1;
}

export interface FoundationQuoteStartPrice {
  mode: "quote";
  chainId: FoundationChainId;
  quoteAsset: Address;
  quoteCodeHash: Hex;
  decimals: number;
  valuationQuoteRaw: string;
  checkpoint: AnyQuoteCheckpointV1;
  validUntil: string;
}
export type FoundationStartPrice = FoundationUsdStartPrice | FoundationQuoteStartPrice;
export const isFoundationQuotePrice = (value: FoundationStartPrice): value is FoundationQuoteStartPrice => "mode" in value && value.mode === "quote";
export function foundationPriceExpiry(value: FoundationStartPrice): bigint {
  const priceExpiry = BigInt(isFoundationQuotePrice(value) ? value.validUntil : value.price.validUntil);
  // The review cache must refresh before either condition in the price validator expires.
  const checkpointExpiry = BigInt(value.checkpoint.timestamp) + foundationPriceCheckpointMaxAge(value.chainId);
  return priceExpiry < checkpointExpiry ? priceExpiry : checkpointExpiry;
}
const displayValuation = (value: { numerator: bigint; denominator: bigint }, decimals: number) => formatUnits(value.numerator * 100_000_000n / value.denominator, decimals + 8);

const PRICE_UNAVAILABLE = "The automatic starting price is unavailable or expired. Review again to refresh it.";
function positive(value: unknown, digits = 256): bigint {
  if (typeof value !== "string" || value.length > digits || !/^[1-9][0-9]*$/.test(value)) throw new Error(PRICE_UNAVAILABLE);
  return BigInt(value);
}

/** Bind either a verified USD reference or explicit quote valuation to the current token and checkpoint. */
export function parseFoundationStartPrice(value: unknown, quote: { address: Address; decimals: number; codeHash: Hex; chainId?: FoundationChainId }, now = BigInt(Math.floor(Date.now() / 1_000))): FoundationStartPrice {
  try {
    const lifetime = foundationPriceLifetime(quote.chainId), checkpointMaxAge = foundationPriceCheckpointMaxAge(quote.chainId);
    if (value && typeof value === "object" && "mode" in value && value.mode === "quote") {
      const data = moduleRecord(value, ["mode", "chainId", "quoteAsset", "quoteCodeHash", "decimals", "valuationQuoteRaw", "checkpoint", "validUntil"], "foundation.quotePrice");
      const checkpoint = moduleRecord(data.checkpoint, ["number", "hash", "timestamp"], "foundation.quotePrice.checkpoint");
      const stamp = positive(checkpoint.timestamp, 16), expiry = positive(data.validUntil, 16);
      positive(checkpoint.number, 20); moduleHash(checkpoint.hash, "foundation.quotePrice.blockHash");
      if (positive(data.valuationQuoteRaw, 39) > (1n << 127n) - 1n
        || data.chainId !== foundationChainProfile(quote.chainId).chainId
        || typeof data.quoteAsset !== "string" || getAddress(data.quoteAsset) !== getAddress(quote.address)
        || moduleHash(data.quoteCodeHash, "foundation.quotePrice.codeHash") !== quote.codeHash
        || data.decimals !== quote.decimals || !Number.isInteger(quote.decimals) || quote.decimals < 0 || quote.decimals > 36
        || stamp > now + 10n || now - stamp > checkpointMaxAge || expiry <= now || expiry > now + lifetime || expiry > stamp + lifetime) throw new Error(PRICE_UNAVAILABLE);
      return data as unknown as FoundationQuoteStartPrice;
    }
    const data = moduleRecord(value, ["chainId", "quoteAsset", "quoteCodeHash", "decimals", "targetMarketCapUsd", "checkpoint", "price"], "foundation.startPrice");
    const checkpoint = moduleRecord(data.checkpoint, ["number", "hash", "timestamp"], "foundation.startPrice.checkpoint");
    const price = moduleRecord(data.price, ["usd", "source", "observedAt", "validUntil", "evidenceHash", "heartbeatSeconds"], "foundation.startPrice.price");
    const usd = moduleRecord(price.usd, ["numerator", "denominator"], "foundation.startPrice.usd");
    const stamp = positive(checkpoint.timestamp, 16), observed = positive(price.observedAt, 16), expiry = positive(price.validUntil, 16);
    positive(checkpoint.number, 20); positive(usd.numerator); positive(usd.denominator);
    moduleHash(checkpoint.hash, "foundation.startPrice.blockHash"); moduleHash(price.evidenceHash, "foundation.startPrice.evidenceHash");
    if (data.chainId !== foundationChainProfile(quote.chainId).chainId || data.targetMarketCapUsd !== FOUNDATION_START_MARKET_CAP_USD.toString()
      || typeof data.quoteAsset !== "string" || getAddress(data.quoteAsset) !== getAddress(quote.address)
      || moduleHash(data.quoteCodeHash, "foundation.startPrice.quoteCodeHash") !== quote.codeHash
      || data.decimals !== quote.decimals || !Number.isInteger(quote.decimals) || quote.decimals < 0 || quote.decimals > 36
      || !["chainlink", "robinhood-stock-rest", "qualified-amm"].includes(String(price.source))
      || (quote.chainId === 1 && price.source === "robinhood-stock-rest")
      || typeof price.heartbeatSeconds !== "number" || !Number.isInteger(price.heartbeatSeconds)
      || price.heartbeatSeconds < 1 || price.heartbeatSeconds > 604_800
      || (price.source === "qualified-amm" && BigInt(price.heartbeatSeconds) > lifetime)
      || stamp > now + 10n || now - stamp > checkpointMaxAge || observed > now || now - observed > BigInt(price.heartbeatSeconds)
      || expiry <= now || expiry > now + lifetime || expiry > observed + BigInt(price.heartbeatSeconds)) throw new Error(PRICE_UNAVAILABLE);
    return data as unknown as FoundationUsdStartPrice;
  } catch { throw new Error(PRICE_UNAVAILABLE); }
}

/** Keep the USD conversion rational through tick selection, including zero-decimal quote tokens. */
export function planFoundationStartPrice(input: { token: Address; quote: { address: Address; decimals: number; codeHash: Hex; chainId?: FoundationChainId }; startPrice: unknown; additionalQuoteRaw?: bigint; now?: bigint }) {
  const startPrice = parseFoundationStartPrice(input.startPrice, input.quote, input.now);
  if (isFoundationQuotePrice(startPrice)) {
    const price = planFoundationPrice({ token: input.token, quote: input.quote.address,
      valuationQuoteRaw: BigInt(startPrice.valuationQuoteRaw), additionalQuoteRaw: input.additionalQuoteRaw });
    return { ...price, actualMarketCapUsd: null, actualMarketCapQuote: displayValuation(price.actualValuationQuote, input.quote.decimals) };
  }
  const usd = startPrice.price.usd, units = 10n ** BigInt(input.quote.decimals);
  const price = planFoundationPrice({ token: input.token, quote: input.quote.address,
    valuationQuoteRaw: { numerator: FOUNDATION_START_MARKET_CAP_USD * units * BigInt(usd.denominator), denominator: BigInt(usd.numerator) },
    additionalQuoteRaw: input.additionalQuoteRaw });
  const cents = price.actualValuationQuote.numerator * BigInt(usd.numerator) * 100n
    / (price.actualValuationQuote.denominator * units * BigInt(usd.denominator));
  return { ...price, actualMarketCapUsd: formatUnits(cents, 2), actualMarketCapQuote: displayValuation(price.actualValuationQuote, input.quote.decimals) };
}
