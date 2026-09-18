import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, toHex, type TransactionReceipt } from "viem";
import type { FoundationPendingOperation } from "@/lib/module-foundation/wallet";
import { acknowledgeFoundationResolution, FOUNDATION_RESOLUTION_EVENT, readFoundationResolution,
  writeFoundationResolution } from "@/lib/module-foundation/result-store";

const account = getAddress("0x1000000000000000000000000000000000000000");
const target = getAddress("0x2000000000000000000000000000000000000000");
const other = getAddress("0x3000000000000000000000000000000000000000");
const txHash = toHex(1n, { size: 32 }), blockHash = toHex(2n, { size: 32 });
const operationId = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";
const key = `programmable:foundation-resolution:v1:4663:${account.toLowerCase()}`;
const pendingKey = `programmable:foundation-pending:v1:4663:${account.toLowerCase()}`;
const pending: FoundationPendingOperation = { schemaVersion: "programmable.foundation.pending.v1", account,
  operationId, releaseDigest: toHex(3n, { size: 32 }), calldataHash: toHex(4n, { size: 32 }), to: target,
  value: "0x0", nonce: 7, startBlock: "100", createdAt: 1_700_000_000_000, transactionHash: txHash };
const receipt = { from: account, to: target, transactionHash: txHash, blockNumber: 101n, blockHash,
  status: "success", logs: [{ unneeded: "Never persist arbitrary receipt payloads" }] } as unknown as TransactionReceipt;
const metadata = { operationKind: "launch", stepKind: "launch", token: other } as const;

class MemoryStorage {
  readonly values = new Map<string, string>();
  writeMode: "normal" | "throw" | "drop" = "normal";
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.writeMode === "throw") throw new Error("Storage quota exceeded");
    if (this.writeMode === "normal") this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}
let storage: MemoryStorage;
let lockAvailable: boolean;
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  storage = new MemoryStorage(); lockAvailable = true;
  request = vi.fn(async (_name: string, _options: unknown, callback: (lock: object | null) => unknown) => callback(lockAvailable ? {} : null));
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { locks: { request } });
});
afterEach(() => vi.unstubAllGlobals());

describe("durable foundation transaction results", () => {
  it("retains the exact completed operation across a module reload and stores only bounded display identity", async () => {
    const event = vi.fn(); window.addEventListener(FOUNDATION_RESOLUTION_EVENT, event);
    const result = writeFoundationResolution(pending, receipt, metadata);
    expect(result).toMatchObject({ operationId, account, nonce: 7, transactionHash: txHash,
      status: "success", blockNumber: "101", blockHash, metadata });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(event).toHaveBeenCalledTimes(1);
    const serialized = storage.getItem(key)!;
    expect(serialized.length).toBeLessThan(4096);
    expect(serialized).not.toContain("Never persist");
    expect(serialized).not.toContain('"logs"');
    vi.resetModules();
    const reloaded = await import("@/lib/module-foundation/result-store");
    expect(reloaded.readFoundationResolution(account)).toEqual(result);
    expect(readFoundationResolution(other)).toBeNull();
  });

  it("retains an ETH conversion as a launch prerequisite across reload", async () => {
    const conversion = { operationKind: "launch", stepKind: "wrap" } as const;
    const result = writeFoundationResolution(pending, receipt, conversion);
    vi.resetModules();
    const reloaded = await import("@/lib/module-foundation/result-store");
    expect(reloaded.readFoundationResolution(account)?.metadata).toEqual(conversion);
    await reloaded.acknowledgeFoundationResolution(account, result.operationId);
    expect(reloaded.readFoundationResolution(account)).toBeNull();
  });

  it("retains reverted and legacy unknown-step outcomes without inventing completion metadata", () => {
    expect(writeFoundationResolution({ ...pending, transactionHash: null }, { ...receipt, status: "reverted" }))
      .toMatchObject({ status: "reverted", transactionHash: txHash });
    expect(readFoundationResolution(account)?.metadata).toBeUndefined();
  });

  it.each([
    ["sender", { from: other }], ["target", { to: other }], ["hash", { transactionHash: blockHash }],
    ["historical height", { blockNumber: 99n }],
  ] as const)("rejects a receipt with the wrong %s without writing a completed result", (_label, change) => {
    expect(() => writeFoundationResolution(pending, { ...receipt, ...change })).toThrow("cannot be verified");
    expect(readFoundationResolution(account)).toBeNull();
  });

  it("preserves an earlier unacknowledged result when another recovery tries to overwrite it", () => {
    const first = writeFoundationResolution(pending, receipt, metadata);
    expect(() => writeFoundationResolution({ ...pending, operationId: nextId }, receipt, metadata)).toThrow("Review the saved");
    expect(readFoundationResolution(account)).toEqual(first);
  });

  it("allows exact idempotent recovery, but rejects changing its receipt or operation meaning", () => {
    const first = writeFoundationResolution(pending, receipt, metadata);
    expect(writeFoundationResolution(pending, receipt, metadata)).toEqual(first);
    expect(() => writeFoundationResolution(pending, { ...receipt, blockHash: txHash }, metadata)).toThrow("cannot be verified");
    expect(() => writeFoundationResolution(pending, receipt, { stepKind: "approve", operationKind: "launch" })).toThrow("cannot be verified");
    expect(readFoundationResolution(account)).toEqual(first);
  });

  it.each(["throw", "drop"] as const)("fails closed on %s storage writes and leaves the unresolved intent available", mode => {
    storage.setItem(pendingKey, JSON.stringify(pending));
    storage.writeMode = mode;
    expect(() => writeFoundationResolution(pending, receipt, metadata)).toThrow();
    expect(storage.getItem(pendingKey)).toBe(JSON.stringify(pending));
    expect(storage.getItem(key)).toBeNull();
  });

  it("acknowledges only the displayed operation under the wallet's existing account lock and leaves pending untouched", async () => {
    storage.setItem(pendingKey, JSON.stringify(pending));
    writeFoundationResolution(pending, receipt, metadata);
    await expect(acknowledgeFoundationResolution(account, nextId)).rejects.toThrow("result changed");
    expect(readFoundationResolution(account)?.operationId).toBe(operationId);
    await acknowledgeFoundationResolution(account, operationId);
    expect(request).toHaveBeenLastCalledWith(pendingKey, { mode: "exclusive", ifAvailable: true }, expect.any(Function));
    expect(readFoundationResolution(account)).toBeNull();
    expect(storage.getItem(pendingKey)).toBe(JSON.stringify(pending));
    writeFoundationResolution({ ...pending, operationId: nextId }, receipt, metadata);
    await expect(acknowledgeFoundationResolution(account, operationId)).rejects.toThrow("result changed");
    expect(readFoundationResolution(account)?.operationId).toBe(nextId);
  });

  it("does not acknowledge while another tab is submitting or reconciling under the same lock", async () => {
    writeFoundationResolution(pending, receipt, metadata);
    lockAvailable = false;
    await expect(acknowledgeFoundationResolution(account, operationId)).rejects.toThrow("recovery is active");
    expect(readFoundationResolution(account)?.operationId).toBe(operationId);
  });

  it.each(["oversized", "wrong account", "wrong metadata", "empty"])("fails closed on %s persisted data", change => {
    const result = writeFoundationResolution(pending, receipt, metadata);
    storage.values.set(key, change === "oversized" ? "x".repeat(4097) : change === "empty" ? ""
      : JSON.stringify({ ...result, ...(change === "wrong account" ? { account: other }
        : { metadata: { operationKind: "claim", stepKind: "launch" } }) }));
    expect(() => readFoundationResolution(account)).toThrow();
  });
});
