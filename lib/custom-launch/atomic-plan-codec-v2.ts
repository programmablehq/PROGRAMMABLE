import { concatHex, decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeFunctionData, hashTypedData,
  isAddress, keccak256, parseAbiParameters, stringToHex, type Address, type Hex } from "viem";
import type { LaunchCallV1 } from "./launch-plan-v1";
// Wire codec mirrored from contract/codec 91016d79 (gas stipend and canonical-topic corrections included).
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

/** Codec only. Encoding a well-formed order never establishes source, simulation, signing or finality authority. */
export const CUSTOM_LAUNCH_PLAN_ATOMIC_EXECUTOR_V2 = "atomic_execute_and_stamp_v2" as const;
export const CUSTOM_LAUNCH_PLAN_ATOMIC_SELECTOR_V2 = "0x506aba45" as const;
export const CUSTOM_LAUNCH_PLAN_ATOMIC_ENVELOPE_SCHEMA_V2 = "programmable.custom-launch-plan-atomic-envelope.v2" as const;
export const CUSTOM_LAUNCH_PLAN_ATOMIC_LIMITS_V2 = Object.freeze({ calls: 32, callDataBytes: 1_048_576,
  components: 64, markets: 32, signatureBytes: 16_384, lifetimeSeconds: 3600 });

export const CUSTOM_LAUNCH_PLAN_ATOMIC_ORDER_FIELDS_V2 = [
  { name: "chainId", type: "uint256" }, { name: "executor", type: "address" },
  { name: "executorRuntimeCodeHash", type: "bytes32" }, { name: "controller", type: "address" },
  { name: "controllerRuntimeCodeHash", type: "bytes32" }, { name: "launchId", type: "bytes32" },
  { name: "planHash", type: "bytes32" }, { name: "manifestDigest", type: "bytes32" },
  { name: "callsHash", type: "bytes32" }, { name: "totalValue", type: "uint256" },
  { name: "componentsHash", type: "bytes32" }, { name: "marketsHash", type: "bytes32" },
  { name: "effectsHash", type: "bytes32" }, { name: "feeObligationsHash", type: "bytes32" },
  { name: "nonce", type: "bytes32" }, { name: "validAfter", type: "uint64" }, { name: "deadline", type: "uint64" },
] as const;
const CALL_FIELDS = [{ name: "target", type: "address" }, { name: "targetRuntimeCodeHash", type: "bytes32" },
  { name: "value", type: "uint256" }, { name: "gasLimit", type: "uint256" }, { name: "data", type: "bytes" }] as const;
const COMPONENT_FIELDS = [{ name: "componentId", type: "bytes32" }, { name: "account", type: "address" },
  { name: "runtimeCodeHash", type: "bytes32" }] as const;
