/** Shared presentation and routing for the reviewed EVM Custom Launch lanes. */
export const EVM_CUSTOM_CHAINS = {
  8453: { id: 8453, apiId: "8453", name: "Base", slug: "base", nativeSymbol: "ETH", explorer: "https://basescan.org", explorerName: "Basescan", uniswapChain: "base" },
  999: { id: 999, apiId: "999", name: "HyperEVM", slug: "hyperevm", nativeSymbol: "HYPE", explorer: "https://hyperevmscan.io", explorerName: "HyperEVM Explorer", uniswapChain: null },
} as const;
export type EvmCustomChainId = keyof typeof EVM_CUSTOM_CHAINS;
