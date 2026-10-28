import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCodexBars } from "@/lib/market/codex";
const cacheMock = vi.hoisted(() => ({ calls: [] as unknown[][], value: undefined as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
  cacheMock.calls.push(args); return cacheMock.value ?? fn(...args);
} }));
let readCodexChart: typeof import("@/lib/server/codex-market").readCodexChart;
let readCodexMarkets: typeof import("@/lib/server/codex-market").readCodexMarkets;
let codexQuery: typeof import("@/lib/server/codex-market").codexQuery;
const address = `0x${"ab".repeat(20)}`, poolId = `0x${"ef".repeat(32)}`;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers({ now: new Date("2026-10-03T09:30:00Z") });
  cacheMock.calls.length = 0;
  cacheMock.value = undefined;
  ({ readCodexChart, readCodexMarkets, codexQuery } = await import("@/lib/server/codex-market"));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const bars = (overrides = {}) => ({ token: { address, networkId: 4663 }, s: "ok", t: [100, 160, 220], c: [.001, null, .002], ...overrides });
const pool = (overrides = {}) => ({ address: poolId, networkId: 4663, token0: `0x${"00".repeat(20)}`, token1: address, ...overrides });
const row = () => ({ token: { address, networkId: 4663 }, priceUSD: "0.001", marketCap: "1000000", circulatingMarketCap: "500000", liquidity: "215595", totalLiquidityUsd: "2027259", volume24: "0", change24: "-0.05" });

describe("Codex provider backoff", () => {
  it("coalesces the same upstream query across independent consumers", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn(async () => Response.json({ data: { value: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const results = await Promise.all(Array.from({ length: 30 }, () => codexQuery("query Shared { value }", {})));
    expect(results).toHaveLength(30);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 402, 403, 429])("shares HTTP %i account backoff across distinct queries and recovers after it", async status => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ errors: [{ message: "private billing response" }] }, { status }))
      .mockImplementation(async () => Response.json({ data: { recovered: true }, errors: [] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(codexQuery("query First { value }", {})).rejects.toThrow("Market data unavailable");
    await expect(codexQuery("query Different { value }", {})).rejects.toThrow("Market data unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 600_001);
    await expect(codexQuery("query Different { value }", {})).resolves.toEqual({ recovered: true });
  });

  it("honors a provider capacity retry window even when HTTP is successful", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ errors: [{ extensions: { code: "OVER_CAPACITY", retryAfterSeconds: 45 } }] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(codexQuery("query First { value }", {})).rejects.toThrow();
    vi.setSystemTime(Date.now() + 44_000);
    await expect(codexQuery("query Second { value }", {})).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Codex price history", () => {
  it("recovers an expired shared cache through one coalesced provider read", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const now = Math.floor(Date.now() / 1000);
    cacheMock.value = { tokenAddress: address, chainId: 4663, range: "1D", source: "codex",
      observedAt: new Date(Date.now() - 180_001).toISOString(), points: [{ time: (now - 600) * 1000, price: .001 }] };
    const fetcher = vi.fn(async () => Response.json({ data: { getTokenBars: bars({ t: [now - 60, now], c: [.001, .002] }) } }));
    vi.stubGlobal("fetch", fetcher);
    const values = await Promise.all([readCodexChart(address, 4663, "1D"), readCodexChart(address, 4663, "1D")]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(values[0].observedAt).toBe(new Date(Date.now()).toISOString());
    expect(values[0].points.at(-1)?.time).toBe(now * 1000);
    expect(values[1]).toEqual(values[0]);
  });
  it("does not relabel expired history as fresh when its recovery read fails", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    cacheMock.value = { tokenAddress: address, chainId: 4663, range: "1D", source: "codex",
      observedAt: new Date(Date.now() - 180_001).toISOString(), points: [] };
    const fetcher = vi.fn().mockRejectedValue(new Error("private provider response"));
    vi.stubGlobal("fetch", fetcher);
    await expect(readCodexChart(address, 4663, "1D")).rejects.toThrow("Market data unavailable");
    await expect(readCodexChart(address, 4663, "1D")).rejects.toThrow("Market data unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps a stable shared-cache identity across refresh windows", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { getTokenBars: bars({
      t: [Math.floor(Date.now() / 1000) - 60], c: [.001],
    }) } })));
    await readCodexChart(address, 4663, "1D");
    vi.setSystemTime(Date.now() + 60_000);
    await readCodexChart(address, 4663, "1D");
    expect(cacheMock.calls).toEqual([[address, 4663, "1D"], [address, 4663, "1D"]]);
  });
  it("does not show unknown circulating supply as zero market cap when the provider has a total-supply valuation", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { filterTokens: { results: [{ ...row(), circulatingMarketCap: "0" }] }, filterPairs: { results: [] } } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await readCodexMarkets([{ tokenAddress: address, poolId }])).get(address))
      .toMatchObject({ marketCapUsd: null, fdvUsd: 1_000_000, valuationKind: "fdv" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves candle times and gaps, with no invented prices", () => {
    expect(parseCodexBars(bars(), address, 4663, 100, 220)).toEqual([{ time: 100_000, price: .001 }, { time: 220_000, price: .002 }]);
    expect(parseCodexBars(bars({ s: "no_data", t: [], c: [] }), address, 4663, 100, 220)).toEqual([]);
    expect(parseCodexBars(bars({ token: { address: address.toUpperCase(), networkId: 4663 } }), address, 4663, 100, 220)).toHaveLength(2);
  });
  it.each([
    { token: { address, networkId: 1 } }, { token: { address: `0x${"cd".repeat(20)}`, networkId: 4663 } },
    { t: [100, 100, 160] }, { t: [100, 160, 221] }, { c: [1] }, { c: [0, 1, 2] }, { c: [1, NaN, 2] }, { s: "error" },
  ])("rejects a mismatched or corrupt history: %j", overrides => {
    expect(() => parseCodexBars(bars(overrides), address, 4663, 100, 220)).toThrow();
  });
});

