import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import { foundationCreatorFeeRates, type FoundationCreatorFees } from "./creator-fees";
import type { FoundationPoolKey } from "./route";

export interface FoundationMetadata { name: string; symbol: string; description: string; imageURI: string; website: string; socialData: Hex }
export interface FoundationContractModule { factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex; descriptorHash: Hex; configuration: Hex; creatorShareBps: number }
export type FoundationLaunchParameters = FoundationLaunchParametersCommon & FoundationCreatorFees;
export type FoundationLaunchParametersV3 = FoundationLaunchParametersCommon & { creatorBuyFeeBps: number; creatorSellFeeBps: number; creatorFeeBps?: never };
export type FoundationLaunchParametersLegacy = FoundationLaunchParametersCommon & { creatorFeeBps: number; creatorBuyFeeBps?: never; creatorSellFeeBps?: never };
interface FoundationLaunchParametersCommon {
  metadata: FoundationMetadata; quote: Address; quoteDecimals: number; initialTick: number;
  additionalQuoteAmount: bigint; initialBuyQuoteAmount: bigint; initialBuyMinimumTokenAmount: bigint;
  deadline: bigint; tokenSalt: Hex; hookSalt: Hex; modules: readonly FoundationContractModule[];
}
export interface FoundationLaunchResult {
  token: Address; hook: Address; ledger: Address; poolId: Hex; baseVault: Address;
  basePositionId: bigint; creatorPositionId: bigint; initialBuyTokenAmount: bigint;
}
/** Exact FoundationLaunchTypesV2.LaunchResultV2 field order. No vault exists in V2. */
export interface FoundationLaunchResultV2 {
  token: Address; hook: Address; ledger: Address; poolId: Hex;
  basePositionOwner: Address; creatorPositionOwner: Address; roundingInventoryRecipient: Address;
  basePositionId: bigint; creatorPositionId: bigint; initialBuyTokenAmount: bigint;
  baseTokenPrincipal: bigint; baseTokenRounding: bigint; creatorQuotePrincipal: bigint; actualQuoteRefund: bigint;
}
export type FoundationLaunchRecord = (FoundationLaunchResult & { factoryVersion: "v1" })
  | (FoundationLaunchResultV2 & { factoryVersion: "v2" | "v3" });

export const foundationMetadataParameters = parseAbiParameters("(string name,string symbol,string description,string imageURI,string website,bytes socialData)");
export const foundationLaunchParameters = parseAbiParameters("((string name,string symbol,string description,string imageURI,string website,bytes socialData) metadata,address quote,uint8 quoteDecimals,int24 initialTick,uint16 creatorFeeBps,uint128 additionalQuoteAmount,uint128 initialBuyQuoteAmount,uint128 initialBuyMinimumTokenAmount,uint64 deadline,bytes32 tokenSalt,bytes32 hookSalt,(address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 descriptorHash,bytes configuration,uint16 creatorShareBps)[] modules)");
export const foundationLaunchParametersV3 = parseAbiParameters("((string name,string symbol,string description,string imageURI,string website,bytes socialData) metadata,address quote,uint8 quoteDecimals,int24 initialTick,uint16 creatorBuyFeeBps,uint16 creatorSellFeeBps,uint128 additionalQuoteAmount,uint128 initialBuyQuoteAmount,uint128 initialBuyMinimumTokenAmount,uint64 deadline,bytes32 tokenSalt,bytes32 hookSalt,(address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 descriptorHash,bytes configuration,uint16 creatorShareBps)[] modules)");

export const foundationFactoryAbi = parseAbi([
  "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
  "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
  "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
  "struct LaunchResult { address token; address hook; address ledger; bytes32 poolId; address baseVault; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; }",
  "function launch(LaunchParams p) returns (LaunchResult result)",
  "function launchOf(address token) view returns (LaunchResult result)",
  "function predictTokenAddress(address creator,bytes32 tokenSalt,Metadata metadata) view returns (address)",
  "function hookInitCodeHash(address creator,address predictedToken,LaunchParams p) view returns (bytes32)",
  "function predictHookAddress(address creator,address predictedToken,LaunchParams p) view returns (address)",
  "function hookDeployer() view returns (address)",
  "function VERSION_ID() view returns (bytes32)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function universalRouter() view returns (address)",
  "function permit2() view returns (address)",
]);

