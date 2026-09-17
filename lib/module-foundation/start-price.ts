import { formatUnits, getAddress, type Address, type Hex } from "viem";
import type { AnyQuoteCheckpointV1, AnyQuotePriceEvidenceV1 } from "@/lib/module-engine/any-quote/types";
import { moduleHash, moduleRecord } from "@/lib/module-mode/release";
import { FOUNDATION_CHAIN_ID } from "./constants";
import { planFoundationPrice } from "./price";

export const FOUNDATION_START_MARKET_CAP_USD = 5_000n;
export interface FoundationStartPrice {
  chainId: 4663;
  quoteAsset: Address;
  quoteCodeHash: Hex;
  decimals: number;
  targetMarketCapUsd: "5000";
  checkpoint: AnyQuoteCheckpointV1;
  price: AnyQuotePriceEvidenceV1;
}

const PRICE_UNAVAILABLE = "The automatic starting price is unavailable or expired. Review again to refresh it.";
function positive(value: unknown, digits = 256): bigint {
  if (typeof value !== "string" || value.length > digits || !/^[1-9][0-9]*$/.test(value)) throw new Error(PRICE_UNAVAILABLE);
  return BigInt(value);
}

/** Validate the server-owned reference against the actual quote, never a draft valuation. */
export function parseFoundationStartPrice(value: unknown, quote: { address: Address; decimals: number; codeHash: Hex }, now = BigInt(Math.floor(Date.now() / 1_000))): FoundationStartPrice {
  try {
    const data = moduleRecord(value, ["chainId", "quoteAsset", "quoteCodeHash", "decimals", "targetMarketCapUsd", "checkpoint", "price"], "foundation.startPrice");
    const checkpoint = moduleRecord(data.checkpoint, ["number", "hash", "timestamp"], "foundation.startPrice.checkpoint");
    const price = moduleRecord(data.price, ["usd", "source", "observedAt", "validUntil", "evidenceHash", "heartbeatSeconds"], "foundation.startPrice.price");
    const usd = moduleRecord(price.usd, ["numerator", "denominator"], "foundation.startPrice.usd");
    const stamp = positive(checkpoint.timestamp, 16), observed = positive(price.observedAt, 16), expiry = positive(price.validUntil, 16);
    positive(checkpoint.number, 20); positive(usd.numerator); positive(usd.denominator);
    moduleHash(checkpoint.hash, "foundation.startPrice.blockHash"); moduleHash(price.evidenceHash, "foundation.startPrice.evidenceHash");
    if (data.chainId !== FOUNDATION_CHAIN_ID || data.targetMarketCapUsd !== FOUNDATION_START_MARKET_CAP_USD.toString()
      || typeof data.quoteAsset !== "string" || getAddress(data.quoteAsset) !== getAddress(quote.address)
      || moduleHash(data.quoteCodeHash, "foundation.startPrice.quoteCodeHash") !== quote.codeHash
      || data.decimals !== quote.decimals || !Number.isInteger(quote.decimals) || quote.decimals < 0 || quote.decimals > 36
      || !["chainlink", "robinhood-stock-rest", "qualified-amm"].includes(String(price.source))
      || typeof price.heartbeatSeconds !== "number" || !Number.isInteger(price.heartbeatSeconds)
      || price.heartbeatSeconds < 1 || price.heartbeatSeconds > 604_800
      || stamp > now + 10n || now - stamp > 60n || observed > now || now - observed > BigInt(price.heartbeatSeconds)
      || expiry <= now || expiry > now + 45n || expiry > observed + BigInt(price.heartbeatSeconds)) throw new Error(PRICE_UNAVAILABLE);
    return data as unknown as FoundationStartPrice;
  } catch { throw new Error(PRICE_UNAVAILABLE); }
}

/** Keep the USD conversion rational through tick selection, including zero-decimal quote tokens. */
export function planFoundationStartPrice(input: { token: Address; quote: { address: Address; decimals: number; codeHash: Hex }; startPrice: unknown; additionalQuoteRaw?: bigint; now?: bigint }) {
  const startPrice = parseFoundationStartPrice(input.startPrice, input.quote, input.now);
  const usd = startPrice.price.usd, units = 10n ** BigInt(input.quote.decimals);
  const price = planFoundationPrice({ token: input.token, quote: input.quote.address,
    valuationQuoteRaw: { numerator: FOUNDATION_START_MARKET_CAP_USD * units * BigInt(usd.denominator), denominator: BigInt(usd.numerator) },
    additionalQuoteRaw: input.additionalQuoteRaw });
  const cents = price.actualValuationQuote.numerator * BigInt(usd.numerator) * 100n
    / (price.actualValuationQuote.denominator * units * BigInt(usd.denominator));
  return { ...price, actualMarketCapUsd: formatUnits(cents, 2) };
}
