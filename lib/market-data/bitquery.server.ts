import "server-only";

import { unstable_cache } from "next/cache";

import {
  MARKET_DATA_CURRENT_MAX_AGE_MS,
  MARKET_DATA_MAXIMUM_RAW_INDEXED_PRICE_DEVIATION_BPS,
  MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD,
  MARKET_DATA_USD_PRICE_SOURCE,
  PROGRAMMABLE_MARKET_CHART_SCHEMA_VERSION,
  PROGRAMMABLE_MARKET_DATA_SCHEMA_VERSION,
  isMarketChartV1,
  selectPrimaryMarketPoolV1,
  type MarketChartIdentityV1,
  type MarketChartPointV1,
  type MarketChartV1,
  type MarketDataIdentityV1,
  type MarketLiquidityV1,
  type MarketPoolDataV1,
  type MarketTradeV1,
  type MarketValuationV1,
  type TokenMarketDataV1,
} from "./market-data-v1";
import {
  BitqueryResponseBodyError,
  readBoundedBitqueryResponseText,
} from "./bitquery-response.server";

export const BITQUERY_OAUTH_TOKEN_ENVIRONMENT_VARIABLE =
  "BITQUERY_OAUTH_TOKEN" as const;
export const BITQUERY_HTTP_ENDPOINT =
  "https://streaming.bitquery.io/graphql" as const;

const REQUEST_TIMEOUT_MS = 8_000;
const MAXIMUM_RESPONSE_BYTES = 1_500_000;
const MARKET_BATCH_SIZE = 100;
const MARKET_BATCH_CONCURRENCY = 2;
const MARKET_LIST_BATCH_SIZE = 384;
const MARKET_LIST_BATCH_CONCURRENCY = 1;
const INDEXED_PRICE_BATCH_SIZE = 20;
const INDEXED_PRICE_BATCH_CONCURRENCY = 2;
const INDEXED_PRICE_RECOVERY_CONCURRENCY = 4;
const MAXIMUM_INDEXED_PRICE_RECOVERIES_PER_BATCH = 20;
const MARKET_CACHE_CURRENT_MAX_AGE_MS = 2_000;
const MARKET_CACHE_MAX_AGE_MS = 15 * 60 * 1_000;
const DURABLE_MARKET_CACHE_SECONDS = 5 * 60;
const CHART_CACHE_CURRENT_MAX_AGE_MS = 2_000;
const CHART_CACHE_MAX_AGE_MS = 2 * 60 * 1_000;
const DURABLE_CURRENT_CHART_CACHE_SECONDS = 60;
const DURABLE_WEEK_CHART_CACHE_SECONDS = 5 * 60;
const DURABLE_ALL_HISTORY_CHART_CACHE_SECONDS = 15 * 60;
const CHART_READ_TIMEOUT_MS = 12_000;
const MAXIMUM_CHART_POINTS = 80;
const MAXIMUM_ALL_HISTORY_CHART_POINTS = 32;
const SUPPLY_PRICE_MAXIMUM_DISTANCE_MS = 24 * 60 * 60 * 1_000;
const INDEXED_PRICE_MAXIMUM_DISTANCE_MS = MARKET_DATA_CURRENT_MAX_AGE_MS;
const MAXIMUM_FUTURE_SKEW_MS = 60_000;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const NATIVE_ETH_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;
const WETH_ADDRESS =
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" as const;
const WAD = 10n ** 18n;

type FetchImplementation = typeof fetch;

type GraphqlResponse = Readonly<{
  data: Record<string, unknown>;
  partial: boolean;
  partialReason?: "graphql-errors";
}>;

type BitqueryMarketDataPhase =
  | "configuration"
  | "market-core"
  | "market-liquidity"
  | "market-price"
  | "market-stats"
  | "chart"
  | "unspecified";

export type BitqueryMarketDataFailureReason =
  | "body-too-large"
  | "graphql-errors"
  | "http-status"
  | "invalid-content-type"
  | "invalid-json"
  | "missing-data"
  | "missing-evm"
  | "missing-token"
  | "missing-trading"
  | "request-transport"
  | "unspecified";

type BitqueryReaderOptions = Readonly<{
  fetchImpl?: FetchImplementation;
  token?: string | null;
  now?: Date;
  signal?: AbortSignal;
  includeStats?: boolean;
}>;

type MarketCacheEntry = Readonly<{
  storedAt: number;
  value: MarketPoolDataV1;
}>;

type ChartCacheEntry = Readonly<{
  storedAt: number;
  value: MarketChartV1;
}>;

type BitqueryFdvRankingObservation = Readonly<{
  asOfTime: string;
  priceUsdWad: string;
  fdvUsdWad: string;
  totalSupply: string;
  maxSupply?: string;
  freshness: "current" | "stale";
}>;

type BitqueryFdvRankingParseResult =
  | Readonly<{ observation: BitqueryFdvRankingObservation; reason?: never }>
  | Readonly<{
      observation?: never;
      reason: Extract<
        MarketValuationV1,
        { status: "unavailable" }
      >["reason"];
    }>;

const marketCache = new Map<string, MarketCacheEntry>();
const chartCache = new Map<string, ChartCacheEntry>();

export class BitqueryMarketDataError extends Error {
  override name = "BitqueryMarketDataError";

  constructor(
    readonly category:
      | "configuration"
      | "transport"
      | "response"
      | "integrity",
    readonly phase: BitqueryMarketDataPhase = "unspecified",
    readonly reason: BitqueryMarketDataFailureReason = "unspecified",
    readonly httpStatus?: number,
  ) {
    super("Market data is temporarily unavailable");
  }
}

