export type RobinhoodCoinMarket = Readonly<{
  poolId: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  /** Total-supply valuation is distinct from circulating market cap. */
  fdvUsd?: number | null;
  valuationKind?: "market-cap" | "fdv";
  source?: "dexscreener" | "uniswap-v4";
  blockNumber?: string;
  blockHash?: string;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  change24hPercent: number | null;
  observedAt: string;
  sourceUrl: string;
}>;

export type RobinhoodCoinPresentation = Readonly<{
  tokenAddress: string;
  imageUrl: string | null;
  description: string | null;
  links: readonly Readonly<{ label: string; url: string }>[];
  market: RobinhoodCoinMarket | null;
}>;

export const ROBINHOOD_MARKET_MAX_AGE_MS = 180_000;

export function mergeRobinhoodPresentations(
  previous: readonly RobinhoodCoinPresentation[],
  incoming: readonly RobinhoodCoinPresentation[] | null,
  now = Date.now(),
) {
  const saved = new Map(previous.map((item) => [item.tokenAddress.toLowerCase(), item.market]));
  let delayed = incoming === null;
  function recent(market: RobinhoodCoinMarket | null | undefined) {
    const age = market ? now - Date.parse(market.observedAt) : NaN;
    return age >= 0 && age <= ROBINHOOD_MARKET_MAX_AGE_MS ? market : null;
  }
  const items = (incoming ?? previous.map((item) => ({ ...item, market: null }))).map((item) => {
    const previousMarket = saved.get(item.tokenAddress.toLowerCase());
    const samePool = !item.market || previousMarket?.poolId.toLowerCase() === item.market.poolId.toLowerCase();
    const savedMarket = samePool ? recent(previousMarket) : null;
    const nextMarket = recent(item.market);
    // Keep a complete, recent observation; never give saved values a new timestamp.
    const market = savedMarket && (!nextMarket || Date.parse(savedMarket.observedAt) > Date.parse(nextMarket.observedAt))
      ? savedMarket : nextMarket ?? null;
    if (market !== item.market || (previousMarket && !nextMarket)) delayed = true;
    return market === item.market ? item : { ...item, market };
  });
  return { items, delayed };
}

const compactDollars = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2,
});
const priceDollars = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumSignificantDigits: 4,
});

/** Keep the valuation basis available under one consistent product label. */
export function coinValuation(market: RobinhoodCoinMarket | null | undefined): { label: "Market Cap"; value: number | null; title?: string } {
  const valid = (value: number | null | undefined): value is number => value != null && Number.isFinite(value) && value >= 0;
  if (valid(market?.marketCapUsd)) return { label: "Market Cap", value: market.marketCapUsd };
  if (valid(market?.fdvUsd)) return { label: "Market Cap", value: market.fdvUsd, title: "Based on total token supply" };
  return { label: "Market Cap", value: null };
}

export function coinDollars(value: number | null | undefined, price = false) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  return (price ? priceDollars : compactDollars).format(value);
}

export function coinAge(value: string | null, now: number) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1_000));
  if (seconds < 60) return "Just launched";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function coinTicker(value: string | null) {
  const ticker = value?.trim();
  return ticker ? ticker.startsWith("$") ? ticker : `$${ticker}` : "Ticker unavailable";
}
