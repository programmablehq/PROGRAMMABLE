import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbiParameters } from "viem";
import recorded from "./fixtures/ethereum-stamped-bridge-rpc.json";
import { prepareEthereumStampedSwap } from "@/lib/server/swap/ethereum-stamped";
import { ethereumStampedSwapRoute, ethereumStampedSwapTransaction, parseEthereumStampedSwapRoute,
  validateEthereumStampedPreparation, type EthereumStampedSwapRequest } from "@/lib/swap/ethereum-stamped";
import { ETHEREUM_UNI_BRIDGE } from "@/lib/swap/ethereum-stamped-bridges";
import { customTradeRouterAbi } from "@/lib/custom-launch/trade-v1";
import { computeOfficialV4PoolId } from "@/lib/uniswap/liquidity-launcher-sdk";
import type { RouterCustomIdentitySnapshotV1 } from "@/lib/alchemy/router-custom-public.server";
import type { EthereumFeeClassificationV1 } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/alchemy/router-custom-public.server", () => ({ readFinalizedRouterCustomIdentitySnapshotCoreV1: vi.fn() }));
const saved = JSON.parse(brotliDecompressSync(Buffer.from(recorded.brotliBase64, "base64")).toString()) as {
  request: EthereumStampedSwapRequest; snapshot: RouterCustomIdentitySnapshotV1;
  classification: EthereumFeeClassificationV1; now: string;
  rpcs: { method: string; params: unknown[]; result: unknown }[][];
};
const entry = saved.snapshot.entries[0]!;
const route = ethereumStampedSwapRoute(entry, saved.classification)!;
const native = "0x0000000000000000000000000000000000000000";
function replay(change?: (result: unknown, method: string, params: readonly unknown[], provider: number) => unknown) {
  const rpcs = saved.rpcs.map((records, provider) => vi.fn(async (method: string, params: readonly unknown[]) => {
    const match = records.find(r => r.method === method && JSON.stringify(r.params) === JSON.stringify(params));
    if (!match) throw Error(`Unrecorded read: ${method}`);
    const value = structuredClone(match.result);
    return change ? change(value, method, params, provider) : value;
  })) as unknown as readonly [TradeRpcV1, TradeRpcV1];
  return { rpcs, prepare: () => prepareEthereumStampedSwap(saved.request, { rpcs,
    readSnapshot: async () => saved.snapshot, readFeeClassification: async () => saved.classification,
    now: () => BigInt(saved.now) }) };
}

