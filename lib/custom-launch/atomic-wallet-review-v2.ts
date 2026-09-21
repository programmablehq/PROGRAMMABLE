import { getAddress, getContractAddress, keccak256 } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { projectionObject } from "./launch-projection-v1";
import type { CustomLaunchPlanV1, LaunchCallV1, LaunchPlanRecordV1, LaunchWalletStepV1 } from "./launch-plan-v1";
import type { LaunchPlanAtomicBindingV2 } from "./launch-plan-release-authority-v1";
import { customLaunchPlanDigestBytesV1, customLaunchPlanLaunchIdV1, customLaunchPlanOccurrenceIdV1 } from "./stamp-plan-codec-v1";
import { customLaunchPlanAtomicOrderDigestV2, customLaunchPlanAtomicStampHashV2,
  decodeCustomLaunchPlanAtomicCallV2, type CustomLaunchPlanAtomicCallV2 } from "./atomic-plan-codec-v2";

function fail(): never { throw new Error("The combined launch and Stamp do not match this plan's exact order and release. Refresh the launch review."); }
const object = (value: unknown) => projectionObject(value) ? value : fail();
const same = (left: unknown, right: unknown) => canonicalBrowserJsonV2(left) === canonicalBrowserJsonV2(right);
const wire = (value: unknown): unknown => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) ? value.toLowerCase()
  : Array.isArray(value) ? value.map(wire) : projectionObject(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)])) : value;
const sameWire = (left: unknown, right: unknown) => same(wire(left), wire(right));
const keys = (value: Record<string, unknown>, expected: readonly string[]) => same(Object.keys(value).sort(), [...expected].sort());
const resolve = (plan: CustomLaunchPlanV1, ref: LaunchCallV1["target"]) => getAddress("address" in ref ? ref.address
  : plan.components.find(component => component.componentId === ref.componentId)?.expectedAddress ?? fail());

/** Reconstruct the ordered project calls from original plan bytes. The released executor is
 * the CALL sender; direct EOA CREATE keeps its separate, already bound multistep adapter. */
export function atomicCallsFromPlanV2(plan: CustomLaunchPlanV1, binding: LaunchPlanAtomicBindingV2): readonly CustomLaunchPlanAtomicCallV2[] {
  if (plan.executor !== "atomic_execute_and_stamp_v2") fail();
  const calls: CustomLaunchPlanAtomicCallV2[] = [];
  let priorExecution: LaunchCallV1 | null = null;
  let priorWasDeployment = false;
  for (const action of plan.actions) {
    if (action.authority.kind !== "controller" || action.actionId.startsWith("platform:") || action.kind === "deployEoaCreate") fail();
    if (!("execution" in action)) continue;
    const deployment = action.kind === "deployCreate" || action.kind === "deployCreate2";
    const sameDeploymentCall = deployment && priorWasDeployment && same(action.execution, priorExecution);
    if (calls.length > 0 && !sameDeploymentCall && action.preconditions.length > 0) fail();
    if (deployment) {
      const component = plan.components.find(item => item.componentId === action.componentId) ?? fail();
      const expected = action.kind === "deployCreate2"
        ? getContractAddress({ opcode: "CREATE2", from: resolve(plan, action.factory), salt: action.salt, bytecodeHash: keccak256(action.initCode) })
        : getContractAddress({ opcode: "CREATE", from: resolve(plan, action.parent), nonce: BigInt(action.nonce) });
      if (getAddress(component.expectedAddress) !== expected) fail();
    }
    if (!sameDeploymentCall) {
      const target = resolve(plan, action.execution.target);
      const targetRuntimeCodeHash = plan.components.find(item => getAddress(item.expectedAddress) === target)?.runtimeCodeHash
        ?? plan.dependencies.find(item => getAddress(item.address) === target)?.runtimeCodeHash
        ?? (target === getAddress(binding.poolManager) ? binding.poolManagerRuntimeCodeHash : undefined);
      if (!targetRuntimeCodeHash || target === getAddress(binding.address)) fail();
      calls.push({ target, targetRuntimeCodeHash, data: action.execution.data, value: action.execution.value, gasLimit: action.execution.gasLimit });
    }
    priorExecution = action.execution;
    priorWasDeployment = deployment;
  }
  return calls;
}

/** Independent browser comparison against the signed admission and original plan. The final
 * eth_call in the wallet adapter verifies the exact ERC-1271 permit and combined effects. */
