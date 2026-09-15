import { parseAbi, parseAbiParameters, type Address, type Hex } from "viem";

export interface FoundationMetadata { name: string; symbol: string; description: string; imageURI: string; website: string; socialData: Hex }
export interface FoundationContractModule { factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex; descriptorHash: Hex; configuration: Hex; creatorShareBps: number }
export interface FoundationLaunchParameters {
  metadata: FoundationMetadata; quote: Address; quoteDecimals: number; initialTick: number; creatorFeeBps: number;
  additionalQuoteAmount: bigint; initialBuyQuoteAmount: bigint; initialBuyMinimumTokenAmount: bigint;
  deadline: bigint; tokenSalt: Hex; hookSalt: Hex; modules: readonly FoundationContractModule[];
}
export interface FoundationLaunchResult {
  token: Address; hook: Address; ledger: Address; poolId: Hex; baseVault: Address;
  basePositionId: bigint; creatorPositionId: bigint; initialBuyTokenAmount: bigint;
}

export const foundationMetadataParameters = parseAbiParameters("(string name,string symbol,string description,string imageURI,string website,bytes socialData)");
export const foundationLaunchParameters = parseAbiParameters("((string name,string symbol,string description,string imageURI,string website,bytes socialData) metadata,address quote,uint8 quoteDecimals,int24 initialTick,uint16 creatorFeeBps,uint128 additionalQuoteAmount,uint128 initialBuyQuoteAmount,uint128 initialBuyMinimumTokenAmount,uint64 deadline,bytes32 tokenSalt,bytes32 hookSalt,(address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 descriptorHash,bytes configuration,uint16 creatorShareBps)[] modules)");

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

export const foundationHookAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function initializer() view returns (address)", "function token() view returns (address)",
  "function quote() view returns (address)", "function creator() view returns (address)",
  "function creatorFeeBps() view returns (uint16)", "function ledger() view returns (address)",
  "function poolId() view returns (bytes32)", "function poolKey() view returns (PoolKey)",
  "function feeCarry(bool buy) view returns (uint16 platform,uint16 creator)",
  "function moduleCount() view returns (uint256)",
]);

export const foundationQuoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteParams params) returns (uint256 amountOut,uint256 gasEstimate)",
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
