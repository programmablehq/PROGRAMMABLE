import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, toHex } from "viem";
import { FoundationQuoteMarketError, readFoundationEthFunding } from "@/lib/server/module-foundation/eth-funding";
import { readFoundationStartPrice } from "@/lib/server/module-foundation/start-price";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import type { AnyQuoteUsdReferenceV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { anyQuotePoolIdV1 } from "@/lib/module-engine/any-quote/route";

const mocks = vi.hoisted(() => ({ assess: vi.fn(), price: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/module-engine/any-quote/readiness.server", () => ({ assessAnyQuoteAssetV1: mocks.assess, readAnyQuoteUsdPriceV1: mocks.price }));
const address = getAddress("0x1b54e762aa34cf6e28e9c082f2848e28e45da6b8");
const zero = getAddress("0x0000000000000000000000000000000000000000");
const hash = toHex(1, { size: 32 }), now = 1_800_000_000;
const quote = { address, decimals: 18, codeHash: hash };
const reference = (chainId: 1 | 4663): AnyQuoteUsdReferenceV1 => ({ chainId, quoteAsset: address, decimals: 18,
  checkpoint: { number: "123", hash, timestamp: String(now) },
  price: { usd: { numerator: "1", denominator: "1000" }, source: "qualified-amm", observedAt: String(now),
    validUntil: String(now + 45), heartbeatSeconds: 45, evidenceHash: hash } });

describe("one verified market for funding and launch valuation", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now * 1000); vi.resetAllMocks(); });
  afterEach(() => vi.useRealTimers());

  it.each([1, 4663] as const)("reuses the %i funding assessment without a second route request", async chainId => {
    const ref = reference(chainId), maximumEth = 10n ** 15n;
    const key = { currency0: zero, currency1: address, fee: 3000, tickSpacing: 60, hooks: zero };
    mocks.assess.mockResolvedValue({ status: "compatible", ...ref, token: { decimals: 18 }, routes: { buy: {
      chainId, tokenIn: foundationChainProfile(chainId).wrappedEth.address, tokenOut: address, validUntil: String(now + 45),
      amountIn: String(maximumEth), amountOut: "1000000", hops: [{ protocol: "V4", tokenIn: zero, tokenOut: address,
        key, poolId: anyQuotePoolIdV1(key), hookData: "0x" }],
    } } });
    const funding = await readFoundationEthFunding(address, maximumEth, chainId);
    const start = await readFoundationStartPrice(quote, chainId, funding.priceReference);
    expect(funding.quoteAmount).toBe(990000n);
    expect(start.price).toEqual(ref.price);
    expect(start.checkpoint).toEqual(ref.checkpoint);
    expect(mocks.assess).toHaveBeenCalledExactlyOnceWith({ quoteAsset: address, probeEthAmount: maximumEth }, { chainId, pricePurpose: "module-launch" });
    expect(mocks.price).not.toHaveBeenCalled();
  });

  it("still reads a fresh price when there is no funding assessment", async () => {
    mocks.price.mockResolvedValue(reference(1));
    await readFoundationStartPrice(quote, 1);
    expect(mocks.price).toHaveBeenCalledExactlyOnceWith({ quoteAsset: address }, { chainId: 1, pricePurpose: "module-launch" });
  });

  it("rejects stale or mismatched shared evidence instead of silently fetching a replacement", async () => {
    const ref = reference(1);
    for (const invalid of [{ ...ref, chainId: 4663 as const }, { ...ref, decimals: 6 },
      { ...ref, quoteAsset: zero }, { ...ref, price: { ...ref.price, validUntil: String(now) } }]) {
      await expect(readFoundationStartPrice(quote, 1, invalid)).rejects.toThrow("current price");
    }
    expect(mocks.price).not.toHaveBeenCalled();
  });

  it("does not describe a provider outage as a missing token route", async () => {
    mocks.assess.mockResolvedValue({ status: "inconclusive", code: "PROVIDER_OR_EXECUTION_INCONCLUSIVE" });
    await expect(readFoundationEthFunding(address, 100n, 1)).rejects.toThrow("could not be verified");
  });

  it("preserves the market failure and does not tell thin-market users to retry the same route", async () => {
    mocks.assess.mockResolvedValue({ status: "inconclusive", code: "MARKET_PRICE_IMPACT_TOO_HIGH" });
    await expect(readFoundationEthFunding(address, 100n, 1)).rejects.toMatchObject({
      code: "MARKET_PRICE_IMPACT_TOO_HIGH", retryable: false, message: expect.stringContaining("too little liquidity"),
    });
    expect(new FoundationQuoteMarketError("V4_DISCOVERY_PROVIDER_UNAVAILABLE").retryable).toBe(true);
    expect(new FoundationQuoteMarketError("PROVIDER_CHAIN_MISMATCH").retryable).toBe(false);
  });
});
