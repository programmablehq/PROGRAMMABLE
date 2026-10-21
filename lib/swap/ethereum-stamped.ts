import { Actions, URVersion, V4Planner } from "@uniswap/v4-sdk";
import { CommandType, RoutePlanner, UniversalRouterVersion } from "@uniswap/universal-router-sdk";
import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { customTradePermit2Abi, customTradeRouterAbi, customTradeTokenAbi } from "@/lib/custom-launch/trade-v1";
import { parsePreparedTransaction, type PreparedTradeTransaction } from "@/lib/prepared-transaction";
import { isLaunchStampProvenanceV1, type CanonicalTokenExploreEntry, type LaunchStampProvenanceV1 } from "@/lib/tokens";
import { computeOfficialV4PoolId } from "@/lib/uniswap/liquidity-launcher-sdk";
import { ETHEREUM_ROUTING_FEE_BOUNDARY_V1, ethereumPoolFeeMatchesPolicy,
  validateEthereumFeeClassificationV1, type EthereumFeeClassificationV1 } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import { assertIssuedEthereumNative30RuntimeProofV1, rebuildEthereumNative30RuntimeProofV1, ethereumNative30FeeAmountV1,
  type EthereumNative30RuntimeProofV1 } from "@/lib/custom-launch/ethereum-native30-runtime-v1";
import { ethereumStampedBridge, type EthereumStampedBridge } from "./ethereum-stamped-bridges";

const NATIVE = "0x0000000000000000000000000000000000000000";
const UINT128_MAX = (1n << 128n) - 1n;
export const ETHEREUM_PERMIT2_APPROVAL_GRACE_SECONDS = 3600n;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const digest = (v: unknown): v is `sha256:${string}` => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Reviewed Ethereum infrastructure, independent of any particular token.
 * This is the existing v2.2 deployment and its matching V2_0 action ABI. */
export const ETHEREUM_STAMPED_SWAP_PROTOCOL = Object.freeze({
  poolManager: { address: "0x000000000004444c5dc75cB358380D2e3dE08A90", runtimeCodeHash: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293" },
  permit2: { address: "0x000000000022d473030f116ddee9f6b43ac78ba3", runtimeCodeHash: "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131" },
  router: { address: "0xd92a36b0000531ef3063ded4de20a0783308446c", runtimeCodeHash: "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49" },
} as const);

export interface EthereumStampedSwapRoute {
  schemaVersion: "programmable.ethereum-stamped-swap-route.v1";
  chainId: 1;
  tokenDecimals: number;
  stamp: LaunchStampProvenanceV1;
  routeBindingHash: `sha256:${string}`;
  feeClassification?: EthereumFeeClassificationV1;
  bridge?: EthereumStampedBridge;
}
export interface EthereumStampedSwapRequest {
  schemaVersion: "programmable.ethereum-stamped-swap-request.v1";
  chainId: 1;
  token: Address;
  owner: Address;
  side: "buy" | "sell";
  amountIn: string;
  slippageBps: number;
  deadline: string;
  routeBindingHash: `sha256:${string}`;
}
export interface EthereumSwapRuntimeBinding { address: Address; runtimeCodeHash: Hex }
export interface EthereumSwapFeeV1 {
  policyHash: `sha256:${string}`;
  mode: "programmable_routed" | "pool_enforced_native30" | "pool_enforced_native100";
  rateBps: 30 | 100;
  routedRateBps: 0 | 30 | 100;
  recipient: Address;
  grossNativeAmount: string;
  platformFeeAmount: string;
  netNativeAmount: string;
  native30Proof: EthereumNative30RuntimeProofV1 | null;
  accrual: Record<string, unknown> | null;
}
export interface EthereumStampedSwapPreparation {
  schemaVersion: "programmable.ethereum-stamped-swap-preparation.v1";
  status: "ready" | "approval-required";
  request: EthereumStampedSwapRequest;
  quote: { amountOut: string; amountOutMinimum: string; blockNumber: string; blockHash: Hex; blockTimestamp: string; validUntil: string };
  transaction: PreparedTradeTransaction;
  evidence: { kind: "independent-rpc-simulation"; runtimeBindings: readonly EthereumSwapRuntimeBinding[]; runtimeBindingHash: `sha256:${string}`; executionDigest: `sha256:${string}` };
  preparationDigest: `sha256:${string}`;
  fee?: EthereumSwapFeeV1;
}

export class EthereumStampedSwapError extends Error {
  constructor(message: string, readonly code = "ETHEREUM_SWAP_UNAVAILABLE", readonly status = 409) { super(message); this.name = "EthereumStampedSwapError"; }
}
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new EthereumStampedSwapError(message); }

