import { describe, expect, it, vi } from "vitest";
import { getAddress, toHex, type PublicClient } from "viem";
import { readFoundationQuote } from "@/lib/module-foundation/client";
import { foundationPriceExpiry, parseFoundationStartPrice, planFoundationStartPrice, type FoundationQuoteStartPrice } from "@/lib/module-foundation/start-price";

const low = getAddress("0x1000000000000000000000000000000000000000");
const high = getAddress("0x9000000000000000000000000000000000000000");
const hash = toHex(1, { size: 32 }), now = 1_800_000_000n;
const reference = (address = high, decimals = 18, chainId: 1 | 4663 = 1): FoundationQuoteStartPrice => ({ mode: "quote", chainId,
  quoteAsset: address, quoteCodeHash: hash, decimals, valuationQuoteRaw: (10n ** BigInt(decimals)).toString(),
  checkpoint: { number: "123", hash, timestamp: String(now) }, validUntil: String(now + 45n) });
const asset = (p: FoundationQuoteStartPrice) => ({ address: p.quoteAsset, decimals: p.decimals, codeHash: p.quoteCodeHash, chainId: p.chainId });

describe("quotes with no existing market", () => {
  it.each([0, 6, 8, 18, 36])("prices an arbitrary %i-decimal quote on either chain and in either token order", decimals => {
    for (const chainId of [1, 4663] as const) for (const [token, quote] of [[low, high], [high, low]]) {
      const p = reference(quote, decimals, chainId);
      const plan = planFoundationStartPrice({ token, quote: asset(p), startPrice: p, now });
      expect(plan.actualMarketCapUsd).toBeNull();
      expect(Number(plan.actualMarketCapQuote)).toBeGreaterThan(0.996);
      expect(Number(plan.actualMarketCapQuote)).toBeLessThan(1.004);
      expect(plan.base.liquidity).toBeGreaterThan(0n);
      expect(foundationPriceExpiry(p)).toBe(now + 45n);
    }
  });

  it.each([1, 4663] as const)("rejects identity changes, invented USD evidence, invalid amounts and expired checkpoints on %i", chainId => {
    const valid = reference(high, 18, chainId);
    for (const mutation of [{ quoteAsset: low }, { chainId: chainId === 1 ? 4663 : 1 }, { decimals: 6 }, { quoteCodeHash: toHex(2, { size: 32 }) },
      { valuationQuoteRaw: "0" }, { valuationQuoteRaw: "1.5" }, { valuationQuoteRaw: (1n << 127n).toString() },
      { validUntil: String(now) }, { validUntil: String(now + (chainId === 1 ? 91n : 46n)) }, { targetMarketCapUsd: "5000" },
      { checkpoint: { ...valid.checkpoint, timestamp: String(now - (chainId === 1 ? 91n : 61n)) } }, { price: { usd: { numerator: "1", denominator: "1" } } }]) {
      expect(() => parseFoundationStartPrice({ ...valid, ...mutation }, asset(valid), now)).toThrow();
    }
  });

  it.each([0, 6, 8, 18, 36])("does not reject a valid %i-decimal ERC20 solely for missing metadata or zero supply", async decimals => {
    const client = { chain: { id: 1 }, getCode: vi.fn(async () => "0x6000"),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "name" || functionName === "symbol") throw new Error("Optional metadata is absent");
        if (functionName === "decimals") return decimals;
        if (functionName === "totalSupply" || functionName === "balanceOf") return 0n;
        throw new Error("Unexpected call");
      }) } as unknown as PublicClient;
    const quote = await readFoundationQuote(client, high, low, 123n);
    expect(quote).toMatchObject({ address: high, decimals, balance: 0n, transferQualification: "exact-launch-simulation-required" });
    expect(quote.name).toContain(high.slice(0, 6));
    expect(quote.symbol).toBe(high.slice(0, 8));
  });

  it("keeps non-token addresses and unsupported decimals blocked", async () => {
    for (const code of ["0x", "0x6000"]) {
      const client = { chain: { id: 1 }, getCode: vi.fn(async () => code),
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === "decimals" ? 37 : functionName === "name" || functionName === "symbol" ? "Token" : 0n) } as unknown as PublicClient;
      await expect(readFoundationQuote(client, high)).rejects.toThrow("ERC20");
    }
  });
});
