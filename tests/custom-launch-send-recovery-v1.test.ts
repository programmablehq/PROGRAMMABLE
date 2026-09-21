import { describe, expect, it, vi } from "vitest";
import { getContractAddress, keccak256, type Hex } from "viem";
import { beginLaunchSendV1, finalizeLaunchSendV1, parseLaunchSendAttemptV1, readLaunchSendJournalV1, rejectLaunchSendV1, rememberLaunchHashV1 } from "@/lib/custom-launch/launch-send-journal-v1";
import { launchFlowStepsV1 } from "@/lib/custom-launch/launch-flow-v1";
import { launchPlanWalletUrlV1, prepareUniversalLaunchWalletV1, readLaunchPlanResourceV1, recoverUniversalLaunchTransactionV1, type LaunchWalletProviderV1, type UniversalLaunchWalletReviewV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { canonicalBrowserSha256V2 as digest } from "@/lib/custom-launch/browser-authority-v2";
import { authorizeRecordFixture, capabilitiesFixture } from "./fixtures/launch-plan-admission-v1";
import { bindStep, component, controller, hash, now, recordFixture, runtime, runtimeHash, stamp } from "./fixtures/universal-launch-v1";

const review = (): UniversalLaunchWalletReviewV1 => ({ sourceVersion: "custom_launch_plan_v1", launchId: recordFixture().planId, stepId: "configure", binding: recordFixture().steps[0].transactionDigest,
  controllerKind: "eoa", transaction: { chainId: "0x1237", from: controller, to: component, data: "0x12345678", nonce: "0x7", gas: "0x186a0", value: "0x0" },
  maxGasCostWei: "200000", valueWei: "0", deadline: String(now + 600n), preconditions: [], postconditions: [] });
function store() { const entries = new Map<string, string>(); return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } }; }
const recoveryProvider = (tx: unknown): LaunchWalletProviderV1 => ({ request: vi.fn(async ({ method }) => method === "eth_chainId" ? "0x1237" : tx) });