function routeHash(stamp: LaunchStampProvenanceV1, tokenDecimals: number, feeClassification?: EthereumFeeClassificationV1,
  bridge?: EthereumStampedBridge) {
  // Presentation and later observation checkpoints are deliberately excluded.
  return canonicalBrowserSha256V2("programmable.ethereum-stamped-swap-route-binding.v1", {
    chainId: 1, tokenDecimals, launchId: stamp.launchId.toLowerCase(), stampHash: stamp.stampHash.toLowerCase(),
    router: stamp.routerAddress.toLowerCase(), token: stamp.tokenProof.tokenAddress.toLowerCase(),
    poolManager: stamp.poolManagerAddress.toLowerCase(), poolId: stamp.poolId.toLowerCase(),
    poolKey: { ...stamp.poolKey, currency0: stamp.poolKey.currency0.toLowerCase(), currency1: stamp.poolKey.currency1.toLowerCase(), hooks: stamp.poolKey.hooks.toLowerCase() },
    protocol: ETHEREUM_STAMPED_SWAP_PROTOCOL,
    ...(feeClassification ? { feeClassification } : {}),
    ...(bridge ? { bridge } : {}),
  });
}

/** A route candidate proves origin and encoding. Only transaction preparation
 * proves that this owner's requested swap currently executes. No audit or
 * reviewed-provider descriptor is inferred from a launch stamp. */
export function ethereumStampedSwapRoute(entry: CanonicalTokenExploreEntry, feeClassification?: EthereumFeeClassificationV1): EthereumStampedSwapRoute | null {
  const stamp = entry.launchStampProvenance;
  if (!stamp || stamp.kind !== "custom-graph" || stamp.chainId !== 1
    || !isLaunchStampProvenanceV1(stamp, { chainId: 1, tokenAddress: entry.tokenAddress, hookAddress: entry.hookAddress, poolId: entry.poolId })
    || !Number.isInteger(entry.tokenDecimals) || Number(entry.tokenDecimals) < 0 || Number(entry.tokenDecimals) > 36
    || !same(stamp.poolManagerAddress, ETHEREUM_STAMPED_SWAP_PROTOCOL.poolManager.address)
    || !same(computeOfficialV4PoolId(stamp.poolKey), stamp.poolId)) return null;
  const native = same(stamp.poolKey.currency0, NATIVE) && same(stamp.poolKey.currency1, entry.tokenAddress);
  const bridge = native ? undefined : ethereumStampedBridge(stamp.poolKey, entry.tokenAddress);
  if (!native && !bridge) return null;
  if (BigInt(stamp.blockNumber) > BigInt(ETHEREUM_ROUTING_FEE_BOUNDARY_V1.blockNumber) && !feeClassification) return null;
  try { if (feeClassification) validateEthereumFeeClassificationV1(feeClassification, stamp); } catch { return null; }
  return Object.freeze({ schemaVersion: "programmable.ethereum-stamped-swap-route.v1", chainId: 1,
    tokenDecimals: entry.tokenDecimals!, stamp, routeBindingHash: routeHash(stamp, entry.tokenDecimals!, feeClassification, bridge),
    ...(feeClassification ? { feeClassification } : {}), ...(bridge ? { bridge } : {}) });
}