export function safeBitqueryMarketDataError(error: unknown): Readonly<{
  name: string;
  category: string;
  phase: string;
  reason: BitqueryMarketDataFailureReason;
  httpStatus?: number;
}> {
  if (!(error instanceof BitqueryMarketDataError)) {
    return {
      name: "MarketDataError",
      category: "unexpected",
      phase: "unspecified",
      reason: "unspecified",
    };
  }
  const httpStatus = Number.isInteger(error.httpStatus) &&
      (error.httpStatus ?? 0) >= 100 && (error.httpStatus ?? 0) <= 599
    ? error.httpStatus
    : undefined;
  return {
    name: error.name,
    category: error.category,
    phase: error.phase,
    reason: error.reason,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

function marketDataErrorAtPhase(
  error: unknown,
  phase: BitqueryMarketDataPhase,
): BitqueryMarketDataError {
  if (error instanceof BitqueryMarketDataError) {
    return new BitqueryMarketDataError(
      error.category,
      phase,
      error.reason,
      error.httpStatus,
    );
  }
  throw error;
}

function partialGraphqlResponseError(
  response: GraphqlResponse,
  phase: BitqueryMarketDataPhase,
): BitqueryMarketDataError {
  return new BitqueryMarketDataError(
    "response",
    phase,
    response.partialReason ?? "unspecified",
  );
}

export function bitqueryMarketDataConfigured(
  token = process.env[BITQUERY_OAUTH_TOKEN_ENVIRONMENT_VARIABLE],
): boolean {
  return typeof token === "string" && token.trim().length >= 16;
}

export async function readBitqueryTokenMarketDataV1(
  identities: readonly MarketDataIdentityV1[],
  options: BitqueryReaderOptions = {},
): Promise<ReadonlyMap<string, TokenMarketDataV1>> {
  const now = options.now ?? new Date();
  const unique = canonicalMarketIdentities(identities);
  if (unique.length === 0) return new Map();
  if (
    process.env.NODE_ENV !== "test" &&
    options.fetchImpl === undefined &&
    options.token === undefined &&
    options.now === undefined &&
    options.includeStats === undefined
  ) {
    const entries = await readDurablyCachedBitqueryMarketData(
      JSON.stringify(unique),
    );
    return ageCachedTokenMarketData(new Map(entries), now);
  }
  return readBitqueryTokenMarketDataUncachedV1(unique, options, now);
}

/**
 * Reads Bitquery directly for public surfaces that deliberately have no
 * provider or cache fallback. Provider, schema and integrity failures reject
 * the whole read; an otherwise valid market with no trades remains a normal
 * `waiting-for-first-trade` result.
 */
export async function readBitqueryTokenMarketDataStrictV1(
  identities: readonly MarketDataIdentityV1[],
  options: BitqueryReaderOptions = {},
): Promise<ReadonlyMap<string, TokenMarketDataV1>> {
  const now = options.now ?? new Date();
  const unique = canonicalMarketIdentities(identities);
  if (unique.length === 0) return new Map();
  const token = resolveToken(options.token);
  if (token === null) {
    throw new BitqueryMarketDataError(
      "configuration",
      "configuration",
      "missing-token",
    );
  }
  const pools = new Map<string, MarketPoolDataV1>();
  const batches: MarketDataIdentityV1[][] = [];
  const batchSize = options.includeStats === false
    ? MARKET_LIST_BATCH_SIZE
    : MARKET_BATCH_SIZE;
  const batchConcurrency = options.includeStats === false
    ? MARKET_LIST_BATCH_CONCURRENCY
    : MARKET_BATCH_CONCURRENCY;
  for (let offset = 0; offset < unique.length; offset += batchSize) {
    batches.push(unique.slice(offset, offset + batchSize));
  }
  await mapWithConcurrency(batches, batchConcurrency, async (batch) => {
    const result = await readMarketBatch(batch, {
      ...options,
      token,
      now,
      strict: true,
    });
    for (const value of result) {
      if (value.status === "unavailable") {
        throw new BitqueryMarketDataError("integrity", "market-core");
      }
      pools.set(value.identity.poolId, value);
    }
  });
  return groupTokenMarketData(unique, pools, now);
}

/**
 * Reads only the bounded data needed to rank Explore entries by current FDV.
 *
 * Token price, supply and provider-computed FDV come from `Trading.Tokens`.
 * Pool liquidity comes from the realtime `EVM(network: eth)` dataset. The
 * token read is strict. A valid liquidity response without an exact pool row
 * fails closed for that valuation, while provider and malformed-response
 * failures reject with their exact taxonomy. This path never reads DEX trades,
 * statistics, caches or another provider.
 */
export async function readBitqueryTokenFdvRankingStrictV1(
  identities: readonly MarketDataIdentityV1[],
  options: BitqueryReaderOptions = {},
): Promise<ReadonlyMap<string, TokenMarketDataV1>> {
  const now = options.now ?? new Date();
  const unique = canonicalMarketIdentities(identities);
  if (unique.length === 0) return new Map();
  if (unique.length > MARKET_LIST_BATCH_SIZE) {
    throw new BitqueryMarketDataError("integrity", "market-core");
  }
  const token = resolveToken(options.token);
  if (token === null) {
    throw new BitqueryMarketDataError(
      "configuration",
      "configuration",
      "missing-token",
    );
  }

  const tokenRequest = marketFdvRankingQuery(unique);
  const liquidityRequest = marketLiquidityQuery(unique);
  const [tokenResult, liquidityResult] = await Promise.allSettled([
    executeBitqueryGraphql(
      tokenRequest.query,
      tokenRequest.variables,
      { ...options, token },
    ),
    executeBitqueryGraphql(
      liquidityRequest.query,
      liquidityRequest.variables,
      { ...options, token },
    ),
  ]);
  if (tokenResult.status === "rejected") {
    throw marketDataErrorAtPhase(tokenResult.reason, "market-core");
  }
  if (tokenResult.value.partial) {
    throw partialGraphqlResponseError(tokenResult.value, "market-core");
  }
  const trading = record(tokenResult.value.data.Trading);
  if (trading === null) {
    throw new BitqueryMarketDataError(
      "response",
      "market-core",
      "missing-trading",
    );
  }

  const expectedTokenAddresses = new Set(
    unique.map(({ tokenAddress }) => tokenAddress),
  );
  let tokenRows: ReadonlyMap<string, unknown>;
  try {
    tokenRows = indexUniqueRows(
      array(trading.rankingTokens),
      rankingTokenRowAddress,
    );
  } catch {
    throw new BitqueryMarketDataError("integrity", "market-core");
  }
  for (const tokenAddress of tokenRows.keys()) {
    if (!expectedTokenAddresses.has(tokenAddress as `0x${string}`)) {
      throw new BitqueryMarketDataError("integrity", "market-core");
    }
  }

  if (liquidityResult.status === "rejected") {
    throw marketDataErrorAtPhase(
      liquidityResult.reason,
      "market-liquidity",
    );
  }
  if (liquidityResult.value.partial) {
    throw partialGraphqlResponseError(
      liquidityResult.value,
      "market-liquidity",
    );
  }
  const evm = record(liquidityResult.value.data.EVM);
  if (evm === null) {
    throw new BitqueryMarketDataError(
      "response",
      "market-liquidity",
      "missing-evm",
    );
  }
  let liquidityRows: ReadonlyMap<string, unknown>;
  try {
    liquidityRows = indexUniqueRows(
      array(evm.latestLiquidity),
      liquidityRowPoolId,
    );
  } catch (error) {
    throw marketDataErrorAtPhase(error, "market-liquidity");
  }

  const pools = new Map<string, MarketPoolDataV1>();
  for (const identity of unique) {
    const tokenValue = parseFdvRankingToken(
      tokenRows.get(identity.tokenAddress),
      identity,
      now,
    );
    const liquidity = parseLiquidity(
      liquidityRows.get(identity.poolId),
      identity,
      now,
    );
    pools.set(
      identity.poolId,
      fdvRankingPoolData(identity, tokenValue, liquidity),
    );
  }
  return groupTokenMarketData(unique, pools, now);
}

async function readBitqueryTokenMarketDataUncachedV1(
  unique: readonly MarketDataIdentityV1[],
  options: BitqueryReaderOptions,
  now: Date,
): Promise<ReadonlyMap<string, TokenMarketDataV1>> {
  const token = resolveToken(options.token);
  const pools = new Map<string, MarketPoolDataV1>();

  if (token === null) {
    for (const identity of unique) {
      pools.set(identity.poolId, cachedOrUnavailable(identity, now));
    }
    return groupTokenMarketData(unique, pools, now);
  }

  const pending = unique.filter((identity) => {
    const cached = marketCache.get(marketCacheKey(identity));
    if (
      cached &&
      now.getTime() - cached.storedAt <= MARKET_CACHE_CURRENT_MAX_AGE_MS
    ) {
      pools.set(identity.poolId, cached.value);
      return false;
    }
    return true;
  });
  const batches: MarketDataIdentityV1[][] = [];
  for (let offset = 0; offset < pending.length; offset += MARKET_BATCH_SIZE) {
    batches.push(pending.slice(offset, offset + MARKET_BATCH_SIZE));
  }
  await mapWithConcurrency(batches, MARKET_BATCH_CONCURRENCY, async (batch) => {
    try {
      const result = await readMarketBatch(batch, {
        ...options,
        token,
        now,
      });
      for (const value of result) {
        const resolved = value.status === "unavailable"
          ? cachedOrUnavailable(value.identity, now)
          : value;
        pools.set(value.identity.poolId, resolved);
        if (resolved.status !== "unavailable") {
          marketCache.set(marketCacheKey(value.identity), {
            storedAt: now.getTime(),
            value: resolved,
          });
        }
      }
    } catch {
      for (const identity of batch) {
        pools.set(identity.poolId, cachedOrUnavailable(identity, now));
      }
    }
  });

  return groupTokenMarketData(unique, pools, now);
}

const readDurablyCachedBitqueryMarketData = unstable_cache(
  async (serializedIdentities: string) => {
    const parsed: unknown = JSON.parse(serializedIdentities);
    if (!Array.isArray(parsed)) throw new BitqueryMarketDataError("integrity");
    const identities = canonicalMarketIdentities(
      parsed as MarketDataIdentityV1[],
    );
    const now = new Date();
    const values = await readBitqueryTokenMarketDataUncachedV1(
      identities,
      {},
      now,
    );
    return [...values.entries()] as Array<[string, TokenMarketDataV1]>;
  },
  ["programmable-bitquery-market-data-v1"],
  { revalidate: DURABLE_MARKET_CACHE_SECONDS },
);

function ageCachedTokenMarketData(
  values: ReadonlyMap<string, TokenMarketDataV1>,
  now: Date,
): ReadonlyMap<string, TokenMarketDataV1> {
  const output = new Map<string, TokenMarketDataV1>();
  for (const [address, value] of values) {
    const pools = value.pools.map((pool): MarketPoolDataV1 => {
      const tradeAge = pool.asOfTime
        ? now.getTime() - Date.parse(pool.asOfTime)
        : null;
      const stale = tradeAge !== null && tradeAge > MARKET_DATA_CURRENT_MAX_AGE_MS;
      const valuation = pool.valuation.status === "available"
        ? {
            ...pool.valuation,
            freshness:
              now.getTime() - Date.parse(pool.valuation.asOfTime) >
                  MARKET_DATA_CURRENT_MAX_AGE_MS
                ? "stale" as const
                : "current" as const,
          }
        : pool.valuation;
      const liquidity = pool.liquidity
        ? {
            ...pool.liquidity,
            freshness:
              now.getTime() - Date.parse(pool.liquidity.asOfTime) >
                  MARKET_DATA_CURRENT_MAX_AGE_MS
                ? "stale" as const
                : "current" as const,
          }
        : undefined;
      return {
        ...pool,
        status: pool.status === "current" && stale ? "stale" : pool.status,
        quality:
          pool.quality === "complete" &&
              (stale ||
                (valuation.status === "available" &&
                  valuation.freshness === "stale") ||
                liquidity?.freshness === "stale")
            ? "partial"
            : pool.quality,
        valuation,
        ...(liquidity ? { liquidity } : {}),
      };
    });
    const primary = selectPrimaryMarketPoolV1(pools);
    const status = primary === null || primary.status === "unavailable"
      ? "unavailable" as const
      : primary.status === "waiting-for-first-trade"
        ? "waiting-for-first-trade" as const
        : primary.status === "stale"
          ? "stale" as const
          : pools.some((pool) => pool.quality !== "complete")
            ? "partial" as const
            : "current" as const;
    output.set(address, {
      ...value,
      status,
      pools,
    });
  }
  return output;
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  run: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        await run(values[index]);
      }
    },
  ));
}

export async function readBitqueryMarketChartV1(input: Readonly<{
  identity: MarketChartIdentityV1;
  range: "1h" | "1d" | "1w" | "all";
  historyStart?: string;
}> & BitqueryReaderOptions): Promise<MarketChartV1> {
  // Test readers and explicitly injected provider credentials retain the exact
  // direct-read contract. Public production reads use the Next Data Cache,
  // keyed by the already pool-bound identity and selected range.
  if (
    process.env.NODE_ENV !== "test" &&
    input.fetchImpl === undefined &&
    input.now === undefined &&
    input.token === undefined
  ) {
    const identity = canonicalMarketChartIdentity(input.identity);
    if (input.range === "all" && input.historyStart !== undefined) {
      return readDurablyCachedAllHistoryBitqueryMarketChartV1(
        identity,
        input.historyStart,
      );
    }
    if (input.range === "1w") {
      return readDurablyCachedWeeklyBitqueryMarketChartV1(identity);
    }
    if (input.range === "1h" || input.range === "1d") {
      return readDurablyCachedCurrentBitqueryMarketChartV1(
        identity,
        input.range,
      );
    }
  }
  return readBitqueryMarketChart(input, false);
}

/**
 * Reads chart data directly from Bitquery. It never reads or writes the
 * in-process chart cache and rejects provider, schema and integrity failures.
 */
export async function readBitqueryMarketChartStrictV1(input: Readonly<{
  identity: MarketChartIdentityV1;
  range: "1h" | "1d" | "1w" | "all";
  historyStart?: string;
}> & BitqueryReaderOptions): Promise<MarketChartV1> {
  return readBitqueryMarketChart(input, true);
}

async function readBitqueryMarketChart(
  input: Readonly<{
    identity: MarketChartIdentityV1;
    range: "1h" | "1d" | "1w" | "all";
    historyStart?: string;
  }> & BitqueryReaderOptions,
  strict: boolean,
): Promise<MarketChartV1> {
  const now = input.now ?? new Date();
  const identity = canonicalMarketChartIdentity(input.identity);
  const since = chartRangeStart(input.range, now, input.historyStart);
  if (since === null) throw new BitqueryMarketDataError("integrity");
  const cacheKey = chartCacheKey(
    identity,
    input.range,
    input.range === "all" ? since.toISOString() : null,
  );
  const token = resolveToken(input.token);
  if (token === null) {
    if (strict) throw new BitqueryMarketDataError("configuration");
    return cachedChartOrUnavailable(identity, input.range, cacheKey, now);
  }
  const currentCached = strict ? null : currentCachedChart(cacheKey, now);
  if (currentCached !== null) return currentCached;

  const chartController = new AbortController();
  const abortChartRead = () => chartController.abort();
  if (input.signal?.aborted) abortChartRead();
  input.signal?.addEventListener("abort", abortChartRead, { once: true });
  const chartTimeout = setTimeout(abortChartRead, CHART_READ_TIMEOUT_MS);
  try {
    const interval = chartInterval(input.range, since, now);
    const query = marketChartQuery(
      input.range,
      interval,
    );
    const variables: Record<string, unknown> = {
      poolId: identity.poolId,
      tokenAddress: identity.tokenAddress,
      quoteAddress: bitqueryCurrencyAddress(identity.quoteAddress),
      till: now.toISOString(),
      since: since.toISOString(),
    };
    const response = await executeBitqueryGraphql(query, variables, {
      ...input,
      token,
      signal: chartController.signal,
    });
    const evm = record(response.data.EVM);
    if (evm === null) {
      throw new BitqueryMarketDataError("response");
    }
    const rows = array(evm.chart);
    const points = rows.flatMap((row) => {
      const point = parseMarketChartPoint(
        row,
        identity,
        interval,
        since,
        now,
      );
      return point === null ? [] : [point];
    });
    if (points.length !== rows.length) {
      throw new BitqueryMarketDataError("integrity");
    }
    points.sort((first, second) => {
      const block = BigInt(first.blockNumber) - BigInt(second.blockNumber);
      if (block !== 0n) return block < 0n ? -1 : 1;
      return Date.parse(first.time) - Date.parse(second.time);
    });
    const totalRows = array(evm.chartTotal);
    if (totalRows.length !== 1) throw new BitqueryMarketDataError("response");
    const total = nonNegativeSafeInteger(record(totalRows[0])?.count);
    if (total === null) throw new BitqueryMarketDataError("integrity");
    const observed = points.reduce((sum, point) => {
      const next = sum + point.tradeCount;
      if (!Number.isSafeInteger(next)) {
        throw new BitqueryMarketDataError("integrity");
      }
      return next;
    }, 0);
    if (observed > total || (total > 0 && points.length === 0)) {
      throw new BitqueryMarketDataError("integrity");
    }
    if (total === 0) {
      if (response.partial || points.length > 0) {
        throw new BitqueryMarketDataError("response");
      }
      const waiting: MarketChartV1 = {
        schemaVersion: PROGRAMMABLE_MARKET_CHART_SCHEMA_VERSION,
        source: "bitquery",
        readStatus: "live",
        status: "waiting-for-first-trade",
        generatedAt: now.toISOString(),
        identity,
        range: input.range,
        points: [],
        swapCount: 0,
        valuation: {
          status: "unavailable",
          reason: "source-unavailable",
        },
        truncated: false,
      };
      if (!strict) {
        chartCache.set(cacheKey, { storedAt: now.getTime(), value: waiting });
      }
      return waiting;
    }

    const truncated = observed < total;
    const latest = points.at(-1) as MarketChartPointV1;
    const partial = truncated || response.partial;
    const status = partial
      ? "partial" as const
      : points.length === 1
        ? "insufficient-history" as const
        : "ready" as const;
    const chart: MarketChartV1 = {
      schemaVersion: PROGRAMMABLE_MARKET_CHART_SCHEMA_VERSION,
      source: "bitquery",
      readStatus: "live",
      status,
      generatedAt: now.toISOString(),
      identity,
      range: input.range,
      points,
      swapCount: observed,
      valuation: { status: "unavailable", reason: "source-unavailable" },
      asOfTime: latest.observedAt,
      truncated,
    };
    if (!isMarketChartV1(chart)) {
      throw new BitqueryMarketDataError("integrity");
    }
    if (!strict) {
      chartCache.set(cacheKey, { storedAt: now.getTime(), value: chart });
    }
    return chart;
  } catch (error) {
    if (strict) throw marketDataErrorAtPhase(error, "chart");
    return cachedChartOrUnavailable(identity, input.range, cacheKey, now);
  } finally {
    clearTimeout(chartTimeout);
    input.signal?.removeEventListener("abort", abortChartRead);
  }
}