export function verifyAtomicWalletReviewV2(resource: LaunchPlanRecordV1, step: LaunchWalletStepV1,
  binding: LaunchPlanAtomicBindingV2, now: bigint) {
  const { order, calls, components, markets } = decodeCustomLaunchPlanAtomicCallV2(step.transaction.data);
  const plan = resource.plan, authorization = object(resource.walletAuthorization), preparation = object(authorization.atomicPreparation);
  if (plan.executor !== "atomic_execute_and_stamp_v2" || resource.steps.length !== 1 || resource.steps[0] !== step
    || !keys(authorization, ["atomicPreparation", "executionOrder"])
    || !keys(preparation, ["order", "calls", "components", "markets", "orderDigest", "stampHash", "sourceEvidenceDigest", "binding"])
    || !same(step.actionIds, [...plan.actions.map(action => action.actionId), "platform:executeAndStampV2"])
    || !same(step.preconditions, [...new Set(plan.actions.flatMap(action => action.preconditions))])
    || !same(step.postconditions, [...new Set([...plan.actions.flatMap(action => action.postconditions), ...plan.expectedEffects.filter(effect => effect.criticality === "critical").map(effect => effect.effectId)])])) fail();
  const expectedComponents = plan.components.map(component => ({ componentId: customLaunchPlanOccurrenceIdV1(resource.planHash, "component", component.componentId),
    account: component.expectedAddress, runtimeCodeHash: component.runtimeCodeHash })).sort((a, b) => a.componentId.localeCompare(b.componentId));
  const expectedMarkets = plan.markets.map(market => ({ marketId: customLaunchPlanOccurrenceIdV1(resource.planHash, "market", market.marketId),
    poolManager: market.poolManager, currency0: resolve(plan, market.currency0), currency1: resolve(plan, market.currency1),
    fee: market.fee, tickSpacing: market.tickSpacing, hooks: resolve(plan, market.hooks) })).sort((a, b) => a.marketId.localeCompare(b.marketId));
  const orderDigest = customLaunchPlanAtomicOrderDigestV2(order), stampHash = customLaunchPlanAtomicStampHashV2(orderDigest);
  if (order.chainId !== "4663" || getAddress(order.executor) !== getAddress(binding.address) || order.executorRuntimeCodeHash !== binding.runtimeCodeHash
    || !step.transaction.to || getAddress(step.transaction.to) !== getAddress(binding.address) || step.transaction.value !== order.totalValue
    || getAddress(order.controller) !== getAddress(plan.controller.address)
    || order.controllerRuntimeCodeHash !== (plan.controller.kind === "eoa" ? `0x${"00".repeat(32)}` : plan.controller.runtimeCodeHash)
    || order.launchId !== customLaunchPlanLaunchIdV1(plan) || order.planHash !== customLaunchPlanDigestBytesV1(resource.planHash)
    || order.manifestDigest !== customLaunchPlanDigestBytesV1(resource.manifestDigest)
    || order.effectsHash !== customLaunchPlanDigestBytesV1(canonicalBrowserSha256V2("programmable.custom-launch-plan-effects.v1", plan.expectedEffects))
    || order.feeObligationsHash !== customLaunchPlanDigestBytesV1(canonicalBrowserSha256V2("programmable.custom-launch-plan-fee-obligations.v1", plan.feeObligations))
    || !sameWire(calls, atomicCallsFromPlanV2(plan, binding)) || !sameWire(components, expectedComponents) || !sameWire(markets, expectedMarkets)
    || markets.some(market => getAddress(market.poolManager) !== getAddress(binding.poolManager))
    || now < BigInt(order.validAfter) || now >= BigInt(order.deadline)
    || BigInt(order.validAfter) < BigInt(plan.budgets.validAfter) || BigInt(order.deadline) > BigInt(plan.budgets.deadline)
    || !sameWire(order, preparation.order) || !sameWire(order, authorization.executionOrder)
    || !sameWire(calls, preparation.calls) || !sameWire(components, preparation.components) || !sameWire(markets, preparation.markets)
    || preparation.orderDigest !== orderDigest || preparation.stampHash !== stampHash || !sameWire(preparation.binding, binding)
    || typeof preparation.sourceEvidenceDigest !== "string" || !/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(preparation.sourceEvidenceDigest)
    || binding.chainId !== plan.chainId || binding.manifestDigest !== resource.manifestDigest
    || binding.policyBindingHash !== resource.admissionEvidence?.policyBindingHash) fail();
  return { functionName: "executeAndStampV2", order, calls, components, markets, orderDigest, stampHash };
}
