import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, type Hex } from "viem";
import { CommandType } from "@uniswap/universal-router-sdk";
import { Actions } from "@uniswap/v4-sdk";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/swap/token-metadata", () => ({ readRobinhoodSwapDecimals: vi.fn(async () => 18) }));
import recorded from "./fixtures/irl-routed-trade-v1.json";
import { buildLaunchPlanRoutedSwapV1, launchPlanTradeBindingV1, launchPlanTradePreparationDigestV1,
  parseLaunchPlanTradeRequestV1, ROUTED_TRADE_ROUTER_ABI_V1, validateLaunchPlanTradePreparationV1,
  type LaunchPlanTradePreparationV1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { proveIrlPoolFeeV1, irlPoolFeeAmountsV1 } from "@/lib/custom-launch/irl-pool-fee-custom-launch-plan-v1";
import { resolveVerifiedLaunchSwapToken } from "@/lib/server/swap/token";
import { parseSwapTokenDescriptor } from "@/lib/swap/client";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import type { LaunchProjectionV1 } from "@/lib/custom-launch/launch-plan-v1";

const projection = recorded.row.launchProjection as unknown as LaunchProjectionV1;
const row = { ...recorded.row, tokenAddress: projection.components.find(component => component.componentId === projection.primaryComponentId)!.expectedAddress };
const request = parseLaunchPlanTradeRequestV1(recorded.prepared.request);
const key = launchPlanTradeBindingV1(projection, request).poolKey;
const market = { chainId: "4663" as const, poolManager: recorded.row.poolManager as Hex, ...key };
const proof = () => proveIrlPoolFeeV1(market, recorded.codes as Record<string, Hex>)!;
function decode(transaction: ReturnType<typeof buildLaunchPlanRoutedSwapV1>) {
  const execution = decodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, data: transaction.data });
  const commandCodes = [...Buffer.from(execution.args[0].slice(2), "hex")];
  const swap = execution.args[1][commandCodes.indexOf(CommandType.V4_SWAP)]!;
  const [actions, parameters] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], swap);
  return { commands: commandCodes, inputs: execution.args[1], actions: [...Buffer.from(actions.slice(2), "hex")], parameters };
}

describe("IRL canonical WETH settlement", () => {
  it("selects the finalized WETH market from the same verified coin identity", async () => {
    const result = await resolveVerifiedLaunchSwapToken({ chainId: 4663, token: row as unknown as RobinhoodLaunch });
    expect(result).toMatchObject({ status: "ready", route: { kind: "custom-vnext", marketId: "irl-weth-pool" } });
    expect(parseSwapTokenDescriptor(result, { chainId: 4663, address: row.tokenAddress })).toEqual(result);
  });
  it("recognizes the recorded immutable fee bytes and rejects a changed hook", () => {
    const verified = proof();
    expect(verified).not.toBeNull();
    expect(launchPlanTradeBindingV1(projection, request, verified).fee).toMatchObject({ mode: "pool_enforced", rateBps: 30, routedRateBps: 0 });
    const codes = { ...recorded.codes, [key.hooks.toLowerCase()]: "0x6000" } as Record<string, Hex>;
    expect(proveIrlPoolFeeV1(market, codes)).toBeNull();
    expect(proveIrlPoolFeeV1({ ...market, tickSpacing: 1 }, recorded.codes as Record<string, Hex>)).toBeNull();
  });
  it("wraps only the ETH input and refunds remaining WETH without another fee", () => {
    const transaction = buildLaunchPlanRoutedSwapV1(projection, request, 1_000_000n, proof());
    const decoded = decode(transaction);
    expect(transaction.value).toBe(request.amountIn);
    expect(decoded.commands).toEqual([CommandType.WRAP_ETH, CommandType.V4_SWAP, CommandType.UNWRAP_WETH]);
    expect(decoded.actions).toEqual([Actions.SWAP_EXACT_IN_SINGLE, Actions.SETTLE, Actions.TAKE_ALL]);
    expect(decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], decoded.parameters[1]!))
      .toEqual([key.currency0, 0n, false]);
  });
  it("takes sell output into the router and unwraps at the exact net minimum", () => {
    const sell = { ...request, zeroForOne: false };
    const transaction = buildLaunchPlanRoutedSwapV1(projection, sell, 1_000_000n, proof());
    const decoded = decode(transaction);
    expect(transaction.value).toBe("0");
    expect(decoded.commands).toEqual([CommandType.V4_SWAP, CommandType.UNWRAP_WETH]);
    expect(decoded.actions).toEqual([Actions.SWAP_EXACT_IN_SINGLE, Actions.SETTLE_ALL, Actions.TAKE]);
    expect(decodeAbiParameters([{ type: "address" }, { type: "uint256" }], decoded.inputs[1]!))
      .toEqual(["0x0000000000000000000000000000000000000001", 990_000n]);
    const legacy = { ...request }; delete legacy.nativeFunding;
    expect(buildLaunchPlanRoutedSwapV1(projection, legacy, 1_000_000n, proof()).value).toBe("0");
  });
  it("rebuilds the actual independent simulation and rejects altered fee effects", () => {
    const preparation = structuredClone(recorded.prepared) as unknown as LaunchPlanTradePreparationV1;
    const now = BigInt(preparation.quote.validUntil) - 25n;
    expect(validateLaunchPlanTradePreparationV1(preparation, projection, request, now)).toEqual(preparation);
    const changed = structuredClone(preparation);
    (changed.evidence.feeTransfer as { poolFeeAccrual: { platformFee: string } }).poolFeeAccrual.platformFee = "0";
    const { preparationDigest: _digest, ...body } = changed; void _digest;
    expect(() => validateLaunchPlanTradePreparationV1({ ...body, preparationDigest: launchPlanTradePreparationDigestV1(body) }, projection, request, now)).toThrow(/IRL swap/);
    expect(irlPoolFeeAmountsV1(10_001n, true)).toEqual({ ecosystemFee: 1000n, platformFee: 30n });
    expect(irlPoolFeeAmountsV1(10_001n, false)).toEqual({ ecosystemFee: 400n, platformFee: 30n });
  });
});
