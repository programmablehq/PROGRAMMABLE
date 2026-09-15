import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, keccak256, toHex, type Hex, type PublicClient } from "viem";
import {
  bindFoundationWalletStep, foundationWalletRequestNonce, readFoundationPending, reconcileFoundationPending,
  revalidateFoundationWalletStep, submitFoundationWalletStep,
  type FoundationPreparedSequence, type FoundationWalletPreparation,
} from "@/lib/module-foundation/wallet";
import type { FoundationDeploymentBinding, FoundationPreparedStep } from "@/lib/module-foundation/client";
import { acknowledgeFoundationResolution, readFoundationResolution } from "@/lib/module-foundation/result-store";

const sdk = vi.hoisted(() => ({
  valid: new WeakSet<object>(), infrastructure: vi.fn(), pool: vi.fn(), simulate: vi.fn(),
}));
vi.mock("@/lib/module-foundation/client", async original => ({
  ...await original<typeof import("@/lib/module-foundation/client")>(),
  assertFoundationPreparedSequence(value: object) {
    if (!sdk.valid.has(value)) throw new Error("Sequence was not prepared by the SDK.");
  },
  assertFoundationInfrastructure: sdk.infrastructure,
  assertFoundationPool: sdk.pool,
  simulateFoundationSequence: sdk.simulate,
}));

const a = (n: number) => getAddress(toHex(n, { size: 20 }));
const h = (n: number) => toHex(n, { size: 32 });
const account = a(90), token = a(21), quote = a(22), router = a(80);
const transactionHash = h(200), blockHash = h(100), callData = "0x12345678" as const;
const fixedTime = 1_800_000_000_000;

class MemoryStorage {
  readonly values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("Storage unavailable");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}
class ExclusiveLocks {
  readonly active = new Set<string>();
  readonly requests: string[] = [];
  async request<T>(name: string, _options: unknown, callback: (lock: { name: string } | null) => Promise<T>) {
    this.requests.push(name);
    if (this.active.has(name)) return callback(null);
    this.active.add(name);
    try { return await callback({ name }); } finally { this.active.delete(name); }
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let storage: MemoryStorage, locks: ExclusiveLocks, now: number;
beforeEach(() => {
  sdk.valid = new WeakSet<object>();
  sdk.infrastructure.mockReset().mockResolvedValue({ blockNumber: 100n, blockHash, timestamp: BigInt(fixedTime / 1_000) });
  sdk.pool.mockReset().mockResolvedValue({});
  sdk.simulate.mockReset().mockResolvedValue({});
  storage = new MemoryStorage(); locks = new ExclusiveLocks(); now = fixedTime;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: storage }));
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("navigator", { locks });
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fixture(index = 0, registered = true) {
  const release: FoundationDeploymentBinding = {
    releaseDigest: h(30), sourceCommit: "a".repeat(40), startBlock: 1n,
    factory: { address: a(81), runtimeCodeHash: h(31) },
    hookDeployer: { address: a(82), runtimeCodeHash: h(32) },
  };
  const trade: FoundationPreparedStep = { label: "Buy coin", kind: "buy", gasUsed: 100_000n,
    transaction: { from: account, to: router, data: callData, value: 0n }, effect: "Spend 10; receive at least 8." };
  const approval: FoundationPreparedStep = { label: "Approve quote", kind: "approve", gasUsed: 40_000n,
    transaction: { from: account, to: quote, data: "0xabcdef01", value: 0n }, effect: "Approve 10.", amount: 10n, spender: router };
  const sequence = {
    sourceKind: "module-foundation-v1", kind: "trade", account, binding: structuredClone(release),
    expiresAt: BigInt(fixedTime / 1_000 + 300), pool: { token, quote, hook: a(83), poolId: h(33) },
    side: "buy", amountIn: 10n, amountOut: 9n, minimumOutput: 8n,
    moduleReview: null,
    moduleAssetPins: [], balanceChecks: [{ token: quote, account, delta: -10n }, { token, account, minimumDelta: 8n }],
    balances: [{ token: quote, account, before: 100n, after: 90n, delta: -10n },
      { token, account, before: 0n, after: 9n, delta: 9n }],
    steps: index === 1 ? [approval, trade] : [trade],
  // This boundary fixture supplies only fields read by the wallet. Real SDK construction is checked separately.
  } as unknown as FoundationPreparedSequence;
  if (registered) sdk.valid.add(sequence);
  const getTransaction = vi.fn(async () => ({ hash: transactionHash, from: account, to: router,
    input: callData, value: 0n, nonce: 7, chainId: 4663, blockNumber: 101n, blockHash }));
  const getTransactionReceipt = vi.fn(async () => ({ from: account, to: router, transactionHash, blockNumber: 101n, blockHash, status: "success" }));
  const getBlock = vi.fn(async () => ({ number: 100n, hash: blockHash, timestamp: BigInt(fixedTime / 1_000) }));
  const estimateGas = vi.fn(async (request: unknown) => {
    expect(request).toMatchObject({ account, to: router, data: callData, value: 0n });
    return 100_000n;
  });
  const extraCode = "0x60016000f3" as Hex;
  const getCode = vi.fn(async () => extraCode);
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === "moduleCount") return 0n;
    if (functionName === "name") return "Additional asset";
    if (functionName === "symbol") return "EXTRA";
    if (functionName === "decimals") return 6;
    if (functionName === "totalSupply") return 1_000_000n;
    throw new Error(`Unexpected contract read ${functionName}`);
  });
  const client = { getChainId: vi.fn(async () => 4663), getTransactionCount: vi.fn(async () => 7),
    getBlock, getTransaction, getTransactionReceipt, estimateGas, getCode, readContract } as unknown as PublicClient;
  const resolveAuthority = vi.fn(async () => structuredClone(release));
  const bind = () => bindFoundationWalletStep({ client, sequence, index, resolveAuthority });
  const send = vi.fn(async (value: FoundationWalletPreparation) => {
    try { await revalidateFoundationWalletStep(value, account); await foundationWalletRequestNonce(value); }
    catch (error) { throw Object.assign(error as Error, { walletRequestAttempted: false }); }
    return transactionHash;
  });
  return { sequence, release, client, resolveAuthority, bind, send, getTransaction, getTransactionReceipt, getBlock, estimateGas, getCode, readContract, extraCode };
}

