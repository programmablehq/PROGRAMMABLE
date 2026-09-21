import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { prepareUniversalLaunchWalletV1, type LaunchWalletProviderV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { atomicCallsFromPlanV2, verifyAtomicWalletReviewV2 } from "@/lib/custom-launch/atomic-wallet-review-v2";
import type { LaunchPlanRecordV1 } from "@/lib/custom-launch/launch-plan-v1";
import { launchFlowPresentationV1, launchFlowStateV1, launchFlowStepsV1 } from "@/lib/custom-launch/launch-flow-v1";
import { customLaunchPlanAtomicCallsHashV2, customLaunchPlanAtomicOrderDigestV2, customLaunchPlanAtomicStampHashV2,
  decodeCustomLaunchPlanAtomicCallV2, encodeCustomLaunchPlanAtomicCallV2 } from "@/lib/custom-launch/atomic-plan-codec-v2";
import { authorizeRecordFixture, capabilitiesFixture, releaseFixture } from "./fixtures/launch-plan-admission-v1";
import { atomicBindingFixture, atomicExecutor, atomicRecordFixture } from "./fixtures/atomic-launch-v2";
import { bindStep, controller, hash, now, recordFixture, runtime } from "./fixtures/universal-launch-v1";

function provider(changedRuntime?: Address): LaunchWalletProviderV1 {
  return { request: vi.fn(async ({ method, params }) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [controller];
    if (method === "eth_getCode") return String(params?.[0]).toLowerCase() === changedRuntime?.toLowerCase() ? "0x6002"
      : params?.[0] === controller ? "0x" : runtime;
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_call") {
      expect(params?.[0]).toMatchObject({ to: atomicExecutor });
      expect(decodeCustomLaunchPlanAtomicCallV2((params![0] as { data: `0x${string}` }).data).platformSignature).toBe("0x11");
      return "0x";
    }
    if (method === "eth_estimateGas") return "0x30d40";
    if (method === "eth_gasPrice") return "0x2";
    throw new Error(`Unexpected wallet method ${method}`);
  }) };
}