export function parseEthereumStampedSwapRoute(value: unknown, expected: { token: string; decimals: number }): EthereumStampedSwapRoute {
  requireValue(object(value) && value.schemaVersion === "programmable.ethereum-stamped-swap-route.v1" && value.chainId === 1
    && value.tokenDecimals === expected.decimals && digest(value.routeBindingHash), "The Ethereum route is invalid.");
  const candidate = value as unknown as EthereumStampedSwapRoute;
  requireValue(isAddress(expected.token) && isLaunchStampProvenanceV1(candidate.stamp, { chainId: 1, tokenAddress: getAddress(expected.token) }), "The Ethereum launch stamp is invalid.");
  const rebuilt = ethereumStampedSwapRoute({ tokenAddress: expected.token, tokenDecimals: expected.decimals,
    hookAddress: candidate.stamp.poolKey.hooks, poolId: candidate.stamp.poolId, launchStampProvenance: candidate.stamp } as CanonicalTokenExploreEntry, candidate.feeClassification);
  requireValue(rebuilt && rebuilt.routeBindingHash === candidate.routeBindingHash, "The Ethereum route does not match this coin.");
  requireValue(canonicalBrowserJsonV2(rebuilt.bridge ?? null) === canonicalBrowserJsonV2(candidate.bridge ?? null), "The Ethereum bridge does not match this route.");
  return rebuilt;
}

export function parseEthereumStampedSwapRequest(value: unknown): EthereumStampedSwapRequest {
  const keys = ["amountIn", "chainId", "deadline", "owner", "routeBindingHash", "schemaVersion", "side", "slippageBps", "token"];
  requireValue(object(value) && Object.keys(value).sort().join() === keys.join(), "Send a valid Ethereum swap request.");
  requireValue(value.schemaVersion === "programmable.ethereum-stamped-swap-request.v1" && value.chainId === 1
    && typeof value.token === "string" && isAddress(value.token) && !same(value.token, NATIVE)
    && typeof value.owner === "string" && isAddress(value.owner) && !same(value.owner, NATIVE)
    && (value.side === "buy" || value.side === "sell") && digest(value.routeBindingHash)
    && typeof value.amountIn === "string" && /^[1-9][0-9]{0,38}$/.test(value.amountIn) && BigInt(value.amountIn) <= UINT128_MAX
    && typeof value.deadline === "string" && /^[1-9][0-9]{0,11}$/.test(value.deadline)
    && Number.isSafeInteger(value.slippageBps) && Number(value.slippageBps) >= 1 && Number(value.slippageBps) <= 500,
  "The Ethereum swap request is invalid.");
  return Object.freeze({ ...value, token: getAddress(value.token), owner: getAddress(value.owner) } as unknown as EthereumStampedSwapRequest);
}

export function ethereumStampedRuntimeBindings(route: EthereumStampedSwapRoute): readonly EthereumSwapRuntimeBinding[] {
  const stamp = route.stamp;
  const bindings = [...Object.values(ETHEREUM_STAMPED_SWAP_PROTOCOL),
    { address: stamp.routerAddress, runtimeCodeHash: stamp.routerRuntimeCodeHash },
    { address: stamp.routeLauncherAddress, runtimeCodeHash: stamp.routeLauncherRuntimeCodeHash }, ...stamp.components,
    ...(route.bridge ? [route.bridge.quoteToken] : [])];
  const result = new Map<string, EthereumSwapRuntimeBinding>();
  for (const item of bindings) {
    const address = getAddress(item.address), runtimeCodeHash = item.runtimeCodeHash.toLowerCase() as Hex;
    requireValue(!result.has(address.toLowerCase()) || same(result.get(address.toLowerCase())!.runtimeCodeHash, runtimeCodeHash), "The launch has conflicting runtime bindings.");
    result.set(address.toLowerCase(), { address, runtimeCodeHash });
  }
  return [...result.values()].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
}