describe("durable custom launch send recovery", () => {
  it("survives more than five minutes, reload and another plan without authorizing another send", () => {
    vi.useFakeTimers();
    try {
      const storage = store(); const attempt = beginLaunchSendV1(review(), storage);
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(parseLaunchSendAttemptV1(readLaunchSendJournalV1(controller, storage), controller)).toEqual(attempt);
      expect(() => beginLaunchSendV1(review(), storage)).toThrow(/earlier launch transaction/);
      expect(() => beginLaunchSendV1({ ...review(), launchId: "20000000-0000-4000-8000-000000000002" }, storage)).toThrow(/earlier launch transaction/);
      rejectLaunchSendV1(attempt, new Error("provider disconnected"), storage);
      expect(readLaunchSendJournalV1(controller, storage)).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("requires working durable storage before sending and only clears explicit rejection", () => {
    expect(() => beginLaunchSendV1(review(), { ...store(), setItem: () => { throw new Error("storage unavailable"); } })).toThrow(/storage/);
    const storage = store(); const attempt = beginLaunchSendV1(review(), storage);
    rejectLaunchSendV1(attempt, { code: 4001 }, storage);
    expect(readLaunchSendJournalV1(controller, storage)).toBeNull();
    expect(() => parseLaunchSendAttemptV1("broken", controller)).toThrow(/saved wallet attempt/);
  });
  it("preserves the hash until the exact backend step is final", () => {
    const storage = store(); const attempt = rememberLaunchHashV1(beginLaunchSendV1(review(), storage), hash, storage);
    const final = { status: "final", transactionDigest: attempt.binding, transactionHash: hash };
    finalizeLaunchSendV1(attempt, { ...final, status: "mined" }, storage);
    expect(() => beginLaunchSendV1(review(), storage)).toThrow();
    finalizeLaunchSendV1(attempt, { ...final, transactionHash: `0x${"bb".repeat(32)}` }, storage);
    expect(readLaunchSendJournalV1(controller, storage)).not.toBeNull();
    finalizeLaunchSendV1(attempt, final, storage);
    expect(readLaunchSendJournalV1(controller, storage)).toBeNull();
  });
  it("recovers only original bytes and does not treat an absent hash or another nonce transaction as no-send proof", async () => {
    const storage = store(); const attempt = beginLaunchSendV1(review(), storage);
    const transaction = { ...review().transaction, hash, input: review().transaction.data };
    await expect(recoverUniversalLaunchTransactionV1(recoveryProvider(transaction), attempt, hash)).resolves.toBe(hash);
    await expect(recoverUniversalLaunchTransactionV1(recoveryProvider(null), attempt, hash)).rejects.toThrow(/remains unresolved/);
    await expect(recoverUniversalLaunchTransactionV1(recoveryProvider({ ...transaction, input: "0x9876" }), attempt, hash)).rejects.toThrow(/does not match/);
    await expect(recoverUniversalLaunchTransactionV1(recoveryProvider({ ...transaction, type: "0x4", authorizationList: [{}] }), attempt, hash)).rejects.toThrow(/does not match/);
    expect(parseLaunchSendAttemptV1(readLaunchSendJournalV1(controller, storage), controller)?.transactionHash).toBeNull();
  });
});

describe("direct EOA creation and launch handoff", () => {
  it.each(["eoa", "delegated_eoa_v1"] as const)("omits to and preserves the %s controller nonce, initcode and constructor address", async kind => {
    const base = recordFixture();
    const expectedAddress = getContractAddress({ from: controller, nonce: 7n });
    const designator = `0xef0100${stamp.slice(2)}` as Hex;
    const plan = { ...base.plan, controller: { address: controller, kind, ...(kind === "delegated_eoa_v1" ? { runtimeCodeHash: keccak256(designator),
      authoritySnapshot: { schemaVersion: "programmable.delegated-eoa-authority.v1", chainId: "4663", delegate: stamp, delegateRuntimeCodeHash: runtimeHash } } : {}) },
      components: [{ ...base.plan.components[0], expectedAddress }], actions: [{ actionId: "create", kind: "deployEoaCreate" as const,
      componentId: "settlement", nonce: "7", dependsOn: [], authority: { kind: "controller" as const }, preconditions: [], postconditions: [],
      execution: { target: null, data: "0x6001600055" as Hex, value: "0", gasLimit: "100000" } }] };
    const planHash = digest("programmable.custom-launch-plan.v1", plan);
    const record = authorizeRecordFixture({ ...base, plan, planHash, rawRequestSha256: planHash,
      steps: [bindStep({ ...base.steps[0], controller: plan.controller, stepId: "create", actionIds: ["create"], postconditions: [], transaction: { ...base.steps[0].transaction, to: null, data: plan.actions[0].execution.data } })] });
    let changedDelegate = false;
    const provider: LaunchWalletProviderV1 = { request: vi.fn(async ({ method, params }) => {
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_accounts") return [controller];
      if (method === "eth_getCode") {
        const target = String(params?.[0]).toLowerCase();
        if (target === controller.toLowerCase()) return kind === "eoa" ? "0x" : designator;
        if (target === expectedAddress.toLowerCase()) return "0x";
        return changedDelegate ? "0x6002" : runtime;
      }
      if (method === "eth_getTransactionCount") return "0x7";
      if (method === "eth_gasPrice") return "0x2";
      if (method === "eth_estimateGas") return "0xc350";
      if (method === "eth_call") { expect(params?.[0]).not.toHaveProperty("to"); return "0x"; }
      throw new Error(`Unexpected RPC ${method}`);
    }) };
    const input = { action: "review" as const, sourceVersion: "custom_launch_plan_v1" as const, reviewedResource: record, stepId: "create",
      loadFreshResource: async () => record, loadFreshCapabilities: async () => capabilitiesFixture(record) };
    const result = await prepareUniversalLaunchWalletV1(provider, controller, input, now);
    expect(result.transaction).not.toHaveProperty("to");
    expect(result.transaction.nonce).toBe("0x7"); expect(result.createdAddress).toBe(expectedAddress);
    expect(result.transaction).not.toHaveProperty("authorizationList");
    expect(result.controllerAuthorization).toBeUndefined();
    if (kind === "delegated_eoa_v1") {
      expect(result.transaction.type).toBe("0x2");
      changedDelegate = true;
      await expect(prepareUniversalLaunchWalletV1(provider, controller, input, now)).rejects.toThrow(/delegate runtime changed/);
    }
    const attempt = beginLaunchSendV1(result, store());
    expect(await recoverUniversalLaunchTransactionV1(recoveryProvider({ ...result.transaction, to: null, input: result.transaction.data, hash }), attempt, hash)).toBe(hash);
  });
  it("accepts optional negotiated walletUrl, preserves the signed plan hash, and rejects a foreign destination", () => {
    const record = recordFixture();
    expect(readLaunchPlanResourceV1({ ...record, walletUrl: launchPlanWalletUrlV1(record.planId) }).planHash).toBe(record.planHash);
    expect(readLaunchPlanResourceV1(record).walletUrl).toBeUndefined();
    expect(() => readLaunchPlanResourceV1({ ...record, walletUrl: "https://example.com/wallet" })).toThrow(/handoff/);
  });
  it("counts the later Stamp before the issuer has appended its transaction", () => {
    expect(launchFlowStepsV1(recordFixture()).map(row => row.label)).toEqual(["Set up contracts", "Programmable Stamp"]);
    expect(launchFlowStepsV1({ ...recordFixture(), steps: [] })).toHaveLength(2);
  });
});