export const foundationFactoryV2Abi = parseAbi([
  "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
  "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
  "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
  "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
  "function launch(LaunchParams p) returns (LaunchResultV2 result)",
  "function launchOf(address token) view returns (LaunchResultV2 result)",
  "function predictTokenAddress(address creator,bytes32 tokenSalt,Metadata metadata) view returns (address)",
  "function hookInitCodeHash(address creator,address predictedToken,LaunchParams p) view returns (bytes32)",
  "function predictHookAddress(address creator,address predictedToken,LaunchParams p) view returns (address)",
  "function hookDeployer() view returns (address)",
  "function VERSION_ID() view returns (bytes32)",
  "function MODULE_ABI_ID() view returns (bytes32)",
  "function LP_CUSTODY_ID() view returns (bytes32)",
  "function LP_RECIPIENT() view returns (address)",
  "function ROUNDING_INVENTORY_RECIPIENT() view returns (address)",
  "function LP_FEE() view returns (uint24)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function universalRouter() view returns (address)",
  "function permit2() view returns (address)",
  "event FoundationLaunchedV2(address indexed token,address indexed creator,bytes32 indexed poolId,address hook,address ledger,address quote,bytes32 metadataHash,bytes32 compositionHash,bytes32 custodyId,uint256 initialBuyQuoteAmount,LaunchResultV2 result)",
]);

export const foundationFactoryV3Abi = parseAbi([
  "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
  "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
  "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorBuyFeeBps; uint16 creatorSellFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
  "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
  "function launch(LaunchParams p) returns (LaunchResultV2 result)",
  "function launchOf(address token) view returns (LaunchResultV2 result)",
  "function predictTokenAddress(address creator,bytes32 tokenSalt,Metadata metadata) view returns (address)",
  "function hookInitCodeHash(address creator,address predictedToken,LaunchParams p) view returns (bytes32)",
  "function predictHookAddress(address creator,address predictedToken,LaunchParams p) view returns (address)",
  "function hookDeployer() view returns (address)",
  "function VERSION_ID() view returns (bytes32)",
  "function MODULE_ABI_ID() view returns (bytes32)",
  "function LP_CUSTODY_ID() view returns (bytes32)",
  "function LP_RECIPIENT() view returns (address)",
  "function ROUNDING_INVENTORY_RECIPIENT() view returns (address)",
  "function LP_FEE() view returns (uint24)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function universalRouter() view returns (address)",
  "function permit2() view returns (address)",
  "event FoundationLaunchedV3(address indexed token,address indexed creator,bytes32 indexed poolId,address hook,address ledger,address quote,bytes32 metadataHash,bytes32 compositionHash,bytes32 custodyId,uint256 initialBuyQuoteAmount,LaunchResultV2 result)",
]);

export const foundationFactoryNativeAbi = [...foundationFactoryV2Abi, ...parseAbi([
  "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
  "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
  "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
  "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function launchWithEth(LaunchParams p,PoolKey fundingPool) payable returns (LaunchResultV2 result)",
  "function launchWithEthRoute(LaunchParams p,bytes fundingPath) payable returns (LaunchResultV2 result)",
  "function NATIVE_FUNDING_ID() view returns (bytes32)",
  "function wrappedEth() view returns (address)",
  "function wrappedEthCodeHash() view returns (bytes32)",
])] as const;

export const foundationFactoryV3NativeAbi = [...foundationFactoryV3Abi, ...parseAbi([
  "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
  "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
  "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorBuyFeeBps; uint16 creatorSellFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
  "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function launchWithEth(LaunchParams p,PoolKey fundingPool) payable returns (LaunchResultV2 result)",
  "function launchWithEthRoute(LaunchParams p,bytes fundingPath) payable returns (LaunchResultV2 result)",
  "function NATIVE_FUNDING_ID() view returns (bytes32)",
  "function wrappedEth() view returns (address)",
  "function wrappedEthCodeHash() view returns (bytes32)",
])] as const;

