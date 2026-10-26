import "server-only";
import { unstable_cache } from "next/cache";
import { CODEX_CHART_RANGES, marketAddress, marketPool, marketNumber, marketObject, parseCodexBars, type CodexChart, type CodexChartRange } from "@/lib/market/codex";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import { readBoundedUtf8BodyV1 } from "./custom-launch/bounded-utf8-body-v1";

const endpoint = "https://graph.codex.io/graphql";
// Explore refreshes can happen every 30 seconds. Keep provider observations
// long enough that those refreshes never turn into a provider polling loop.
const MARKET_OBSERVATION_TTL_MS = 900_000;
const PROVIDER_FAILURE_BACKOFF_MS = 300_000;
const marketQuery = `query Markets($tokens:[String],$pairs:[String]) {
 filterTokens(tokens:$tokens,limit:100,useAggregatedStats:true) { results { token { address networkId } priceUSD marketCap circulatingMarketCap volume24 change24 } }
 filterPairs(pairs:$pairs,limit:100) { results { liquidity pair { address networkId token0 token1 token0Data { address networkId symbol } token1Data { address networkId symbol } } } }
}`;
// Fixed windows are already below the provider's point limit. countback overrides from.
const barsQuery = `query Chart($symbol:String!,$from:Int!,$to:Int!,$resolution:String!) { getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,currencyCode:USD,removeEmptyBars:false,removeLeadingNullValues:true) { t c s token {address networkId} } }`;
let providerRetryAt = 0;
function pauseProvider(seconds: number) {
  providerRetryAt = Math.max(providerRetryAt, Date.now() + Math.min(900, Math.max(1, Number.isFinite(seconds) ? seconds : 15)) * 1_000);
}

export async function codexQuery(query: string, variables: Record<string, unknown>) {
  const key = process.env.CODEX_API_KEY?.trim();
  if (!key || Date.now() < providerRetryAt) throw new Error("Market data unavailable");
  const signal = AbortSignal.timeout(8_000);
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", headers: { Authorization: key, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), cache: "no-store", redirect: "error", signal });
  } catch {
    pauseProvider(5);
    throw new Error("Market data unavailable");
  }
  if (!response.ok) {
    // A paused billing account affects every endpoint. Do not retry it per token or page.
    const retry = Number(response.headers.get("Retry-After"));
    pauseProvider(response.status === 401 || response.status === 403 || response.status === 429
      ? 600 : retry > 0 ? retry : response.status >= 500 ? 2 : 15);
    void response.body?.cancel();
    throw new Error("Market data unavailable");
  }
  const body: unknown = JSON.parse(await readBoundedUtf8BodyV1(response, 512_000, { signal }));
  // Provider errors may contain request context. Never forward them to the browser or logs.
  if (!marketObject(body) || !marketObject(body.data) || body.errors != null && (!Array.isArray(body.errors) || body.errors.length > 0)) {
    const errors = marketObject(body) && Array.isArray(body.errors) ? body.errors : [];
    for (const error of errors) if (marketObject(error) && marketObject(error.extensions)) {
      if (["OVER_CAPACITY", "TOO_MANY_REQUESTS"].includes(String(error.extensions.code))) {
        pauseProvider(Number(error.extensions.retryAfterSeconds) || 600);
      } else if (["UNAUTHENTICATED", "FORBIDDEN", "NOT_AUTHORIZED"].includes(String(error.extensions.code))) pauseProvider(600);
    }
    throw new Error("Market data unavailable");
  }
  return body.data;
}

type Identity = { tokenAddress: string; poolId: string };
type MarketRead = Promise<RobinhoodCoinMarket | undefined>;
const marketReads = new Map<string, MarketRead>();
const marketObservations = new Map<string, { expiresAt: number; market: RobinhoodCoinMarket }>();
const marketIdentity = (token: Identity, chainId: number) => `${chainId}:${token.tokenAddress}:${token.poolId}`;
const copyMarket = (market: RobinhoodCoinMarket): RobinhoodCoinMarket => ({ ...market,
  ...(market.quoteAsset ? { quoteAsset: { ...market.quoteAsset } } : {}),
});
const pending = new Map<string, Promise<unknown>>();
const failedUntil = new Map<string, number>();
// Coalesce cold reads and briefly back off failures, without automatic provider retries.
async function sharedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const active = pending.get(key);
  if (active) return active as Promise<T>;
  if ((failedUntil.get(key) ?? 0) > Date.now()) throw new Error("Market data unavailable");
  const request = read();
  pending.set(key, request);
  try { return await request; }
  catch {
    failedUntil.delete(key); failedUntil.set(key, Date.now() + PROVIDER_FAILURE_BACKOFF_MS);
    if (failedUntil.size > 200) failedUntil.delete(failedUntil.keys().next().value!);
    throw new Error("Market data unavailable");
  } finally { pending.delete(key); }
}

