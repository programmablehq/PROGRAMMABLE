import type { Address, Hex } from "viem";
import { canonicalBrowserSha256V2 as digest } from "@/lib/custom-launch/browser-authority-v2";
import type { LaunchPlanRecordV1 } from "@/lib/custom-launch/launch-plan-v1";
import type { LaunchPlanAtomicBindingV2 } from "@/lib/custom-launch/launch-plan-release-authority-v1";
import { customLaunchPlanDigestBytesV1, customLaunchPlanLaunchIdV1, customLaunchPlanOccurrenceIdV1 } from "@/lib/custom-launch/stamp-plan-codec-v1";
import { customLaunchPlanAtomicCallsHashV2, customLaunchPlanAtomicComponentsHashV2, customLaunchPlanAtomicMarketsHashV2,
  customLaunchPlanAtomicOrderDigestV2, customLaunchPlanAtomicStampHashV2, encodeCustomLaunchPlanAtomicCallV2 } from "@/lib/custom-launch/atomic-plan-codec-v2";
import { bindStep, component, controller, hash, recordFixture, runtimeHash } from "./universal-launch-v1";

export const atomicExecutor = "0x6666666666666666666666666666666666666666" as Address;
export function atomicBindingFixture(record: LaunchPlanRecordV1): LaunchPlanAtomicBindingV2 {
  return { chainId: "4663", manifestDigest: record.manifestDigest,
    policyBindingHash: digest("programmable.custom-launch-plan-policy-binding.v1", { fixture: true }),
    address: atomicExecutor, runtimeCodeHash: runtimeHash,
    permitAuthority: "0x5555555555555555555555555555555555555555", permitAuthorityRuntimeCodeHash: runtimeHash,
    poolManager: "0x7777777777777777777777777777777777777777", poolManagerRuntimeCodeHash: runtimeHash };
}

// Browser-safe transport fixture. Its signature is deliberately synthetic; Node tests attach a real ephemeral admission.
export function atomicRecordFixture(base = recordFixture()): LaunchPlanRecordV1 {
  const plan = { ...base.plan, executor: "atomic_execute_and_stamp_v2" as const,
    actions: [...base.plan.actions, { actionId: "activate", dependsOn: ["configure"], authority: { kind: "controller" as const },
      preconditions: [], postconditions: [], kind: "call" as const,
      execution: { target: { componentId: "settlement" }, data: "0x87654321" as Hex, value: "0", gasLimit: "100000" } }] };
  const planHash = digest("programmable.custom-launch-plan.v1", plan), binding = atomicBindingFixture(base);
  const calls = ["0x12345678", "0x87654321"].map(data => ({ target: component, targetRuntimeCodeHash: runtimeHash,
    data: data as Hex, value: "0", gasLimit: "100000" }));
  const components = [{ componentId: customLaunchPlanOccurrenceIdV1(planHash, "component", "settlement"), account: component, runtimeCodeHash: runtimeHash }];
  const resolve = (ref: { address: Address } | { componentId: string }) => "address" in ref ? ref.address
    : plan.components.find(item => item.componentId === ref.componentId)!.expectedAddress;
  const markets = plan.markets.map(market => ({ marketId: customLaunchPlanOccurrenceIdV1(planHash, "market", market.marketId), poolManager: market.poolManager,
    currency0: resolve(market.currency0), currency1: resolve(market.currency1), fee: market.fee, tickSpacing: market.tickSpacing, hooks: resolve(market.hooks) }));
  const order = { chainId: "4663", executor: atomicExecutor, executorRuntimeCodeHash: runtimeHash, controller,
    controllerRuntimeCodeHash: `0x${"00".repeat(32)}` as Hex, launchId: customLaunchPlanLaunchIdV1(plan),
    planHash: customLaunchPlanDigestBytesV1(planHash), manifestDigest: customLaunchPlanDigestBytesV1(base.manifestDigest),
    callsHash: customLaunchPlanAtomicCallsHashV2(calls), totalValue: "0", componentsHash: customLaunchPlanAtomicComponentsHashV2(components),
    marketsHash: customLaunchPlanAtomicMarketsHashV2(markets),
    effectsHash: customLaunchPlanDigestBytesV1(digest("programmable.custom-launch-plan-effects.v1", plan.expectedEffects)),
    feeObligationsHash: customLaunchPlanDigestBytesV1(digest("programmable.custom-launch-plan-fee-obligations.v1", plan.feeObligations)),
    nonce: hash, validAfter: plan.budgets.validAfter, deadline: plan.budgets.deadline };
  const payload = { order, calls, components, markets }, orderDigest = customLaunchPlanAtomicOrderDigestV2(order);
  const preparation = { ...payload, orderDigest, stampHash: customLaunchPlanAtomicStampHashV2(orderDigest), sourceEvidenceDigest: planHash, binding };
  const call = encodeCustomLaunchPlanAtomicCallV2(payload, "0x11", "280000");
  const walletAuthorization = { atomicPreparation: preparation, executionOrder: order };
  return { ...base, plan, planHash, rawRequestSha256: planHash, walletAuthorization,
    admissionEvidence: { ...base.admissionEvidence, policyBindingHash: binding.policyBindingHash, walletAuthorization },
    steps: [bindStep({ ...base.steps[0], stepId: "step-1", actionIds: [...plan.actions.map(action => action.actionId), "platform:executeAndStampV2"],
      transaction: { ...base.steps[0].transaction, to: atomicExecutor, data: call.data, gasLimit: call.gasLimit }, preconditions: [], postconditions: ["configured"] })] } as LaunchPlanRecordV1;
}