describe("stamped Ethereum UNI bridge", () => {
  it("binds the existing hookless bridge, original launch pool and quote runtime", () => {
    expect(computeOfficialV4PoolId(ETHEREUM_UNI_BRIDGE.poolKey)).toBe(ETHEREUM_UNI_BRIDGE.poolId);
    expect(route.bridge).toEqual(ETHEREUM_UNI_BRIDGE);
    expect(parseEthereumStampedSwapRoute(route, { token: entry.tokenAddress, decimals: 18 })).toEqual(route);
    expect(() => parseEthereumStampedSwapRoute({ ...route, bridge: { ...route.bridge, poolId: `0x${"00".repeat(32)}` } },
      { token: entry.tokenAddress, decimals: 18 })).toThrow(/bridge/);
    expect(() => parseEthereumStampedSwapRoute({ ...route, bridge: undefined },
      { token: entry.tokenAddress, decimals: 18 })).toThrow(/bridge/);
  });
  it.each(["buy", "sell"] as const)("encodes an atomic %s with exact input, open UNI credit and bounded output", side => {
    const tx = ethereumStampedSwapTransaction(route, { ...saved.request, side }, 1000n);
    const decoded = decodeFunctionData({ abi: customTradeRouterAbi, data: tx.data });
    const commands = decoded.args[0], inputs = decoded.args[1];
    expect(commands).toBe(side === "buy" ? "0x051004" : "0x1004");
    const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes, bytes[]"), inputs[side === "buy" ? 1 : 0]!);
    expect(actions).toBe(side === "buy" ? "0x06060c0f" : "0x06060c100f");
    const abi = parseAbiParameters("((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)");
    const first = decodeAbiParameters(abi, params[0]!)[0], second = decodeAbiParameters(abi, params[1]!)[0];
    const pools = side === "buy" ? [ETHEREUM_UNI_BRIDGE.poolKey, route.stamp.poolKey] : [route.stamp.poolKey, ETHEREUM_UNI_BRIDGE.poolKey];
    expect(computeOfficialV4PoolId(first.poolKey)).toBe(computeOfficialV4PoolId(pools[0]!));
    expect(computeOfficialV4PoolId(second.poolKey)).toBe(computeOfficialV4PoolId(pools[1]!));
    expect(first.zeroForOne).toBe(side === "buy" || route.stamp.poolKey.currency0.toLowerCase() === entry.tokenAddress.toLowerCase());
    expect(second.zeroForOne).toBe(side === "buy" && route.stamp.poolKey.currency0.toLowerCase() === ETHEREUM_UNI_BRIDGE.quoteToken.address.toLowerCase());
    expect(first.amountIn).toBe(side === "buy" ? 99700000000000n : BigInt(saved.request.amountIn));
    expect(second.amountIn).toBe(0n);
    expect(second.amountOutMinimum).toBe(970n);
    const [currency, cap] = decodeAbiParameters(parseAbiParameters("address,uint256"), params[2]!);
    expect(currency).toBe(getAddress(side === "buy" ? native : entry.tokenAddress));
    expect(cap).toBe(first.amountIn);
    expect(tx.value).toBe(side === "buy" ? saved.request.amountIn : "0");
  });
  it("replays the two independent mainnet simulations with exact settlement and fee evidence", async () => {
    const f = replay(), result = await f.prepare();
    expect(result.status).toBe("ready");
    expect(result.quote.amountOut).toBe("98336452890480703");
    expect(result.fee).toMatchObject({ mode: "programmable_routed", platformFeeAmount: "300000000000", routedRateBps: 30 });
    expect(result.evidence.runtimeBindings).toContainEqual({ address: getAddress(ETHEREUM_UNI_BRIDGE.quoteToken.address), runtimeCodeHash: ETHEREUM_UNI_BRIDGE.quoteToken.runtimeCodeHash });
    expect(validateEthereumStampedPreparation(result, route, saved.request, BigInt(saved.now))).toEqual(result);
    for (const rpc of f.rpcs) expect(vi.mocked(rpc).mock.calls.every(([method]) => !/send|sign/.test(method))).toBe(true);
  });
  it("rejects changed UNI runtime before returning any transaction", async () => {
    const f = replay((value, method, params) => method === "eth_getCode"
      && String(params[0]).toLowerCase() === ETHEREUM_UNI_BRIDGE.quoteToken.address.toLowerCase() ? "0x6000" : value);
    await expect(f.prepare()).rejects.toMatchObject({ code: "ETHEREUM_LAUNCH_RUNTIME_CHANGED" });
  });
  it("rejects a bridge revert even when the token pool and stamp remain valid", async () => {
    const f = replay((value, method, params) => method === "debug_traceCall" && (params[2] as { tracer: string }).tracer === "callTracer"
      ? { ...(value as object), error: "execution reverted" } : value);
    await expect(f.prepare()).rejects.toThrow();
  });
  it("cannot accept a response with the quote runtime removed", async () => {
    const result = await replay().prepare();
    const changed = structuredClone(result);
    changed.evidence.runtimeBindings = changed.evidence.runtimeBindings.filter(b => b.address.toLowerCase() !== ETHEREUM_UNI_BRIDGE.quoteToken.address.toLowerCase());
    expect(() => validateEthereumStampedPreparation(changed, route, saved.request, BigInt(saved.now))).toThrow();
  });
});