export const ethereumNative30Market = (route: EthereumStampedSwapRoute) => ({ chainId: "1" as const,
  poolManager: getAddress(route.stamp.poolManagerAddress), ...route.stamp.poolKey });
export const ethereumRouteRequiresFee = (route: EthereumStampedSwapRoute) => route.feeClassification?.profileVersion === "3.6.0";
/** Select only the exact policy authenticated by this launch's finalized stamp. */
export function ethereumRouteFeePolicy(route: EthereumStampedSwapRoute) {
  const binding = route.feeClassification?.routingFeePolicy;
  if (!ethereumRouteRequiresFee(route) || !binding) throw new TypeError("Verified Ethereum fee policy required.");
  validateEthereumFeeClassificationV1(route.feeClassification!, route.stamp);
  return binding;
}


function swapTransaction(route: EthereumStampedSwapRoute, request: EthereumStampedSwapRequest, minimum: bigint,
  native30Proof?: EthereumNative30RuntimeProofV1): PreparedTradeTransaction {
  if (native30Proof) assertIssuedEthereumNative30RuntimeProofV1(native30Proof, ethereumNative30Market(route));
  const feePolicy = ethereumRouteRequiresFee(route) ? ethereumRouteFeePolicy(route) : null;
  if (native30Proof && feePolicy) requireValue(ethereumPoolFeeMatchesPolicy(feePolicy.policy, native30Proof), "The pool fee recipient differs from the launch policy.");
  const charge = feePolicy !== null && !native30Proof;
  const upfrontFee = charge && request.side === "buy" ? BigInt(request.amountIn) * BigInt(feePolicy!.policy.rateBps) / 10_000n : 0n;
  const amountIn = BigInt(request.amountIn) - upfrontFee;
  requireValue(minimum > 0n && minimum <= UINT128_MAX, "The swap returned no usable output.");
  const planner = new V4Planner();
  if (route.bridge) {
    const quote = route.bridge.quoteToken.address;
    const pools = request.side === "buy"
      ? [route.bridge.poolKey, route.stamp.poolKey] : [route.stamp.poolKey, route.bridge.poolKey];
    const inputs = [request.side === "buy" ? NATIVE : request.token, quote];
    // Both swaps share one PoolManager unlock. OPEN_DELTA (0) consumes the
    // first hop's actual UNI credit, without guessing or rounding its output.
    pools.forEach((poolKey, index) => planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{ poolKey,
      zeroForOne: same(poolKey.currency0, inputs[index]!), amountIn: index === 0 ? amountIn.toString() : "0",
      amountOutMinimum: index === 0 ? "1" : minimum.toString(), hookData: "0x" }], URVersion.V2_0));
  } else {
    planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{ poolKey: route.stamp.poolKey, zeroForOne: request.side === "buy",
      amountIn: amountIn.toString(), amountOutMinimum: minimum.toString(), hookData: "0x" }], URVersion.V2_0);
  }
  planner.addAction(Actions.SETTLE_ALL, [request.side === "buy" ? NATIVE : request.token, amountIn.toString()], URVersion.V2_0);
  if (charge && request.side === "sell") planner.addAction(Actions.TAKE_PORTION,
    [NATIVE, feePolicy!.policy.defaultCollection.recipient, feePolicy!.policy.defaultCollection.routedRateBps], URVersion.V2_0);
  planner.addAction(Actions.TAKE_ALL, [request.side === "buy" ? request.token : NATIVE, minimum.toString()], URVersion.V2_0);
  const plannerRoute = new RoutePlanner();
  if (upfrontFee > 0n) plannerRoute.addCommand(CommandType.TRANSFER,
    [NATIVE, feePolicy!.policy.defaultCollection.recipient, upfrontFee.toString()], false, UniversalRouterVersion.V2_0);
  plannerRoute.addCommand(CommandType.V4_SWAP, [planner.finalize()], false, UniversalRouterVersion.V2_0);
  // Return any native refund to msgSender. A hook may reduce the settled input;
  // remaining transaction value must never stay in the public router.
  plannerRoute.addCommand(CommandType.SWEEP, [NATIVE, "0x0000000000000000000000000000000000000001", "0"], false, UniversalRouterVersion.V2_0);
  return { kind: "swap", chainId: 1, to: getAddress(ETHEREUM_STAMPED_SWAP_PROTOCOL.router.address),
    data: encodeFunctionData({ abi: customTradeRouterAbi, functionName: "execute", args: [plannerRoute.commands as Hex, plannerRoute.inputs as Hex[], BigInt(request.deadline)] }),
    value: request.side === "buy" ? request.amountIn : "0", gasLimit: "1" };
}

