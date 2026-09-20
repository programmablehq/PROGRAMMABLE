import { describe, expect, it, vi } from "vitest";
import { encodeFunctionResult, parseAbi, toFunctionSelector, toHex, type Address } from "viem";
import { readAnyQuoteUsdPriceV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { ANY_QUOTE_USDG, ANY_QUOTE_WETH } from "@/lib/module-engine/any-quote/types";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

vi.mock("server-only", () => ({}));
const now = 1_800_000_000n, hash = toHex(1, { size: 32 });
const feed = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);
function provider(quote: Address, answer = 2500n * 10n ** 8n, updatedAt = now - 100n, stamp = now) {
  return vi.fn<TradeRpcV1>(async (method, params) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") return { number: params[0] === "latest" ? "0x8b" : "0x7b", hash, timestamp: toHex(stamp) };
    expect(params.at(-1)).toEqual({ blockHash: hash, requireCanonical: true });
    if (method === "eth_getCode") { expect(params[0]).toBe(quote); return "0x6001"; }
    if (method !== "eth_call") throw new Error(`Unexpected ${method}`);
    const call = params[0] as { to: Address; data: string };
    if (call.data === toFunctionSelector("decimals()")) return encodeFunctionResult({ abi: feed, functionName: "decimals", result: call.to === quote ? 18 : 8 });
    expect(call.to).toBe(quote === ANY_QUOTE_WETH ? "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" : "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2");
    expect(call.data).toBe(toFunctionSelector("latestRoundData()"));
    return encodeFunctionResult({ abi: feed, functionName: "latestRoundData", result: [10n, answer, updatedAt, updatedAt, 10n] });
  });
}

describe("price-only quote references", () => {
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
