import type { LaunchStampProvenanceV1 } from "@/lib/tokens";

const NATIVE = "0x0000000000000000000000000000000000000000";

/** Existing hookless Uniswap v4 pool. Both directions use the same pool;
 * current liquidity and the complete swap still require independent simulation. */
export const ETHEREUM_UNI_BRIDGE = Object.freeze({
  quoteToken: Object.freeze({
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    runtimeCodeHash: "0xdeba17f16fdba566b45d8019575e068625403cc6986fa17ceadd6edf08aa0868",
  }),
  poolId: "0x053f6a47ccba79e7d5d623173ed6dd5a31cf19c28bae0fb8276f4506295f90da",
  poolKey: Object.freeze({ currency0: NATIVE, currency1: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    fee: 3000, tickSpacing: 60, hooks: NATIVE }),
} as const);

export type EthereumStampedBridge = typeof ETHEREUM_UNI_BRIDGE;

export function ethereumStampedBridge(pool: LaunchStampProvenanceV1["poolKey"], token: string): EthereumStampedBridge | undefined {
  const currencies = [pool.currency0.toLowerCase(), pool.currency1.toLowerCase()];
  const quote = ETHEREUM_UNI_BRIDGE.quoteToken.address.toLowerCase();
  return token.toLowerCase() !== quote && currencies.includes(token.toLowerCase()) && currencies.includes(quote)
    ? ETHEREUM_UNI_BRIDGE : undefined;
}