export function ethereumStampedSwapTransaction(route: EthereumStampedSwapRoute, request: EthereumStampedSwapRequest, amountOut: bigint,
  native30Proof?: EthereumNative30RuntimeProofV1): PreparedTradeTransaction {
  requireValue(amountOut > 0n && amountOut <= UINT128_MAX, "The swap returned no usable output.");
  return swapTransaction(route, request, amountOut * (10_000n - BigInt(request.slippageBps)) / 10_000n, native30Proof);
}
/** Simulation only. This transaction is never returned for wallet submission. */
export const ethereumStampedProbeTransaction = (route: EthereumStampedSwapRoute, request: EthereumStampedSwapRequest,
  native30Proof?: EthereumNative30RuntimeProofV1) => swapTransaction(route, request, 1n, native30Proof);

export function ethereumStampedApprovalTransaction(request: EthereumStampedSwapRequest, kind: "token-to-permit2" | "permit2-to-router"): PreparedTradeTransaction {
  return kind === "token-to-permit2"
    ? { kind, chainId: 1, to: request.token, data: encodeFunctionData({ abi: customTradeTokenAbi, functionName: "approve", args: [getAddress(ETHEREUM_STAMPED_SWAP_PROTOCOL.permit2.address), BigInt(request.amountIn)] }), value: "0" }
    : { kind, chainId: 1, to: getAddress(ETHEREUM_STAMPED_SWAP_PROTOCOL.permit2.address), data: encodeFunctionData({ abi: customTradePermit2Abi, functionName: "approve",
      args: [request.token, getAddress(ETHEREUM_STAMPED_SWAP_PROTOCOL.router.address), BigInt(request.amountIn), Number(BigInt(request.deadline) + ETHEREUM_PERMIT2_APPROVAL_GRACE_SECONDS)] }), value: "0" };
}

export const ethereumStampedPreparationDigest = (body: Omit<EthereumStampedSwapPreparation, "preparationDigest">) =>
  canonicalBrowserSha256V2("programmable.ethereum-stamped-swap-preparation.v1", body);
export const ethereumStampedRuntimeDigest = (bindings: readonly EthereumSwapRuntimeBinding[]) =>
  canonicalBrowserSha256V2("programmable.ethereum-stamped-swap-runtime.v1", bindings);

