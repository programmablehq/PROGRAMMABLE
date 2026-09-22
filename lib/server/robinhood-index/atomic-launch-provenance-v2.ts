import { decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult,
  keccak256, parseAbi, parseAbiParameters, type Address, type Hex, type PublicClient } from "viem";
import { canonicalBrowserJsonV2 } from "@/lib/custom-launch/browser-authority-v2";
import type { LaunchProjectionV1 } from "@/lib/custom-launch/launch-plan-v1";
import { projectionAddress, projectionHash, projectionUint, resolveProjectionAddress } from "@/lib/custom-launch/launch-projection-v1";
import { customLaunchPlanOccurrenceIdV1 } from "@/lib/custom-launch/stamp-plan-codec-v1";
import { CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, customLaunchPlanAtomicOrderDigestV2, customLaunchPlanAtomicStampHashV2,
  decodeCustomLaunchPlanAtomicCallV2 } from "@/lib/custom-launch/atomic-plan-codec-v2";
import { readStampEvmBlockNumber } from "./stamp-block-context";

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const digest = (value: unknown): value is `sha256:${string}` => typeof value === "string" && /^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(value);
function fail(): never { throw new Error("Projection Atomic V2 occurrence binding mismatch"); }
const wire = (value: unknown): unknown => typeof value === "bigint" ? value.toString()
  : typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) ? value.toLowerCase()
    : Array.isArray(value) ? value.map(wire) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)])) : value;
const fields = ["schemaVersion", "executorKind", "address", "runtimeCodeHash", "onchainLaunchId", "controller", "planHash", "manifestDigest",
  "stampHash", "permitDigest", "blockNumber", "blockHash", "orderDigest", "callsHash", "callCount", "sourceEvidenceDigest", "releaseId", "admissionReceiptHash", "eventLogIndexes"].sort();
const POOL_STATE_ABI = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);

/** The saved index only accepts the explicit V2 witness. Legacy stamp records retain their
 * original reader; sharing a sourceVersion does not make the two ABIs interchangeable. */
