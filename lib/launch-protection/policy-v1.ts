import { getAddress, type Address } from "viem";
import { TickMath } from "@uniswap/v3-sdk";

/** Candidate policy. Activation is a separately reviewed release operation. */
export const LAUNCH_PROTECTION_V1 = Object.freeze({
  schemaVersion: "programmable.launch-protection.v1",
  minimumFdvUsd: "30000",
  walletLimitBps: 200,
  walletLimitSeconds: 300,
  openingTotalFeePpm: 990_000,
  openingFeeSeconds: 30,
  maximumAdditionalTaxExemptWallets: 3,
  exemptionScope: "additional-opening-fee-only",
  capBasis: "cumulative-recipient-inflow",
  openingFeeDestination: "irrevocably-locked-lp",
  platformFeeBps: 30,
} as const);

export function validateLaunchExemptions(developer: Address, additional: readonly string[]): readonly Address[] {
  const dev = getAddress(developer), zero = "0x0000000000000000000000000000000000000000";
  if (dev === zero || additional.length > LAUNCH_PROTECTION_V1.maximumAdditionalTaxExemptWallets) {
    throw new Error("At most three additional tax-exempt wallets are allowed.");
  }
  const wallets = additional.map(wallet => getAddress(wallet));
  if (wallets.some(w => w === zero || w === dev) || new Set(wallets).size !== wallets.length) {
    throw new Error("Tax-exempt wallets must be unique, nonzero and different from the developer.");
  }
  return Object.freeze(wallets);
}

export interface VerifiedLaunchUsdPriceV1 {
  numerator: bigint;
  denominator: bigint;
  observedAt: bigint;
  validUntil: bigint;
}

const Q192 = 1n << 192n;
const MAX_SUPPLY = (1n << 127n) - 1n;
const SPACING = 60;
const MIN_TICK = -887_220 + SPACING;
const MAX_TICK = 887_220 - SPACING;

/** USD value of the total launch supply at the pool's spot opening price, without floating-point math. */
export function openingFdvUsdV1(input: { sqrtPriceX96: bigint; tokenIsCurrency0: boolean; supply: bigint;
  quoteDecimals: number; usd: Pick<VerifiedLaunchUsdPriceV1, "numerator" | "denominator"> }) {
  const { sqrtPriceX96: price, tokenIsCurrency0, supply, quoteDecimals, usd } = input;
  if (price <= 0n || price > (1n << 160n) - 1n || supply < 50n || supply > MAX_SUPPLY || !Number.isInteger(quoteDecimals)
    || quoteDecimals < 0 || quoteDecimals > 36 || usd.numerator <= 0n || usd.denominator <= 0n) {
    throw new Error("Invalid launch valuation inputs.");
  }
  const square = price * price;
  return {
    numerator: supply * (tokenIsCurrency0 ? square : Q192) * usd.numerator,
    denominator: (tokenIsCurrency0 ? Q192 : square) * 10n ** BigInt(quoteDecimals) * usd.denominator,
  };
}

/** The caller must obtain usd from an independent verified server/oracle source, never from a request assertion. */
export function planProtectedOpeningPriceV1(input: { token: Address; quote: Address; supply: bigint;
  quoteDecimals: number; usd: VerifiedLaunchUsdPriceV1; now: bigint; targetFdvUsd?: bigint }) {
  const { usd, now } = input, target = input.targetFdvUsd ?? BigInt(LAUNCH_PROTECTION_V1.minimumFdvUsd);
  const token = getAddress(input.token), quote = getAddress(input.quote);
  if (token === quote || target < BigInt(LAUNCH_PROTECTION_V1.minimumFdvUsd) || target > (1n << 128n)
    || usd.observedAt <= 0n || usd.observedAt > now || now - usd.observedAt > 3600n
    || usd.validUntil <= now || usd.validUntil > usd.observedAt + 3600n) {
    throw new Error("A fresh verified USD price and at least USD 30,000 starting valuation are required.");
  }
  const tokenIsCurrency0 = BigInt(token) < BigInt(quote);
  const at = (tick: number) => {
    const sqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(tick).toString());
    const fdv = openingFdvUsdV1({ ...input, sqrtPriceX96, tokenIsCurrency0 });
    return { tick, sqrtPriceX96, fdv, sufficient: fdv.numerator >= target * fdv.denominator };
  };
  // Search in the direction of increasing valuation. Never round below the minimum.
  const count = Math.floor((MAX_TICK - MIN_TICK) / SPACING);
  const tickFor = (i: number) => tokenIsCurrency0 ? MIN_TICK + i * SPACING : MAX_TICK - i * SPACING;
  if (!at(tickFor(count)).sufficient) throw new Error("Starting valuation is outside the supported tick range.");
  let lo = 0, hi = count;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (at(tickFor(mid)).sufficient) hi = mid; else lo = mid + 1;
  }
  const result = at(tickFor(lo));
  return Object.freeze({ initialTick: result.tick, sqrtPriceX96: result.sqrtPriceX96,
    tokenIsCurrency0, openingFdv: result.fdv, targetFdvUsd: target,
    walletTokenLimit: input.supply * BigInt(LAUNCH_PROTECTION_V1.walletLimitBps) / 10_000n });
}