export const foundationHookAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function initializer() view returns (address)", "function token() view returns (address)",
  "function quote() view returns (address)", "function creator() view returns (address)",
  "function creatorFeeBps() view returns (uint16)", "function ledger() view returns (address)",
  "function poolId() view returns (bytes32)", "function poolKey() view returns (PoolKey)",
  "function initialTick() view returns (int24)",
  "function feeCarry(bool buy) view returns (uint16 platform,uint16 creator)",
  "function moduleCount() view returns (uint256)",
]);

export const foundationHookV2Abi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function initializer() view returns (address)", "function token() view returns (address)",
  "function quote() view returns (address)", "function creator() view returns (address)",
  "function creatorBuyFeeBps() view returns (uint16)", "function creatorSellFeeBps() view returns (uint16)", "function ledger() view returns (address)",
  "function poolId() view returns (bytes32)", "function poolKey() view returns (PoolKey)",
  "function initialTick() view returns (int24)",
  "function feeCarry(bool buy) view returns (uint16 platform,uint16 creator)",
  "function moduleCount() view returns (uint256)",
]);

export const foundationQuoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteParams params) returns (uint256 amountOut,uint256 gasEstimate)",
  "struct PathKey { address intermediateCurrency; uint24 fee; int24 tickSpacing; address hooks; bytes hookData; }",
  "struct QuoteExactParams { address exactCurrency; PathKey[] path; uint128 exactAmount; }",
  "function quoteExactInput(QuoteExactParams params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
export const foundationPermit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const foundationTokenAbi = parseAbi([
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)",
  "function metadata() view returns (string description,string website,string image,bytes extraData)",
  "function metadataHash() view returns (bytes32)",
]);

export const foundationLedgerAbi = parseAbi([
  "function poolManager() view returns (address)", "function hook() view returns (address)",
  "function quote() view returns (address)", "function creator() view returns (address)",
  "function platformReceived() view returns (uint256)", "function platformClaimed() view returns (uint256)",
  "function creatorCredited() view returns (uint256)", "function creatorClaimed() view returns (uint256)",
  "function claimPlatform() returns (uint256 amount)", "function claimCreator() returns (uint256 amount)",
  "event QuoteClaimed(address indexed beneficiary,uint8 indexed budget,uint256 amount)",
]);

export type FoundationLaunchEntry = { functionName: "launch" }
  | { functionName: "launchWithEthRoute"; fundingPath: Hex }
  | { functionName: "launchWithEth"; fundingPool: FoundationPoolKey };

/** A single, typed choice of the canonical tuple; no packed or inferred fee values. */
export function encodeFoundationLaunchEntry(p: FoundationLaunchParameters, entry: FoundationLaunchEntry): Hex {
  foundationCreatorFeeRates(p);
  if (p.creatorFeeBps === undefined) {
    if (entry.functionName === "launchWithEthRoute") return encodeFunctionData({ abi: foundationFactoryV3NativeAbi, functionName: entry.functionName, args: [p, entry.fundingPath] });
    if (entry.functionName === "launchWithEth") return encodeFunctionData({ abi: foundationFactoryV3NativeAbi, functionName: entry.functionName, args: [p, entry.fundingPool] });
    return encodeFunctionData({ abi: foundationFactoryV3Abi, functionName: "launch", args: [p] });
  }
  if (entry.functionName === "launchWithEthRoute") return encodeFunctionData({ abi: foundationFactoryNativeAbi, functionName: entry.functionName, args: [p, entry.fundingPath] });
  if (entry.functionName === "launchWithEth") return encodeFunctionData({ abi: foundationFactoryNativeAbi, functionName: entry.functionName, args: [p, entry.fundingPool] });
  return encodeFunctionData({ abi: foundationFactoryAbi, functionName: "launch", args: [p] });
}

export function encodeFoundationParameters(p: FoundationLaunchParameters): Hex {
  foundationCreatorFeeRates(p);
  return p.creatorFeeBps === undefined ? encodeAbiParameters(foundationLaunchParametersV3, [p]) : encodeAbiParameters(foundationLaunchParameters, [p]);
}
