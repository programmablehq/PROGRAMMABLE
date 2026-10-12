import type { Address, Hex, PublicClient } from "viem";
export interface Source {
  chainId: 1; platformFeeBps?: 30 | 100; releaseDigest: Hex; sourceCommit: string; startBlock: bigint;
  implementation: { address: Address; runtimeCodeHash: Hex }; proxyRuntimeCodeHash: Hex;
}
export interface Metadata { name: string; symbol: string; description: string; imageURI: string; website: string; socialData: Hex }
export interface Module { factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex; descriptorHash: Hex; configuration: Hex; creatorShareBps: number }
export interface Parameters {
  metadata: Metadata; quote: Address; quoteDecimals: number; initialTick: number;
  creatorBuyFeeBps: number; creatorSellFeeBps: number; additionalQuoteAmount: bigint;
  initialBuyQuoteAmount: bigint; initialBuyMinimumTokenAmount: bigint; deadline: bigint;
  tokenSalt: Hex; hookSalt: Hex; modules: readonly Module[];
}
export interface FundingHop { intermediateCurrency: Address; fee: number; tickSpacing: number; hooks: Address; hookData: Hex }
export interface Identity { routeNamespace: Hex; routeNonce: Hex; topologyHash: Hex }
export interface Target { targetIdHash: Hex; applicantSalt: Hex; deploymentValue: bigint; initializerValue: bigint; initCode: Hex; initializerCalldata: Hex }
export interface PoolKey { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
export interface Output { targetIndex: number; targetIdHash: Hex; account: Address; runtimeCodeHash: Hex }
export interface Graph { identity: Identity; launchId: Hex; account: Address; engine: Address; token: Address; hook: Address; targets: Target[]; graphCommitment: Hex; totalValue: bigint; parameters: Parameters; poolKey: PoolKey }
export interface Plan {
  route: Identity & { graphCommitment: Hex; targets: readonly Target[]; expectedOutputs: readonly Output[]; expectedGraphDeploymentHash: Hex };
  routePayload: Hex;
  permit: { chainId: bigint; router: Address; launchWallet: Address; kind: number; routePayloadHash: Hex; expectedResultHash: Hex; stampRequestHash: Hex; nonce: Hex; validAfter: bigint; deadline: bigint; value: bigint };
  stamp: { launchId: Hex; token: Address; tokenRuntimeCodeHash: Hex; poolKey: PoolKey; hookRuntimeCodeHash: Hex; components: { resultIndex: number; account: Address; runtimeCodeHash: Hex; kind: number; scope: number }[] };
}
export function decodeEthereumModuleParameters(bytes: Hex): Parameters;
export function predictFoundationEthereumAccounts(input: { source: Source; account: Address; tokenSalt: Hex; metadata: Metadata }): { identity: Identity; engine: Address; token: Address; engineTarget: Target; tokenTarget: Target; launchId: Hex };
export function buildFoundationEthereumGraph(input: { source: Source; account: Address; parameters: Parameters; fundingPath: readonly FundingHop[]; value: bigint; signal?: AbortSignal }): Promise<Graph>;
export function simulateFoundationEthereumGraph(input: { clients: readonly [PublicClient, PublicClient]; source: Source; graph: Graph; signal?: AbortSignal }): Promise<{ plan: Plan; block: { number: bigint; hash: Hex; timestamp: bigint }; providerCount: 2; authoritySignature: null }>;
export function encodeFoundationEthereumStamp(plan: Plan, signature: Hex): { to: Address; value: bigint; data: Hex };
