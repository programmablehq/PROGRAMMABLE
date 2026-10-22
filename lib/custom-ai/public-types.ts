import type { Address, Hex } from "viem";

export type CustomAIPublicToken = {
  version: 1; schema: "programmable.custom-ai-launch.v1"; sourceKind: "custom-ai-v1";
  chainId: 1 | 4663; mode: "custom"; category: "custom";
  factory: Address; coreBundleHash: string; tokenAddress: Address; hookAddress: Address;
  creator: Address; launchId: Hex; launchSalt: Hex; transactionHash: Hex;
  blockNumber: string; blockHash: Hex; logIndex: number; launchedAt: string;
  name: string; symbol: string; description: string; imageUrl: string; decimals: 18;
  quoteAsset: Address; quoteDecimals: number; poolId: Hex;
  poolKey: { currency0: Address; currency1: Address; fee: 0; tickSpacing: 60; hooks: Address };
  ledger: Address; rewardVault: Address; liquidityVault: Address;
  finalizedAt: { number: string; hash: Hex };
};