describe("foundation private wallet preparation", () => {
  it("preserves exact debit, minimum output and zero-loss additional asset checks at wallet replay", async () => {
    const f = fixture(), extra = a(23);
    if (f.sequence.kind !== "trade") throw new Error("Trade fixture required");
    f.sequence.moduleAssetPins = [[extra, 6, keccak256(f.extraCode)]];
    f.sequence.balanceChecks = [...f.sequence.balanceChecks, { token: extra, account, minimumDelta: 0n }];
    await submitFoundationWalletStep(f.bind(), f.send);
    expect(f.getCode).toHaveBeenCalledWith({ address: extra, blockNumber: 100n });
    expect(f.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: extra, functionName: "decimals", blockNumber: 100n }));
    expect(sdk.simulate.mock.calls[0][3]).toEqual([
      { token: quote, account, delta: -10n }, { token, account, minimumDelta: 8n }, { token: extra, account, minimumDelta: 0n },
    ]);
  });

  it("rejects changed pinned asset code before a wallet request and keeps no pending intent", async () => {
    const f = fixture(), extra = a(23);
    if (f.sequence.kind !== "trade") throw new Error("Trade fixture required");
    f.sequence.moduleAssetPins = [[extra, 6, keccak256("0x60026000f3")]];
    await expect(submitFoundationWalletStep(f.bind(), f.send)).rejects.toThrow("decimals or runtime code changed");
    expect(f.estimateGas).not.toHaveBeenCalled();
    expect(sdk.simulate).not.toHaveBeenCalled();
    expect(readFoundationPending(account)).toBeNull();
  });

  it("uses fresh required gas for the exact current step when a callback's reserve far exceeds simulated consumption", async () => {
    const f = fixture(1), value = f.bind();
    f.estimateGas.mockResolvedValue(2_000_000n);
    const original = { ...value.transaction };
    await submitFoundationWalletStep(value, async preparation => {
      const transaction = await revalidateFoundationWalletStep(preparation, account);
      expect(transaction.gas).toBe(toHex(2_415_000n));
      expect(transaction).toMatchObject({ from: original.from, to: original.to, data: original.data, value: original.value, chainId: 4663 });
      expect(Object.isFrozen(transaction)).toBe(true);
      expect(value.transaction).toEqual(original);
      await foundationWalletRequestNonce(preparation);
      return transactionHash;
    });
    expect(f.estimateGas).toHaveBeenCalledTimes(1);
    expect(f.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ account, to: router, data: callData, value: 0n }));
    expect(sdk.simulate.mock.calls[0][1]).toHaveLength(1);
  });

  it("keeps an estimate failure as a definite pre-wallet rejection", async () => {
    const f = fixture(); f.estimateGas.mockRejectedValue(new Error("Exact transaction cannot satisfy gas reserve"));
    await expect(submitFoundationWalletStep(f.bind(), f.send)).rejects.toThrow("cannot satisfy gas reserve");
    expect(readFoundationPending(account)).toBeNull();
    expect(readFoundationResolution(account)).toBeNull();
  });

  it("rejects expiry reached during gas estimation before producing a transaction for the provider", async () => {
    const f = fixture();
    f.estimateGas.mockImplementation(async () => { now += 301_000; return 100_000n; });
    await expect(submitFoundationWalletStep(f.bind(), f.send)).rejects.toThrow(/no longer current|expired/i);
    expect(readFoundationPending(account)).toBeNull();
  });

  it("rechecks the exact durable intent after awaited gas estimation", async () => {
    const f = fixture();
    f.estimateGas.mockImplementation(async () => {
      const current = readFoundationPending(account)!;
      const key = `programmable:foundation-pending:v1:4663:${account.toLowerCase()}`;
      storage.setItem(key, JSON.stringify({ ...current, calldataHash: h(999) }));
      return 100_000n;
    });
    await expect(submitFoundationWalletStep(f.bind(), f.send)).rejects.toThrow(/no longer current/i);
    expect(readFoundationPending(account)).toBeNull();
  });

  it("rejects a fabricated sequence and a copied public preparation", async () => {
    const untrusted = fixture(0, false);
    expect(untrusted.bind).toThrow("not prepared");
    const f = fixture(), value = f.bind();
    await expect(revalidateFoundationWalletStep({ ...value }, account)).rejects.toThrow();
    expect(sdk.simulate).not.toHaveBeenCalled();
  });

  it("also rejects fabricated objects in the real SDK registry", async () => {
    const actual = await vi.importActual<typeof import("@/lib/module-foundation/client")>("@/lib/module-foundation/client");
    expect(() => actual.assertFoundationPreparedSequence(fixture().sequence)).toThrow();
  });

  it("does not simulate mutated caller data while returning the original frozen transaction", async () => {
    const f = fixture(), value = f.bind();
    f.sequence.steps[0].transaction.data = "0xdeadbeef";
    f.sequence.steps[0].transaction.to = a(999);
    f.sequence.binding.releaseDigest = h(999);
    f.sequence.balances[0].delta = 0n;
    if (f.sequence.kind === "trade") f.sequence.minimumOutput = 1n;
    await expect(submitFoundationWalletStep(value, f.send)).resolves.toBe(transactionHash);
    const [, steps, , checks] = sdk.simulate.mock.calls[0];
    expect(steps[0].transaction).toMatchObject({ to: router, data: callData, value: 0n });
    expect(checks).toEqual([{ token: quote, account, delta: -10n }, { token, account, minimumDelta: 8n }]);
    expect(value.transaction).toMatchObject({ to: router, data: callData, value: "0x0" });
    expect(Object.isFrozen(value.transaction)).toBe(true);
  });

  it("revalidates only remaining steps and refuses the direct provider bypass", async () => {
    const f = fixture(1), value = f.bind();
    await expect(revalidateFoundationWalletStep(value, account)).rejects.toThrow();
    expect(sdk.simulate).not.toHaveBeenCalled();
    await submitFoundationWalletStep(value, f.send);
    expect(sdk.simulate.mock.calls[0][1]).toHaveLength(1);
    expect(sdk.simulate.mock.calls[0][1][0].transaction.data).toBe(callData);
  });

  it("refuses a changed release and an expiry reached during asynchronous revalidation", async () => {
    const changed = fixture(), changedValue = changed.bind();
    changed.resolveAuthority.mockResolvedValue({ ...changed.release, sourceCommit: "b".repeat(40) });
    await expect(submitFoundationWalletStep(changedValue, changed.send)).rejects.toThrow("release changed");
    expect(readFoundationPending(account)).toBeNull();
    const expired = fixture(), expiredValue = expired.bind();
    sdk.simulate.mockImplementationOnce(async () => { now += 301_000; return {}; });
    await expect(submitFoundationWalletStep(expiredValue, expired.send)).rejects.toThrow(/expired|no longer current/i);
    expect(readFoundationPending(account)).toBeNull();
  });

  it("rejects a nonce consumed during revalidation before opening the provider request", async () => {
    const f = fixture(), value = f.bind();
    vi.mocked(f.client.getTransactionCount).mockResolvedValueOnce(7).mockResolvedValue(8);
    await expect(submitFoundationWalletStep(value, f.send)).rejects.toThrow("Wallet activity changed");
    expect(readFoundationPending(account)).toBeNull();
  });

  it("rechecks the exact persisted operation after asynchronous simulation", async () => {
    const f = fixture(), value = f.bind();
    sdk.simulate.mockImplementationOnce(async () => {
      const key = [...storage.values.keys()][0];
      const pending = JSON.parse(storage.getItem(key)!);
      storage.setItem(key, JSON.stringify({ ...pending, to: a(999) }));
      return {};
    });
    await expect(submitFoundationWalletStep(value, f.send)).rejects.toThrow("no longer current");
    expect(readFoundationPending(account)).toBeNull();
  });
});

