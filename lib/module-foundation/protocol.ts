import { decodeFunctionResult, encodeFunctionData, encodeFunctionResult, getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { foundationFactoryAbi, foundationFactoryV2Abi, foundationFactoryV3Abi, foundationFactoryNativeAbi, foundationFactoryV3NativeAbi, type FoundationLaunchParameters, type FoundationLaunchRecord, type FoundationLaunchResultV2 } from "./abi";
import { FOUNDATION_DEAD_ADDRESS, FOUNDATION_INFRASTRUCTURE, FOUNDATION_LP_CUSTODY_DEAD_ID, FOUNDATION_SUPPLY } from "./constants";
import { FOUNDATION_MAX_TICK, FOUNDATION_MIN_TICK } from "./price";
import { foundationPoolId } from "./route";

export type FoundationFactoryVersion = "v1" | "v2" | "v3";
export type FoundationFactoryIdentity = { factoryVersion?: "v1"; lpCustodyId?: never }
  | { factoryVersion: "v2" | "v3"; lpCustodyId: Hex };
export type FoundationDeploymentBinding = FoundationFactoryIdentity & {
  releaseDigest: Hex; sourceCommit: string; startBlock: bigint;
  factory: { address: Address; runtimeCodeHash: Hex };
  hookDeployer: { address: Address; runtimeCodeHash: Hex };
};

const hash = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && BigInt(value) !== 0n;
const nonzero = (value: Address) => BigInt(getAddress(value)) !== 0n;
const same = (a: Address, b: Address) => getAddress(a) === getAddress(b);

/** A missing discriminator belongs only to the structurally validated original V1 binding. */
export function foundationFactoryVersion(binding: FoundationDeploymentBinding): FoundationFactoryVersion {
  if (!binding || !hash(binding.releaseDigest) || !/^[0-9a-f]{40}$/.test(binding.sourceCommit)
    || typeof binding.startBlock !== "bigint" || binding.startBlock <= 0n
    || !binding.factory || !binding.hookDeployer
    || !nonzero(binding.factory.address) || !hash(binding.factory.runtimeCodeHash)
    || !nonzero(binding.hookDeployer.address) || !hash(binding.hookDeployer.runtimeCodeHash)
    || same(binding.factory.address, binding.hookDeployer.address)) throw new Error("The foundation source binding is invalid.");
  if (binding.factoryVersion === undefined || binding.factoryVersion === "v1") {
    if (binding.lpCustodyId !== undefined) throw new Error("A V1 source cannot claim V2 LP custody.");
    return "v1";
  }
  if ((binding.factoryVersion !== "v2" && binding.factoryVersion !== "v3") || binding.lpCustodyId?.toLowerCase() !== FOUNDATION_LP_CUSTODY_DEAD_ID.toLowerCase()) {
    throw new Error("The foundation factory or LP custody version is unsupported.");
  }
  return binding.factoryVersion;
}

export function foundationFactoryAbiFor(binding: FoundationDeploymentBinding) {
  const version = foundationFactoryVersion(binding);
  return version === "v3" ? foundationFactoryV3Abi : version === "v2" ? foundationFactoryV2Abi : foundationFactoryAbi;
}

export function foundationFactoryNativeAbiFor(binding: FoundationDeploymentBinding) {
  return foundationFactoryVersion(binding) === "v3" ? foundationFactoryV3NativeAbi : foundationFactoryNativeAbi;
}

export async function readFoundationHookPrediction(client: PublicClient, binding: FoundationDeploymentBinding, creator: Address,
  token: Address, parameters: FoundationLaunchParameters, functionName: "hookInitCodeHash" | "predictHookAddress", blockNumber: bigint): Promise<Hex> {
  const version = foundationFactoryVersion(binding);
  if (version === "v3") {
    if (parameters.creatorFeeBps !== undefined) throw new Error("V3 requires explicit buy and sell fees.");
    return client.readContract({ address: binding.factory.address, abi: foundationFactoryV3Abi, functionName, args: [creator, token, parameters], blockNumber });
  }
  if (parameters.creatorFeeBps === undefined) throw new Error("Legacy launch bytes require their original creator fee.");
  return client.readContract({ address: binding.factory.address, abi: foundationFactoryAbi, functionName, args: [creator, token, parameters], blockNumber });
}

export async function readFoundationLaunchRecord(client: PublicClient, binding: FoundationDeploymentBinding, token: Address, blockNumber: bigint): Promise<FoundationLaunchRecord> {
  if (foundationFactoryVersion(binding) === "v3") {
    const result = await client.readContract({ address: binding.factory.address, abi: foundationFactoryV3Abi, functionName: "launchOf", args: [token], blockNumber });
    return { ...result, factoryVersion: "v3" };
  }
  if (foundationFactoryVersion(binding) === "v2") {
    const result = await client.readContract({ address: binding.factory.address, abi: foundationFactoryV2Abi, functionName: "launchOf", args: [token], blockNumber });
    return { ...result, factoryVersion: "v2" };
  }
  const result = await client.readContract({ address: binding.factory.address, abi: foundationFactoryAbi, functionName: "launchOf", args: [token], blockNumber });
  return { ...result, factoryVersion: "v1" };
}

export function decodeFoundationLaunchResult(binding: FoundationDeploymentBinding, data: Hex): FoundationLaunchRecord {
  if (foundationFactoryVersion(binding) === "v3") {
    const result = decodeFunctionResult({ abi: foundationFactoryV3Abi, functionName: "launch", data });
    if (encodeFunctionResult({ abi: foundationFactoryV3Abi, functionName: "launch", result }).toLowerCase() !== data.toLowerCase()) throw new Error("The V3 launch result is not canonical ABI data.");
    return { ...result, factoryVersion: "v3" };
  }
  if (foundationFactoryVersion(binding) === "v2") {
    const result = decodeFunctionResult({ abi: foundationFactoryV2Abi, functionName: "launch", data });
    if (encodeFunctionResult({ abi: foundationFactoryV2Abi, functionName: "launch", result }).toLowerCase() !== data.toLowerCase()) throw new Error("The V2 launch result is not canonical ABI data.");
    return { ...result, factoryVersion: "v2" };
  }
  const result = decodeFunctionResult({ abi: foundationFactoryAbi, functionName: "launch", data });
  if (encodeFunctionResult({ abi: foundationFactoryAbi, functionName: "launch", result }).toLowerCase() !== data.toLowerCase()) throw new Error("The V1 launch result is not canonical ABI data.");
  return { ...result, factoryVersion: "v1" };
}

/** Reported V2 amounts are launch principal and rounding inventory, never current withdrawable balances. */
export function assertFoundationV2Result(result: FoundationLaunchResultV2, parameters?: FoundationLaunchParameters): void {
  if ([result.token, result.hook, result.ledger].some(address => !nonzero(address))
    || new Set([result.token, result.hook, result.ledger].map(address => getAddress(address))).size !== 3
    || !hash(result.poolId) || result.basePositionId <= 0n || result.creatorPositionId < 0n
    || result.basePositionId === result.creatorPositionId
    || !same(result.basePositionOwner, FOUNDATION_DEAD_ADDRESS)
    || !same(result.roundingInventoryRecipient, FOUNDATION_DEAD_ADDRESS)
    || (result.creatorPositionId > 0n ? !same(result.creatorPositionOwner, FOUNDATION_DEAD_ADDRESS) : BigInt(result.creatorPositionOwner) !== 0n)
    || result.baseTokenPrincipal <= 0n || result.baseTokenRounding < 0n
    || result.baseTokenPrincipal + result.baseTokenRounding !== FOUNDATION_SUPPLY
    || result.creatorQuotePrincipal < 0n || result.actualQuoteRefund < 0n || result.initialBuyTokenAmount < 0n
    || (result.creatorPositionId > 0n) !== (result.creatorQuotePrincipal > 0n)) {
    throw new Error("The V2 launch result has inconsistent NFT custody, principal or rounding inventory.");
  }
  if (parameters && ((parameters.additionalQuoteAmount > 0n) !== (result.creatorPositionId > 0n)
    || result.creatorQuotePrincipal > parameters.additionalQuoteAmount
    || result.actualQuoteRefund < parameters.additionalQuoteAmount - result.creatorQuotePrincipal
    || result.initialBuyTokenAmount < parameters.initialBuyMinimumTokenAmount
    || (parameters.initialBuyQuoteAmount === 0n && result.initialBuyTokenAmount !== 0n))) {
    throw new Error("The V2 launch principal or actual quote refund differs from the signed funding.");
  }
}

export const foundationPositionAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function ownerOf(uint256 id) view returns (address)",
  "function getApproved(uint256 id) view returns (address)",
  "function getPositionLiquidity(uint256 id) view returns (uint128)",
  "function getPoolAndPositionInfo(uint256 id) view returns (PoolKey poolKey,uint256 info)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed id)",
]);

