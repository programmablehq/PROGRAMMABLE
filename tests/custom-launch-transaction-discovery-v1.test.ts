import { describe, expect, it, vi } from "vitest";
import { toHex } from "viem";
import { discoverUniversalLaunchTransactionV1 } from "@/lib/custom-launch/launch-transaction-discovery-v1";
import type { LaunchSendAttemptV1 } from "@/lib/custom-launch/launch-send-journal-v1";
import { recoverUniversalLaunchTransactionV1, type LaunchWalletProviderV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { atomicRecordFixture } from "./fixtures/atomic-launch-v2";
import { controller, hash } from "./fixtures/universal-launch-v1";

const resource = atomicRecordFixture();
const step = resource.steps[0];
const blockHash = `0x${"ab".repeat(32)}`;
const attempt: LaunchSendAttemptV1 = {
  schemaVersion: "programmable.custom-launch-send.v1", sourceVersion: "custom_launch_plan_v1",
  launchId: resource.planId, stepId: step.stepId, binding: step.transactionDigest, controller, chainId: "4663",
  nonce: "0x7", startedAt: "2026-10-12T20:00:00.000Z", transactionHash: null,
  transaction: { chainId: "0x1237", from: controller, to: step.transaction.to!, data: step.transaction.data,
    value: toHex(BigInt(step.transaction.value)), gas: toHex(BigInt(step.transaction.gasLimit)), nonce: "0x7" },
};
const transaction = { ...attempt.transaction, hash, input: attempt.transaction.data, blockHash, blockNumber: "0x2710" };
const receipt = { transactionHash: hash, status: "0x1", blockHash, blockNumber: transaction.blockNumber, gasUsed: "0x30d40" };
function provider(options: { unmined?: boolean; wrongChain?: boolean; transaction?: typeof transaction; receipt?: unknown; reorg?: boolean; failHistory?: boolean } = {}): LaunchWalletProviderV1 {
  return { request: vi.fn(async ({ method, params }) => {
    if (method === "eth_chainId") return options.wrongChain ? "0x1" : "0x1237";
    if (method === "eth_blockNumber") return "0x2730";
    if (method === "eth_getTransactionCount") {
      if (options.failHistory) throw new Error("archive unavailable");
      return options.unmined || BigInt(String(params![1])) < 10_000n ? "0x7" : "0x8";
    }
    if (method === "eth_getBlockByNumber") {
      expect(params![0]).toBe("0x2710");
      return { number: "0x2710", hash: options.reorg && !params![1] ? hash : blockHash, transactions: [options.transaction ?? transaction] };
    }
    if (method === "eth_getTransactionByHash") return options.transaction ?? transaction;
    if (method === "eth_getTransactionReceipt") return options.receipt ?? receipt;
    throw new Error(`Unexpected RPC method: ${method}`);
  }) };
}

describe("automatic recovery of the original launch transaction", () => {
  it("finds the nonce-consuming block and validates the original call without signing or editing the attempt", async () => {
    const rpc = provider();
    await expect(discoverUniversalLaunchTransactionV1(rpc, attempt, resource)).resolves.toBe(hash);
    const methods = vi.mocked(rpc.request).mock.calls.map(([call]) => call.method);
    expect(methods.length).toBeLessThan(20);
    expect(methods.some(method => /send|sign|wallet_|accounts/i.test(method))).toBe(false);
    expect(attempt.transactionHash).toBeNull();
  });
  it("does not ask for a chain switch or imply no send when the nonce is still pending", async () => {
    const wrong = provider({ wrongChain: true }), pending = provider({ unmined: true });
    await expect(discoverUniversalLaunchTransactionV1(wrong, attempt, resource)).resolves.toBeNull();
    expect(wrong.request).toHaveBeenCalledTimes(1);
    await expect(discoverUniversalLaunchTransactionV1(pending, attempt, resource)).resolves.toBeNull();
    expect(pending.request).toHaveBeenCalledTimes(3);
    expect(attempt.transactionHash).toBeNull();
  });
  it("rejects a different call consuming the same nonce and ignores a reorganized block", async () => {
    await expect(discoverUniversalLaunchTransactionV1(provider({ transaction: { ...transaction, input: "0x1234" } }), attempt, resource)).rejects.toThrow(/does not match/);
    await expect(discoverUniversalLaunchTransactionV1(provider({ reorg: true }), attempt, resource)).resolves.toBeNull();
  });
  it("stops on cancellation or unavailable archive history with no journal change", async () => {
    const abort = new AbortController(); abort.abort();
    const rpc = provider();
    await expect(discoverUniversalLaunchTransactionV1(rpc, attempt, resource, abort.signal)).rejects.toThrow();
    expect(rpc.request).not.toHaveBeenCalled();
    await expect(discoverUniversalLaunchTransactionV1(provider({ failHistory: true }), attempt, resource)).rejects.toThrow(/archive unavailable/);
    expect(attempt.transactionHash).toBeNull();
  });
  it("recovers a confirmed atomic call when the wallet increased outer gas but actual usage stayed in budget", async () => {
    const rpc = provider({ transaction: { ...transaction, gas: toHex(BigInt(transaction.gas) + 100_000n) } });
    await expect(discoverUniversalLaunchTransactionV1(rpc, attempt, resource)).resolves.toBe(hash);
    expect(vi.mocked(rpc.request).mock.calls.some(([call]) => call.method === "eth_getTransactionReceipt")).toBe(true);
  });
  it("keeps exact gas required without a matching atomic resource, success receipt and original consumption budget", async () => {
    const changed = { ...transaction, gas: toHex(BigInt(transaction.gas) + 100_000n) };
    await expect(recoverUniversalLaunchTransactionV1(provider({ transaction: changed }), attempt, hash)).rejects.toThrow(/gas budget/);
    for (const changedReceipt of [{ ...receipt, status: "0x0" }, { ...receipt, transactionHash: blockHash },
      { ...receipt, gasUsed: changed.gas }, { ...receipt, blockNumber: "0x2711" }]) {
      await expect(recoverUniversalLaunchTransactionV1(provider({ transaction: changed, receipt: changedReceipt }), attempt, hash, resource)).rejects.toThrow(/successful receipt/);
    }
    await expect(recoverUniversalLaunchTransactionV1(provider({ transaction: { ...transaction, gas: "0x1" } }), attempt, hash, resource)).rejects.toThrow(/gas budget/);
    expect(attempt.transactionHash).toBeNull();
  });
});
