import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { parseSwapTokenDescriptor, prepareSwap, submitSwap, type SwapWalletActions } from "@/lib/swap/client";
import type { SwapTokenDescriptor } from "@/lib/swap/types";
import { SHARD_ROUTER_TRADE_CAPABILITY_V1 as capability, SHARD_ROUTER_TRADE_PROJECT_ID } from "@/lib/custom-launch/router-trade-adapters-v1";
import { buildCustomMarketSwapTransactionV1, buildCustomTokenApprovalTransactionV1, customAmountOutMinimumV1,
  customTradeSideBindingV1, type CustomMarketTradePreparationV1, type CustomMarketTradeRequestV1 } from "@/lib/custom-launch/trade-v1";
import { shardRouterTradeEntry } from "./shard-router-trade-fixture";
import { a, h } from "./fixtures/module-mode-evidence";

const pending = vi.hoisted(() => ({ begin: vi.fn(async () => ({ id: "fixture" })), record: vi.fn(async value => value) }));
vi.mock("@/lib/swap/pending", () => ({ getPendingSwap: () => null, beginPendingSwap: pending.begin,
  clearPendingSwap: vi.fn(), recordPendingSwapHash: pending.record, subscribePendingSwap: vi.fn() }));

const descriptor: SwapTokenDescriptor = { schemaVersion: "programmable.swap-token.v1", chainId: 1, status: "ready", manageHref: null,
  token: { address: shardRouterTradeEntry.tokenAddress as `0x${string}`, name: "Shard", symbol: "SHARD", decimals: 18 },
  route: { kind: "custom-market", projectId: SHARD_ROUTER_TRADE_PROJECT_ID, marketId: "shard-eth-v4", capability } };