const MARKET_FIELDS = [{ name: "marketId", type: "bytes32" }, { name: "poolManager", type: "address" },
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] as const;
export const CUSTOM_LAUNCH_PLAN_ATOMIC_ORDER_TYPES_V2 = {
  ProgrammableLaunchPlanAtomicOrderV2: CUSTOM_LAUNCH_PLAN_ATOMIC_ORDER_FIELDS_V2,
} as const;
export const CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2 = [
  { type: "function", name: "executeAndStampV2", stateMutability: "payable", inputs: [
    { name: "order", type: "tuple", components: CUSTOM_LAUNCH_PLAN_ATOMIC_ORDER_FIELDS_V2 },
    { name: "calls", type: "tuple[]", components: CALL_FIELDS },
    { name: "components", type: "tuple[]", components: COMPONENT_FIELDS },
    { name: "markets", type: "tuple[]", components: MARKET_FIELDS }, { name: "platformSignature", type: "bytes" },
  ], outputs: [{ name: "stampHash", type: "bytes32" }] },
  { type: "function", name: "launchStampV2", stateMutability: "view", inputs: [{ name: "launchId", type: "bytes32" }],
    outputs: [{ type: "tuple", components: [
      { name: "stampHash", type: "bytes32" }, { name: "orderDigest", type: "bytes32" },
      { name: "planHash", type: "bytes32" }, { name: "manifestDigest", type: "bytes32" },
      { name: "callsHash", type: "bytes32" }, { name: "controller", type: "address" },
      { name: "blockNumber", type: "uint256" },
    ] }] },
  { type: "function", name: "stampProofV2", stateMutability: "view", inputs: [
    { name: "launchId", type: "bytes32" }, { name: "componentId", type: "bytes32" },
  ], outputs: [{ name: "account", type: "address" }, { name: "runtimeCodeHash", type: "bytes32" },
    { name: "stampHash", type: "bytes32" }] },
  { type: "function", name: "marketPoolId", stateMutability: "view", inputs: [
    { name: "launchId", type: "bytes32" }, { name: "marketId", type: "bytes32" },
  ], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "nonceUsed", stateMutability: "view", inputs: [
    { name: "controller", type: "address" }, { name: "nonce", type: "bytes32" },
  ], outputs: [{ type: "bool" }] },
  { type: "function", name: "orderDigestUsed", stateMutability: "view", inputs: [{ name: "orderDigest", type: "bytes32" }],
    outputs: [{ type: "bool" }] },
  { type: "event", name: "AtomicPlanStampedV2", inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "controller", type: "address", indexed: true },
    { name: "planHash", type: "bytes32", indexed: true }, { name: "manifestDigest", type: "bytes32", indexed: false },
    { name: "orderDigest", type: "bytes32", indexed: false }, { name: "stampHash", type: "bytes32", indexed: false },
    { name: "callsHash", type: "bytes32", indexed: false },
  ] },
  { type: "event", name: "AtomicPlanComponentStampedV2", inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "componentId", type: "bytes32", indexed: true },
    { name: "account", type: "address", indexed: true }, { name: "runtimeCodeHash", type: "bytes32", indexed: false },
  ] },
  { type: "event", name: "AtomicPlanMarketStampedV2", inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "marketId", type: "bytes32", indexed: true },
    { name: "poolId", type: "bytes32", indexed: true }, { name: "poolManager", type: "address", indexed: false },
  ] },
  { type: "event", name: "AtomicProjectCallExecutedV2", inputs: [
    { name: "launchId", type: "bytes32", indexed: true }, { name: "callIndex", type: "uint256", indexed: true },
    { name: "target", type: "address", indexed: true },
  ] },
] as const;

export const CUSTOM_LAUNCH_PLAN_ATOMIC_CALL_TYPEHASH_V2 = keccak256(stringToHex(
  "ProgrammableLaunchPlanAtomicCallV2(address target,bytes32 targetRuntimeCodeHash,uint256 value,uint256 gasLimit,bytes32 dataHash)"));
export const CUSTOM_LAUNCH_PLAN_ATOMIC_COMPONENT_TYPEHASH_V2 = keccak256(stringToHex(
  "ProgrammableLaunchPlanAtomicComponentV2(bytes32 componentId,address account,bytes32 runtimeCodeHash)"));
export const CUSTOM_LAUNCH_PLAN_ATOMIC_MARKET_TYPEHASH_V2 = keccak256(stringToHex(
  "ProgrammableLaunchPlanAtomicMarketV2(bytes32 marketId,address poolManager,address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"));
export const CUSTOM_LAUNCH_PLAN_ATOMIC_STAMP_TYPEHASH_V2 = keccak256(stringToHex(
  "ProgrammableLaunchPlanAtomicStampV2(bytes32 orderDigest)"));

export interface CustomLaunchPlanAtomicOrderV2 {
  readonly chainId: string; readonly executor: Address; readonly executorRuntimeCodeHash: Hex;
  readonly controller: Address; readonly controllerRuntimeCodeHash: Hex; readonly launchId: Hex;
  readonly planHash: Hex; readonly manifestDigest: Hex; readonly callsHash: Hex; readonly totalValue: string;
  readonly componentsHash: Hex; readonly marketsHash: Hex; readonly effectsHash: Hex; readonly feeObligationsHash: Hex;
  readonly nonce: Hex; readonly validAfter: string; readonly deadline: string;
}
export interface CustomLaunchPlanAtomicCallV2 {
  readonly target: Address; readonly targetRuntimeCodeHash: Hex; readonly value: string;
  readonly gasLimit: string; readonly data: Hex;
}
export interface CustomLaunchPlanAtomicComponentV2 {
  readonly componentId: Hex; readonly account: Address; readonly runtimeCodeHash: Hex;
}
export interface CustomLaunchPlanAtomicMarketV2 {
  readonly marketId: Hex; readonly poolManager: Address; readonly currency0: Address; readonly currency1: Address;
  readonly fee: number; readonly tickSpacing: number; readonly hooks: Address;
}
export interface CustomLaunchPlanAtomicPayloadV2 {
  readonly order: CustomLaunchPlanAtomicOrderV2; readonly calls: readonly CustomLaunchPlanAtomicCallV2[];
  readonly components: readonly CustomLaunchPlanAtomicComponentV2[]; readonly markets: readonly CustomLaunchPlanAtomicMarketV2[];
}
/** Signatures are not part of the order/plan hash. The issuer independently validates a prepared payload before signing. */
export interface CustomLaunchPlanAtomicEnvelopeV2 extends CustomLaunchPlanAtomicPayloadV2 {
  readonly schemaVersion: typeof CUSTOM_LAUNCH_PLAN_ATOMIC_ENVELOPE_SCHEMA_V2; readonly platformSignature: Hex;
}
export interface CustomLaunchPlanAtomicReleaseBindingV2 {
  readonly chainId: string; readonly address: Address; readonly runtimeCodeHash: Hex;
  readonly permitAuthority: Address; readonly permitAuthorityRuntimeCodeHash: Hex;
  readonly poolManager: Address; readonly poolManagerRuntimeCodeHash: Hex;
}