describe("Codex server market adapter", () => {
  it("reuses missing market observations across page and coin reads, then refreshes them", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: {
      filterTokens: { results: [] }, filterPairs: { results: [] },
    } })).mockImplementation(async () => Response.json({ data: {
      filterTokens: { results: [row()] }, filterPairs: { results: [] },
    } }));
    vi.stubGlobal("fetch", fetcher);
    const tokens = [{ tokenAddress: address, poolId },
      { tokenAddress: `0x${"cd".repeat(20)}`, poolId: `0x${"12".repeat(32)}` }];
    expect((await readCodexMarkets(tokens)).size).toBe(0);
    for (let index = 0; index < 20; index++) {
      expect((await readCodexMarkets(tokens.slice(0, 1))).size).toBe(0);
      expect((await readCodexMarkets(tokens)).size).toBe(0);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 900_001);
    expect((await readCodexMarkets(tokens)).has(address)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("reuses exact-pool catalog observations on single-coin pages without extending their age", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const other = { tokenAddress: `0x${"cd".repeat(20)}`, poolId: `0x${"12".repeat(32)}` };
    const fetcher = vi.fn(async (_url, request) => Response.json({ data: {
      filterTokens: { results: JSON.parse(request.body).variables.tokens.map((id: string) =>
        ({ ...row(), token: { address: id.split(":")[0], networkId: 4663 } })) }, filterPairs: { results: [] },
    } }));
    vi.stubGlobal("fetch", fetcher);
    const catalog = await readCodexMarkets([{ tokenAddress: address, poolId }, other]);
    const observedAt = catalog.get(address)!.observedAt;
    Reflect.set(catalog.get(address)!, "priceUsd", 42);
    vi.setSystemTime(Date.now() + 20_000);
    expect((await readCodexMarkets([{ tokenAddress: address, poolId }])).get(address))
      .toMatchObject({ priceUsd: .001, observedAt });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 880_001);
    await readCodexMarkets([{ tokenAddress: address, poolId }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shares pending identities between overlapping catalog and coin requests", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const fetcher = vi.fn(async () => { await gate; return Response.json({ data: {
      filterTokens: { results: [row()] }, filterPairs: { results: [] },
    } }); });
    vi.stubGlobal("fetch", fetcher);
    const catalog = readCodexMarkets([{ tokenAddress: address, poolId },
      { tokenAddress: `0x${"cd".repeat(20)}`, poolId: `0x${"12".repeat(32)}` }]);
    const coin = readCodexMarkets([{ tokenAddress: address, poolId }]);
    finish();
    const results = await Promise.all([catalog, coin]);
    expect(results.every(result => result.has(address))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps cached observations separate for each chain and pool", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn(async (_url, request) => {
      const chainId = Number(JSON.parse(request.body).variables.tokens[0].split(":")[1]);
      return Response.json({ data: { filterTokens: { results: [{ ...row(), token: { address, networkId: chainId } }] }, filterPairs: { results: [] } } });
    });
    vi.stubGlobal("fetch", fetcher);
    await readCodexMarkets([{ tokenAddress: address, poolId }], 4663);
    await readCodexMarkets([{ tokenAddress: address, poolId }], 1);
    await readCodexMarkets([{ tokenAddress: address, poolId }], 8453);
    await readCodexMarkets([{ tokenAddress: address, poolId: `0x${"12".repeat(32)}` }], 4663);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([4663, 1, 8453])("reads the paired ticker in the existing batch on chain %s", async chainId => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const quote = `0x${"cd".repeat(20)}`;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: {
      filterTokens: { results: [{ ...row(), token: { address, networkId: chainId } }] },
      filterPairs: { results: [{ liquidity: "12", pair: pool({ networkId: chainId, token0: quote,
        token0Data: { address: quote, networkId: chainId, symbol: "PAIR" },
        token1Data: { address, networkId: chainId, symbol: "BASE" } }) }] },
    } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await readCodexMarkets([{ tokenAddress: address, poolId }], chainId)).get(address)?.quoteAsset)
      .toEqual({ address: quote, symbol: "PAIR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).query).toContain("token0Data { address networkId symbol }");
  });
  it.each([
    { address, networkId: 4663, symbol: "WRONG_TOKEN" },
    { address: pool().token0, networkId: 1, symbol: "WRONG_CHAIN" },
    { address: pool().token0, networkId: 4663, symbol: "spoof\u202e" },
  ])("ignores mismatched or unsafe paired metadata: %j", async token0Data => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: {
      filterTokens: { results: [row()] }, filterPairs: { results: [{ liquidity: "12", pair: pool({ token0Data }) }] },
    } })));
    expect((await readCodexMarkets([{ tokenAddress: address, poolId }])).get(address)?.quoteAsset)
      .toEqual({ address: pool().token0, symbol: null });
  });
  it("batches verified identities and distinguishes circulating cap from FDV", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { filterTokens: { results: [row()] }, filterPairs: { results: [{ liquidity: "172345", pair: pool() }] } } }));
    vi.stubGlobal("fetch", fetcher);
    const markets = await readCodexMarkets([{ tokenAddress: address, poolId }]);
    expect(markets.get(address)).toMatchObject({ poolId, source: "codex", marketCapUsd: 500000, fdvUsd: 1000000, liquidityUsd: 172345, volume24hUsd: 0, change24hPercent: -5 });
    expect(markets.get(address)?.quoteAsset).toEqual({ address: pool().token0, symbol: null });
    const request = fetcher.mock.calls[0][1];
    expect(JSON.parse(request.body).variables.tokens).toEqual([`${address}:4663`]);
    expect(JSON.parse(request.body).variables.pairs).toEqual([`${poolId}:4663`]);
    expect(request.headers.Authorization).toBe("test-private-key");
    expect(JSON.stringify([...markets.values()])).not.toContain("test-private-key");
  });
  it.each([
    { results: [] }, { results: [{ liquidity: "172345", pair: pool({ networkId: 1 }) }] },
    { results: [{ liquidity: "172345", pair: pool({ token1: `0x${"cd".repeat(20)}` }) }] },
    { results: [{ liquidity: "bad", pair: pool() }] },
  ])("does not replace missing or mismatched pool liquidity with aggregated balances: %j", async ({ results }) => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { filterTokens: { results: [row()] }, filterPairs: { results } } })));
    expect((await readCodexMarkets([{ tokenAddress: address, poolId }])).get(address)).toMatchObject({ liquidityUsd: null, priceUsd: .001 });
  });
  it("rejects conflicting canonical pools before sending a request", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readCodexMarkets([{ tokenAddress: address, poolId }, { tokenAddress: address, poolId: `0x${"cd".repeat(32)}` }])).rejects.toThrow("Ambiguous market identity");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("batches one hundred identities and coalesces simultaneous catalog reads", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const tokens = Array.from({ length: 105 }, (_, index) => ({ tokenAddress: `0x${index.toString(16).padStart(40, "0")}`, poolId: `0x${index.toString(16).padStart(64, "0")}` }));
    const fetcher = vi.fn(async (_url, request) => {
      const variables = JSON.parse(request.body).variables;
      return Response.json({ data: { filterTokens: { results: variables.tokens.map((id: string) => ({ token: { address: id.split(":")[0], networkId: 4663 }, priceUSD: "1" })) }, filterPairs: { results: [] } } });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await Promise.all([readCodexMarkets(tokens), readCodexMarkets(tokens)]);
    expect(result.every(markets => markets.size === 105)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds a cold catalog read instead of fanning out without a limit", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const tokens = Array.from({ length: 2_105 }, (_, index) => ({ tokenAddress: `0x${index.toString(16).padStart(40, "0")}`, poolId: `0x${index.toString(16).padStart(64, "0")}` }));
    const fetcher = vi.fn(async (_url, request) => {
      const variables = JSON.parse(request.body).variables;
      return Response.json({ data: { filterTokens: { results: variables.tokens.map((id: string) => ({ token: { address: id.split(":")[0], networkId: 4663 }, priceUSD: "1" })) }, filterPairs: { results: [] } } });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await readCodexMarkets(tokens);
    expect(fetcher).toHaveBeenCalledTimes(20);
    expect(result.size).toBe(2_000);
  });
  it("retains negative observations for a large catalog instead of rebilling unpriced tokens", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const tokens = Array.from({ length: 2_000 }, (_, index) => ({ tokenAddress: `0x${index.toString(16).padStart(40, "0")}`, poolId: `0x${index.toString(16).padStart(64, "0")}` }));
    const fetcher = vi.fn(async (_url, request) => {
      const variables = JSON.parse(request.body).variables;
      return Response.json({ data: { filterTokens: { results: [{ token: {
        address: variables.tokens[0].split(":")[0], networkId: 4663,
      }, priceUSD: "1" }] }, filterPairs: { results: [] } } });
    });
    vi.stubGlobal("fetch", fetcher);
    const first = await readCodexMarkets(tokens);
    for (let index = 0; index < 10; index++) expect(await readCodexMarkets(tokens)).toEqual(first);
    expect(first.size).toBe(20);
    expect(fetcher).toHaveBeenCalledTimes(20);
  });
  it("keeps an empty chart for two minutes before trying the provider again", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn(async () => Response.json({ data: { getTokenBars: bars({ s: "no_data", t: [], c: [] }) } }));
    vi.stubGlobal("fetch", fetcher);
    for (let index = 0; index < 12; index++) {
      expect((await readCodexChart(address, 4663, "1m")).points).toEqual([]);
      vi.setSystemTime(Date.now() + 10_000);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    await readCodexChart(address, 4663, "1m");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { body: { data: { filterTokens: { results: [{ ...row(), token: { address, networkId: 1 } }] } } } },
    { body: { data: { filterTokens: { results: [{ ...row(), token: { address: `0x${"cd".repeat(20)}`, networkId: 4663 } }] } } } },
    { body: { data: { filterTokens: { results: [row(), row()] } } } },
    { body: { errors: [{ message: "provider error" }] } },
  ])("does not enrich another network, unknown token, duplicate row or provider error: %j", async ({ body }) => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetcher);
    expect(await readCodexMarkets([{ tokenAddress: address, poolId }])).toEqual(new Map());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([4663, 1, 8453])("returns chart data for chain %s and rejects unknown periods before requesting", async chainId => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const now = Math.floor(Date.now() / 1000);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { getTokenBars: bars({ token: { address, networkId: chainId }, t: [now - 60, now], c: [.001, .002] }) } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await readCodexChart(address, chainId, "1H")).toMatchObject({ source: "codex", chainId, tokenAddress: address, points: [{ time: (now - 60) * 1000, price: .001 }, { time: now * 1000, price: .002 }] });
    // @ts-expect-error -- malformed public input must fail closed.
    await expect(readCodexChart(address, chainId, "unknown")).rejects.toThrow("Invalid chart request");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).variables.symbol).toBe(`${address}:${chainId}`);
  });
  it.each([10, 84532])("rejects unsupported network %s before requesting market data", async chainId => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(readCodexMarkets([{ tokenAddress: address, poolId }], chainId)).rejects.toThrow("Invalid market request");
    await expect(readCodexChart(address, chainId, "1D")).rejects.toThrow("Invalid chart request");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requests thirty minutes of one-minute candles and accepts a resolution-aligned leading candle", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const now = Math.floor(Date.now() / 1000);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { getTokenBars: bars({ t: [now - 1_860, now], c: [.001, .002] }) } }));
    vi.stubGlobal("fetch", fetcher);
    const values = await Promise.all([readCodexChart(address, 4663, "1m"), readCodexChart(address.toUpperCase(), 4663, "1m")]);
    expect(values[0].points).toHaveLength(2); expect(values[1]).toEqual(values[0]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toMatchObject({ from: now - 1_800, to: now, resolution: "1" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).query).not.toContain("countback");
  });
  it("backs off a failed provider request instead of repeatedly retrying it", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockRejectedValue(new Error("private provider response")); vi.stubGlobal("fetch", fetcher);
    for (let attempt = 0; attempt < 3; attempt++) await expect(readCodexChart(address, 4663, "1H")).rejects.toThrow("Market data unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 300_001);
    await expect(readCodexChart(address, 4663, "1H")).rejects.toThrow("Market data unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
