import { describe, expect, it } from "vitest";
import { getAddress, toHex } from "viem";
import { parseFoundationStartPrice, planFoundationStartPrice, type FoundationStartPrice } from "@/lib/module-foundation/start-price";

const low = getAddress("0x1000000000000000000000000000000000000000");
const high = getAddress("0x9000000000000000000000000000000000000000");
const hash = toHex(1, { size: 32 }), now = 1_800_000_000n;
function reference(address = high, decimals = 18, numerator = "3000", denominator = "1"): FoundationStartPrice {
  return { chainId: 4663, quoteAsset: address, quoteCodeHash: hash, decimals, targetMarketCapUsd: "5000",
    checkpoint: { number: "123", hash, timestamp: String(now) },
    price: { usd: { numerator, denominator }, source: "chainlink", observedAt: String(now - 20n),
      validUntil: String(now + 45n), heartbeatSeconds: 86400, evidenceHash: hash } };
}
const asset = (value: FoundationStartPrice) => ({ address: value.quoteAsset, decimals: value.decimals, codeHash: value.quoteCodeHash });

describe("automatic Foundation starting market cap", () => {
  it.each([0, 6, 8, 18, 36])("keeps USD 5000 through 60-tick rounding with %i quote decimals in either sort order", decimals => {
    for (const [token, quote] of [[low, high], [high, low]]) {
      const startPrice = reference(quote, decimals);
      const planned = planFoundationStartPrice({ token, quote: asset(startPrice), startPrice, now });
      const n = planned.actualValuationQuote.numerator * 3000n;
      const d = planned.actualValuationQuote.denominator * 10n ** BigInt(decimals);
      const difference = n > 5000n * d ? n - 5000n * d : 5000n * d - n;
      expect(difference * 10_000n).toBeLessThanOrEqual(5000n * d * 31n);
      expect(Math.abs(planned.initialTick % 60)).toBe(0);
      expect(planned.base.liquidity).toBeGreaterThan(0n);
      expect(planned.creator).toBeNull();
    }
  });

  it("does not use a constant ETH amount or round a sub-unit valuation to zero", () => {
    for (const [decimals, dollars] of [[18, "2500"], [18, "4000"], [0, "50000"]] as const) {
      const startPrice = reference(high, decimals, dollars);
      const result = planFoundationStartPrice({ token: low, quote: asset(startPrice), startPrice, now });
      expect(Number(result.actualMarketCapUsd)).toBeGreaterThan(4984);
      expect(Number(result.actualMarketCapUsd)).toBeLessThan(5016);
    }
  });

  it("retains rational precision and does not confuse valuation with quote funding", () => {
    const startPrice = reference(high, 18, `3000${"0".repeat(100)}`, `1${"0".repeat(100)}`);
    const result = planFoundationStartPrice({ token: low, quote: asset(startPrice), startPrice, now, additionalQuoteRaw: 1_000_000_000_000_000_000n });
    expect(Number(result.actualMarketCapUsd)).toBeGreaterThan(4984);
    expect(result.creator!.principal).toBeLessThanOrEqual(1_000_000_000_000_000_000n);
  });

  it("rejects custom valuation, wrong asset identity, changed precision and changed runtime", () => {
    const valid = reference();
    for (const changed of [
      { ...valid, targetMarketCapUsd: "100000" }, { ...valid, chainId: 1 },
      { ...valid, quoteAsset: low }, { ...valid, decimals: 6 }, { ...valid, quoteCodeHash: toHex(2, { size: 32 }) },
      { ...valid, startValuationQuote: "2" },
    ]) expect(() => parseFoundationStartPrice(changed, asset(valid), now)).toThrow("automatic starting price");
  });

  it("rejects expired, future, stale and invalid price evidence", () => {
    const valid = reference();
    for (const price of [
      { ...valid.price, validUntil: String(now) }, { ...valid.price, validUntil: String(now + 46n) },
      { ...valid.price, observedAt: String(now + 1n) }, { ...valid.price, observedAt: String(now - 86401n) },
      { ...valid.price, usd: { numerator: "0", denominator: "1" } },
      { ...valid.price, usd: { numerator: "3000", denominator: "0" } },
      { ...valid.price, usd: { numerator: "3e3", denominator: "1" } },
      { ...valid.price, heartbeatSeconds: 0 },
    ]) expect(() => parseFoundationStartPrice({ ...valid, price }, asset(valid), now)).toThrow("expired");
    for (const timestamp of [now - 61n, now + 11n]) {
      expect(() => parseFoundationStartPrice({ ...valid, checkpoint: { ...valid.checkpoint, timestamp: String(timestamp) } }, asset(valid), now)).toThrow("expired");
    }
    expect(() => parseFoundationStartPrice(valid, asset(valid), now + 45n)).toThrow("expired");
  });
});