export function customLaunchPlanAtomicCallsHashV2(calls: readonly CustomLaunchPlanAtomicCallV2[]): Hex {
  if (calls.length === 0 || calls.length > CUSTOM_LAUNCH_PLAN_ATOMIC_LIMITS_V2.calls) throw new TypeError("Atomic calls outside bounds");
  let bytes = 0;
  let totalValue = 0n;
  const hashes = calls.map(call => {
    closed(call, CALL_FIELDS.map(field => field.name), "call");
    address(call.target); hex32(call.targetRuntimeCodeHash); decimal(call.value); decimal(call.gasLimit, 256, true); hex(call.data);
    if (BigInt(call.value) > 0n && BigInt(call.gasLimit) < 2300n) throw new TypeError("Atomic value call gas budget is below its stipend");
    bytes += (call.data.length - 2) / 2;
    totalValue += BigInt(call.value);
    if (bytes > CUSTOM_LAUNCH_PLAN_ATOMIC_LIMITS_V2.callDataBytes || totalValue >= 2n ** 256n) {
      throw new TypeError("Atomic call bytes or total value outside bounds");
    }
    return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,address,bytes32,uint256,uint256,bytes32"), [
      CUSTOM_LAUNCH_PLAN_ATOMIC_CALL_TYPEHASH_V2, call.target, call.targetRuntimeCodeHash,
      BigInt(call.value), BigInt(call.gasLimit), keccak256(call.data),
    ]));
  });
  return keccak256(concatHex(hashes));
}

export function customLaunchPlanAtomicComponentsHashV2(components: readonly CustomLaunchPlanAtomicComponentV2[]): Hex {
  if (components.length > CUSTOM_LAUNCH_PLAN_ATOMIC_LIMITS_V2.components) throw new TypeError("Atomic component limit exceeded");
  orderedIds(components.map(component => component.componentId));
  return keccak256(concatHex(components.map(component => {
    closed(component, COMPONENT_FIELDS.map(field => field.name), "component");
    address(component.account); hex32(component.runtimeCodeHash);
    return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,address,bytes32"), [
      CUSTOM_LAUNCH_PLAN_ATOMIC_COMPONENT_TYPEHASH_V2, component.componentId, component.account, component.runtimeCodeHash,
    ]));
  })));
}

export function customLaunchPlanAtomicMarketsHashV2(markets: readonly CustomLaunchPlanAtomicMarketV2[]): Hex {
  if (markets.length > CUSTOM_LAUNCH_PLAN_ATOMIC_LIMITS_V2.markets) throw new TypeError("Atomic market limit exceeded");
  orderedIds(markets.map(market => market.marketId));
  return keccak256(concatHex(markets.map(market => {
    closed(market, MARKET_FIELDS.map(field => field.name), "market");
    address(market.poolManager); address(market.currency0, true); address(market.currency1); address(market.hooks, true);
    if (BigInt(market.currency0) >= BigInt(market.currency1) || !Number.isInteger(market.fee) || market.fee < 0
      || market.fee >= 2 ** 24 || !Number.isInteger(market.tickSpacing) || market.tickSpacing < -(2 ** 23)
      || market.tickSpacing >= 2 ** 23) throw new TypeError("Atomic market key is malformed");
    return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,address,address,address,uint24,int24,address"), [
      CUSTOM_LAUNCH_PLAN_ATOMIC_MARKET_TYPEHASH_V2, market.marketId, market.poolManager, market.currency0,
      market.currency1, market.fee, market.tickSpacing, market.hooks,
    ]));
  })));
}