const cachedMarkets = unstable_cache(async (identities: readonly Identity[], chainId: number) => {
  const addresses = identities.map(token => token.tokenAddress);
  const pools = [...new Set(identities.map(token => token.poolId))];
  const data = await codexQuery(marketQuery, { tokens: addresses.map(address => `${address}:${chainId}`), pairs: pools.map(pool => `${pool}:${chainId}`) });
  if (!marketObject(data.filterTokens) || !Array.isArray(data.filterTokens.results) || data.filterTokens.results.length > 100) throw new Error("Market data unavailable");
  const liquidity = new Map<string, { tokens: string[]; symbols: (string | null)[]; usd: number | null }>();
  if (marketObject(data.filterPairs) && Array.isArray(data.filterPairs.results) && data.filterPairs.results.length <= 100) {
    for (const row of data.filterPairs.results) {
      if (!marketObject(row) || !marketObject(row.pair)) continue;
      const pair = row.pair;
      if (typeof pair.address !== "string" || !marketPool.test(pair.address) || pair.networkId !== chainId
        || typeof pair.token0 !== "string" || !marketAddress.test(pair.token0) || typeof pair.token1 !== "string" || !marketAddress.test(pair.token1)) continue;
      const pool = pair.address.toLowerCase();
      if (!pools.includes(pool) || liquidity.has(pool)) throw new Error("Invalid pool identity");
      const tokens = [pair.token0.toLowerCase(), pair.token1.toLowerCase()];
      const symbols = [pair.token0Data, pair.token1Data].map((token, index) => {
        if (!marketObject(token) || typeof token.address !== "string" || token.address.toLowerCase() !== tokens[index]
          || token.networkId !== chainId || typeof token.symbol !== "string") return null;
        const symbol = token.symbol.trim();
        return symbol.length > 0 && symbol.length <= 32 && !/[\p{Cc}\p{Cf}]/u.test(symbol) ? symbol : null;
      });
      liquidity.set(pool, { tokens, symbols, usd: marketNumber(row.liquidity) });
    }
  }
  const observedAt = new Date().toISOString();
  const entries: [string, Omit<RobinhoodCoinMarket, "poolId">][] = [];
  const seen = new Set<string>();
  for (const row of data.filterTokens.results) {
    if (!marketObject(row) || !marketObject(row.token) || typeof row.token.address !== "string" || row.token.networkId !== chainId) throw new Error("Invalid market identity");
    const address = row.token.address.toLowerCase();
    if (!addresses.includes(address) || seen.has(address)) throw new Error("Invalid market identity");
    seen.add(address);
    const priceUsd = marketNumber(row.priceUSD);
    if (priceUsd === null || priceUsd <= 0) continue;
    // A positive token price with unknown/zero provider supply is not a measured zero-dollar valuation.
    const circulating = marketNumber(row.circulatingMarketCap), total = marketNumber(row.marketCap);
    const marketCapUsd = circulating !== null && circulating > 0 ? circulating : null;
    const fdvUsd = total !== null && total > 0 ? total : null;
    const change = marketNumber(row.change24, true);
    const pool = liquidity.get(identities.find(token => token.tokenAddress === address)!.poolId);
    const quoteAddress = pool?.tokens.includes(address) ? pool.tokens.find(token => token !== address) : undefined;
    entries.push([address, { source: "codex", priceUsd, marketCapUsd, fdvUsd,
      ...(quoteAddress ? { quoteAsset: { address: quoteAddress, symbol: pool!.symbols[pool!.tokens.indexOf(quoteAddress)] } } : {}),
      valuationKind: marketCapUsd !== null ? "market-cap" : "fdv", liquidityUsd: pool?.tokens.includes(address) ? pool.usd : null,
      volume24hUsd: marketNumber(row.volume24), change24hPercent: change === null ? null : change * 100,
      observedAt, sourceUrl: "https://www.codex.io/" }]);
  }
  return entries;
}, ["codex-token-markets-v5"], { revalidate: 900 });