describe("exact Atomic V2 wallet handoff", () => {
  it("checks a leading verifyEffect before execution and rejects moving it between calls", async () => {
    const base = recordFixture();
    const check = { actionId: "check-configured", kind: "verifyEffect" as const, effectId: "configured", dependsOn: ["configure"],
      authority: { kind: "controller" as const }, preconditions: [], postconditions: [] };
    const original = atomicRecordFixture({ ...base, plan: { ...base.plan, actions: [check, ...base.plan.actions] } });
    const record = authorizeRecordFixture({ ...original, steps: [bindStep({ ...original.steps[0], preconditions: ["configured"] })] });
    const rpc = provider(), request = rpc.request;
    rpc.request = vi.fn(async input => input.method === "eth_getStorageAt" ? `0x${"00".repeat(32)}` : request(input));
    await expect(prepareUniversalLaunchWalletV1(rpc, controller, { action: "review", sourceVersion: "custom_launch_plan_v1", reviewedResource: record,
      loadFreshResource: async () => record, loadFreshCapabilities: async () => capabilitiesFixture(record) }, now)).rejects.toThrow(/storage precondition changed/);
    expect(vi.mocked(rpc.request).mock.calls.some(([input]) => input.method === "eth_getStorageAt")).toBe(true);
    expect(vi.mocked(rpc.request).mock.calls.some(([input]) => input.method === "eth_call")).toBe(false);
    expect(() => verifyAtomicWalletReviewV2(original, original.steps[0], atomicBindingFixture(original), now)).toThrow(/exact order/);
    const [leading, first, last] = original.plan.actions;
    expect(() => atomicCallsFromPlanV2({ ...original.plan, actions: [first, leading, last] }, atomicBindingFixture(original))).toThrow(/exact order/);
  });
  it("keeps a saved matching hash submitted during a lagging ready response without asserting finality", () => {
    for (const record of [recordFixture(), atomicRecordFixture()]) {
      const step = record.steps[0], submission = { stepId: step.stepId, transactionDigest: step.transactionDigest, transactionHash: hash };
      const view = launchFlowPresentationV1(record, submission);
      expect(view.state).toMatchObject({ title: "Transaction submitted", terminal: false });
      expect(view.steps[0].status).toBe("broadcast");
      expect(record.steps[0].status).toBe("wallet_action_ready");
      expect(launchFlowPresentationV1(record, { ...submission, transactionDigest: "changed" }).steps[0].status).toBe("wallet_action_ready");
      expect(launchFlowPresentationV1({ ...record, status: "final", steps: [{ ...step, status: "final" }] }, submission).state.terminal).toBe(true);
    }
  });
  it("prepares two project calls and Stamp as one ordinary wallet transaction, including under a historical release", async () => {
    const record = authorizeRecordFixture(atomicRecordFixture()), release = releaseFixture(record);
    const rpc = provider();
    const input = { action: "review" as const, sourceVersion: "custom_launch_plan_v1" as const, reviewedResource: record,
      loadFreshResource: async () => record, loadFreshCapabilities: async () => capabilitiesFixture(record, [release]) };
    const review = await prepareUniversalLaunchWalletV1(rpc, controller, input, now);
    expect(review.transaction).toEqual({ from: controller, to: atomicExecutor, chainId: "0x1237", value: "0x0", gas: "0x445c0", nonce: "0x7", data: record.steps[0].transaction.data });
    expect(review.controllerAuthorization).toBeUndefined();
    expect(decodeCustomLaunchPlanAtomicCallV2(review.transaction.data).calls).toHaveLength(2);
    expect(launchFlowStepsV1(record)).toEqual([{ id: "step-1", label: "Launch and Programmable Stamp", stamp: true, status: "wallet_action_ready" }]);
    expect(launchFlowStateV1(record).description).toContain("One wallet transaction");
    expect(launchFlowStateV1({ ...record, status: "analysis_pending", steps: [{ ...record.steps[0], status: "final" }] }).title).toBe("Confirming launch evidence");
    expect(vi.mocked(rpc.request).mock.calls.some(([request]) => /send|sign|wallet_/i.test(request.method))).toBe(false);
    const legacyOnly = { ...release, atomicBinding: undefined, execution: { stamp: release.execution.stamp } };
    await expect(prepareUniversalLaunchWalletV1(rpc, controller, { ...input, loadFreshCapabilities: async () => capabilitiesFixture(record, [legacyOnly]) }, now)).rejects.toThrow(/original release/);
  });

  it("rejects a rehashed but reordered call envelope instead of borrowing the original admission", () => {
    const original = atomicRecordFixture(), binding = atomicBindingFixture(original), step = original.steps[0];
    const decoded = decodeCustomLaunchPlanAtomicCallV2(step.transaction.data), calls = [...decoded.calls].reverse();
    const order = { ...decoded.order, callsHash: customLaunchPlanAtomicCallsHashV2(calls) };
    const orderDigest = customLaunchPlanAtomicOrderDigestV2(order);
    const call = encodeCustomLaunchPlanAtomicCallV2({ ...decoded, order, calls }, decoded.platformSignature, step.transaction.gasLimit);
    const walletAuthorization = { atomicPreparation: { order, calls, components: decoded.components, markets: decoded.markets,
      orderDigest, stampHash: customLaunchPlanAtomicStampHashV2(orderDigest), binding, sourceEvidenceDigest: original.planHash }, executionOrder: order };
    const record = { ...original, walletAuthorization, steps: [bindStep({ ...step, transaction: { ...step.transaction, data: call.data } })] } as unknown as LaunchPlanRecordV1;
    expect(() => verifyAtomicWalletReviewV2(record, record.steps[0], binding, now)).toThrow(/exact order/);
    expect(() => verifyAtomicWalletReviewV2({ ...original, steps: [step, step] }, step, binding, now)).toThrow(/exact order/);
  });

  it("checks current executor, permit authority, PoolManager and controller runtimes before any wallet prompt", async () => {
    const record = authorizeRecordFixture(atomicRecordFixture()), binding = atomicBindingFixture(record);
    for (const address of [binding.address, binding.permitAuthority, binding.poolManager, controller]) {
      const rpc = provider(address);
      await expect(prepareUniversalLaunchWalletV1(rpc, controller, { action: "review", sourceVersion: "custom_launch_plan_v1", reviewedResource: record,
        loadFreshResource: async () => record, loadFreshCapabilities: async () => capabilitiesFixture(record) }, now)).rejects.toThrow(/runtime|account type/);
      expect(vi.mocked(rpc.request).mock.calls.some(([request]) => request.method === "eth_call")).toBe(false);
    }
  });
});