export function customLaunchPlanAtomicOrderTypedDataV2(order: CustomLaunchPlanAtomicOrderV2) {
  validateOrder(order);
  return { domain: { name: "ProgrammableLaunchPlanAtomic", version: "2", chainId: BigInt(order.chainId),
    verifyingContract: order.executor }, types: CUSTOM_LAUNCH_PLAN_ATOMIC_ORDER_TYPES_V2,
    primaryType: "ProgrammableLaunchPlanAtomicOrderV2", message: abiOrder(order) } as const;
}
export function customLaunchPlanAtomicOrderDigestV2(order: CustomLaunchPlanAtomicOrderV2): Hex {
  return hashTypedData(customLaunchPlanAtomicOrderTypedDataV2(order));
}
export function customLaunchPlanAtomicStampHashV2(orderDigest: Hex): Hex {
  hex32(orderDigest);
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32"), [
    CUSTOM_LAUNCH_PLAN_ATOMIC_STAMP_TYPEHASH_V2, orderDigest,
  ]));
}

/** Exact Safe CompatibilityFallbackHandler wrapping; a codec does not grant custody/signing permission. */
export function customLaunchPlanAtomicSafeMessageV2(order: CustomLaunchPlanAtomicOrderV2, permitAuthority: Address) {
  address(permitAuthority);
  return deepFreeze({ domain: { chainId: BigInt(order.chainId), verifyingContract: permitAuthority },
    types: { EIP712Domain: [{ name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      SafeMessage: [{ name: "message", type: "bytes" }] }, primaryType: "SafeMessage",
    message: { message: customLaunchPlanAtomicOrderDigestV2(order) } } as const);
}
export function customLaunchPlanAtomicSafeMessageDigestV2(order: CustomLaunchPlanAtomicOrderV2, permitAuthority: Address): Hex {
  return hashTypedData(customLaunchPlanAtomicSafeMessageV2(order, permitAuthority));
}

/** Consistency only. Runtime identity, source, ownership semantics and poststate need independent verification. */
export function assertCustomLaunchPlanAtomicPayloadV2(payload: CustomLaunchPlanAtomicPayloadV2): void {
  validateOrder(payload.order);
  const { order, calls, components, markets } = payload;
  if (customLaunchPlanAtomicCallsHashV2(calls) !== order.callsHash
    || customLaunchPlanAtomicComponentsHashV2(components) !== order.componentsHash
    || customLaunchPlanAtomicMarketsHashV2(markets) !== order.marketsHash
    || calls.reduce((sum, call) => sum + BigInt(call.value), 0n) !== BigInt(order.totalValue)
    || calls.some(call => call.target.toLowerCase() === order.executor.toLowerCase())) {
    throw new TypeError("Atomic payload differs from the signed order");
  }
  for (const market of markets) {
    if (BigInt(market.hooks) !== 0n && !components.some(component => component.account.toLowerCase() === market.hooks.toLowerCase())) {
      throw new TypeError("Atomic hook lacks an expected component occurrence");
    }
  }
}

export function encodeCustomLaunchPlanAtomicCallV2(payload: CustomLaunchPlanAtomicPayloadV2,
  platformSignature: Hex, gasLimit: string): LaunchCallV1 {
  assertCustomLaunchPlanAtomicPayloadV2(payload);
  signature(platformSignature); decimal(gasLimit, 256, true);
  return deepFreeze({ target: { address: payload.order.executor }, value: payload.order.totalValue, gasLimit,
    data: encodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, functionName: "executeAndStampV2", args: [
      abiOrder(payload.order), payload.calls.map(call => ({ ...call, value: BigInt(call.value), gasLimit: BigInt(call.gasLimit) })),
      payload.components, payload.markets, platformSignature,
    ] }) });
}

export function decodeCustomLaunchPlanAtomicCallV2(data: Hex): CustomLaunchPlanAtomicEnvelopeV2 {
  hex(data);
  const decoded = decodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, data });
  if (decoded.functionName !== "executeAndStampV2") throw new TypeError("Not an Atomic V2 execution call");
  const [order, calls, components, markets, platformSignature] = decoded.args;
  const payload: CustomLaunchPlanAtomicPayloadV2 = { order: { ...order, chainId: order.chainId.toString(),
    totalValue: order.totalValue.toString(), validAfter: order.validAfter.toString(), deadline: order.deadline.toString() },
  calls: calls.map(call => ({ ...call, value: call.value.toString(), gasLimit: call.gasLimit.toString() })), components, markets };
  if (encodeCustomLaunchPlanAtomicCallV2(payload, platformSignature, "1").data !== data) {
    throw new TypeError("Atomic calldata is not canonical");
  }
  return deepFreeze({ schemaVersion: CUSTOM_LAUNCH_PLAN_ATOMIC_ENVELOPE_SCHEMA_V2, ...payload, platformSignature });
}

