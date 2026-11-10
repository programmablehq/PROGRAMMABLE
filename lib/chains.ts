import { defineChain } from "viem";

export const ROBINHOOD_CHAIN_ID = 4_663 as const;
export const ROBINHOOD_MAINNET_RPC_URL =
  "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_BLOCK_EXPLORER_URL =
  "https://robinhoodchain.blockscout.com";
export const ROBINHOOD_MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
export const ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH =
  "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891" as const;

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: [ROBINHOOD_MAINNET_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: ROBINHOOD_BLOCK_EXPLORER_URL,
    },
  },
  contracts: {
    multicall3: {
      address: ROBINHOOD_MULTICALL3_ADDRESS,
    },
  },
});

export const elysiumChain = defineChain({
  id: 99901, name: "Elysium", nativeCurrency: { decimals: 18, name: "HYPE", symbol: "HYPE" },
  rpcUrls: { default: { http: ["https://rpc.elysium.kinetiq.xyz"] } },
  blockExplorers: { default: { name: "Elysium Explorer", url: "https://elysium.kinetiq.xyz" } },
});