const owner = a(90);
const input = { descriptor, owner, side: "buy" as const, amountIn: 1_000n };
function wallet(): SwapWalletActions {
  return { sendTransaction: vi.fn(async () => h(200)), sendModuleModeTransaction: vi.fn(),
    sendLaunchPlanTradeWalletAction: vi.fn(), sendCustomV4SwapWalletAction: vi.fn() };
}
function preparation(request: CustomMarketTradeRequestV1, approval = false): CustomMarketTradePreparationV1 {
  const binding = customTradeSideBindingV1(capability, request.side), amountOut = 50_000n;
  const transaction = approval
    ? buildCustomTokenApprovalTransactionV1({ capability, token: descriptor.token.address, amountIn: BigInt(request.amountIn) })
    : buildCustomMarketSwapTransactionV1({ capability, side: request.side, amountIn: BigInt(request.amountIn), quotedAmountOut: amountOut,
      slippageBps: request.slippageBps, deadline: BigInt(request.deadline) });
  return { schemaVersion: "programmable.custom-market-trade-preparation.v1", status: approval ? "approval-required" : "ready",
    projectId: request.projectId, marketId: request.marketId, tradeCapabilityBindingHash: request.tradeCapabilityBindingHash,
    chainId: request.chainId, owner: request.owner, recipient: request.recipient, side: request.side,
    inputAssetId: binding.inputAssetId, outputAssetId: binding.outputAssetId, inputCurrencyKind: binding.inputCurrencyKind,
    approvalState: approval ? "erc20-to-permit2" : "ready", transaction: { ...transaction, gasLimit: "240000" },
    quote: { amountIn: request.amountIn, amountOut: amountOut.toString(), amountOutMinimum: customAmountOutMinimumV1(amountOut, request.slippageBps).toString(),
      gasEstimate: "200000", slippageBps: request.slippageBps, deadline: request.deadline, observedAtBlock: "100", observedAtTimestamp: "1000",
      validUntil: "1030", stateView: { sqrtPriceX96: "79228162514264337593543950336", tick: "0", liquidity: "100000" } } };
}
function responses(transform: (value: CustomMarketTradePreparationV1, call: number) => CustomMarketTradePreparationV1 = value => value, approval = false) {
  let call = 0;
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as CustomMarketTradeRequestV1;
    return Response.json(transform(preparation(request, approval), ++call));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(1_000_000); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("reviewed Ethereum Custom swaps", () => {
  it("parses the exact ETH/token capability and rejects another token or chain", () => {
    expect(parseSwapTokenDescriptor(descriptor, { address: descriptor.token.address, chainId: 1 })).toMatchObject({ route: { kind: "custom-market" } });
    expect(() => parseSwapTokenDescriptor({ ...descriptor, chainId: 4663 }, { address: descriptor.token.address })).toThrow("Ethereum market");
    expect(() => parseSwapTokenDescriptor({ ...descriptor, token: { ...descriptor.token, address: a(22) } }, { address: a(22), chainId: 1 })).toThrow("ETH swap route");
  });

  it("prepares 3% Buy with the existing endpoint and revalidates before sending", async () => {
    const fetcher = responses(), actions = wallet(), review = await prepareSwap(input, actions);
    expect(review).toMatchObject({ chainId: 1, owner, side: "buy", amountIn: 1_000n, amountOut: 50_000n, minimumOutput: 48_500n, expiresAt: 1030n });
    expect(actions.sendTransaction).not.toHaveBeenCalled();
    await submitSwap(review, actions);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe("/api/custom-launch/v2/trade/prepare");
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toMatchObject({ owner, recipient: owner, side: "quote-to-base", slippageBps: 300, deadline: "1240",
      projectId: SHARD_ROUTER_TRADE_PROJECT_ID, marketId: "shard-eth-v4", tradeCapabilityBindingHash: capability.tradeCapabilityBindingHash });
    expect(actions.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ kind: "swap", chainId: 1, value: "1000" }));
    expect(pending.begin).toHaveBeenCalledWith(expect.objectContaining({ owner, token: descriptor.token.address, chainId: 1, preparedBlock: "100" }));
  });

  it("retains the required exact ERC20 approval on Sell", async () => {
    responses(value => value, true);
    const actions = wallet(), review = await prepareSwap({ ...input, side: "sell" }, actions);
    expect(review.kind).toBe("approval");
    await submitSwap(review, actions);
    expect(actions.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ kind: "token-to-permit2", to: descriptor.token.address, value: "0" }));
  });

  it.each(["recipient", "minimum", "stale", "calldata"])("rejects a %s mismatch before the wallet boundary", async change => {
    responses(value => change === "recipient" ? { ...value, recipient: a(99) }
      : change === "minimum" ? { ...value, quote: { ...value.quote, amountOutMinimum: "1" } }
        : change === "stale" ? { ...value, quote: { ...value.quote, validUntil: "999" } }
          : { ...value, transaction: { ...value.transaction, data: "0x12345678" as Hex } });
    const actions = wallet();
    await expect(prepareSwap(input, actions)).rejects.toThrow();
    expect(actions.sendTransaction).not.toHaveBeenCalled();
    expect(pending.begin).not.toHaveBeenCalled();
  });

  it("does not send if the canonical quote changes during the final refresh", async () => {
    responses((value, call) => call === 1 ? value : { ...value,
      quote: { ...value.quote, amountOut: "49000", amountOutMinimum: customAmountOutMinimumV1(49_000n, 300).toString() },
      transaction: { ...buildCustomMarketSwapTransactionV1({ capability, side: value.side, amountIn: 1_000n,
        quotedAmountOut: 49_000n, slippageBps: 300, deadline: BigInt(value.quote.deadline) }), gasLimit: "240000" },
    });
    const actions = wallet(), review = await prepareSwap(input, actions);
    await expect(submitSwap(review, actions)).rejects.toThrow("swap quote changed");
    expect(actions.sendTransaction).not.toHaveBeenCalled();
    expect(pending.begin).not.toHaveBeenCalled();
  });
});
