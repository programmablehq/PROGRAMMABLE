import { getAddress, keccak256, stringToHex, type Hex } from "viem";
import chainProfile from "@/contracts/spec/robinhood-custom-launch/chain-4663.v1.json";

export const FOUNDATION_CHAIN_ID = 4663 as const;
export const FOUNDATION_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const FOUNDATION_TICK_SPACING = 60 as const;
export const FOUNDATION_LP_FEE = 0 as const;
export const FOUNDATION_PLATFORM_BPS = 30 as const;
export const FOUNDATION_PLATFORM_RECIPIENT = getAddress("0xD88539d3c4C460136a733A3Fd60cf6BF269079da");
export const FOUNDATION_ABI_ID = keccak256(stringToHex("programmable.module-foundation.v1"));
export const FOUNDATION_INT128_MAX = (1n << 127n) - 1n;
export const FOUNDATION_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const FOUNDATION_ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
export const FOUNDATION_INFRASTRUCTURE = Object.fromEntries(
  ["poolManager", "positionManager", "universalRouter", "permit2", "v4Quoter", "stateView"].map(role => {
    const pin = chainProfile.contracts.uniswap[role as keyof typeof chainProfile.contracts.uniswap];
    return [role, { address: getAddress(pin.address), runtimeCodeHash: pin.runtimeCodeHash as Hex }];
  }),
) as Record<"poolManager" | "positionManager" | "universalRouter" | "permit2" | "v4Quoter" | "stateView", { address: `0x${string}`; runtimeCodeHash: Hex }>;

export function foundationCreatorFeeBps(value: number): number {
  if (!Number.isInteger(value) || (value !== 0 && (value < 100 || value > 1_000))) {
    throw new Error("Creator fees must be zero or between 1% and 10%.");
  }
  return value;
}