export interface FoundationV2PositionSpec { kind: "base" | "creator"; id: bigint; lower: number; upper: number; liquidity?: bigint }
export function foundationV2PositionSpecs(result: FoundationLaunchResultV2, quote: Address, initialTick: number,
  liquidity?: { base: bigint; creator?: bigint }): FoundationV2PositionSpec[] {
  assertFoundationV2Result(result);
  const token0 = BigInt(result.token) < BigInt(quote);
  return [{ kind: "base", id: result.basePositionId, lower: token0 ? initialTick : FOUNDATION_MIN_TICK,
    upper: token0 ? FOUNDATION_MAX_TICK : initialTick, liquidity: liquidity?.base },
  ...(result.creatorPositionId === 0n ? [] : [{ kind: "creator" as const, id: result.creatorPositionId,
    lower: token0 ? FOUNDATION_MIN_TICK : initialTick, upper: token0 ? initialTick : FOUNDATION_MAX_TICK, liquidity: liquidity?.creator }])];
}
export function foundationV2PositionCalls(specs: readonly FoundationV2PositionSpec[]) {
  return specs.flatMap(spec => (["ownerOf", "getApproved", "getPositionLiquidity", "getPoolAndPositionInfo"] as const).map(functionName => ({
    to: FOUNDATION_INFRASTRUCTURE.positionManager.address,
    data: encodeFunctionData({ abi: foundationPositionAbi, functionName, args: [spec.id] }),
  })));
}
export function verifyFoundationV2PositionData(specs: readonly FoundationV2PositionSpec[], poolId: Hex, data: readonly Hex[]) {
  if (data.length !== specs.length * 4) throw new Error("The V2 simulation did not read every launch NFT.");
  return specs.map((spec, index) => {
    const owner = decodeFunctionResult({ abi: foundationPositionAbi, functionName: "ownerOf", data: data[index * 4] });
    const approved = decodeFunctionResult({ abi: foundationPositionAbi, functionName: "getApproved", data: data[index * 4 + 1] });
    const liquidity = decodeFunctionResult({ abi: foundationPositionAbi, functionName: "getPositionLiquidity", data: data[index * 4 + 2] });
    const [key, info] = decodeFunctionResult({ abi: foundationPositionAbi, functionName: "getPoolAndPositionInfo", data: data[index * 4 + 3] });
    const tickLower = Number(BigInt.asIntN(24, info >> 8n)), tickUpper = Number(BigInt.asIntN(24, info >> 32n));
    if (!same(owner, FOUNDATION_DEAD_ADDRESS) || BigInt(approved) !== 0n || liquidity <= 0n
      || (spec.liquidity !== undefined && spec.liquidity !== liquidity)
      || foundationPoolId(key).toLowerCase() !== poolId.toLowerCase() || (info >> 56n) !== (BigInt(poolId) >> 56n)
      || tickLower !== spec.lower || tickUpper !== spec.upper) throw new Error(`The ${spec.kind} launch NFT has incorrect DEAD custody, approval, liquidity or pool binding.`);
    return { kind: spec.kind, custody: "dead-v1" as const, positionId: spec.id, status: "active" as const,
      owner: getAddress(owner), tickLower, tickUpper, liquidity };
  });
}
export async function readFoundationV2Positions(client: PublicClient, result: FoundationLaunchResultV2, quote: Address, initialTick: number, blockNumber: bigint) {
  const specs = foundationV2PositionSpecs(result, quote, initialTick);
  const data = await Promise.all(foundationV2PositionCalls(specs).map(async call => {
    const response = await client.call({ ...call, blockNumber });
    if (!response.data) throw new Error("A V2 launch NFT could not be read.");
    return response.data;
  }));
  const positions = verifyFoundationV2PositionData(specs, result.poolId, data);
  return { base: positions[0], creator: positions[1] ?? null };
}