describe("foundation durable wallet operation", () => {
  it.each([{ walletRequestAttempted: false }, { walletRequestAttempted: true, walletRequestRejected: true, code: 4001 }])(
    "clears a definite no-send outcome only: %j", async classification => {
      const f = fixture(), value = f.bind();
      await expect(submitFoundationWalletStep(value, async () => {
        expect(readFoundationPending(account)).toMatchObject({ transactionHash: null, nonce: 7, startBlock: "100" });
        throw Object.assign(new Error("Not sent"), classification);
      })).rejects.toThrow("Not sent");
      expect(readFoundationPending(account)).toBeNull();
    },
  );

  it("keeps an unknown outcome across reload/second tab and preserves a known hash when its final storage write fails", async () => {
    const first = fixture();
    await expect(submitFoundationWalletStep(first.bind(), async () => {
      throw Object.assign(new Error("Wallet response lost"), { walletRequestAttempted: true });
    })).rejects.toThrow("Wallet response lost");
    const second = fixture(), secondSend = vi.fn(async () => transactionHash);
    await expect(submitFoundationWalletStep(second.bind(), secondSend)).rejects.toThrow(/previous|reconciliation/i);
    expect(secondSend).not.toHaveBeenCalled();
    expect(readFoundationPending(account)?.transactionHash).toBeNull();
    storage.values.clear(); // Test-only reload fixture reset; production has no clearing shortcut.
    const known = fixture();
    await expect(submitFoundationWalletStep(known.bind(), async () => { storage.failWrites = true; return transactionHash; })).resolves.toBe(transactionHash);
    expect(readFoundationPending(account)?.transactionHash).toBeNull();
  });

  it("does not open a wallet when durable storage is unavailable", async () => {
    const f = fixture(), send = vi.fn(async () => transactionHash);
    storage.failWrites = true;
    await expect(submitFoundationWalletStep(f.bind(), send)).rejects.toThrow("Storage unavailable");
    expect(send).not.toHaveBeenCalled();
  });

  it("serializes same-account requests across tabs", async () => {
    const first = fixture(), entered = deferred<void>(), finish = deferred<Hex>();
    const pending = submitFoundationWalletStep(first.bind(), async () => { entered.resolve(); return finish.promise; });
    await entered.promise;
    const second = fixture(), send = vi.fn(async () => transactionHash);
    await expect(submitFoundationWalletStep(second.bind(), send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    finish.resolve(transactionHash); await pending;
  });
});

describe("foundation exact pending reconciliation", () => {
  async function uncertain() {
    const f = fixture();
    await expect(submitFoundationWalletStep(f.bind(), async () => { throw new Error("Unknown response"); })).rejects.toThrow("Unknown response");
    return f;
  }

  it("rejects a historical identical call with an older nonce", async () => {
    const f = await uncertain();
    f.getTransaction.mockResolvedValueOnce({ ...await f.getTransaction(), nonce: 6 });
    await expect(reconcileFoundationPending(f.client, account, transactionHash)).rejects.toThrow(/match/i);
    expect(readFoundationPending(account)).not.toBeNull();
  });

  it("rejects a stale/noncanonical receipt and resolves the exact canonical transaction", async () => {
    const f = await uncertain();
    f.getBlock.mockResolvedValueOnce({ number: 101n, hash: h(999), timestamp: BigInt(fixedTime / 1_000) });
    await expect(reconcileFoundationPending(f.client, account, transactionHash)).rejects.toThrow(/canonical/i);
    expect(readFoundationPending(account)).not.toBeNull();
    await expect(reconcileFoundationPending(f.client, account, transactionHash)).resolves.toMatchObject({ transactionHash, status: "success" });
    expect(readFoundationPending(account)).toBeNull();
    expect(locks.requests.every(name => name === locks.requests[0])).toBe(true);
  });

  it("does not replace a known send hash with a caller-supplied historic hash", async () => {
    const f = fixture();
    await submitFoundationWalletStep(f.bind(), async () => transactionHash);
    await reconcileFoundationPending(f.client, account, h(999));
    expect(f.getTransaction).toHaveBeenCalledWith({ hash: transactionHash });
  });

  it("retains the confirmed operation after clearing pending and blocks another send until exact acknowledgement", async () => {
    const first = await uncertain();
    await reconcileFoundationPending(first.client, account, transactionHash);
    expect(readFoundationPending(account)).toBeNull();
    const result = readFoundationResolution(account)!;
    expect(result).toMatchObject({ transactionHash, status: "success", metadata: { operationKind: "trade", stepKind: "buy", token } });
    const second = fixture(), send = vi.fn(async () => transactionHash);
    await expect(submitFoundationWalletStep(second.bind(), send)).rejects.toThrow(/previous|reconciliation/i);
    expect(send).not.toHaveBeenCalled();
    await acknowledgeFoundationResolution(account, result.operationId);
    await expect(submitFoundationWalletStep(second.bind(), send)).resolves.toBe(transactionHash);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps pending when a canonical result cannot be durably stored, then recovers without losing the hash", async () => {
    const f = await uncertain(), original = readFoundationPending(account);
    storage.failWrites = true;
    await expect(reconcileFoundationPending(f.client, account, transactionHash)).rejects.toThrow("Storage unavailable");
    expect(readFoundationPending(account)).toEqual(original);
    expect(readFoundationResolution(account)).toBeNull();
    storage.failWrites = false;
    await reconcileFoundationPending(f.client, account, transactionHash);
    expect(readFoundationPending(account)).toBeNull();
    expect(readFoundationResolution(account)?.transactionHash).toBe(transactionHash);
  });

  it("holds the same account lock during receipt recovery", async () => {
    const f = await uncertain(), entered = deferred<void>(), finish = deferred<Awaited<ReturnType<typeof f.getTransactionReceipt>>>();
    f.getTransactionReceipt.mockImplementationOnce(async () => { entered.resolve(); return finish.promise; });
    const recovering = reconcileFoundationPending(f.client, account, transactionHash);
    await entered.promise;
    expect(locks.active.size).toBe(1);
    const other = fixture(), send = vi.fn(async () => transactionHash);
    await expect(submitFoundationWalletStep(other.bind(), send)).rejects.toThrow();
    finish.resolve({ from: account, to: router, transactionHash, blockNumber: 101n, blockHash, status: "success" });
    await recovering;
    expect(send).not.toHaveBeenCalled();
  });
});
