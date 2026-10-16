import { describe, expect, it } from "vitest";
import { TickMath } from "@uniswap/v3-sdk";
import { type Address } from "viem";
import { openingFdvUsdV1, planProtectedOpeningPriceV1, validateLaunchExemptions } from "@/lib/launch-protection/policy-v1";

const low = "0x0000000000000000000000000000000000000001" as Address;
const high = "0x1111111111111111111111111111111111111111" as Address;
const now = 10000n, usd = { numerator: 2000n, denominator: 1n, observedAt: now, validUntil: now + 60n };

describe("mandatory launch-protection candidate", () => {
  it.each([0, 6, 8, 18, 36])("never rounds below the USD minimum with %i quote decimals", quoteDecimals => {
    for (const [token, quote] of [[low, high], [high, low]] as const) {
      for (const supply of [1_000_000n, 1_000_000_000n * 10n ** 18n]) {
        const result = planProtectedOpeningPriceV1({ chainId: 1, token, quote, quoteDecimals, supply, usd, now });
        expect(result.openingFdv.numerator).toBeGreaterThanOrEqual(30000n * result.openingFdv.denominator);
        const lowerTick = result.initialTick + (result.tokenIsCurrency0 ? -60 : 60);
        const previous = openingFdvUsdV1({ supply, quoteDecimals, usd, tokenIsCurrency0: result.tokenIsCurrency0,
          sqrtPriceX96: BigInt(TickMath.getSqrtRatioAtTick(lowerTick).toString()) });
        expect(previous.numerator).toBeLessThan(30000n * previous.denominator);
        expect(result.walletTokenLimit).toBe(supply / 50n);
      }
    }
  });

  it("rejects stale, future, absent or zero price evidence and a lower target", () => {
    const input = { chainId: 1 as const, token: low, quote: high, quoteDecimals: 18, supply: 10n ** 27n, usd, now };
    for (const patch of [{ numerator: 0n }, { denominator: 0n }, { observedAt: now + 1n },
      { observedAt: now - 3601n }, { validUntil: now }, { validUntil: now + 3601n }]) {
      expect(() => planProtectedOpeningPriceV1({ ...input, usd: { ...usd, ...patch } })).toThrow();
    }
    expect(() => planProtectedOpeningPriceV1({ ...input, targetFdvUsd: 5000n })).toThrow();
  });

  it("allows at most three distinct additional exemptions", () => {
    const wallets = ["0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444"];
    expect(validateLaunchExemptions(high, wallets)).toHaveLength(3);
    for (const invalid of [[...wallets, low], [high], [low, low], ["0x0000000000000000000000000000000000000000"]]) {
      expect(() => validateLaunchExemptions(high, invalid)).toThrow();
    }
  });

  it.each([[1, 3600n], [4663, 86400n]] as const)("enforces the fixed feed heartbeat on chain %i", (chainId, maxAge) => {
    const now = 200000n;
    const input = { chainId, token: high, quote: low, quoteDecimals: 18, supply: 10n ** 27n, now };
    expect(() => planProtectedOpeningPriceV1({ ...input, usd: { numerator: 2000n, denominator: 1n,
      observedAt: now - maxAge + 1n, validUntil: now + 1n } })).not.toThrow();
    expect(() => planProtectedOpeningPriceV1({ ...input, usd: { numerator: 2000n, denominator: 1n,
      observedAt: now - maxAge - 1n, validUntil: now + 1n } })).toThrow();
  });
});