export async function verifyAtomicLaunchProvenanceV2(client: PublicClient, projection: LaunchProjectionV1,
  witness: Record<string, unknown>, source: Address, height: bigint) {
  if (Object.keys(witness).sort().join(",") !== fields.join(",")
    || witness.schemaVersion !== "programmable.custom-launch-plan-atomic-stamp-witness.v2" || witness.executorKind !== "atomic_execute_and_stamp_v2"
    || projection.finality.transactionHashes.length !== 1 || !digest(projection.planHash) || !digest(projection.manifestDigest)
    || !projectionAddress(witness.address) || !same(witness.address, source) || !projectionAddress(witness.controller) || !same(witness.controller, projection.controller)
    || ![witness.runtimeCodeHash, witness.onchainLaunchId, witness.stampHash, witness.permitDigest,
      witness.orderDigest, witness.callsHash, witness.blockHash].every(projectionHash)
    || witness.planHash !== projection.planHash || witness.manifestDigest !== projection.manifestDigest
    || witness.blockNumber !== height.toString() || witness.blockHash !== projection.finality.blockHash
    || !Number.isInteger(witness.callCount) || Number(witness.callCount) < 1 || Number(witness.callCount) > 32
    || ![witness.sourceEvidenceDigest, witness.releaseId, witness.admissionReceiptHash].every(digest)
    || !Array.isArray(witness.eventLogIndexes) || !witness.eventLogIndexes.length || !witness.eventLogIndexes.every(projectionUint)
    || new Set(witness.eventLogIndexes).size !== witness.eventLogIndexes.length
    || witness.permitDigest !== witness.orderDigest
    || witness.stampHash !== customLaunchPlanAtomicStampHashV2(witness.orderDigest as `0x${string}`)) fail();
  const launchId = witness.onchainLaunchId as `0x${string}`;
  const planHash = `0x${projection.planHash.slice(7)}`, manifestDigest = `0x${projection.manifestDigest.slice(7)}`;
  type Reads = {
    launchStampV2: { stampHash: Hex; orderDigest: Hex; planHash: Hex; manifestDigest: Hex; callsHash: Hex; controller: Address; blockNumber: bigint };
    stampProofV2: readonly [Address, Hex, Hex]; marketPoolId: Hex;
  };
  async function read<Name extends keyof Reads>(name: Name, args: readonly Hex[]): Promise<Reads[Name]> {
    const data = encodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, functionName: name, args } as never);
    // EIP-1898 pins every occurrence getter to the verified canonical block hash.
    const raw = await client.request({ method: "eth_call", params: [{ to: source, data }, { blockHash: witness.blockHash, requireCanonical: true }] } as never) as Hex;
    const result = decodeFunctionResult({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, functionName: name, data: raw } as never);
    if (encodeFunctionResult({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, functionName: name, result } as never) !== raw) fail();
    return result as Reads[Name];
  }
  const hash = projection.finality.transactionHashes[0];
  const [stamp, tx, receipt, evmBlockNumber] = await Promise.all([
    read("launchStampV2", [launchId]),
    client.getTransaction({ hash }), client.getTransactionReceipt({ hash }),
    readStampEvmBlockNumber(client, witness.blockHash as Hex),
  ]);
  if (!same(stamp.controller, projection.controller) || stamp.blockNumber !== evmBlockNumber || stamp.planHash !== planHash
    || stamp.manifestDigest !== manifestDigest || stamp.stampHash !== witness.stampHash || stamp.orderDigest !== witness.orderDigest
    || stamp.callsHash !== witness.callsHash || receipt.status !== "success" || receipt.blockNumber !== height || receipt.blockHash !== witness.blockHash
    || tx.hash !== hash || !tx.to || !same(tx.to, source) || !same(tx.from, projection.controller) || tx.blockHash !== witness.blockHash
    || tx.chainId !== undefined && tx.chainId !== 4663 || !["legacy", "eip2930", "eip1559"].includes(tx.type)) fail();
  const envelope = decodeCustomLaunchPlanAtomicCallV2(tx.input), { order, calls, components, markets } = envelope;
  if (!same(order.executor, source) || order.executorRuntimeCodeHash !== witness.runtimeCodeHash || !same(order.controller, projection.controller)
    || order.chainId !== "4663" || order.launchId !== launchId || order.planHash !== planHash || order.manifestDigest !== manifestDigest
    || BigInt(order.totalValue) !== tx.value || order.callsHash !== witness.callsHash || calls.length !== witness.callCount
    || customLaunchPlanAtomicOrderDigestV2(order) !== witness.orderDigest || components.length !== projection.components.length
    || markets.length !== projection.markets.length) fail();
  const poolIdFor = (market: typeof markets[number]) => keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"),
    [market.currency0, market.currency1, market.fee, market.tickSpacing, market.hooks]));
  const expectedEvents = [
    ...calls.map((call, index) => ({ eventName: "AtomicProjectCallExecutedV2", args: { launchId, callIndex: String(index), target: call.target } })),
    ...components.map(component => ({ eventName: "AtomicPlanComponentStampedV2", args: { launchId, ...component } })),
    ...markets.map(market => ({ eventName: "AtomicPlanMarketStampedV2", args: { launchId, marketId: market.marketId, poolId: poolIdFor(market), poolManager: market.poolManager } })),
    { eventName: "AtomicPlanStampedV2", args: { launchId, controller: order.controller, planHash, manifestDigest,
      orderDigest: witness.orderDigest, stampHash: witness.stampHash, callsHash: witness.callsHash } },
  ];
  const logs = receipt.logs.filter(log => same(log.address, source));
  if (logs.length !== expectedEvents.length || witness.eventLogIndexes.length !== logs.length) fail();
  logs.forEach((log, index) => {
    if (log.removed || log.transactionHash !== hash || log.blockHash !== witness.blockHash || log.blockNumber !== height
      || log.logIndex === null || index > 0 && log.logIndex <= logs[index - 1].logIndex!
      || String(log.logIndex) !== (witness.eventLogIndexes as string[])[index]) fail();
    const decoded = decodeEventLog({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, data: log.data, topics: log.topics, strict: true });
    if (canonicalBrowserJsonV2(wire({ eventName: decoded.eventName, args: decoded.args })) !== canonicalBrowserJsonV2(wire(expectedEvents[index]))) fail();
    const topics = encodeEventTopics({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, eventName: decoded.eventName, args: decoded.args } as never);
    const event = CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2.find(item => item.type === "event" && item.name === decoded.eventName);
    if (!event || event.type !== "event") fail();
    const nonIndexed = event.inputs.filter(input => !input.indexed);
    const data = encodeAbiParameters(nonIndexed, nonIndexed.map(input => (decoded.args as Record<string, unknown>)[input.name]) as never);
    if (data !== log.data || canonicalBrowserJsonV2(topics) !== canonicalBrowserJsonV2(log.topics)) fail();
  });
  for (const component of projection.components) {
    const occurrence = customLaunchPlanOccurrenceIdV1(projection.planHash, "component", component.componentId);
    const bound = components.find(item => item.componentId === occurrence);
    const proof = await read("stampProofV2", [launchId, occurrence]);
    if (!bound || !same(bound.account, component.expectedAddress) || bound.runtimeCodeHash !== component.runtimeCodeHash
      || !same(proof[0], component.expectedAddress) || proof[1] !== component.runtimeCodeHash || proof[2] !== stamp.stampHash) fail();
  }
  for (const market of projection.markets) {
    const occurrence = customLaunchPlanOccurrenceIdV1(projection.planHash, "market", market.marketId);
    const bound = markets.find(item => item.marketId === occurrence);
    const currency0 = resolveProjectionAddress(projection, market.currency0), currency1 = resolveProjectionAddress(projection, market.currency1), hooks = resolveProjectionAddress(projection, market.hooks);
    const poolId = keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [currency0, currency1, market.fee, market.tickSpacing, hooks]));
    const actual = await read("marketPoolId", [launchId, occurrence]);
    if (!bound || !same(bound.poolManager, market.poolManager) || !same(bound.currency0, currency0) || !same(bound.currency1, currency1)
      || !same(bound.hooks, hooks) || bound.fee !== market.fee || bound.tickSpacing !== market.tickSpacing || actual !== poolId) fail();
    const slot = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256"), [poolId, 6n]));
    const data = encodeFunctionData({ abi: POOL_STATE_ABI, functionName: "extsload", args: [slot] });
    const state = await client.request({ method: "eth_call", params: [{ to: market.poolManager, data }, { blockHash: witness.blockHash, requireCanonical: true }] } as never);
    // Canonical v4 StateLibrary: slot zero of each pool stores sqrtPriceX96 in its low 160 bits.
    if (!projectionHash(state) || (BigInt(state) & ((1n << 160n) - 1n)) === 0n) fail();
  }
  if ((await client.getBlock({ blockNumber: height })).hash !== witness.blockHash) fail();
}