// Keep only successful, provider-backed chart reads in the durable cache.
// A provider failure rejects this cache fill, allowing the public caller to
// preserve the existing in-process last-good fallback without persisting an
// unavailable response across regions.
const readDurablyCachedCurrentBitqueryMarketChartV1 = unstable_cache(
  async (
    identity: MarketChartIdentityV1,
    range: "1h" | "1d",
  ) => readBitqueryMarketChart({ identity, range }, true),
  ["programmable-bitquery-market-chart-current-v1"],
  { revalidate: DURABLE_CURRENT_CHART_CACHE_SECONDS },
);

const readDurablyCachedWeeklyBitqueryMarketChartV1 = unstable_cache(
  async (identity: MarketChartIdentityV1) => readBitqueryMarketChart({
    identity,
    range: "1w",
  }, true),
  ["programmable-bitquery-market-chart-week-v1"],
  { revalidate: DURABLE_WEEK_CHART_CACHE_SECONDS },
);

const readDurablyCachedAllHistoryBitqueryMarketChartV1 = unstable_cache(
  async (identity: MarketChartIdentityV1, historyStart: string) =>
    readBitqueryMarketChart({ identity, range: "all", historyStart }, true),
  ["programmable-bitquery-market-chart-all-v1"],
  { revalidate: DURABLE_ALL_HISTORY_CHART_CACHE_SECONDS },
);

export function clearBitqueryMarketDataCachesForTests(): void {
  marketCache.clear();
  chartCache.clear();
}

export function ingestBitqueryMarketStreamPayloadV1(input: Readonly<{
  identity: MarketDataIdentityV1;
  payload: Record<string, unknown>;
  now?: Date;
}>): MarketPoolDataV1 | null {
  const now = input.now ?? new Date();
  const identity = canonicalMarketIdentities([input.identity])[0];
  if (!identity) throw new BitqueryMarketDataError("integrity");
  const evm = record(input.payload.EVM);
  if (evm === null) throw new BitqueryMarketDataError("response");
  const tradeRows = array(evm.DEXTrades);
  const liquidityRows = array(evm.DEXPoolEvents);
  const parsedTrades = tradeRows.flatMap((row) => {
    const trade = parseTrade(row, identity);
    return trade === null ? [] : [trade];
  });
  if (parsedTrades.length !== tradeRows.length) {
    throw new BitqueryMarketDataError("integrity");
  }
  const latestTrade = canonicalTrades(parsedTrades).at(-1) ?? null;
  const parsedLiquidity = liquidityRows.flatMap((row) => {
    const liquidity = parseLiquidity(row, identity, now, latestTrade);
    return liquidity === null ? [] : [liquidity];
  });
  if (parsedLiquidity.length !== liquidityRows.length) {
    throw new BitqueryMarketDataError("integrity");
  }
  const latestLiquidity = parsedLiquidity.sort((first, second) => {
    const left = BigInt(first.asOfBlock);
    const right = BigInt(second.asOfBlock);
    return left === right ? 0 : left < right ? -1 : 1;
  }).at(-1) ?? null;
  const existing = marketCache.get(marketCacheKey(identity))?.value;
  if (latestTrade === null) {
    if (latestLiquidity === null) return null;
    if (!existing) return unavailablePool(identity, "source-unavailable");
    const value: MarketPoolDataV1 = {
      ...existing,
      liquidity: latestLiquidity,
      quality: "partial",
    };
    marketCache.set(marketCacheKey(identity), {
      storedAt: now.getTime(),
      value,
    });
    return value;
  }
  const value = marketPoolData({
    identity,
    latestTrade,
    tradeObserved: true,
    liquidity: latestLiquidity ?? existing?.liquidity ?? null,
    stats: {
      ...(existing?.volume24hUsdWad
        ? { volumeUsdWad: existing.volume24hUsdWad }
        : {}),
      ...(existing?.tradeCount24h !== undefined
        ? { tradeCount: existing.tradeCount24h }
        : {}),
    },
    supply: supplyFromValuation(existing?.valuation),
    now,
    partialResponse: true,
  });
  marketCache.set(marketCacheKey(identity), {
    storedAt: now.getTime(),
    value,
  });
  return value;
}

async function readMarketBatch(
  identities: readonly MarketDataIdentityV1[],
  options: BitqueryReaderOptions & Readonly<{
    token: string;
    now: Date;
    strict?: boolean;
  }>,
): Promise<readonly MarketPoolDataV1[]> {
  const coreRequest = marketBatchQuery(identities);
  const liquidityRequest = marketLiquidityQuery(identities);
  const coreRead = executeBitqueryGraphql(
    coreRequest.query,
    coreRequest.variables,
    options,
  );
  const liquidityRead = executeBitqueryGraphql(
    liquidityRequest.query,
    liquidityRequest.variables,
    options,
  );
  const statsRead: Promise<GraphqlResponse | null> = options.includeStats === false
    ? Promise.resolve(null)
    : (() => {
        const statsRequest = marketStatsQuery(identities);
        return executeBitqueryGraphql(
          statsRequest.query,
          statsRequest.variables,
          options,
        );
      })();
  const [coreResult, liquidityResult, statsResult] = await Promise.allSettled([
    coreRead,
    liquidityRead,
    statsRead,
  ]);
  if (coreResult.status === "rejected") {
    throw marketDataErrorAtPhase(coreResult.reason, "market-core");
  }
  const response = coreResult.value;
  if (options.strict && response.partial) {
    throw partialGraphqlResponseError(response, "market-core");
  }
  const evm = record(response.data.EVM);
  const trading = record(response.data.Trading);
  if (evm === null) {
    throw new BitqueryMarketDataError(
      "response",
      "market-core",
      "missing-evm",
    );
  }
  const tradesByPool = indexUniqueRows(array(evm.latestTrades), tradeRowPoolId);
  const parsedTrades = identities.map((identity) => {
    const row = tradesByPool.get(identity.poolId);
    return {
      row,
      trade: parseTrade(row, identity),
    };
  });
  const priceCandidates = parsedTrades.flatMap(({ trade }, index) =>
    trade && trade.priceUsdWad === undefined &&
        (trade.quoteAddress === NATIVE_ETH_ADDRESS ||
          trade.quoteAddress === WETH_ADDRESS)
      ? [{ index, trade }]
      : []
  );
  const [priceResult] = await Promise.allSettled([
    readIndexedPriceObservations(priceCandidates, options),
  ]);

  const indexedPricesByIndex = priceResult.status === "fulfilled"
    ? priceResult.value.observations
    : new Map<number, TokenPriceObservation | null>();
  const priceLookupWasPartial = priceResult.status !== "fulfilled" ||
    priceResult.value.partial;
  if (options.strict && priceResult.status === "rejected") {
    throw marketDataErrorAtPhase(priceResult.reason, "market-price");
  }
  if (
    options.strict && priceResult.status === "fulfilled" &&
    priceResult.value.partial
  ) {
    throw new BitqueryMarketDataError(
      "response",
      "market-price",
      "unspecified",
    );
  }
  const liquidityEvm = liquidityResult.status === "fulfilled" &&
      !liquidityResult.value.partial
    ? record(liquidityResult.value.data.EVM)
    : null;
  const statsEvm = statsResult.status === "fulfilled" && statsResult.value !== null
    ? record(statsResult.value.data.EVM)
    : null;
  if (
    options.strict && options.includeStats !== false &&
    statsResult.status === "rejected"
  ) throw marketDataErrorAtPhase(statsResult.reason, "market-stats");
  if (
    options.strict && options.includeStats !== false &&
    (statsEvm === null || statsResult.status !== "fulfilled" ||
      statsResult.value === null || statsResult.value.partial)
  ) {
    const reason = statsResult.status === "fulfilled" &&
        statsResult.value?.partialReason === "graphql-errors"
      ? "graphql-errors" as const
      : "missing-evm" as const;
    throw new BitqueryMarketDataError("response", "market-stats", reason);
  }

  let liquidityReadPartial = liquidityResult.status !== "fulfilled" ||
    liquidityResult.value.partial || liquidityEvm === null;
  let liquidityByPool: ReadonlyMap<string, unknown> = new Map();
  if (!liquidityReadPartial && liquidityEvm !== null) {
    try {
      liquidityByPool = indexUniqueRows(
        array(liquidityEvm.latestLiquidity),
        liquidityRowPoolId,
      );
    } catch {
      // Liquidity is eligibility evidence, not launch discovery. A malformed
      // optional row removes FDV eligibility without taking down the catalog.
      liquidityReadPartial = true;
    }
  }
  const statsByMarket = indexUniqueRows(
    array(statsEvm?.stats),
    (row) => {
      const trade = record(record(row)?.Trade);
      const poolId = canonicalBytes32(trade?.PoolId);
      const address = canonicalCurrencyAddress(
        record(trade?.Currency)?.SmartContract,
      );
      return poolId && address ? marketStatsKey(poolId, address) : null;
    },
  );
  const suppliesByAddress = new Map<string, unknown>();
  for (const row of array(trading?.tokenSupplies)) {
    const address = canonicalAddress(record(row)?.Token &&
      record(record(row)?.Token)?.Address);
    if (address !== null && !suppliesByAddress.has(address)) {
      suppliesByAddress.set(address, row);
    }
  }
  const parsed = identities.map((identity, index) => {
    const latestTradeRow = parsedTrades[index]?.row;
    const latestTradeRows = latestTradeRow === undefined
      ? []
      : [latestTradeRow];
    const parsedTrade = parsedTrades[index]?.trade ?? null;
    const indexedPrice = indexedPricesByIndex.get(index) ?? null;
    const latestTrade = parsedTrade === null
      ? null
      : enrichTradeWithIndexedUsd(
          parsedTrade,
          indexedPrice,
          options.now,
        );
    return {
      identity,
      latestTradeRows,
      latestTrade,
      liquidityPriceTrade: parsedTrade,
      liquidityRow: liquidityByPool.get(identity.poolId),
      stats: parseStats(statsByMarket.get(
        marketStatsKey(identity.poolId, identity.tokenAddress),
      )),
      supply: parseSupply(suppliesByAddress.get(identity.tokenAddress), identity),
    };
  });

  return parsed.map((value) => {
    const liquidity = parseLiquidity(
      value.liquidityRow,
      value.identity,
      options.now,
      value.liquidityPriceTrade,
    );
    return marketPoolData({
      identity: value.identity,
      latestTrade: value.latestTrade,
      tradeObserved: value.latestTradeRows.length > 0,
      liquidity,
      stats: value.stats,
      supply: value.supply,
      now: options.now,
      partialResponse:
        response.partial ||
        priceLookupWasPartial ||
        liquidityReadPartial ||
        (options.includeStats !== false &&
          (statsResult.status !== "fulfilled" ||
            statsResult.value === null || statsResult.value.partial)),
    });
  });
}