export function validateEthereumStampedPreparation(value: unknown, route: EthereumStampedSwapRoute, request: EthereumStampedSwapRequest, now: bigint): EthereumStampedSwapPreparation {
  requireValue(object(value) && value.schemaVersion === "programmable.ethereum-stamped-swap-preparation.v1"
    && (value.status === "ready" || value.status === "approval-required") && object(value.quote) && object(value.evidence)
    && canonicalBrowserJsonV2(value.request) === canonicalBrowserJsonV2(request), "The swap response does not match your request.");
  const prepared = value as unknown as EthereumStampedSwapPreparation, { quote, evidence } = prepared;
  requireValue([quote.amountOut, quote.amountOutMinimum, quote.blockNumber, quote.blockTimestamp, quote.validUntil].every(item => typeof item === "string" && /^[0-9]{1,78}$/.test(item))
    && /^0x[0-9a-f]{64}$/i.test(quote.blockHash) && BigInt(quote.validUntil) > now && BigInt(quote.validUntil) <= now + 30n
    && BigInt(quote.validUntil) <= BigInt(request.deadline) && BigInt(quote.blockTimestamp) <= now + 5n && now <= BigInt(quote.blockTimestamp) + 60n
    && BigInt(quote.amountOutMinimum) === BigInt(quote.amountOut) * (10_000n - BigInt(request.slippageBps)) / 10_000n,
  "The swap quote expired or changed.");
  requireValue(evidence.kind === "independent-rpc-simulation" && Array.isArray(evidence.runtimeBindings) && evidence.runtimeBindings.length <= 96
    && digest(evidence.executionDigest) && digest(evidence.runtimeBindingHash)
    && evidence.runtimeBindings.every(binding => isAddress(binding.address) && /^0x[0-9a-f]{64}$/i.test(binding.runtimeCodeHash))
    && new Set(evidence.runtimeBindings.map(binding => binding.address.toLowerCase())).size === evidence.runtimeBindings.length
    && evidence.runtimeBindingHash === ethereumStampedRuntimeDigest(evidence.runtimeBindings), "The current swap runtime could not be verified.");
  for (const expected of ethereumStampedRuntimeBindings(route)) requireValue(evidence.runtimeBindings.some(binding => same(binding.address, expected.address) && same(binding.runtimeCodeHash, expected.runtimeCodeHash)), "The swap runtime does not match the launch.");
  const transaction = parsePreparedTransaction(prepared.transaction);
  let native30Proof: EthereumNative30RuntimeProofV1 | undefined;
  if (ethereumRouteRequiresFee(route)) {
    const fee = prepared.fee, feePolicy = ethereumRouteFeePolicy(route);
    requireValue(fee && fee.policyHash === feePolicy.policyHash && fee.rateBps === feePolicy.policy.rateBps
      && same(fee.recipient, feePolicy!.policy.defaultCollection.recipient)
      && [fee.grossNativeAmount, fee.platformFeeAmount, fee.netNativeAmount].every(amount => typeof amount === "string" && /^(0|[1-9][0-9]{0,77})$/.test(amount)), "The platform fee is invalid.");
    if (fee.mode === "pool_enforced_native30" || fee.mode === "pool_enforced_native100") {
      native30Proof = rebuildEthereumNative30RuntimeProofV1(fee.native30Proof, ethereumNative30Market(route));
      requireValue(ethereumPoolFeeMatchesPolicy(feePolicy.policy, native30Proof)
        && fee.mode === (native30Proof.rateBps === 100 ? "pool_enforced_native100" : "pool_enforced_native30")
        && fee.routedRateBps === 0 && native30Proof.runtimeBindings.every(expected => evidence.runtimeBindings.some(binding => same(binding.address, expected.address)
        && same(binding.runtimeCodeHash, expected.runtimeCodeHash))), "The pool fee runtime is incomplete.");
    } else requireValue(fee.mode === "programmable_routed" && fee.routedRateBps === feePolicy.policy.defaultCollection.routedRateBps && fee.native30Proof === null && fee.accrual === null, "The platform fee mode is invalid.");
    const gross = BigInt(fee.grossNativeAmount), platform = BigInt(fee.platformFeeAmount);
    let remainderBefore = 0n;
    if (native30Proof?.rounding === "floor_with_remainder" && transaction.kind === "swap") {
      const accrued = fee.accrual;
      requireValue(object(accrued) && [accrued.platformRemainderBefore, accrued.platformRemainderAfter]
        .every(value => typeof value === "string" && /^(0|[1-9][0-9]{0,5})$/.test(value)), "The platform fee remainder is invalid.");
      remainderBefore = BigInt(accrued.platformRemainderBefore as string);
      requireValue(ethereumNative30FeeAmountV1(native30Proof, gross, remainderBefore).remainder === BigInt(accrued.platformRemainderAfter as string), "The platform fee remainder is invalid.");
    }
    requireValue(BigInt(fee.netNativeAmount) === gross - platform
      && platform === ethereumNative30FeeAmountV1(native30Proof ?? { rateBps: feePolicy.policy.rateBps, rounding: "floor_per_trade" }, gross, remainderBefore).amount,
    "The platform fee amount is invalid.");
    if (transaction.kind === "swap") {
      requireValue(gross > 0n && (request.side !== "buy" || (native30Proof ? gross <= BigInt(request.amountIn) : gross === BigInt(request.amountIn)))
        && (request.side !== "sell" || native30Proof || BigInt(fee.netNativeAmount) === BigInt(quote.amountOut)), "The platform fee does not match the trade.");
      if (native30Proof) {
        const accrued = fee.accrual;
        requireValue(object(accrued) && accrued.proofDigest === native30Proof.proofDigest && accrued.vault === native30Proof.feeVault
          && accrued.recipient === native30Proof.recipient && accrued.rateBps === native30Proof.rateBps && accrued.currency === NATIVE
          && accrued.assessmentBase === "gross_native_leg" && accrued.rounding === native30Proof.rounding
          && accrued.grossNativeAmount === fee.grossNativeAmount && accrued.platformAccruedIncrease === fee.platformFeeAmount
          && digest(accrued.callbackTraceDigest) && digest(accrued.recordTraceDigest), "The pool fee accrual is invalid.");
        const ledger = (key: string) => { const value = accrued[key]; const change = key === "creatorAccruedIncrease" || key === "backingIncrease";
          requireValue(typeof value === "string" && (change ? /^(0|-?[1-9][0-9]{0,77})$/ : /^(0|[1-9][0-9]{0,77})$/).test(value), "The pool fee ledger is invalid."); return BigInt(value); };
        requireValue(ledger("platformAccruedAfter") - ledger("platformAccruedBefore") === platform
          && ledger("creatorAccruedAfter") - ledger("creatorAccruedBefore") === ledger("creatorAccruedIncrease")
          && ledger("backingAfter") - ledger("backingBefore") === ledger("backingIncrease")
          && ledger("backingIncrease") === platform + ledger("creatorAccruedIncrease")
          && ledger("backingBefore") >= ledger("platformAccruedBefore") + ledger("creatorAccruedBefore")
          && ledger("backingAfter") >= ledger("platformAccruedAfter") + ledger("creatorAccruedAfter"), "The pool fee is not backed.");
      }
    } else requireValue(gross === 0n && fee.accrual === null, "An approval cannot charge a platform fee.");
  } else requireValue(prepared.fee === undefined, "The historical fee policy changed.");
  const expected = transaction.kind === "swap" ? ethereumStampedSwapTransaction(route, request, BigInt(quote.amountOut), native30Proof)
    : transaction.kind === "token-to-permit2" || transaction.kind === "permit2-to-router" ? ethereumStampedApprovalTransaction(request, transaction.kind) : null;
  requireValue(expected && transaction.chainId === 1 && transaction.kind === expected.kind && same(transaction.to, expected.to)
    && transaction.data === expected.data && transaction.value === expected.value && transaction.gasLimit && BigInt(transaction.gasLimit) > 0n
    && ((transaction.kind === "swap") === (prepared.status === "ready")) && (transaction.kind === "swap" || request.side === "sell"), "The swap transaction is not canonical.");
  const { preparationDigest, ...body } = prepared;
  requireValue(digest(preparationDigest) && preparationDigest === ethereumStampedPreparationDigest(body), "The swap preparation changed.");
  return prepared;
}
