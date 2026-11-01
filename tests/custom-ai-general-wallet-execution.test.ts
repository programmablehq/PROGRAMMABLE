import { describe, expect, it, vi } from "vitest";
import { executeGeneralGraphWalletSend, recoverGeneralGraphWalletSend } from "../lib/custom-ai/general-wallet-execution";
import { beginGraphWalletAttempt, graphWalletActionHash, readGraphWalletAttempts, type GraphWalletAction } from "../lib/custom-ai/general-wallet-attempt";
import { WalletRequestNotSubmittedError } from "../lib/wallet-request-lock";

const action: GraphWalletAction = { chainId: "1", from: `0x${"11".repeat(20)}`, to: `0x${"22".repeat(20)}`, value: "0x0", data: "0x12345678" };
const context = { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", requestHash: `sha256:${"44".repeat(32)}` as const, actionHash: graphWalletActionHash(action) };
const hash = `0x${"55".repeat(32)}` as const;
const boundary = { context, assertCurrent() {} };
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
const current = () => {};

describe("Graph send inside the exclusive canonical wallet boundary", () => {
  it("persists first and calls the wallet once, retaining its observed hash", async () => {
    const store = storage(), send = vi.fn(async () => {
      expect(readGraphWalletAttempts(action.from, "1", store)[0].transactionHash).toBeNull(); return hash;
    });
    await expect(executeGeneralGraphWalletSend({ action, boundary, assertCurrent: current, store, send })).resolves.toBe(hash);
    expect(send).toHaveBeenCalledTimes(1); expect(readGraphWalletAttempts(action.from, "1", store)[0].transactionHash).toBe(hash);
  });
  it.each(["session", "scope", "storage"])("never requests a transaction when the final %s guard fails", async (kind) => {
    const store = storage(), send = vi.fn(async () => hash), stop = () => { throw Error("Changed"); };
    if (kind === "storage") store.setItem = stop;
    await expect(executeGeneralGraphWalletSend({ action, boundary: { ...boundary, assertCurrent: kind === "scope" ? stop : current },
      assertCurrent: kind === "session" ? stop : current, store, send })).rejects.toBeInstanceOf(WalletRequestNotSubmittedError);
    expect(send).not.toHaveBeenCalled();
  });
  it("keeps an unknown broadcast through reload, and blocks the older workspace too", async () => {
    const store = storage(), send = vi.fn(async () => { throw Error("Connection lost after wallet request"); });
    await expect(executeGeneralGraphWalletSend({ action, boundary, assertCurrent: current, store, send })).rejects.toThrow("Connection lost");
    const retry = vi.fn(async () => hash);
    await expect(executeGeneralGraphWalletSend({ action, assertCurrent: current, store, send: retry })).rejects.toBeInstanceOf(WalletRequestNotSubmittedError);
    expect(retry).not.toHaveBeenCalled(); expect(readGraphWalletAttempts(action.from, "1", store)).toHaveLength(1);
  });
  it("allows another explicit attempt only after an explicit wallet rejection", async () => {
    const store = storage();
    await expect(executeGeneralGraphWalletSend({ action, boundary, assertCurrent: current, store, send: async () => { throw { code: 4001 }; } })).rejects.toEqual({ code: 4001 });
    expect(readGraphWalletAttempts(action.from, "1", store)).toEqual([]);
    await expect(executeGeneralGraphWalletSend({ action, boundary, assertCurrent: current, store, send: async () => hash })).resolves.toBe(hash);
  });
  it("returns the observed receipt when persistence fails after broadcast, without enabling a second send", async () => {
    const store = storage(), original = store.setItem; let writes = 0;
    store.setItem = (key, value) => { if (++writes > 1) throw Error("Storage became full"); original(key, value); };
    await expect(executeGeneralGraphWalletSend({ action, boundary, assertCurrent: current, store, send: async () => hash })).resolves.toBe(hash);
    expect(readGraphWalletAttempts(action.from, "1", store)[0].transactionHash).toBeNull();
    const send = vi.fn(async () => hash);
    await expect(executeGeneralGraphWalletSend({ action, boundary, assertCurrent: current, store, send })).rejects.toBeInstanceOf(WalletRequestNotSubmittedError);
    expect(send).not.toHaveBeenCalled();
  });
  it("does not interpret an invalid wallet result as a rejected request", async () => {
    const store = storage();
    await expect(executeGeneralGraphWalletSend({ action, boundary, assertCurrent: current, store, send: async () => "0x" })).rejects.toThrow("valid transaction hash");
    expect(readGraphWalletAttempts(action.from, "1", store)[0].transactionHash).toBeNull();
  });
});

describe("read-only recovery of the original Graph transaction", () => {
  function fixture(chainId = "1") {
    const store = storage(), value = { ...action, chainId }, attempt = beginGraphWalletAttempt({ ...context, actionHash: graphWalletActionHash(value) }, value, store);
    const transaction = { hash, from: value.from, to: value.to, input: value.data, value: value.value, chainId: `0x${Number(chainId).toString(16)}` };
    const request = vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? transaction.chainId : transaction);
    return { store, attempt, transaction, request };
  }
  it.each(["1", "8453", "999"])("recovers chain %s using only its network and exact original transaction reads", async chainId => {
    const f = fixture(chainId);
    await expect(recoverGeneralGraphWalletSend({ ...f, transactionHash: hash, assertCurrent: current })).resolves.toBe(hash);
    expect(f.request.mock.calls.map(([v]) => v.method)).toEqual(["eth_chainId", "eth_getTransactionByHash"]);
    expect(readGraphWalletAttempts(action.from, chainId as "1" | "8453" | "999", f.store)[0].transactionHash).toBe(hash);
  });
  it.each(["from", "to", "input", "value", "hash", "chainId"])("never adopts a recovery hash when %s differs", async field => {
    const f = fixture(); Object.assign(f.transaction, { [field]: field === "input" ? "0xabcd" : field === "value" || field === "chainId" ? "0x2" : `0x${"66".repeat(field === "hash" ? 32 : 20)}` });
    await expect(recoverGeneralGraphWalletSend({ ...f, transactionHash: hash, assertCurrent: current })).rejects.toThrow();
    expect(readGraphWalletAttempts(action.from, "1", f.store)[0].transactionHash).toBeNull();
  });
  it("refuses a stale private scope after the provider returns, retaining the original unknown attempt", async () => {
    const f = fixture(); let checks = 0;
    await expect(recoverGeneralGraphWalletSend({ ...f, transactionHash: hash, assertCurrent: () => { if (++checks > 1) throw Error("Scope changed"); } })).rejects.toThrow("Scope changed");
    expect(readGraphWalletAttempts(action.from, "1", f.store)[0].transactionHash).toBeNull();
  });
  it("refuses changed journal identity before making any provider request", async () => {
    const f = fixture();
    await expect(recoverGeneralGraphWalletSend({ ...f, attempt: { ...f.attempt, requestHash: `sha256:${"77".repeat(32)}` }, transactionHash: hash, assertCurrent: current })).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
});
