import { describe, expect, it, vi } from "vitest";
import { encodeFunctionResult, parseAbi, toFunctionSelector, toHex, type Address } from "viem";
import { readAnyQuoteUsdPriceV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { ANY_QUOTE_USDG, ANY_QUOTE_WETH } from "@/lib/module-engine/any-quote/types";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

vi.mock("server-only", () => ({}));
const now = 1_800_000_000n, hash = toHex(1, { size: 32 });
const feed = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);
function provider(quote: Address, answer = 2500n * 10n ** 8n, updatedAt = now - 100n, stamp = now, chainId: 1 | 4663 = 4663) {
  return vi.fn<TradeRpcV1>(async (method, params) => {
    if (method === "eth_chainId") return toHex(chainId);
    if (method === "eth_getBlockByNumber") return { number: params[0] === "latest" ? "0x8b" : params[0], hash, timestamp: toHex(stamp) };
    expect(params.at(-1)).toEqual({ blockHash: hash, requireCanonical: true });
    if (method === "eth_getCode") { expect(params[0]).toBe(quote); return "0x6001"; }
    if (method !== "eth_call") throw new Error(`Unexpected ${method}`);
    const call = params[0] as { to: Address; data: string };
    if (call.data === toFunctionSelector("decimals()")) return encodeFunctionResult({ abi: feed, functionName: "decimals", result: call.to === quote ? 18 : 8 });
    expect(call.to).toBe(chainId === 1 ? "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" : quote === ANY_QUOTE_WETH ? "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" : "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2");
    expect(call.data).toBe(toFunctionSelector("latestRoundData()"));
    return encodeFunctionResult({ abi: feed, functionName: "latestRoundData", result: [10n, answer, updatedAt, updatedAt, 10n] });
  });
}

describe("price-only quote references", () => {
  it("uses the Ethereum WETH oracle and a fresh Ethereum checkpoint without discovery calls", async () => {
    const quoteAsset = foundationChainProfile(1).wrappedEth.address;
    const a = provider(quoteAsset, 2500n * 10n ** 8n, now - 100n, now, 1), b = provider(quoteAsset, 2500n * 10n ** 8n, now - 100n, now, 1);
    const fetchImpl = vi.fn();
    const value = await readAnyQuoteUsdPriceV1({ quoteAsset }, { chainId: 1, rpcs: [a, b], now, fetchImpl });
    expect(value.chainId).toBe(1);
    expect(value.price).toMatchObject({ source: "chainlink", heartbeatSeconds: 7200, usd: { numerator: "2500", denominator: "1" } });
    expect(a).toHaveBeenCalledWith("eth_getBlockByNumber", ["0x89", false]);
    expect(fetchImpl).not.toHaveBeenCalled();
    const stale = provider(quoteAsset, 2500n, now - 7201n, now, 1);
    await expect(readAnyQuoteUsdPriceV1({ quoteAsset }, { chainId: 1, rpcs: [stale, stale], now })).rejects.toMatchObject({ code: "PRICE_FEED_UNAVAILABLE" });
  });

  it.each([1, 4663] as const)("uses launch valuation timing only for the explicit %i launch purpose", async chainId => {
    const quoteAsset = foundationChainProfile(chainId).wrappedEth.address;
    const a = provider(quoteAsset, 2500n * 10n ** 8n, now - 100n, now - 30n, chainId);
    const options = { chainId, rpcs: [a, a] as const, now };
    const trade = await readAnyQuoteUsdPriceV1({ quoteAsset }, options);
    const launch = await readAnyQuoteUsdPriceV1({ quoteAsset }, { ...options, pricePurpose: "module-launch" });
    expect(trade.price.validUntil).toBe(String(now + 45n));
    expect(launch.price.validUntil).toBe(String(now + (chainId === 1 ? 90n : 45n)));
    // The oracle's own expiry is never extended by the launch purpose.
    const almostExpired = provider(quoteAsset, 2500n * 10n ** 8n,
      now - (chainId === 1 ? 7200n : 86400n) + 5n, now - 30n, chainId);
    const fresh = await readAnyQuoteUsdPriceV1({ quoteAsset }, { ...options,
      rpcs: [almostExpired, almostExpired], pricePurpose: "module-launch" });
    expect(fresh.price.validUntil).toBe(String(now + 5n));
  });

  it("rejects a Robinhood provider pair for an Ethereum price before reading token or oracle data", async () => {
    const quoteAsset = foundationChainProfile(1).wrappedEth.address, wrong = provider(quoteAsset);
    await expect(readAnyQuoteUsdPriceV1({ quoteAsset }, { chainId: 1, rpcs: [wrong, wrong], now })).rejects.toMatchObject({ code: "PROVIDER_CHAIN_MISMATCH" });
    expect(wrong.mock.calls.every(([method]) => method === "eth_chainId")).toBe(true);
  });

  it.each([ANY_QUOTE_WETH, ANY_QUOTE_USDG])("reads %s without an engine release, AMM, routing key or HTTP request", async quoteAsset => {
    const a = provider(quoteAsset), b = provider(quoteAsset), fetchImpl = vi.fn();
    const value = await readAnyQuoteUsdPriceV1({ quoteAsset }, { rpcs: [a, b], now, fetchImpl });
    expect(value.quoteAsset).toBe(quoteAsset);
    expect(value.price).toMatchObject({ source: "chainlink", usd: { numerator: "2500", denominator: "1" }, validUntil: String(now + 45n) });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(a).toHaveBeenCalledTimes(b.mock.calls.length);
    expect(a.mock.calls.every(([method]) => ["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(method))).toBe(true);
  });

  it("does not replace missing, stale or future oracle prices with a default ETH amount", async () => {
    for (const [answer, updatedAt] of [[0n, now], [2500n, now - 86401n], [2500n, now + 1n]]) {
      await expect(readAnyQuoteUsdPriceV1({ quoteAsset: ANY_QUOTE_WETH }, {
        rpcs: [provider(ANY_QUOTE_WETH, answer, updatedAt), provider(ANY_QUOTE_WETH, answer, updatedAt)], now,
      })).rejects.toMatchObject({ code: "PRICE_FEED_UNAVAILABLE" });
    }
  });

  it("rejects provider disagreement and stale checkpoints", async () => {
    await expect(readAnyQuoteUsdPriceV1({ quoteAsset: ANY_QUOTE_WETH }, {
      rpcs: [provider(ANY_QUOTE_WETH, 100n), provider(ANY_QUOTE_WETH, 200n)], now,
    })).rejects.toMatchObject({ code: "TRADE_PROVIDER_DISAGREEMENT" });
    const stale = provider(ANY_QUOTE_WETH, 2500n, now, now - 61n);
    await expect(readAnyQuoteUsdPriceV1({ quoteAsset: ANY_QUOTE_WETH }, { rpcs: [stale, stale], now }))
      .rejects.toMatchObject({ code: "PROVIDER_CHECKPOINT_STALE" });
  });
});
