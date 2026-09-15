import { TickMath } from "@uniswap/v3-sdk";
import { getAddress, type Address } from "viem";
import { FOUNDATION_SUPPLY, FOUNDATION_TICK_SPACING } from "./constants";

const Q96 = 1n << 96n;
const Q192 = Q96 * Q96;
export const FOUNDATION_MIN_TICK = Math.ceil(-887_272 / FOUNDATION_TICK_SPACING) * FOUNDATION_TICK_SPACING;
export const FOUNDATION_MAX_TICK = Math.floor(887_272 / FOUNDATION_TICK_SPACING) * FOUNDATION_TICK_SPACING;
const abs = (n: bigint) => n < 0n ? -n : n;
const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d;

/** Reject excessive decimal precision; never round a wallet amount silently. */
export function foundationParseAmount(value: string, decimals: number, allowZero = true): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36
    || typeof value !== "string" || value.length > 100 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new Error("Enter an exact amount in the selected quote token.");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places.`);
  const result = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (!allowZero && result === 0n) throw new Error("Enter an amount greater than zero.");
  if (result > (1n << 127n) - 1n) throw new Error("The amount exceeds this pool's supported range.");
  return result;
}

export function foundationSqrtPriceAtTick(tick: number): bigint {
  return BigInt(TickMath.getSqrtRatioAtTick(tick).toString());
}

export function foundationValuationAtTick(tick: number, tokenIsCurrency0: boolean): { numerator: bigint; denominator: bigint } {
  const square = foundationSqrtPriceAtTick(tick) ** 2n;
  return tokenIsCurrency0
    ? { numerator: square * FOUNDATION_SUPPLY, denominator: Q192 }
    : { numerator: Q192 * FOUNDATION_SUPPLY, denominator: square };
}

/** Quote-denominated valuation; no USD assumption or dependency on a third-asset route. */
export function planFoundationPrice(input: { token: Address; quote: Address; valuationQuoteRaw: bigint; additionalQuoteRaw?: bigint }) {
  const token = getAddress(input.token), quote = getAddress(input.quote);
  if (token === quote || input.valuationQuoteRaw <= 0n || input.valuationQuoteRaw > (1n << 127n) - 1n) throw new Error("Invalid pool price.");
  const tokenIsCurrency0 = BigInt(token) < BigInt(quote);
  const [ratioN, ratioD] = tokenIsCurrency0
    ? [input.valuationQuoteRaw, FOUNDATION_SUPPLY] : [FOUNDATION_SUPPLY, input.valuationQuoteRaw];
  const compare = (tick: number) => foundationSqrtPriceAtTick(tick) ** 2n * ratioD - ratioN * Q192;
  const min = FOUNDATION_MIN_TICK + FOUNDATION_TICK_SPACING;
  const max = FOUNDATION_MAX_TICK - FOUNDATION_TICK_SPACING;
  if (compare(min) > 0n || compare(max) < 0n) throw new Error("The starting valuation is outside the supported price range.");
  let lo = min, hi = max;
  while (lo < hi) {
    const middle = Math.floor((lo + hi + 1) / 2);
    if (compare(middle) <= 0n) lo = middle; else hi = middle - 1;
  }
  const lower = Math.floor(lo / FOUNDATION_TICK_SPACING) * FOUNDATION_TICK_SPACING;
  const candidates = [...new Set([Math.max(min, lower), Math.min(max, lower + FOUNDATION_TICK_SPACING)])].map(tick => {
    const valuation = foundationValuationAtTick(tick, tokenIsCurrency0);
    return { tick, valuation, error: abs(valuation.numerator - input.valuationQuoteRaw * valuation.denominator) };
  }).sort((a, b) => {
    const difference = a.error * b.valuation.denominator - b.error * a.valuation.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : a.tick - b.tick;
  });
  const selected = candidates[0];
  const sqrtPriceX96 = foundationSqrtPriceAtTick(selected.tick);
  const baseLower = tokenIsCurrency0 ? selected.tick : FOUNDATION_MIN_TICK;
  const baseUpper = tokenIsCurrency0 ? FOUNDATION_MAX_TICK : selected.tick;
  const creatorLower = tokenIsCurrency0 ? FOUNDATION_MIN_TICK : selected.tick;
  const creatorUpper = tokenIsCurrency0 ? selected.tick : FOUNDATION_MAX_TICK;
  const base = oneSidedPosition(baseLower, baseUpper, FOUNDATION_SUPPLY, tokenIsCurrency0);
  const additionalQuote = input.additionalQuoteRaw ?? 0n;
  if (additionalQuote < 0n || additionalQuote > (1n << 127n) - 1n) throw new Error("Invalid additional quote liquidity.");
  const creator = additionalQuote > 0n ? oneSidedPosition(creatorLower, creatorUpper, additionalQuote, !tokenIsCurrency0) : null;
  // Core counts the partially usable negative tick interval with floor division.
  const tickCount = Math.floor(887_272 / FOUNDATION_TICK_SPACING) - Math.floor(-887_272 / FOUNDATION_TICK_SPACING) + 1;
  const maxLiquidity = ((1n << 128n) - 1n) / BigInt(tickCount);
  if (base.liquidity === 0n || base.liquidity + (creator?.liquidity ?? 0n) > maxLiquidity
    || (creator && creator.liquidity === 0n)) throw new Error("The supplied amount cannot form a supported liquidity position.");
  return { initialTick: selected.tick, sqrtPriceX96, tokenIsCurrency0,
    actualValuationQuote: selected.valuation, base, creator };
}

function oneSidedPosition(tickLower: number, tickUpper: number, amount: bigint, currency0: boolean) {
  const a = foundationSqrtPriceAtTick(tickLower), b = foundationSqrtPriceAtTick(tickUpper);
  const liquidity = currency0 ? amount * (a * b / Q96) / (b - a) : amount * Q96 / (b - a);
  const principal = currency0 ? ceilDiv(ceilDiv((liquidity << 96n) * (b - a), b), a) : ceilDiv(liquidity * (b - a), Q96);
  if (principal > amount) throw new Error("The position exceeds its funding.");
  return { tickLower, tickUpper, liquidity, principal, dust: amount - principal };
}
