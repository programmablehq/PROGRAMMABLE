// The only display preference is the canonical Programmable token on Robinhood Chain.
// Every other indexed launch, including test launches, follows the same Explore rules.
export const PINNED_ROBINHOOD_CHAIN_ID = 4663;
export const PINNED_ROBINHOOD_TOKEN = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";

// Compatibility for indexed launch readback. Publication visibility is checked
// against the canonical record by the caller; no token address is excluded.
export function isVisibleRobinhoodToken(address: string) {
  return /^0x[\da-f]{40}$/i.test(address);
}

export function isPinnedRobinhoodToken(address: string, chainId: number) {
  return chainId === PINNED_ROBINHOOD_CHAIN_ID && address.toLowerCase() === PINNED_ROBINHOOD_TOKEN;
}
