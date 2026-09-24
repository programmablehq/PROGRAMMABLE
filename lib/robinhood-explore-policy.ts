// Explore pins the canonical Programmable token on Robinhood Chain.
export const PINNED_ROBINHOOD_CHAIN_ID = 4663;
export const PINNED_ROBINHOOD_TOKEN = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";

// Requested Explore exclusions do not remove canonical launch records or coin pages.
const EXPLORE_EXCLUDED_TOKENS = new Set([
  "0xe8b292783382c93706dc43b54bba03f0f1a9908e", // catch trade
  "0x9fa5619b14d3fb6900247db219a3feb657ca46fc", // Tradable
  "0x859e6b4497f977b8ad88fbde2c6ca70c68cec5f9", // TEST launch
]);

export function isDiscoverableRobinhoodToken(address: string) {
  return !EXPLORE_EXCLUDED_TOKENS.has(address.toLowerCase());
}

// Compatibility for indexed launch readback. Publication visibility is checked
// against the canonical record by the caller; no token address is excluded.
export function isVisibleRobinhoodToken(address: string) {
  return /^0x[\da-f]{40}$/i.test(address);
}

export function isPinnedRobinhoodToken(address: string, chainId: number) {
  return chainId === PINNED_ROBINHOOD_CHAIN_ID && address.toLowerCase() === PINNED_ROBINHOOD_TOKEN;
}
