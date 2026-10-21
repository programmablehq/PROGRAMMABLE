import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, sha256, type Hex } from "viem";
import { runSwapFlow } from "@/components/swap-flow";
import { prepareSwap, prepareSwapContinuation, submitSwap, type SwapWalletActions } from "@/lib/swap/client";
import type { SwapTokenDescriptor } from "@/lib/swap/types";
import { buildCustomV4Swap, buildCustomV4SwapApproval, customV4PoolId, customV4SwapDescriptorDigest, CUSTOM_V4_SWAP_DESCRIPTOR, type CustomV4SwapDescriptor } from "@/lib/swap/custom-v4";
import type { LaunchProjectionV1 } from "@/lib/custom-launch/launch-plan-v1";
import { buildLaunchPlanTradeApprovalV1, buildLaunchPlanRoutedSwapV1, ROUTED_TRADE_PERMIT2_ABI_V1, ROUTED_TRADE_CONTRACTS_V1, ROUTED_FEE_RECIPIENT_V1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { projectionFixture, nowIso } from "./fixtures/universal-launch-v1";
import { a, h } from "./fixtures/module-mode-evidence";

const mocked = vi.hoisted(() => ({ client: vi.fn(), pending: null as unknown }));
vi.mock("@/lib/module-engine/client", () => ({ createModuleEngineClient: mocked.client }));
vi.mock("@/lib/module-mode-operation-store", () => ({ moduleModeOperationSnapshot: () => null }));
vi.mock("@/lib/swap/pending", () => ({
  getPendingSwap: () => mocked.pending,
  beginPendingSwap: async (input: { data: Hex }) => mocked.pending = { ...input, id: "pending", hash: null, dataHash: sha256(input.data) },
  recordPendingSwapHash: async (input: object, hash: Hex) => mocked.pending = { ...input, hash },
  clearPendingSwap: async () => { mocked.pending = null; },
  subscribePendingSwap: () => () => {},
}));

const owner = a(90), token = a(22), native = a(0);
const poolKey = { currency0: native, currency1: token, fee: 3000, tickSpacing: 60, hooks: a(33) };
const descriptorBody: Omit<CustomV4SwapDescriptor, "descriptorDigest"> = {
  schemaVersion: CUSTOM_V4_SWAP_DESCRIPTOR, poolKey,
  launch: { tokenAddress: token, hookAddress: poolKey.hooks, poolId: customV4PoolId(poolKey),
    routerAddress: a(44), launchId: h(1), stampHash: h(2), creator: owner,
    poolManager: ROUTED_TRADE_CONTRACTS_V1.poolManager.address, transactionHash: h(3), blockHash: h(4),
    blockNumber: "42", logIndex: 1, launchedAt: null, name: "Test coin", symbol: "TEST", decimals: 18 },
  source: { kind: "router_v1", router: a(44), routerRuntimeCodeHash: h(5), onchainLaunchId: h(1), stampHash: h(2) },
  runtimeBindings: [{ address: a(44), runtimeCodeHash: h(5) }],
};
const descriptor: CustomV4SwapDescriptor = { ...descriptorBody, descriptorDigest: customV4SwapDescriptorDigest(descriptorBody) };
const originalProjection = projectionFixture();
const projection: LaunchProjectionV1 = { ...originalProjection,
  components: originalProjection.components.map((component, index) => index === 0 ? { ...component, expectedAddress: token } : component),
  markets: [{ marketId: "test-market", kind: "uniswap_v4",
  poolManager: ROUTED_TRADE_CONTRACTS_V1.poolManager.address as Hex,
  currency0: { address: native }, currency1: { componentId: "settlement" },
  hooks: { address: native }, fee: 3000, tickSpacing: 60 }],
  assuranceClaims: [{ claimType: "fee_on_programmable_routed_trades", subject: "route-fee",
  observedValue: { obligationId: "route-fee", mode: "programmable_routed", policyVersion: "programmable.custom-launch-fee.v1", rateBps: 20,
    scope: "programmable_built_or_routed_qualifying_swaps", recipient: ROUTED_FEE_RECIPIENT_V1, marketIds: ["test-market"] },
  status: "disclosed", witness: { kind: "policy", ref: "fixture:fee", details: {} }, assessor: "fixture", assessorVersion: "1", validAt: nowIso, blockNumber: "42" }],
};

function fixture(kind: "custom-v4" | "custom-vnext", options: { staleAllowance?: boolean; receiptDelay?: number; receiptStatus?: "reverted"; checkpointDelayReads?: number } = {}) {
  let time = 1_800_000_000, blockNumber = 100n, tokenApproved = false, permitExpires = 0n;
  let previousTokenApproved = false, previousPermitExpires = 0n, staleReads = 0;
  const transactions: { kind: string; hash: Hex; from: typeof owner; to: typeof owner; input: Hex; value: bigint; chainId: number; blockNumber: bigint; blockHash: Hex }[] = [];
  const deadlines: string[] = [];
  vi.spyOn(Date, "now").mockImplementation(() => time * 1000);
  mocked.client.mockReturnValue({
    getChainId: async () => 4663,
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const tx = transactions.find(item => item.hash === hash)!;
      time += options.receiptDelay ?? 2;
      blockNumber = tx.blockNumber;
      previousTokenApproved = tokenApproved; previousPermitExpires = permitExpires;
      staleReads = options.checkpointDelayReads ?? 0;
      if (tx.kind === "token_approval") tokenApproved = true;
      if (tx.kind === "permit2_approval") {
        permitExpires = BigInt(decodeFunctionData({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, data: tx.input }).args[3]!);
      }
      return { ...tx, status: options.receiptStatus ?? "success", transactionHash: hash };
    },
    getTransaction: async ({ hash }: { hash: Hex }) => transactions.find(item => item.hash === hash),
    getBlock: async ({ blockNumber: n }: { blockNumber: bigint }) => ({ hash: h(Number(n)) }),
  });
  const review = (request: { deadline: string; amountIn: string }) => {
    deadlines.push(request.deadline);
    const stale = staleReads-- > 0;
    const tokenAllowance = stale ? previousTokenApproved : tokenApproved;
    const permitExpiration = stale ? previousPermitExpires : permitExpires;
    const step = !tokenAllowance ? "token_approval" : options.staleAllowance || permitExpiration < BigInt(request.deadline) ? "permit2_approval" : "swap";
    // Use the real approval builders so the simulated allowance has the actual expiry.
    const transaction = kind === "custom-v4"
      ? step === "swap" ? buildCustomV4Swap(descriptor, request as never, 50_000n) : buildCustomV4SwapApproval(request as never, step)
      : step === "swap" ? buildLaunchPlanRoutedSwapV1(projection, request as never, 50_000n) : buildLaunchPlanTradeApprovalV1(request as never, token, step);
    return { preparation: { status: step === "swap" ? "ready" : "approval_required", transaction: { ...transaction, gasLimit: "100000" },
      quote: { amountOut: "50000", amountOutMinimum: "48500", blockNumber: (stale ? blockNumber - 1n : blockNumber).toString(), validUntil: String(time + 25) } } };
  };
  const action = vi.fn(async (input: { action: string; request: { deadline: string; amountIn: string }; reviewed?: ReturnType<typeof review> }) => {
    if (input.action === "review") return review(input.request);
    const tx = input.reviewed!.preparation.transaction;
    const hash = h(transactions.length + 200), n = blockNumber + 1n;
    transactions.push({ kind: tx.kind, hash, from: owner, to: tx.to, input: tx.data, value: BigInt(tx.value), chainId: 4663, blockNumber: n, blockHash: h(Number(n)) });
    return hash;
  });
  const wallet = { sendCustomV4SwapWalletAction: action, sendLaunchPlanTradeWalletAction: action,
    sendModuleModeTransaction: vi.fn(), sendTransaction: vi.fn() } as unknown as SwapWalletActions;
  const input = { descriptor: { schemaVersion: "programmable.swap-token.v1", chainId: 4663, status: "ready", manageHref: null,
    token: { address: token, name: "Test coin", symbol: "TEST", decimals: 18 },
    route: kind === "custom-v4" ? { kind, descriptor } : { kind, projection, marketId: projection.markets[0]!.marketId } } as SwapTokenDescriptor,
  owner, side: "sell" as const, amountIn: 100_000n };
  return { wallet, input, transactions, deadlines };
}

