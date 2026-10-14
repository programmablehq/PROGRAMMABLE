import { brotliDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, getAddress, type Hex } from "viem";
import recordingBytes from "./fixtures/ethereum-stamped-swap-rpc.json";
import { type RouterCustomIdentitySnapshotV1 } from "@/lib/alchemy/router-custom-public.server";
import { ETHEREUM_STAMPED_SWAP_PROTOCOL as protocol, ethereumStampedApprovalTransaction, ethereumStampedPreparationDigest,
  ethereumStampedRuntimeDigest, ethereumStampedSwapRoute, parseEthereumStampedSwapRequest, validateEthereumStampedPreparation,
  type EthereumStampedSwapPreparation, type EthereumStampedSwapRequest } from "@/lib/swap/ethereum-stamped";
import { prepareEthereumStampedSwap } from "@/lib/server/swap/ethereum-stamped";
import { parseSwapTokenDescriptor, prepareSwap, submitSwap, type SwapWalletActions } from "@/lib/swap/client";
import { customTradePermit2Abi, customTradeTokenAbi } from "@/lib/custom-launch/trade-v1";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { computeOfficialV4PoolId } from "@/lib/uniswap/liquidity-launcher-sdk";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/alchemy/router-custom-public.server", () => ({ readFinalizedRouterCustomIdentitySnapshotCoreV1: vi.fn() }));
const pending = vi.hoisted(() => ({ begin: vi.fn(async () => ({ id: "fixture" })), record: vi.fn(async value => value) }));
vi.mock("@/lib/swap/pending", () => ({ getPendingSwap: () => null, beginPendingSwap: pending.begin,
  clearPendingSwap: vi.fn(), recordPendingSwapHash: pending.record, subscribePendingSwap: vi.fn() }));
type RecordedCase = "buy" | "sell" | "sell-permit" | "sell-ready";
const recording = JSON.parse(brotliDecompressSync(Buffer.from(recordingBytes.brotliBase64, "base64")).toString()) as Record<RecordedCase, {
  request: EthereumStampedSwapRequest; snapshot: RouterCustomIdentitySnapshotV1; now: string;
  rpcs: { method: string; params: unknown[]; result: unknown }[][];
}>;