/** Only enrich identities supplied by the verified launch catalog. No provider token becomes a launch. */
export async function readCodexMarkets(tokens: readonly Identity[], chainId = 4663): Promise<Map<string, RobinhoodCoinMarket>> {
  if (![1, 4663, 8453].includes(chainId) || tokens.some(token => !marketAddress.test(token.tokenAddress) || !marketPool.test(token.poolId))) throw new Error("Invalid market request");
  if (!process.env.CODEX_API_KEY?.trim()) return new Map();
  const poolsByToken = new Map<string, string>();
  for (const token of tokens) {
    const address = token.tokenAddress.toLowerCase(), pool = token.poolId.toLowerCase();
    if (poolsByToken.has(address) && poolsByToken.get(address) !== pool) throw new Error("Ambiguous market identity");
    poolsByToken.set(address, pool);
  }
  const identities = [...new Map(tokens.map(token => [token.tokenAddress.toLowerCase(), { tokenAddress: token.tokenAddress.toLowerCase(), poolId: token.poolId.toLowerCase() }])).values()].sort((a,b) => a.tokenAddress.localeCompare(b.tokenAddress));
  const result = new Map<string, RobinhoodCoinMarket>();
  // One HTTP request for token stats and exact-pool liquidity per 100 verified identities.
  const deadline = Date.now() + 8_000;
  for (let offset = 0; offset < identities.length && Date.now() < deadline; offset += 400) {
    const wave = identities.slice(offset, offset + 400);
    const reads = new Map<string, MarketRead>();
    const missing: Identity[] = [];
    for (const token of wave) {
      const key = marketIdentity(token, chainId), observation = marketObservations.get(key);
      if (observation && Date.now() < observation.expiresAt) {
        result.set(token.tokenAddress, copyMarket(observation.market));
      } else {
        marketObservations.delete(key);
        const active = marketReads.get(key);
        if (active) reads.set(token.tokenAddress, active);
        else missing.push(token);
      }
    }
    for (let index = 0; index < missing.length; index += 100) {
      const batch = missing.slice(index, index + 100);
      // A stable cache key lets Next serve the last observation while refreshing.
      // A time bucket here creates a cold blocking request every 30 seconds.
      const batchRead = sharedRead(`markets:${chainId}:${JSON.stringify(batch)}`, () => cachedMarkets(batch, chainId)).then(entries => new Map(entries));
      for (const token of batch) {
        const key = marketIdentity(token, chainId);
        const request: MarketRead = batchRead.then(entries => {
          const value = entries.get(token.tokenAddress);
          if (!value) return;
          const observedAt = Date.parse(value.observedAt), age = Date.now() - observedAt;
          if (!(age >= 0 && age <= MARKET_OBSERVATION_TTL_MS)) return;
          const market = { ...value, poolId: token.poolId };
          // Reuse catalog observations on coin pages without extending their age.
          // Chain and exact pool are part of the key; failures are never saved.
          if (age < MARKET_OBSERVATION_TTL_MS) {
            marketObservations.delete(key);
            marketObservations.set(key, { expiresAt: observedAt + MARKET_OBSERVATION_TTL_MS, market });
            while (marketObservations.size > 2_048) marketObservations.delete(marketObservations.keys().next().value!);
          }
          return market;
        }).finally(() => { if (marketReads.get(key) === request) marketReads.delete(key); });
        marketReads.set(key, request);
        reads.set(token.tokenAddress, request);
      }
    }
    const addresses = [...reads.keys()];
    const settled = await Promise.allSettled(reads.values());
    settled.forEach((read, index) => {
      if (read.status === "fulfilled" && read.value) result.set(addresses[index], copyMarket(read.value));
    });
  }
  return result;
}

async function fetchChart(address: string, chainId: number, range: CodexChartRange): Promise<CodexChart> {
  const config = CODEX_CHART_RANGES[range];
  const bucket = Math.floor(Date.now() / config.refreshMs);
  const to = Math.floor(bucket * config.refreshMs / 1_000), from = to - config.seconds;
  const data = await codexQuery(barsQuery, { symbol: `${address.toLowerCase()}:${chainId}`, from, to, resolution: config.resolution });
  // The first candle can start just before the requested window at its resolution boundary.
  const earliest = from - config.candleSeconds;
  const points = parseCodexBars(data.getTokenBars, address.toLowerCase(), chainId, earliest, to);
  return { tokenAddress: address.toLowerCase(), chainId, range, points, source: "codex", observedAt: new Date().toISOString() };
}
const freshChart = (address: string, chainId: number, range: CodexChartRange) =>
  sharedRead(`chart-provider:${chainId}:${address}:${range}`, () => fetchChart(address, chainId, range));
// A stable key serves the previous observation while Next refreshes it.
// Putting the clock in the key forces a blocking cold read every minute.
const cachedChart = unstable_cache(freshChart, ["codex-token-bars-v4"], { revalidate: 15 });

function currentChart(chart: CodexChart) {
  const age = Date.now() - Date.parse(chart.observedAt);
  return Number.isFinite(age) && age >= 0 && age <= 180_000;
}

export async function readCodexChart(address: string, chainId: number, range: CodexChartRange): Promise<CodexChart> {
  if (!marketAddress.test(address) || ![1, 4663, 8453].includes(chainId) || !Object.hasOwn(CODEX_CHART_RANGES, range)) throw new Error("Invalid chart request");
  const normalized = address.toLowerCase();
  return sharedRead(`chart:${chainId}:${normalized}:${range}`, async () => {
    const cached = await cachedChart(normalized, chainId, range);
    // Next can return an old observation while revalidating in the background.
    // Once it exceeds our display limit, join that source read instead of
    // returning 503 for data that is already being refreshed.
    const chart = currentChart(cached) ? cached : await freshChart(normalized, chainId, range);
    if (!currentChart(chart)) throw new Error("Market data unavailable");
    return chart;
  });
}