beforeEach(() => { vi.clearAllMocks(); mocked.pending = null; });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe.each(["custom-v4", "custom-vnext"] as const)("%s approval continuation", kind => {
  it("keeps the original deadline across two mined approvals and reaches the sell", async () => {
    const f = fixture(kind);
    const result = await runSwapFlow({ review: await prepareSwap(f.input, f.wallet), assertCurrent() {},
      prepare: previous => prepareSwapContinuation(previous, f.wallet), submit: review => submitSwap(review, f.wallet) });
    expect(result.kind).toBe("swap");
    expect(f.transactions.map(tx => tx.kind)).toEqual(["token_approval", "permit2_approval", "swap"]);
    expect(f.deadlines).toEqual(["1800000600", "1800000600", "1800000600"]);
  });

  it("does not resend a confirmed permit when the provider still reports the old allowance", async () => {
    const f = fixture(kind, { staleAllowance: true });
    await expect(runSwapFlow({ review: await prepareSwap(f.input, f.wallet), assertCurrent() {},
      prepare: previous => prepareSwapContinuation(previous, f.wallet), submit: review => submitSwap(review, f.wallet) })).rejects.toThrow("approval is confirmed");
    expect(f.transactions.map(tx => tx.kind)).toEqual(["token_approval", "permit2_approval"]);
  });

  it("waits for the simulation checkpoint to include each approval before continuing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture(kind, { checkpointDelayReads: 2 }), review = await prepareSwap(f.input, f.wallet);
    const task = runSwapFlow({ review, assertCurrent() {},
      prepare: previous => prepareSwapContinuation(previous, f.wallet), submit: value => submitSwap(value, f.wallet) });
    const result = expect(task).resolves.toMatchObject({ kind: "swap", receipt: { status: "success" } });
    await vi.runAllTimersAsync(); await result;
    expect(f.transactions.map(tx => tx.kind)).toEqual(["token_approval", "permit2_approval", "swap"]);
    expect(f.deadlines).toHaveLength(7);
    expect(new Set(f.deadlines)).toEqual(new Set(["1800000600"]));
  });

  it("bounds checkpoint retries without sending another approval", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture(kind, { checkpointDelayReads: Infinity }), review = await prepareSwap(f.input, f.wallet);
    const task = runSwapFlow({ review, assertCurrent() {},
      prepare: previous => prepareSwapContinuation(previous, f.wallet), submit: value => submitSwap(value, f.wallet) });
    const result = expect(task).rejects.toThrow("Trading checks are still catching up");
    await vi.runAllTimersAsync(); await result;
    expect(f.transactions.map(tx => tx.kind)).toEqual(["token_approval"]);
    expect(f.deadlines).toHaveLength(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("asks for a fresh quote if confirmation outlasts the original deadline", async () => {
    const f = fixture(kind, { receiptDelay: 601 });
    await expect(runSwapFlow({ review: await prepareSwap(f.input, f.wallet), assertCurrent() {},
      prepare: previous => prepareSwapContinuation(previous, f.wallet), submit: review => submitSwap(review, f.wallet) })).rejects.toThrow("quote expired");
    expect(f.transactions).toHaveLength(1);
  });

  it("requires the original review and a mined successful approval", async () => {
    const f = fixture(kind), review = await prepareSwap(f.input, f.wallet);
    await expect(prepareSwapContinuation(review, f.wallet)).rejects.toThrow("approval to confirm");
    const sent = await submitSwap(review, f.wallet);
    await expect(prepareSwapContinuation(review, f.wallet)).rejects.toThrow("approval to confirm");
    await sent.wait();
    await expect(prepareSwapContinuation({ ...review }, f.wallet)).rejects.toThrow("approval to confirm");
    await expect(prepareSwapContinuation(review, f.wallet)).resolves.toMatchObject({ kind: "approval" });
    await expect(prepareSwapContinuation(review, f.wallet)).rejects.toThrow("approval to confirm");
    await expect(sent.wait()).rejects.toThrow("saved swap changed");
    await expect(prepareSwapContinuation(review, f.wallet)).rejects.toThrow("approval to confirm");
  });

  it("does not continue a reverted approval", async () => {
    const f = fixture(kind, { receiptStatus: "reverted" }), review = await prepareSwap(f.input, f.wallet);
    const result = await runSwapFlow({ review, assertCurrent() {},
      prepare: previous => prepareSwapContinuation(previous, f.wallet), submit: value => submitSwap(value, f.wallet) });
    expect(result.receipt.status).toBe("reverted");
    expect(f.transactions).toHaveLength(1);
    await expect(prepareSwapContinuation(review, f.wallet)).rejects.toThrow("approval to confirm");
  });
});