type IndexedPriceCandidate = Readonly<{
  index: number;
  trade: MarketTradeV1;
}>;

async function readIndexedPriceObservations(
  candidates: readonly IndexedPriceCandidate[],
  options: BitqueryReaderOptions & Readonly<{
    token: string;
    strict?: boolean;
  }>,
): Promise<Readonly<{
  observations: Map<number, TokenPriceObservation | null>;
  partial: boolean;
}>> {
  const observations = new Map<number, TokenPriceObservation | null>();
  const batches: IndexedPriceCandidate[][] = [];
  for (let offset = 0; offset < candidates.length; offset += INDEXED_PRICE_BATCH_SIZE) {
    batches.push(candidates.slice(offset, offset + INDEXED_PRICE_BATCH_SIZE));
  }
  let partial = false;
  await mapWithConcurrency(
    batches,
    INDEXED_PRICE_BATCH_CONCURRENCY,
    async (batch) => {
      try {
        const request = marketPriceQuery(batch.map(({ trade }) => trade));
        const response = await executeBitqueryGraphql(
          request.query,
          request.variables,
          options,
        );
        const trading = record(response.data.Trading);
        if (trading === null) {
          partial = true;
          return;
        }
        if (response.partial) partial = true;
        for (let index = 0; index < batch.length; index += 1) {
          const candidate = batch[index];
          const observation = parseNativeQuotePriceObservation(
            array(trading[`price${index}`])[0],
            candidate.trade,
          );
          if (observation !== null) {
            observations.set(candidate.index, observation);
          }
        }
      } catch (error) {
        if (options.strict) {
          throw marketDataErrorAtPhase(error, "market-price");
        }
        partial = true;
      }
    },
  );

  if (options.strict) {
    for (const { index } of candidates) {
      if (!observations.has(index)) observations.set(index, null);
    }
    return { observations, partial };
  }

  const missing = candidates.filter(
    ({ index }) => !observations.has(index),
  ).slice(0, MAXIMUM_INDEXED_PRICE_RECOVERIES_PER_BATCH);
  await mapWithConcurrency(
    missing,
    INDEXED_PRICE_RECOVERY_CONCURRENCY,
    async ({ index, trade }) => {
      try {
        const request = marketPriceQuery([trade]);
        const response = await executeBitqueryGraphql(
          request.query,
          request.variables,
          options,
        );
        const trading = record(response.data.Trading);
        observations.set(
          index,
          parseNativeQuotePriceObservation(
            array(trading?.price0)[0],
            trade,
          ),
        );
      } catch {
        observations.set(index, null);
      }
    },
  );
  return { observations, partial };
}

type TokenPriceObservation = Readonly<{
  time: string;
  priceUsdWad: string;
}>;

function parseNativeQuotePriceObservation(
  value: unknown,
  trade: MarketTradeV1,
): TokenPriceObservation | null {
  const row = record(value);
  const block = record(row?.Block);
  const token = record(row?.Token);
  const price = record(row?.Price);
  const ohlc = record(price?.Ohlc);
  const tokenId = nonEmptyString(token?.Id)?.toLowerCase();
  if (
    (trade.quoteAddress !== NATIVE_ETH_ADDRESS &&
      trade.quoteAddress !== WETH_ADDRESS) ||
    canonicalAddress(token?.Address) !== WETH_ADDRESS ||
    tokenId !== `bid:eth:${WETH_ADDRESS}` ||
    price?.IsQuotedInUsd !== true
  ) return null;
  const time = isoTime(block?.Time);
  const priceUsdWad = decimalToWad(ohlc?.Close);
  return time !== null && priceUsdWad !== null &&
      Date.parse(time) <= Date.parse(trade.time) &&
      Date.parse(trade.time) - Date.parse(time) <= INDEXED_PRICE_MAXIMUM_DISTANCE_MS
    ? { time, priceUsdWad: priceUsdWad.toString() }
    : null;
}

function enrichTradeWithIndexedUsd(
  trade: MarketTradeV1,
  indexed: TokenPriceObservation | null,
  now: Date,
): MarketTradeV1 {
  const indexedTime = indexed === null ? Number.NaN : Date.parse(indexed.time);
  const tradeTime = Date.parse(trade.time);
  const rawPrice = trade.rawPriceUsdWad === undefined
    ? null
    : BigInt(trade.rawPriceUsdWad);
  const indexedPrice = indexed === null ? null : BigInt(indexed.priceUsdWad);
  const quotePrice = trade.priceQuoteWad === undefined
    ? null
    : BigInt(trade.priceQuoteWad);
  const derivedPrice = quotePrice === null || indexedPrice === null
    ? null
    : quotePrice * indexedPrice / WAD;
  if (trade.priceUsdWad) return trade;
  if (
    indexed === null ||
    indexedPrice === null ||
    derivedPrice === null ||
    derivedPrice <= 0n ||
    !Number.isFinite(indexedTime) ||
    !Number.isFinite(tradeTime) ||
    indexedTime > now.getTime() + MAXIMUM_FUTURE_SKEW_MS ||
    Math.abs(indexedTime - tradeTime) > INDEXED_PRICE_MAXIMUM_DISTANCE_MS ||
    (rawPrice !== null && !usdPricesWithinConfidence(rawPrice, derivedPrice))
  ) return trade;
  const amountUsdWad = trade.tokenAmount
    ? multiplyWadByDecimal(derivedPrice, trade.tokenAmount)
    : null;
  return {
    ...trade,
    priceUsdWad: derivedPrice.toString(),
    priceUsdAsOfTime: indexed.time,
    priceUsdSource: MARKET_DATA_USD_PRICE_SOURCE,
    rawPriceUsdWad: rawPrice?.toString() ?? derivedPrice.toString(),
    ...(amountUsdWad === null ? {} : { amountUsdWad: amountUsdWad.toString() }),
  };
}

function usdPricesWithinConfidence(rawPrice: bigint, indexedPrice: bigint): boolean {
  if (rawPrice <= 0n || indexedPrice <= 0n) return false;
  const difference = rawPrice > indexedPrice
    ? rawPrice - indexedPrice
    : indexedPrice - rawPrice;
  return difference * 10_000n <=
    indexedPrice * BigInt(MARKET_DATA_MAXIMUM_RAW_INDEXED_PRICE_DEVIATION_BPS);
}

