import type { FoundationChainId } from "./chains";

/** Ethereum's two-block checkpoint already consumes 24–36 seconds. Leave time
 * for authorization and exact-transaction simulation without extending swap quotes. */
export const foundationPriceLifetime = (chainId: FoundationChainId = 4663): bigint => chainId === 1 ? 90n : 45n;
export const foundationPriceCheckpointMaxAge = (chainId: FoundationChainId = 4663): bigint => chainId === 1 ? 90n : 60n;