// Public, read-only mainnet responses captured from both committed providers.
// Replays run offline. No keys, RPC URLs, transaction sends or guessed balances.
function fixture(side: RecordedCase = "buy", change?: (value: unknown, method: string, params: readonly unknown[], provider: number) => unknown) {
  const saved = recording[side], request = parseEthereumStampedSwapRequest(saved.request), snapshot = saved.snapshot as unknown as RouterCustomIdentitySnapshotV1;
  const records = saved.rpcs;
  const rpcs = records.map((items, provider) => vi.fn(async (method: string, params: readonly unknown[]) => {
    const match = items.find(item => item.method === method && JSON.stringify(item.params) === JSON.stringify(params));
    if (!match) throw Error(`Unrecorded read: ${method}`);
    const value = structuredClone(match.result);
    return change ? change(value, method, params, provider) : value;
  })) as unknown as readonly [TradeRpcV1, TradeRpcV1];
  const now = () => BigInt(saved.now);
  const route = ethereumStampedSwapRoute(snapshot.entries.find(entry => entry.tokenAddress.toLowerCase() === request.token.toLowerCase())!)!;
  return { request, snapshot, rpcs, now, route, prepare: () => prepareEthereumStampedSwap(request, { rpcs, now, readSnapshot: async () => snapshot }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("automatic stamped Ethereum swaps", () => {
  it("reuses identical pinned reads only within one preparation", async () => {
    const f = fixture();
    await f.prepare();
    for (const rpc of f.rpcs) {
      const calls = vi.mocked(rpc).mock.calls.filter(([method, params]) =>
        ["eth_call", "eth_getCode", "eth_getBalance"].includes(method)
        && typeof params[1] === "object" && params[1] !== null && "blockHash" in params[1]);
      expect(new Set(calls.map(call => JSON.stringify(call))).size).toBe(calls.length);
    }
    const before = f.rpcs.map(rpc => vi.mocked(rpc).mock.calls.length);
    await f.prepare();
    f.rpcs.forEach((rpc, index) => expect(vi.mocked(rpc).mock.calls.length).toBe(before[index] * 2));
  });
  it("still performs a fresh canonical-block check after both simulations", async () => {
    const reads = [0, 0];
    const checkpoint = recording.buy.rpcs[0].find(item => item.method === "eth_getBlockByNumber" && item.params[0] !== "latest")!.params[0];
    const f = fixture("buy", (value, method, params, provider) => {
      if (method === "eth_getBlockByNumber" && params[0] === checkpoint
        && ++reads[provider] > 1) return { ...(value as object), hash: `0x${"77".repeat(32)}` };
      return value;
    });
    await expect(f.prepare()).rejects.toMatchObject({ code: "ETHEREUM_SWAP_CHECKPOINT_CHANGED" });
  });
  it("simulates the actual owner's complete buy and binds both current proxy implementations", async () => {
    const f = fixture(), prepared = await f.prepare();
    expect(validateEthereumStampedPreparation(prepared, f.route, f.request, f.now())).toEqual(prepared);
    expect(prepared).toMatchObject({ status: "ready", transaction: { kind: "swap", to: getAddress(protocol.router.address), value: f.request.amountIn } });
    expect(BigInt(prepared.quote.amountOut)).toBeGreaterThan(0n);
    expect(BigInt(prepared.quote.amountOutMinimum)).toBe(BigInt(prepared.quote.amountOut) * 9700n / 10000n);
    expect(prepared.evidence.runtimeBindings.map(binding => binding.address.toLowerCase())).toEqual(expect.arrayContaining([
      "0x62374fadb151467ed7ac637cc9b3969c712a1fae", "0x1c015ccae47160c07f71029182f75efebfa4fba0",
    ]));
    for (const rpc of f.rpcs) {
      expect(vi.mocked(rpc).mock.calls.length).toBeLessThan(96);
      expect(vi.mocked(rpc).mock.calls.every(([method]) => !method.includes("send") && !method.includes("sign"))).toBe(true);
    }
  });
  it("proves the exact sell approval using the real current allowance and simulated post-state", async () => {
    const f = fixture("sell"), prepared = await f.prepare();
    expect(validateEthereumStampedPreparation(prepared, f.route, f.request, f.now())).toEqual(prepared);
    expect(prepared.status).toBe("approval-required");
    expect(prepared.transaction.kind).toBe("token-to-permit2");
    const decoded = decodeFunctionData({ abi: customTradeTokenAbi, data: prepared.transaction.data });
    expect(decoded.args).toEqual([getAddress(protocol.permit2.address), BigInt(f.request.amountIn)]);
    const permit = decodeFunctionData({ abi: customTradePermit2Abi, data: ethereumStampedApprovalTransaction(f.request, "permit2-to-router").data });
    expect(permit.args).toEqual([f.request.token, getAddress(protocol.router.address), BigInt(f.request.amountIn), Number(f.request.deadline) + 3600]);
  });
  it("keeps saved finalized identity usable while independently checking current execution", async () => {
    const f = fixture();
    expect(f.snapshot.status).toBe("last-known-good");
    await expect(f.prepare()).resolves.toMatchObject({ status: "ready" });
  });
  it("continues to sell after both exact approvals as the next block advances", async () => {
    const approval = fixture("sell-permit"), preparedApproval = await approval.prepare();
    expect(preparedApproval).toMatchObject({ status: "approval-required", transaction: { kind: "permit2-to-router" } });
    expect(validateEthereumStampedPreparation(preparedApproval, approval.route, approval.request, approval.now())).toEqual(preparedApproval);
    const swap = fixture("sell-ready"), preparedSwap = await swap.prepare();
    expect(BigInt(swap.request.deadline)).toBeGreaterThan(BigInt(approval.request.deadline));
    expect(validateEthereumStampedPreparation(preparedSwap, swap.route, swap.request, swap.now())).toEqual(preparedSwap);
    expect(preparedSwap).toMatchObject({ status: "ready", transaction: { kind: "swap", value: "0" } });
    expect(BigInt(preparedSwap.quote.amountOut)).toBeGreaterThan(0n);
  });
  it.each(["runtime", "stamp", "reorg", "provider", "trace", "post-state", "balance", "transfer-tax"])("stops a %s failure before returning a transaction", async failure => {
    const f = fixture("buy", (value, method, params, provider) => {
      if (failure === "runtime" && method === "eth_getCode" && String(params[0]).toLowerCase() === protocol.router.address.toLowerCase()) return "0x6000";
      if (failure === "stamp" && method === "eth_call" && String((params[0] as {to: string}).to).toLowerCase() === recording.buy.snapshot.entries[0].launchStampProvenance!.routerAddress.toLowerCase()) return `0x${"00".repeat(64)}`;
      if (failure === "reorg" && method === "eth_getBlockByNumber" && params[0] !== "latest") return { ...(value as object), hash: `0x${"77".repeat(32)}` };
      if (failure === "provider" && method === "eth_chainId" && provider === 1) return "0xa";
      if (failure === "trace" && method === "debug_traceCall" && (params[2] as {tracer: string}).tracer === "callTracer") return { ...(value as object), error: "execution reverted" };
      if ((failure === "post-state" || failure === "transfer-tax") && method === "debug_traceCall" && (params[2] as {tracer: string}).tracer === "prestateTracer") {
        const diff = value as {post: Record<string, {balance?: string; storage?: Record<string, Hex>}>};
        const owner = f.request.owner.toLowerCase();
        if (failure === "post-state" && provider === 1) diff.post[owner] = { balance: "0x0" };
        if (failure === "transfer-tax") {
          const token = diff.post[f.request.token.toLowerCase()];
          if (token?.storage) for (const slot of Object.keys(token.storage)) token.storage[slot] = `0x${"00".repeat(32)}`;
        }
      }
      if (failure === "balance" && method === "eth_getBalance") return "0x1";
      return value;
    });
    await expect(f.prepare()).rejects.toThrow();
  });
  it("rejects unfinalized launches and a stale execution checkpoint", async () => {
    const f = fixture();
    await expect(prepareEthereumStampedSwap(f.request, { rpcs: f.rpcs, readSnapshot: async () => f.snapshot, now: () => f.now() + 61n })).rejects.toMatchObject({ code: "ETHEREUM_CHECKPOINT_STALE" });
    const snapshot = structuredClone(f.snapshot), entry = snapshot.entries.find(e => e.tokenAddress === f.request.token)!;
    entry.launchStampProvenance = { ...entry.launchStampProvenance!, blockNumber: snapshot.asOfBlock, finalizedAtBlockNumber: String(BigInt(snapshot.asOfBlock) + 64n) };
    await expect(prepareEthereumStampedSwap(f.request, { rpcs: f.rpcs, now: f.now, readSnapshot: async () => snapshot })).rejects.toThrow();
  });
  it.each([7, 8, 9])("derives a new token route without a coin allowlist (%s)", number => {
    const f = fixture(), entry = structuredClone(f.snapshot.entries.find(e => e.tokenAddress === f.request.token)!) as CanonicalTokenExploreEntry;
    const oldToken = entry.tokenAddress, token = `0x${String(number).repeat(40)}` as Hex, previous = entry.launchStampProvenance!;
    const poolKey = { ...previous.poolKey, currency1: token }, poolId = computeOfficialV4PoolId(poolKey);
    const stamp = { ...previous, poolKey, poolId, tokenProof: { ...previous.tokenProof, tokenAddress: token },
      poolProof: { ...previous.poolProof, poolId }, components: previous.components.map(c => c.address.toLowerCase() === oldToken.toLowerCase() ? { ...c, address: token } : c) };
    entry.tokenAddress = token;
    entry.poolId = stamp.poolId; entry.launchStampProvenance = stamp;
    const route = ethereumStampedSwapRoute(entry);
    expect(route?.stamp.tokenProof.tokenAddress).toBe(token);
    expect(route?.routeBindingHash).not.toBe(f.route.routeBindingHash);
  });
  it("does not use names, tickers or optional display enrichment as route authority", () => {
    const f = fixture(), entry = f.snapshot.entries.find(e => e.tokenAddress === f.request.token)!;
    expect(ethereumStampedSwapRoute({ ...entry, name: "A new name", symbol: "NEW" })?.routeBindingHash).toBe(f.route.routeBindingHash);
    expect(ethereumStampedSwapRoute({ ...entry, launchStampProvenance: undefined })).toBeNull();
    expect(ethereumStampedSwapRoute({ ...entry, poolId: `0x${"00".repeat(32)}` })).toBeNull();
  });
});

describe("Ethereum wallet preparation boundary", () => {
  function actions(): SwapWalletActions { return { sendTransaction: vi.fn(async () => `0x${"01".repeat(32)}` as Hex), sendModuleModeTransaction: vi.fn(), sendLaunchPlanTradeWalletAction: vi.fn(), sendCustomV4SwapWalletAction: vi.fn() }; }
  async function setup(transform: (value: EthereumStampedSwapPreparation, call: number) => EthereumStampedSwapPreparation = value => value) {
    const f = fixture(), prepared = await f.prepare();
    vi.spyOn(Date, "now").mockReturnValue(Number(f.now()) * 1000);
    const descriptor = { schemaVersion: "programmable.swap-token.v1" as const, chainId: 1 as const, status: "ready" as const, manageHref: null,
      token: { address: f.request.token, name: "A new name", symbol: "NEW", decimals: f.route.tokenDecimals }, route: { kind: "ethereum-stamped" as const, descriptor: f.route } };
    let count = 0;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const request = parseEthereumStampedSwapRequest(JSON.parse(String(init.body)));
      const value = transform({ ...structuredClone(prepared), request }, ++count);
      // A new browser deadline changes canonical calldata. Use its exact request
      // while retaining replayed amounts and independent runtime evidence.
      const api = await import("@/lib/swap/ethereum-stamped");
      if (value.transaction.data === prepared.transaction.data) value.transaction = { ...api.ethereumStampedSwapTransaction(f.route, request, BigInt(value.quote.amountOut)), gasLimit: value.transaction.gasLimit! };
      const body = { ...value }; delete (body as Partial<EthereumStampedSwapPreparation>).preparationDigest;
      return Response.json({ ...body, preparationDigest: ethereumStampedPreparationDigest(body) });
    });
    vi.stubGlobal("fetch", fetcher);
    return { f, descriptor, fetcher, actions: actions(), input: { descriptor, owner: f.request.owner, side: "buy" as const, amountIn: BigInt(f.request.amountIn) } };
  }
  it("reconstructs a canonical transaction and checks again before asking the wallet", async () => {
    const f = await setup();
    expect(parseSwapTokenDescriptor(f.descriptor, { address: f.f.request.token, chainId: 1 }).status).toBe("ready");
    const review = await prepareSwap(f.input, f.actions);
    expect(f.actions.sendTransaction).not.toHaveBeenCalled();
    await submitSwap(review, f.actions);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.fetcher.mock.calls[0][0]).toBe("/api/swap/ethereum/prepare");
    expect(f.actions.sendTransaction).toHaveBeenCalledOnce();
  });
  it.each(["calldata", "expiry", "runtime", "gas"])("never opens the wallet after a %s change", async failure => {
    const f = await setup((value, call) => {
      if (call !== 2) return value;
      if (failure === "calldata") value.transaction.data = "0x12345678";
      if (failure === "expiry") value.quote.validUntil = String(BigInt(value.quote.blockTimestamp) - 1n);
      if (failure === "gas") value.transaction.gasLimit = String(BigInt(value.transaction.gasLimit!) + 1n);
      if (failure === "runtime") {
        value.evidence.runtimeBindings = value.evidence.runtimeBindings.map(binding => binding.address.toLowerCase() === "0x1c015ccae47160c07f71029182f75efebfa4fba0" ? { ...binding, runtimeCodeHash: `0x${"33".repeat(32)}` } : binding);
        value.evidence.runtimeBindingHash = ethereumStampedRuntimeDigest(value.evidence.runtimeBindings);
      }
      return value;
    });
    const review = await prepareSwap(f.input, f.actions);
    await expect(submitSwap(review, f.actions)).rejects.toThrow();
    expect(f.actions.sendTransaction).not.toHaveBeenCalled();
    expect(pending.begin).not.toHaveBeenCalled();
  });
  it("rejects request extras and slippage outside the supported bounds", () => {
    const f = fixture();
    for (const request of [{ ...f.request, recipient: f.request.owner }, { ...f.request, slippageBps: 501 }, { ...f.request, amountIn: "0" }, { ...f.request, chainId: 4663 }])
      expect(() => parseEthereumStampedSwapRequest(request)).toThrow();
  });
});