async function executeBitqueryGraphql(
  query: string,
  variables: Record<string, unknown>,
  options: BitqueryReaderOptions & Readonly<{ token: string }>,
): Promise<GraphqlResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const body = JSON.stringify({ query, variables });
    let response: Response;
    try {
      response = await fetchImpl(BITQUERY_HTTP_ENDPOINT, {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof TypeError
        ? error.message.trim().toLowerCase()
        : "";
      if (
        controller.signal.aborted ||
        message === "fetch failed" ||
        message === "failed to fetch" ||
        message === "load failed" ||
        message === "networkerror when attempting to fetch resource."
      ) {
        throw new BitqueryMarketDataError(
          "transport",
          "unspecified",
          "request-transport",
        );
      }
      throw error;
    }
    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? "configuration" as const
        : response.status === 408 || response.status === 425 ||
            response.status === 429 || response.status >= 500
          ? "transport" as const
          : "response" as const;
      throw new BitqueryMarketDataError(
        category,
        "unspecified",
        "http-status",
        response.status,
      );
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes(
      "application/json",
    )) {
      throw new BitqueryMarketDataError(
        "response",
        "unspecified",
        "invalid-content-type",
      );
    }
    let source: string;
    try {
      source = await readBoundedBitqueryResponseText(
        response,
        MAXIMUM_RESPONSE_BYTES,
      );
    } catch (error) {
      if (!(error instanceof BitqueryResponseBodyError)) throw error;
      if (error.kind === "too-large") {
        throw new BitqueryMarketDataError(
          "response",
          "unspecified",
          "body-too-large",
        );
      }
      if (error.kind === "invalid-body") {
        throw new BitqueryMarketDataError(
          "response",
          "unspecified",
          "invalid-json",
        );
      }
      throw new BitqueryMarketDataError(
        "transport",
        "unspecified",
        "request-transport",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(source);
    } catch {
      throw new BitqueryMarketDataError(
        "response",
        "unspecified",
        "invalid-json",
      );
    }
    const envelope = record(payload);
    const data = record(envelope?.data);
    const errors = array(envelope?.errors);
    if (data === null) {
      throw new BitqueryMarketDataError(
        "response",
        "unspecified",
        "missing-data",
      );
    }
    return {
      data,
      partial: errors.length > 0,
      ...(errors.length === 0 ? {} : { partialReason: "graphql-errors" }),
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

function indexUniqueRows(
  rows: readonly unknown[],
  keyFor: (row: unknown) => string | null,
): ReadonlyMap<string, unknown> {
  const indexed = new Map<string, unknown>();
  for (const row of rows) {
    const key = keyFor(row);
    if (key === null || indexed.has(key)) {
      throw new BitqueryMarketDataError("integrity");
    }
    indexed.set(key, row);
  }
  return indexed;
}

function tradeRowPoolId(row: unknown): `0x${string}` | null {
  return canonicalBytes32(record(record(row)?.Trade)?.PoolId);
}

function liquidityRowPoolId(row: unknown): `0x${string}` | null {
  const event = record(record(row)?.PoolEvent);
  return canonicalBytes32(record(event?.Pool)?.PoolId);
}

function marketStatsKey(
  poolId: `0x${string}`,
  tokenAddress: `0x${string}`,
): string {
  return `${poolId}:${tokenAddress}`;
}

function marketBatchQuery(identities: readonly MarketDataIdentityV1[]) {
  const pools = identities.map(({ poolId }) => poolId);
  const tokenAddresses = identities.map(({ tokenAddress }) => tokenAddress);
  const rowLimit = Math.max(1, identities.length);

  return {
    query: `query ProgrammableMarketSnapshot(
      $pools: [String!]!
      $tokenAddresses: [String!]!
    ) {
      EVM(network: eth, dataset: combined) {
        latestTrades: DEXTrades(
          limit: { count: ${rowLimit} }
          limitBy: { by: Trade_PoolId, count: 1 }
          orderBy: [
            { descending: Block_Number }
            { descending: Transaction_Index }
            { descending: Log_Index }
          ]
          where: {
            TransactionStatus: { Success: true }
            Trade: {
              Dex: { ProtocolName: { is: "uniswap_v4" } }
              PoolId: { in: $pools }
            }
          }
        ) { ${tradeSelection()} }
      }
      Trading {
        tokenSupplies: Tokens(
          limit: { count: ${rowLimit} }
          limitBy: { by: Token_Address, count: 1 }
          orderBy: { descending: Block_Time }
          where: { Token: { Address: { in: $tokenAddresses } } }
        ) { ${supplySelection()} }
      }
    }`,
    variables: { pools, tokenAddresses },
  };
}

function marketFdvRankingQuery(
  identities: readonly MarketDataIdentityV1[],
) {
  const tokenAddresses = [...new Set(
    identities.map(({ tokenAddress }) => tokenAddress),
  )].sort();
  const rowLimit = Math.max(1, tokenAddresses.length);
  return {
    query: `query ProgrammableExploreFdvRanking(
      $tokenAddresses: [String!]!
    ) {
      Trading {
        rankingTokens: Tokens(
          limit: { count: ${rowLimit} }
          limitBy: { by: Token_Id, count: 1 }
          orderBy: { descending: Block_Time }
          where: {
            Token: {
              Address: { in: $tokenAddresses }
              Network: { is: "Ethereum" }
            }
            Interval: { Time: { Duration: { eq: 1 } } }
            Price: { IsQuotedInUsd: true }
          }
        ) {
          Token { Id Address Network }
          Block { Time }
          Supply {
            TotalSupply
            FullyDilutedValuationUsd
          }
          Price { IsQuotedInUsd Ohlc { Close } }
        }
      }
    }`,
    variables: { tokenAddresses },
  };
}

function marketPriceQuery(trades: readonly MarketTradeV1[]) {
  // The legacy Trades filter `Token: { Id: { is: "bid:eth" } }` did not
  // provide a reliable USD observation. The Tokens price index requires the
  // full WETH token identity instead.
  const selections = trades.map((trade, index) => `
    price${index}: Tokens(
      limit: { count: 1 }
      orderBy: { descending: Block_Time }
      where: {
        Block: { Time: { till: "${trade.time}" } }
        Token: { Id: { is: "bid:eth:${WETH_ADDRESS}" } }
        Price: { IsQuotedInUsd: true }
      }
    ) {
      Block { Time }
      Token { Id Address }
      Price { IsQuotedInUsd Ohlc { Close } }
    }
  `).join("\n");
  return {
    query: `query ProgrammableMarketPrices {
      Trading { ${selections} }
    }`,
    variables: {},
  };
}

function marketLiquidityQuery(identities: readonly MarketDataIdentityV1[]) {
  const pools = identities.map(({ poolId }) => poolId);
  const rowLimit = Math.max(1, identities.length);
  return {
    query: `query ProgrammableMarketLiquidity($pools: [String!]!) {
      EVM(network: eth) {
        latestLiquidity: DEXPoolEvents(
          limit: { count: ${rowLimit} }
          limitBy: { by: PoolEvent_Pool_PoolId, count: 1 }
          orderBy: [
            { descending: Block_Number }
            { descending: Transaction_Index }
            { descending: Log_Index }
          ]
          where: {
            TransactionStatus: { Success: true }
            PoolEvent: {
              Dex: { ProtocolName: { is: "uniswap_v4" } }
              Pool: { PoolId: { in: $pools } }
            }
          }
        ) { ${liquiditySelection()} }
      }
    }`,
    variables: { pools },
  };
}

function marketStatsQuery(identities: readonly MarketDataIdentityV1[]) {
  const pools = identities.map(({ poolId }) => poolId);
  const tokenAddresses = [...new Set(
    identities.map(({ tokenAddress }) => tokenAddress),
  )].sort();
  const statsLimit = Math.max(1, identities.length * 2);
  return {
    query: `query ProgrammableMarketStats(
      $pools: [String!]!
      $tokenAddresses: [String!]!
    ) {
      EVM(network: eth, dataset: combined) {
        stats: DEXTradeByTokens(
          limit: { count: ${statsLimit} }
          where: {
            TransactionStatus: { Success: true }
            Block: { Time: { since_relative: { hours_ago: 24 } } }
            Trade: {
              Dex: { ProtocolName: { is: "uniswap_v4" } }
              PoolId: { in: $pools }
              Currency: { SmartContract: { in: $tokenAddresses } }
            }
          }
        ) {
          Trade { PoolId Currency { SmartContract } }
          count
          volumeUsd: sum(of: Trade_Side_AmountInUSD)
        }
      }
    }`,
    variables: { pools, tokenAddresses },
  };
}

function marketChartQuery(
  range: MarketChartV1["range"],
  interval: Readonly<{
    count: number;
    unit: "minutes" | "hours" | "days";
  }>,
) {
  const pointLimit = chartPointLimit(range);
  const definitions = [
    "$poolId: String!",
    "$tokenAddress: String!",
    "$quoteAddress: String!",
    "$till: DateTime!",
    "$since: DateTime!",
  ].join(", ");
  const blockFilter = "Block: { Time: { since: $since, till: $till } }";
  const where = `{
            TransactionStatus: { Success: true }
            ${blockFilter}
            Trade: {
              Dex: { ProtocolName: { is: "uniswap_v4" } }
              PoolId: { is: $poolId }
              Currency: { SmartContract: { is: $tokenAddress } }
              Side: { Currency: { SmartContract: { is: $quoteAddress } } }
            }
          }`;
  const dataset = range === "1h" ? "" : ", dataset: combined";
  return `query ProgrammableMarketChart(${definitions}) {
    EVM(network: eth${dataset}) {
      chart: DEXTradeByTokens(
        limit: { count: ${pointLimit} }
        orderBy: { descendingByField: "Block_Bucket" }
        where: ${where}
      ) {
        Block {
          Bucket: Time(interval: { count: ${interval.count}, in: ${interval.unit} })
          Number(maximum: Block_Number)
          Time(maximum: Block_Time)
        }
        Trade {
          PoolId
          Currency { SmartContract }
          Side { Currency { SmartContract Symbol } }
        }
        price: median(of: Trade_Price)
        count
      }
      chartTotal: DEXTradeByTokens(
        limit: { count: 1 }
        where: ${where}
      ) { count }
    }
  }`;
}

function chartInterval(
  range: MarketChartV1["range"],
  since: Date,
  now: Date,
): Readonly<{
  count: number;
  unit: "minutes" | "hours" | "days";
}> {
  if (range === "1h") return { count: 1, unit: "minutes" };
  if (range === "1d") return { count: 20, unit: "minutes" };
  if (range === "1w") return { count: 3, unit: "hours" };
  const duration = now.getTime() - since.getTime();
  const minimumBucketMs = Math.floor(
    duration / (chartPointLimit(range) - 1),
  ) + 1;
  if (minimumBucketMs <= 60 * 60 * 1_000) {
    return {
      count: Math.max(1, Math.ceil(minimumBucketMs / (60 * 1_000))),
      unit: "minutes",
    };
  }
  if (minimumBucketMs <= 24 * 60 * 60 * 1_000) {
    return {
      count: Math.ceil(minimumBucketMs / (60 * 60 * 1_000)),
      unit: "hours",
    };
  }
  return {
    count: Math.ceil(minimumBucketMs / (24 * 60 * 60 * 1_000)),
    unit: "days",
  };
}

function chartPointLimit(range: MarketChartV1["range"]): number {
  return range === "all"
    ? MAXIMUM_ALL_HISTORY_CHART_POINTS
    : MAXIMUM_CHART_POINTS;
}

function parseMarketChartPoint(
  value: unknown,
  identity: MarketChartIdentityV1,
  interval: Readonly<{
    count: number;
    unit: "minutes" | "hours" | "days";
  }>,
  since: Date,
  till: Date,
): MarketChartPointV1 | null {
  const row = record(value);
  const block = record(row?.Block);
  const trade = record(row?.Trade);
  const currency = record(trade?.Currency);
  const side = record(trade?.Side);
  const quoteCurrency = record(side?.Currency);
  const blockNumber = typeof block?.Number === "number" &&
      Number.isSafeInteger(block.Number)
    ? String(block.Number)
    : block?.Number;
  const bucket = isoTime(block?.Bucket);
  const observedAt = isoTime(block?.Time);
  const quoteAddress = canonicalCurrencyAddress(quoteCurrency?.SmartContract);
  const quoteSymbol = nonEmptyString(quoteCurrency?.Symbol);
  const price = positiveDecimal(row?.price);
  const tradeCount = nonNegativeSafeInteger(row?.count);
  if (
    !row ||
    !block ||
    !trade ||
    !currency ||
    !side ||
    !quoteCurrency ||
    canonicalBytes32(trade.PoolId) !== identity.poolId ||
    canonicalAddress(currency.SmartContract) !== identity.tokenAddress ||
    quoteAddress !== identity.quoteAddress ||
    quoteSymbol === null ||
    !canonicalUnsignedInteger(blockNumber) ||
    bucket === null ||
    observedAt === null ||
    price === null ||
    tradeCount === null ||
    tradeCount === 0
  ) return null;
  const providerBucketStart = Date.parse(bucket);
  const bucketStartMs = Math.max(providerBucketStart, since.getTime());
  const bucketEndMs = Math.min(
    providerBucketStart + chartIntervalDurationMs(interval),
    till.getTime(),
  );
  const observedAtMs = Date.parse(observedAt);
  if (
    bucketStartMs >= bucketEndMs ||
    observedAtMs < bucketStartMs ||
    observedAtMs > bucketEndMs
  ) return null;
  const bucketStart = new Date(bucketStartMs).toISOString();
  const bucketEnd = new Date(bucketEndMs).toISOString();
  return {
    blockNumber: String(blockNumber),
    time: bucketEnd,
    bucketStart,
    bucketEnd,
    observedAt,
    valueSemantics: "period-median",
    priceQuote: price,
    quoteSymbol,
    tradeCount,
  };
}

function chartIntervalDurationMs(interval: Readonly<{
  count: number;
  unit: "minutes" | "hours" | "days";
}>): number {
  const unitMs = interval.unit === "minutes"
    ? 60 * 1_000
    : interval.unit === "hours"
      ? 60 * 60 * 1_000
      : 24 * 60 * 60 * 1_000;
  return interval.count * unitMs;
}

function tradeSelection() {
  return `
    Block { Number Time }
    Log { Index }
    Trade {
      PoolId
      Buy { Currency { SmartContract Symbol } Amount AmountInUSD Price PriceInUSD }
      Sell { Currency { SmartContract Symbol } Amount AmountInUSD Price PriceInUSD }
    }
    Transaction { Hash Index }
  `;
}

function liquiditySelection() {
  return `
    Block { Number Time }
    Log { Index }
    Transaction { Hash Index }
    PoolEvent {
      Pool {
        PoolId
        CurrencyA { SmartContract Symbol }
        CurrencyB { SmartContract Symbol }
      }
      Liquidity {
        AmountCurrencyA
        AmountCurrencyAInUSD
        AmountCurrencyB
        AmountCurrencyBInUSD
      }
    }
  `;
}

function supplySelection() {
  return `
    Token { Id Address }
    Block { Time }
    Supply {
      TotalSupply
      CirculatingSupply
      MaxSupply
    }
    Price {
      IsQuotedInUsd
      Ohlc { Close }
    }
  `;
}

function parseTrade(
  value: unknown,
  identity: MarketDataIdentityV1,
): MarketTradeV1 | null {
  const row = record(value);
  const block = record(row?.Block);
  const log = record(row?.Log);
  const trade = record(row?.Trade);
  const transaction = record(row?.Transaction);
  const transactionHash = canonicalTransactionHash(transaction?.Hash);
  const transactionIndex = nonNegativeSafeInteger(transaction?.Index);
  if (
    !row ||
    !block ||
    !log ||
    !trade ||
    !transaction ||
    canonicalBytes32(trade.PoolId) !== identity.poolId ||
    !canonicalUnsignedInteger(block.Number) ||
    nonNegativeSafeInteger(log.Index) === null ||
    transactionIndex === null ||
    transactionHash === null
  ) return null;
  const time = isoTime(block.Time);
  if (time === null) return null;
  const buy = record(trade.Buy);
  const sell = record(trade.Sell);
  const buyCurrency = record(buy?.Currency);
  const sellCurrency = record(sell?.Currency);
  const buyAddress = canonicalAddress(buyCurrency?.SmartContract);
  const sellAddress = canonicalAddress(sellCurrency?.SmartContract);
  const tokenIsBuy = buyAddress === identity.tokenAddress;
  const tokenIsSell = sellAddress === identity.tokenAddress;
  if (tokenIsBuy === tokenIsSell) return null;
  const tokenSide = tokenIsBuy ? "buy" as const : "sell" as const;
  const token = tokenIsBuy ? buy : sell;
  const quote = tokenIsBuy ? sell : buy;
  const quoteCurrency = tokenIsBuy ? sellCurrency : buyCurrency;
  const tokenAmount = positiveDecimal(token?.Amount);
  const rawPriceUsdWad = decimalToWad(token?.PriceInUSD);
  const priceQuoteWad = decimalToWad(token?.Price);
  const quoteAddress = canonicalCurrencyAddress(quoteCurrency?.SmartContract);
  const quoteSymbol = nonEmptyString(quoteCurrency?.Symbol);
  const quotePriceUsdWad = decimalToWad(quote?.PriceInUSD);
  const sameTradePriceUsdWad =
    (quoteAddress === NATIVE_ETH_ADDRESS || quoteAddress === WETH_ADDRESS) &&
      priceQuoteWad !== null && quotePriceUsdWad !== null
      ? priceQuoteWad * quotePriceUsdWad / WAD
      : null;
  const verifiedSameTradePriceUsdWad = sameTradePriceUsdWad !== null &&
      sameTradePriceUsdWad > 0n &&
      (rawPriceUsdWad === null ||
        usdPricesWithinConfidence(rawPriceUsdWad, sameTradePriceUsdWad))
    ? sameTradePriceUsdWad
    : null;
  const amountUsdWad = verifiedSameTradePriceUsdWad !== null && tokenAmount
    ? multiplyWadByDecimal(verifiedSameTradePriceUsdWad, tokenAmount)
    : null;
  if (rawPriceUsdWad === null && priceQuoteWad === null) return null;
  return {
    transactionHash,
    transactionIndex,
    logIndex: Number(log.Index),
    blockNumber: String(block.Number),
    time,
    tokenSide,
    ...(tokenAmount === null ? {} : { tokenAmount }),
    ...(rawPriceUsdWad === null
      ? verifiedSameTradePriceUsdWad === null
        ? {}
        : { rawPriceUsdWad: verifiedSameTradePriceUsdWad.toString() }
      : { rawPriceUsdWad: rawPriceUsdWad.toString() }),
    ...(verifiedSameTradePriceUsdWad === null
      ? {}
      : {
          priceUsdWad: verifiedSameTradePriceUsdWad.toString(),
          priceUsdAsOfTime: time,
          priceUsdSource: MARKET_DATA_USD_PRICE_SOURCE,
        }),
    ...(amountUsdWad === null ? {} : { amountUsdWad: amountUsdWad.toString() }),
    ...(priceQuoteWad === null
      ? {}
      : { priceQuoteWad: priceQuoteWad.toString() }),
    ...(quoteAddress === null ? {} : { quoteAddress }),
    ...(quoteSymbol === null ? {} : { quoteSymbol }),
  };
}

function parseLiquidity(
  value: unknown,
  identity: MarketDataIdentityV1,
  now: Date,
  sameEventTrade: MarketTradeV1 | null = null,
): MarketLiquidityV1 | null {
  const row = record(value);
  const block = record(row?.Block);
  const log = record(row?.Log);
  const transaction = record(row?.Transaction);
  const event = record(row?.PoolEvent);
  const pool = record(event?.Pool);
  const liquidity = record(event?.Liquidity);
  const eventTransactionHash = canonicalTransactionHash(transaction?.Hash);
  const eventTransactionIndex = nonNegativeSafeInteger(transaction?.Index);
  const eventLogIndex = nonNegativeSafeInteger(log?.Index);
  if (
    !block ||
    !log ||
    !transaction ||
    !event ||
    !pool ||
    !liquidity ||
    canonicalBytes32(pool.PoolId) !== identity.poolId ||
    !canonicalUnsignedInteger(block.Number) ||
    eventTransactionHash === null ||
    eventTransactionIndex === null ||
    eventLogIndex === null
  ) return null;
  const time = isoTime(block.Time);
  const currencyA = record(pool.CurrencyA);
  const currencyB = record(pool.CurrencyB);
  const eventBlockNumber = String(block.Number);
  const addressA = canonicalCurrencyAddress(currencyA?.SmartContract);
  const addressB = canonicalCurrencyAddress(currencyB?.SmartContract);
  const tokenIsA = addressA === identity.tokenAddress;
  const tokenIsB = addressB === identity.tokenAddress;
  if (tokenIsA === tokenIsB) return null;
  const quoteAddress = tokenIsA ? addressB : addressA;
  if (
    quoteAddress === null ||
    (sameEventTrade?.quoteAddress !== undefined &&
      sameEventTrade.quoteAddress !== quoteAddress)
  ) return null;
  const amountA = decimalString(liquidity.AmountCurrencyA);
  const amountB = decimalString(liquidity.AmountCurrencyB);
  const amountAInUsd = liquidity.AmountCurrencyAInUSD;
  const amountBInUsd = liquidity.AmountCurrencyBInUSD;
  const observedA = liquidityUsdWad(
    amountAInUsd,
    amountA,
  );
  const observedB = liquidityUsdWad(
    amountBInUsd,
    amountB,
  );
  if (
    (amountAInUsd !== undefined && amountAInUsd !== null && observedA === null) ||
    (amountBInUsd !== undefined && amountBInUsd !== null && observedB === null)
  ) return null;
  const tradePrice = sameEventTrade?.priceUsdWad
    ? BigInt(sameEventTrade.priceUsdWad)
    : null;
  const tradeQuotePrice = sameEventTrade?.priceQuoteWad
    ? BigInt(sameEventTrade.priceQuoteWad)
    : null;
  const first = observedA ?? deriveLiquiditySideUsd({
    address: addressA,
    amount: amountA,
    identity,
    eventTime: time,
    eventBlockNumber,
    eventTransactionHash,
    eventTransactionIndex,
    eventLogIndex,
    tokenPriceUsdWad: tradePrice,
    tokenPriceTime: sameEventTrade?.priceUsdAsOfTime,
    tokenPriceBlockNumber: sameEventTrade?.blockNumber,
    tokenPriceTransactionHash: sameEventTrade?.transactionHash,
    tokenPriceTransactionIndex: sameEventTrade?.transactionIndex,
    tokenPriceLogIndex: sameEventTrade?.logIndex,
    tokenPriceQuoteWad: tradeQuotePrice,
    quoteAddress: sameEventTrade?.quoteAddress,
  });
  const second = observedB ?? deriveLiquiditySideUsd({
    address: addressB,
    amount: amountB,
    identity,
    eventTime: time,
    eventBlockNumber,
    eventTransactionHash,
    eventTransactionIndex,
    eventLogIndex,
    tokenPriceUsdWad: tradePrice,
    tokenPriceTime: sameEventTrade?.priceUsdAsOfTime,
    tokenPriceBlockNumber: sameEventTrade?.blockNumber,
    tokenPriceTransactionHash: sameEventTrade?.transactionHash,
    tokenPriceTransactionIndex: sameEventTrade?.transactionIndex,
    tokenPriceLogIndex: sameEventTrade?.logIndex,
    tokenPriceQuoteWad: tradeQuotePrice,
    quoteAddress: sameEventTrade?.quoteAddress,
  });
  if (time === null || first === null || second === null) return null;
  const total = first + second;
  if (total <= 0n) return null;
  const age = now.getTime() - Date.parse(time);
  if (age < -MAXIMUM_FUTURE_SKEW_MS) return null;
  return {
    asOfTime: time,
    asOfBlock: eventBlockNumber,
    valueUsdWad: total.toString(),
    freshness: age > MARKET_DATA_CURRENT_MAX_AGE_MS ? "stale" : "current",
  };
}

function deriveLiquiditySideUsd(input: Readonly<{
  address: `0x${string}` | null;
  amount: string | null;
  identity: MarketDataIdentityV1;
  eventTime: string | null;
  eventBlockNumber: string;
  eventTransactionHash: `0x${string}`;
  eventTransactionIndex: number;
  eventLogIndex: number;
  tokenPriceUsdWad: bigint | null;
  tokenPriceTime?: string;
  tokenPriceBlockNumber?: string;
  tokenPriceTransactionHash?: `0x${string}`;
  tokenPriceTransactionIndex?: number;
  tokenPriceLogIndex?: number;
  tokenPriceQuoteWad: bigint | null;
  quoteAddress?: `0x${string}`;
}>): bigint | null {
  if (input.address === null || input.amount === null || input.eventTime === null) {
    return null;
  }
  if (/^0(?:\.0+)?$/u.test(input.amount)) return 0n;
  const priceIsEventBound = input.tokenPriceTime === input.eventTime &&
    input.tokenPriceBlockNumber === input.eventBlockNumber &&
    input.tokenPriceTransactionHash === input.eventTransactionHash &&
    input.tokenPriceTransactionIndex === input.eventTransactionIndex &&
    input.tokenPriceLogIndex === input.eventLogIndex;
  if (
    input.address === input.identity.tokenAddress &&
    input.tokenPriceUsdWad !== null &&
    priceIsEventBound
  ) {
    return multiplyWadByDecimal(input.tokenPriceUsdWad, input.amount);
  }
  if (
    input.address === input.quoteAddress &&
    (input.quoteAddress === NATIVE_ETH_ADDRESS ||
      input.quoteAddress === WETH_ADDRESS) &&
    input.tokenPriceUsdWad !== null &&
    input.tokenPriceQuoteWad !== null &&
    input.tokenPriceQuoteWad > 0n &&
    priceIsEventBound
  ) {
    const quotePriceUsdWad = input.tokenPriceUsdWad * WAD /
      input.tokenPriceQuoteWad;
    return quotePriceUsdWad > 0n
      ? multiplyWadByDecimal(quotePriceUsdWad, input.amount)
      : null;
  }
  return null;
}

function liquidityUsdWad(
  value: unknown,
  rawAmount: string | null,
): bigint | null {
  const normalized = decimalString(value);
  if (normalized === null || rawAmount === null) return null;
  const amountIsZero = /^0(?:\.0+)?$/u.test(rawAmount);
  const usdIsZero = /^0(?:\.0+)?$/u.test(normalized);
  if (amountIsZero !== usdIsZero) return null;
  if (usdIsZero) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  const wad = BigInt(whole) * WAD +
    BigInt(fraction.slice(0, 18).padEnd(18, "0") || "0");
  return wad > 0n ? wad : null;
}

function parseStats(value: unknown): Readonly<{
  volumeUsdWad?: string;
  tradeCount?: number;
}> {
  const row = record(value);
  if (!row) return {};
  const volume = decimalToWad(row.volumeUsd);
  const count = nonNegativeSafeInteger(row.count);
  return {
    ...(volume === null ? {} : { volumeUsdWad: volume.toString() }),
    ...(count === null ? {} : { tradeCount: count }),
  };
}

type ParsedSupply = Readonly<{
  asOfTime: string;
  totalSupply?: string;
  circulatingSupply?: string;
  maxSupply?: string;
}> | null;

function parseFdvRankingToken(
  value: unknown,
  identity: MarketDataIdentityV1,
  now: Date,
): BitqueryFdvRankingParseResult {
  if (value === undefined) {
    return { reason: "source-unavailable" };
  }
  const row = record(value);
  const token = record(row?.Token);
  const block = record(row?.Block);
  const supply = record(row?.Supply);
  const price = record(row?.Price);
  const ohlc = record(price?.Ohlc);
  if (!row || !token || !block || !supply || !price || !ohlc) {
    return { reason: "source-unavailable" };
  }
  const address = canonicalAddress(token.Address);
  const id = nonEmptyString(token.Id)?.toLowerCase();
  if (
    address !== identity.tokenAddress ||
    token.Network !== "Ethereum" ||
    (id !== ethereumTokenId(identity.tokenAddress) &&
      id !== bidEthereumTokenId(identity.tokenAddress))
  ) {
    return { reason: "inconsistent-market-data" };
  }
  const asOfTime = isoTime(block.Time);
  const totalSupply = positiveDecimal(supply.TotalSupply);
  const maxSupply = positiveDecimal(supply.MaxSupply);
  const priceUsdWad = price.IsQuotedInUsd === true
    ? decimalToWad(ohlc.Close)
    : null;
  const fdvUsdWad = decimalToWad(supply.FullyDilutedValuationUsd);
  if (asOfTime === null) return { reason: "inconsistent-market-data" };
  if (priceUsdWad === null) return { reason: "price-unavailable" };
  if (totalSupply === null || fdvUsdWad === null) {
    return { reason: "supply-unavailable" };
  }
  if (
    maxSupply !== null && comparePositiveDecimals(totalSupply, maxSupply) > 0
  ) {
    return { reason: "inconsistent-market-data" };
  }
  const computedFdvUsdWad = multiplyWadByDecimal(priceUsdWad, totalSupply);
  if (
    computedFdvUsdWad === null ||
    !usdPricesWithinConfidence(fdvUsdWad, computedFdvUsdWad)
  ) {
    return { reason: "inconsistent-market-data" };
  }
  const age = now.getTime() - Date.parse(asOfTime);
  if (age < -MAXIMUM_FUTURE_SKEW_MS) {
    return { reason: "inconsistent-market-data" };
  }
  return {
    observation: {
      asOfTime,
      priceUsdWad: priceUsdWad.toString(),
      fdvUsdWad: fdvUsdWad.toString(),
      totalSupply,
      ...(maxSupply === null ? {} : { maxSupply }),
      freshness: age > MARKET_DATA_CURRENT_MAX_AGE_MS ? "stale" : "current",
    },
  };
}

function fdvRankingPoolData(
  identity: MarketDataIdentityV1,
  tokenValue: BitqueryFdvRankingParseResult,
  liquidity: MarketLiquidityV1 | null,
): MarketPoolDataV1 {
  if (tokenValue.observation === undefined) {
    return unavailablePool(identity, tokenValue.reason);
  }
  const observation = tokenValue.observation;
  const status = observation.freshness === "current" &&
      liquidity?.freshness !== "stale"
    ? "current" as const
    : "stale" as const;
  if (liquidity === null) {
    return {
      identity,
      source: "bitquery",
      status,
      quality: "partial",
      asOfTime: observation.asOfTime,
      valuation: { status: "unavailable", reason: "source-unavailable" },
    };
  }
  if (
    observation.freshness !== "current" ||
    liquidity.freshness !== "current"
  ) {
    return {
      identity,
      source: "bitquery",
      status: "stale",
      quality: "partial",
      asOfTime: new Date(Math.min(
        Date.parse(observation.asOfTime),
        Date.parse(liquidity.asOfTime),
      )).toISOString(),
      liquidity,
      valuation: { status: "unavailable", reason: "source-unavailable" },
    };
  }
  if (
    BigInt(liquidity.valueUsdWad) <
      BigInt(MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD)
  ) {
    return {
      identity,
      source: "bitquery",
      status: "current",
      quality: "partial",
      asOfTime: observation.asOfTime,
      liquidity,
      valuation: {
        status: "unavailable",
        reason: "inconsistent-market-data",
      },
    };
  }
  const asOfTime = new Date(Math.min(
    Date.parse(observation.asOfTime),
    Date.parse(liquidity.asOfTime),
  )).toISOString();
  return {
    identity,
    source: "bitquery",
    status: "current",
    quality: "complete",
    asOfTime,
    liquidity,
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      valueUsdWad: observation.fdvUsdWad,
      fdvUsdWad: observation.fdvUsdWad,
      totalSupply: observation.totalSupply,
      ...(observation.maxSupply === undefined
        ? {}
        : { maxSupply: observation.maxSupply }),
      asOfTime,
      freshness: "current",
    },
  };
}

function parseSupply(
  value: unknown,
  identity: MarketDataIdentityV1,
): ParsedSupply {
  const row = record(value);
  const token = record(row?.Token);
  const block = record(row?.Block);
  const supply = record(row?.Supply);
  if (!token || !block || !supply) return null;
  const address = canonicalAddress(token.Address);
  const id = nonEmptyString(token.Id)?.toLowerCase();
  if (
    address !== identity.tokenAddress ||
    (id !== `eth:${identity.tokenAddress}` &&
      id !== `bid:eth:${identity.tokenAddress}`)
  ) return null;
  const asOfTime = isoTime(block.Time);
  if (asOfTime === null) return null;
  const totalSupply = positiveDecimal(supply.TotalSupply);
  const circulatingSupply = positiveDecimal(supply.CirculatingSupply);
  const maxSupply = positiveDecimal(supply.MaxSupply);
  return {
    asOfTime,
    ...(totalSupply === null ? {} : { totalSupply }),
    ...(circulatingSupply === null ? {} : { circulatingSupply }),
    ...(maxSupply === null ? {} : { maxSupply }),
  };
}

function marketPoolData(input: Readonly<{
  identity: MarketDataIdentityV1;
  latestTrade: MarketTradeV1 | null;
  tradeObserved: boolean;
  liquidity: MarketLiquidityV1 | null;
  stats: Readonly<{ volumeUsdWad?: string; tradeCount?: number }>;
  supply: ParsedSupply;
  now: Date;
  partialResponse: boolean;
}>): MarketPoolDataV1 {
  if (input.latestTrade === null) {
    if (input.tradeObserved || input.partialResponse) {
      return unavailablePool(
        input.identity,
        input.tradeObserved
          ? "inconsistent-market-data"
          : "source-unavailable",
      );
    }
    return {
      identity: input.identity,
      source: "bitquery",
      status: "waiting-for-first-trade",
      quality: input.partialResponse ? "partial" : "complete",
      ...(input.liquidity === null ? {} : { liquidity: input.liquidity }),
      valuation: {
        status: "unavailable",
        reason: "waiting-for-first-trade",
      },
    };
  }
  const age = input.now.getTime() - Date.parse(input.latestTrade.time);
  if (age < -MAXIMUM_FUTURE_SKEW_MS) {
    return unavailablePool(input.identity, "inconsistent-market-data");
  }
  const status = age > MARKET_DATA_CURRENT_MAX_AGE_MS
    ? "stale" as const
    : "current" as const;
  const sourceValuation = valuationFrom(
    input.latestTrade,
    input.supply,
    input.now,
  );
  const liquidityValue = input.liquidity === null
    ? null
    : BigInt(input.liquidity.valueUsdWad);
  const valuation = sourceValuation.status === "available" &&
      liquidityValue === null
    ? { status: "unavailable" as const, reason: "source-unavailable" as const }
    : sourceValuation.status === "available" &&
      liquidityValue !== null &&
      liquidityValue < BigInt(MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD)
    ? { status: "unavailable" as const, reason: "inconsistent-market-data" as const }
    : sourceValuation.status === "available" && input.liquidity !== null
      ? {
          ...sourceValuation,
          asOfTime: new Date(Math.min(
            Date.parse(sourceValuation.asOfTime),
            Date.parse(input.latestTrade.time),
            Date.parse(input.liquidity.asOfTime),
          )).toISOString(),
          freshness: status === "current" &&
              sourceValuation.freshness === "current" &&
              input.liquidity.freshness === "current"
            ? "current" as const
            : "stale" as const,
        }
      : sourceValuation;
  const quality = input.partialResponse ||
    input.liquidity === null ||
    input.liquidity.freshness === "stale" ||
    input.stats.volumeUsdWad === undefined ||
    input.stats.tradeCount === undefined ||
    valuation.status === "unavailable" ||
    valuation.freshness === "stale"
      ? "partial" as const
      : "complete" as const;
  return {
    identity: input.identity,
    source: "bitquery",
    status,
    quality,
    asOfTime: input.latestTrade.time,
    latestTrade: input.latestTrade,
    ...(input.liquidity === null ? {} : { liquidity: input.liquidity }),
    ...(input.stats.volumeUsdWad === undefined
      ? {}
      : { volume24hUsdWad: input.stats.volumeUsdWad }),
    ...(input.stats.tradeCount === undefined
      ? {}
      : { tradeCount24h: input.stats.tradeCount }),
    valuation,
  };
}

function valuationFrom(
  trade: MarketTradeV1,
  supply: ParsedSupply,
  now: Date,
): MarketValuationV1 {
  if (
    !trade.priceUsdWad ||
    !trade.priceUsdAsOfTime ||
    trade.priceUsdSource !== MARKET_DATA_USD_PRICE_SOURCE ||
    !trade.rawPriceUsdWad
  ) {
    return { status: "unavailable", reason: "price-unavailable" };
  }
  if (!supply) {
    return { status: "unavailable", reason: "supply-unavailable" };
  }
  const tradeTime = Date.parse(trade.time);
  const priceTime = Date.parse(trade.priceUsdAsOfTime);
  const supplyTime = Date.parse(supply.asOfTime);
  const priceUsdWad = BigInt(trade.priceUsdWad);
  const rawPriceUsdWad = BigInt(trade.rawPriceUsdWad);
  if (
    !Number.isFinite(tradeTime) ||
    !Number.isFinite(priceTime) ||
    !Number.isFinite(supplyTime) ||
    Math.abs(tradeTime - priceTime) > INDEXED_PRICE_MAXIMUM_DISTANCE_MS ||
    Math.abs(priceTime - supplyTime) > SUPPLY_PRICE_MAXIMUM_DISTANCE_MS ||
    !usdPricesWithinConfidence(rawPriceUsdWad, priceUsdWad) ||
    tradeTime > now.getTime() + MAXIMUM_FUTURE_SKEW_MS ||
    priceTime > now.getTime() + MAXIMUM_FUTURE_SKEW_MS ||
    supplyTime > now.getTime() + MAXIMUM_FUTURE_SKEW_MS
  ) {
    return { status: "unavailable", reason: "inconsistent-market-data" };
  }
  const total = supply.totalSupply
    ? multiplyWadByDecimal(priceUsdWad, supply.totalSupply)
    : null;
  if (
    supply.maxSupply &&
    supply.totalSupply &&
    comparePositiveDecimals(supply.totalSupply, supply.maxSupply) > 0
  ) {
    return { status: "unavailable", reason: "inconsistent-market-data" };
  }
  const valuationTime = Math.min(tradeTime, priceTime, supplyTime);
  const asOfTime = new Date(valuationTime).toISOString();
  const freshness = now.getTime() - valuationTime > MARKET_DATA_CURRENT_MAX_AGE_MS
    ? "stale" as const
    : "current" as const;
  if (total !== null && supply.totalSupply) {
    return {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      valueUsdWad: total.toString(),
      fdvUsdWad: total.toString(),
      totalSupply: supply.totalSupply,
      ...(supply.maxSupply ? { maxSupply: supply.maxSupply } : {}),
      asOfTime,
      freshness,
    };
  }
  return { status: "unavailable", reason: "supply-unavailable" };
}

function supplyFromValuation(
  value: MarketValuationV1 | undefined,
): ParsedSupply {
  if (!value || value.status !== "available") return null;
  return {
    asOfTime: value.asOfTime,
    ...(value.totalSupply ? { totalSupply: value.totalSupply } : {}),
    ...(value.circulatingSupply
      ? { circulatingSupply: value.circulatingSupply }
      : {}),
    ...(value.maxSupply ? { maxSupply: value.maxSupply } : {}),
  };
}

function groupTokenMarketData(
  identities: readonly MarketDataIdentityV1[],
  pools: ReadonlyMap<string, MarketPoolDataV1>,
  now: Date,
): ReadonlyMap<string, TokenMarketDataV1> {
  const grouped = new Map<string, MarketPoolDataV1[]>();
  for (const identity of identities) {
    const value = pools.get(identity.poolId) ?? unavailablePool(
      identity,
      "source-unavailable",
    );
    const existing = grouped.get(identity.tokenAddress) ?? [];
    existing.push(value);
    grouped.set(identity.tokenAddress, existing);
  }
  const output = new Map<string, TokenMarketDataV1>();
  for (const [address, values] of grouped) {
    const primary = selectPrimaryMarketPoolV1(values);
    const status = primary === null || primary.status === "unavailable"
      ? "unavailable" as const
      : primary.status === "waiting-for-first-trade"
        ? "waiting-for-first-trade" as const
        : primary.status === "stale"
          ? "stale" as const
          : values.some((value) => value.quality !== "complete")
            ? "partial" as const
            : "current" as const;
    output.set(address, {
      schemaVersion: PROGRAMMABLE_MARKET_DATA_SCHEMA_VERSION,
      source: "bitquery",
      generatedAt: now.toISOString(),
      status,
      primaryPoolId: primary?.identity.poolId ?? null,
      pools: values,
    });
  }
  return output;
}

function canonicalMarketIdentities(
  identities: readonly MarketDataIdentityV1[],
): MarketDataIdentityV1[] {
  const byPool = new Map<string, MarketDataIdentityV1>();
  for (const identity of identities) {
    const tokenAddress = canonicalAddress(identity.tokenAddress);
    const poolId = canonicalBytes32(identity.poolId);
    if (
      identity.chainId !== "1" ||
      identity.protocol !== "uniswap_v4" ||
      tokenAddress === null ||
      poolId === null
    ) throw new BitqueryMarketDataError("integrity");
    const normalized = {
      chainId: "1" as const,
      tokenAddress,
      poolId,
      protocol: "uniswap_v4" as const,
    };
    const existing = byPool.get(poolId);
    if (existing && existing.tokenAddress !== tokenAddress) {
      throw new BitqueryMarketDataError("integrity");
    }
    byPool.set(poolId, normalized);
  }
  return [...byPool.values()].sort((a, b) => a.poolId.localeCompare(b.poolId));
}

function unavailablePool(
  identity: MarketDataIdentityV1,
  reason: Extract<MarketValuationV1, { status: "unavailable" }>["reason"],
): MarketPoolDataV1 {
  return {
    identity,
    source: "bitquery",
    status: "unavailable",
    quality: "unavailable",
    valuation: { status: "unavailable", reason },
  };
}

function cachedOrUnavailable(
  identity: MarketDataIdentityV1,
  now: Date,
): MarketPoolDataV1 {
  const cached = marketCache.get(marketCacheKey(identity));
  if (!cached || now.getTime() - cached.storedAt > MARKET_CACHE_MAX_AGE_MS) {
    return unavailablePool(identity, "source-unavailable");
  }
  if (cached.value.status === "waiting-for-first-trade") {
    return {
      ...cached.value,
      status: "unavailable",
      quality: "partial",
      valuation: { status: "unavailable", reason: "source-unavailable" },
    };
  }
  return {
    ...cached.value,
    status: "stale",
    quality: "partial",
    valuation: cached.value.valuation.status === "available"
      ? { ...cached.value.valuation, freshness: "stale" }
      : cached.value.valuation,
  };
}

function cachedChartOrUnavailable(
  identity: MarketChartIdentityV1,
  range: MarketChartV1["range"],
  key: string,
  now: Date,
): MarketChartV1 {
  const cached = chartCache.get(key);
  if (cached && now.getTime() - cached.storedAt <= CHART_CACHE_MAX_AGE_MS) {
    if (cached.value.points.length === 0) {
      return {
        ...cached.value,
        readStatus: "cache-fallback",
        status: "unavailable",
        valuation: { status: "unavailable", reason: "source-unavailable" },
      };
    }
    return {
      ...cached.value,
      readStatus: "cache-fallback",
      status: "partial",
      valuation: { status: "unavailable", reason: "source-unavailable" },
    };
  }
  return {
    schemaVersion: PROGRAMMABLE_MARKET_CHART_SCHEMA_VERSION,
    source: "bitquery",
    readStatus: "cache-fallback",
    status: "unavailable",
    generatedAt: now.toISOString(),
    identity,
    range,
    points: [],
    swapCount: 0,
    valuation: { status: "unavailable", reason: "source-unavailable" },
    truncated: false,
  };
}

function currentCachedChart(
  key: string,
  now: Date,
): MarketChartV1 | null {
  const cached = chartCache.get(key);
  if (
    !cached ||
    cached.value.points.length === 0 ||
    now.getTime() - cached.storedAt > CHART_CACHE_CURRENT_MAX_AGE_MS
  ) {
    return null;
  }
  return cached.value;
}

function chartCacheKey(
  identity: MarketChartIdentityV1,
  range: MarketChartV1["range"],
  historyStart: string | null,
): string {
  return `${marketCacheKey(identity)}:${identity.quoteAddress}:${range}:${historyStart ?? "bounded"}`;
}

function canonicalMarketChartIdentity(
  identity: MarketChartIdentityV1,
): MarketChartIdentityV1 {
  const tokenAddress = canonicalAddress(identity.tokenAddress);
  const quoteAddress = canonicalCurrencyAddress(identity.quoteAddress);
  const poolId = canonicalBytes32(identity.poolId);
  if (
    identity.chainId !== "1" ||
    identity.protocol !== "uniswap_v4" ||
    tokenAddress === null ||
    quoteAddress === null ||
    quoteAddress === tokenAddress ||
    poolId === null
  ) throw new BitqueryMarketDataError("integrity");
  return {
    chainId: "1",
    tokenAddress,
    quoteAddress,
    poolId,
    protocol: "uniswap_v4",
  };
}

function bitqueryCurrencyAddress(value: `0x${string}`): string {
  return value === NATIVE_ETH_ADDRESS ? "0x" : value;
}

function chartRangeStart(
  range: MarketChartV1["range"],
  now: Date,
  historyStart: string | undefined,
): Date | null {
  const duration = range === "1h"
    ? 60 * 60 * 1_000
    : range === "1d"
      ? 24 * 60 * 60 * 1_000
      : range === "1w"
        ? 7 * 24 * 60 * 60 * 1_000
        : null;
  if (duration !== null) return new Date(now.getTime() - duration);
  const parsed = historyStart === undefined ? Number.NaN : Date.parse(historyStart);
  return Number.isFinite(parsed) && parsed <= now.getTime()
    ? new Date(parsed)
    : null;
}

function canonicalTrades(trades: readonly MarketTradeV1[]): MarketTradeV1[] {
  const sorted = [...trades].sort((first, second) => {
    const block = BigInt(first.blockNumber) - BigInt(second.blockNumber);
    if (block !== 0n) return block < 0n ? -1 : 1;
    const firstTransaction = first.transactionIndex ?? -1;
    const secondTransaction = second.transactionIndex ?? -1;
    const transaction = firstTransaction - secondTransaction;
    if (transaction !== 0) return transaction;
    const log = first.logIndex - second.logIndex;
    return log !== 0
      ? log
      : first.transactionHash.localeCompare(second.transactionHash);
  });
  const byKey = new Map<string, MarketTradeV1>();
  for (const trade of sorted) {
    const key = [
      trade.blockNumber,
      trade.transactionHash,
      trade.logIndex,
    ].join(":");
    byKey.set(key, trade);
  }
  return [...byKey.values()];
}

function marketCacheKey(identity: MarketDataIdentityV1): string {
  return `${identity.chainId}:${identity.tokenAddress}:${identity.poolId}`;
}

function resolveToken(explicit: string | null | undefined): string | null {
  const value = explicit === undefined
    ? process.env[BITQUERY_OAUTH_TOKEN_ENVIRONMENT_VARIABLE]
    : explicit;
  return typeof value === "string" && value.trim().length >= 16
    ? value.trim()
    : null;
}

function ethereumTokenId(address: `0x${string}`): string {
  return `eth:${address}`;
}

function bidEthereumTokenId(address: `0x${string}`): string {
  return `bid:eth:${address}`;
}

function rankingTokenRowAddress(value: unknown): `0x${string}` | null {
  const token = record(record(value)?.Token);
  const address = canonicalAddress(token?.Address);
  const id = nonEmptyString(token?.Id)?.toLowerCase();
  return address !== null && token?.Network === "Ethereum" &&
      (id === ethereumTokenId(address) || id === bidEthereumTokenId(address))
    ? address
    : null;
}

function canonicalAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS.test(normalized) ? normalized as `0x${string}` : null;
}

function canonicalCurrencyAddress(value: unknown): `0x${string}` | null {
  if (value === "0x") return "0x0000000000000000000000000000000000000000";
  return canonicalAddress(value);
}

function canonicalBytes32(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return BYTES32.test(normalized) ? normalized as `0x${string}` : null;
}

function canonicalTransactionHash(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return TRANSACTION_HASH.test(normalized)
    ? normalized as `0x${string}`
    : null;
}

function canonicalUnsignedInteger(value: unknown): value is string {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;
  return typeof normalized === "string" &&
    CANONICAL_UNSIGNED_INTEGER.test(normalized);
}

function positiveDecimal(value: unknown): string | null {
  const normalized = decimalString(value);
  return normalized !== null && !/^0(?:\.0+)?$/u.test(normalized)
    ? normalized
    : null;
}

function decimalString(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const expanded = value.toLocaleString("en-US", {
      useGrouping: false,
      maximumFractionDigits: 20,
    });
    return /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(expanded)
      ? expanded
      : null;
  }
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)
  ) return null;
  return value;
}

function decimalToWad(value: unknown): bigint | null {
  const normalized = positiveDecimal(value);
  if (normalized === null) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const wad = BigInt(whole) * 10n ** 18n +
    BigInt(fraction.slice(0, 18).padEnd(18, "0") || "0");
  return wad > 0n ? wad : null;
}

function decimalParts(value: string): Readonly<{
  coefficient: bigint;
  scale: bigint;
}> {
  const [whole, fraction = ""] = value.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: 10n ** BigInt(fraction.length),
  };
}

function multiplyWadByDecimal(wad: bigint, value: string): bigint | null {
  const parsed = decimalParts(value);
  const result = wad * parsed.coefficient / parsed.scale;
  return result > 0n ? result : null;
}

function comparePositiveDecimals(first: string, second: string): number {
  const a = decimalParts(first);
  const b = decimalParts(second);
  const comparison = a.coefficient * b.scale - b.coefficient * a.scale;
  return comparison === 0n ? 0 : comparison > 0n ? 1 : -1;
}

function isoTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  const normalized = typeof value === "string" && /^\d+$/u.test(value)
    ? Number(value)
    : value;
  return typeof normalized === "number" &&
    Number.isSafeInteger(normalized) &&
    normalized >= 0
    ? normalized
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
