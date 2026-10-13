import { describe, expect, it } from "vitest";
import { getAddress, toHex } from "viem";
import { foundationPriceExpiry, parseFoundationStartPrice, planFoundationStartPrice, type FoundationUsdStartPrice as FoundationStartPrice } from "@/lib/module-foundation/start-price";

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
  it.each([{ chainId: 1 as const, lifetime: 90n, maxAge: 90n }, { chainId: 4663 as const, lifetime: 45n, maxAge: 60n }])(
    "expires a $chainId review before its checkpoint becomes unusable", ({ chainId, lifetime, maxAge }) => {
      const valid = reference();
      valid.chainId = chainId;
      valid.checkpoint.timestamp = String(now - 30n);
      valid.price.validUntil = String(now + lifetime);
      const quote = { ...asset(valid), chainId };
      const expiry = foundationPriceExpiry(valid);
      expect(expiry).toBe(now - 30n + maxAge);
      expect(parseFoundationStartPrice(valid, quote, expiry - 1n)).toEqual(valid);
      expect(() => parseFoundationStartPrice(valid, quote, expiry + 1n)).toThrow("expired");
      // A shorter oracle lifetime must still win over the checkpoint limit.
      valid.price.validUntil = String(now + 10n);
      expect(foundationPriceExpiry(valid)).toBe(now + 10n);
    });

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

  it("keeps an Ethereum AMM reference valid through two-block lag and launch preparation", () => {
    const valid = reference();
    valid.chainId = 1;
    valid.checkpoint.timestamp = String(now - 30n);
    valid.price = { ...valid.price, source: "qualified-amm", observedAt: String(now - 30n),
      validUntil: String(now + 60n), heartbeatSeconds: 90 };
    const quote = { ...asset(valid), chainId: 1 as const };
    // Eight seconds composing plus twenty seconds authorizing/simulating used to exhaust 45s.
    expect(parseFoundationStartPrice(valid, quote, now + 28n)).toEqual(valid);
    expect(() => parseFoundationStartPrice(valid, quote, now + 60n)).toThrow("expired");
    expect(() => parseFoundationStartPrice({ ...valid, price: { ...valid.price,
      validUntil: String(now + 61n) } }, quote, now + 28n)).toThrow("expired");
    expect(() => parseFoundationStartPrice({ ...valid, price: { ...valid.price,
      heartbeatSeconds: 91 } }, quote, now + 28n)).toThrow("expired");
    expect(() => parseFoundationStartPrice({ ...valid, chainId: 4663 }, asset(valid), now + 28n)).toThrow("expired");
  });

  it("gives manual Ethereum valuations the same bounded preparation time", () => {
    const quote = { address: high, decimals: 18, codeHash: hash, chainId: 1 as const };
    const valid = { mode: "quote", chainId: 1, quoteAsset: high, quoteCodeHash: hash,
      decimals: 18, valuationQuoteRaw: "5000000000000000000000",
      checkpoint: { number: "123", hash, timestamp: String(now - 30n) }, validUntil: String(now + 60n) };
    expect(parseFoundationStartPrice(valid, quote, now + 28n)).toEqual(valid);
    expect(() => parseFoundationStartPrice(valid, quote, now + 60n)).toThrow("expired");
    expect(() => parseFoundationStartPrice({ ...valid, validUntil: String(now + 61n) }, quote, now)).toThrow("expired");
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