/** This decodes occurrence claims only; callers still verify receipt success, inclusion, exact order and finality. */
export function decodeCustomLaunchPlanAtomicStampLogV2(log: Readonly<{
  address: Address; data: Hex; topics: readonly Hex[];
}>, expectedExecutor: Address) {
  address(expectedExecutor); address(log.address);
  if (log.address.toLowerCase() !== expectedExecutor.toLowerCase()) throw new TypeError("Atomic log emitter is not the released executor");
  hex(log.data);
  if (log.topics.length !== 4 || log.data.length !== 258) throw new TypeError("Atomic stamp log is not canonical");
  log.topics.forEach(topic => hex32(topic, true));
  if (!/^0x0{24}[0-9a-fA-F]{40}$/u.test(log.topics[2]!)) throw new TypeError("Atomic controller topic is not canonically padded");
  const decoded = decodeEventLog({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, eventName: "AtomicPlanStampedV2",
    data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
  if (decoded.args.stampHash !== customLaunchPlanAtomicStampHashV2(decoded.args.orderDigest)) {
    throw new TypeError("Atomic log stamp commitment differs from its order digest");
  }
  return decoded.args;
}

function abiOrder(order: CustomLaunchPlanAtomicOrderV2) {
  return { ...order, chainId: BigInt(order.chainId), totalValue: BigInt(order.totalValue),
    validAfter: BigInt(order.validAfter), deadline: BigInt(order.deadline) };
}
function validateOrder(order: CustomLaunchPlanAtomicOrderV2): void {
  closed(order, CUSTOM_LAUNCH_PLAN_ATOMIC_ORDER_FIELDS_V2.map(field => field.name), "order");
  decimal(order.chainId, 256, true); decimal(order.totalValue); decimal(order.validAfter, 64); decimal(order.deadline, 64);
  address(order.executor); address(order.controller); hex32(order.controllerRuntimeCodeHash, true);
  for (const field of ["executorRuntimeCodeHash", "launchId", "planHash", "manifestDigest", "callsHash", "componentsHash",
    "marketsHash", "effectsHash", "feeObligationsHash", "nonce"] as const) hex32(order[field]);
  const lifetime = BigInt(order.deadline) - BigInt(order.validAfter);
  if (lifetime <= 0n || lifetime > BigInt(CUSTOM_LAUNCH_PLAN_ATOMIC_LIMITS_V2.lifetimeSeconds)) {
    throw new TypeError("Atomic order validity window outside bounds");
  }
}
function closed(value: object, fields: readonly string[], subject: string): void {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw new TypeError(`Noncanonical Atomic ${subject}`);
}
function decimal(value: string, bits = 256, nonzero = false): void {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value) || BigInt(value) >= 2n ** BigInt(bits)
    || nonzero && BigInt(value) === 0n) throw new TypeError("Noncanonical Atomic integer");
}
function address(value: Address, zeroAllowed = false): void {
  if (typeof value !== "string" || !isAddress(value, { strict: false }) || !zeroAllowed && BigInt(value) === 0n) {
    throw new TypeError("Noncanonical Atomic address");
  }
}
function hex(value: Hex): void {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value)) throw new TypeError("Noncanonical Atomic bytes");
}
function hex32(value: Hex, zeroAllowed = false): void {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value) || !zeroAllowed && BigInt(value) === 0n) {
    throw new TypeError("Noncanonical Atomic commitment");
  }
}
function signature(value: Hex): void {
  hex(value);
  if (value.length <= 2 || (value.length - 2) / 2 > CUSTOM_LAUNCH_PLAN_ATOMIC_LIMITS_V2.signatureBytes) {
    throw new TypeError("Atomic signature outside bounds");
  }
}
function orderedIds(ids: readonly Hex[]): void {
  let previous = 0n;
  for (const id of ids) {
    hex32(id);
    if (BigInt(id) <= previous) throw new TypeError("Atomic occurrence IDs must be strictly ordered and unique");
    previous = BigInt(id);
  }
}
