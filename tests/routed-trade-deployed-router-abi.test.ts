import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbiParameters, type Address, type Hex } from "viem";
import { buildLaunchPlanRoutedSwapV1, launchPlanTradeAmountsV1, parseLaunchPlanTradeRequestV1,
  ROUTED_FEE_RECIPIENT_V1, ROUTED_TRADE_CONTRACTS_V1, ROUTED_TRADE_REQUEST_V1, ROUTED_TRADE_ROUTER_ABI_V1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { projectionFixture, component, controller, hash, now, nowIso } from "./fixtures/universal-launch-v1";
import { buildCustomV4Swap, CUSTOM_V4_SWAP_DESCRIPTOR, customV4PoolId, customV4SwapDescriptorDigest, type CustomV4SwapDescriptor } from "@/lib/swap/custom-v4";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";

// Independent of V4Planner's ABI table: Universal Router 2.1.1 (999d561c)
// pins v4-periphery 3231810e39b8c4d569b9d66907fa4ef8cd2cec22.
// src/interfaces/IV4Router.sol SHA-256:
// 82048fb6a2b92a52aa37c516bc1d25dc31c062749016701345ee8e36b02306d9
// https://github.com/Uniswap/v4-periphery/blob/3231810e39b8c4d569b9d66907fa4ef8cd2cec22/src/interfaces/IV4Router.sol
const SWAP = parseAbiParameters("((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)");
const ACTIONS = parseAbiParameters("bytes actions,bytes[] params");
const PAYMENT = parseAbiParameters("address currency,uint256 amount");
const PORTION = parseAbiParameters("address currency,address recipient,uint256 bps");
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const SENDER = "0x0000000000000000000000000000000000000001" as const;

describe("routed trade ABI bound to the deployed Robinhood Universal Router", () => {
  it.each([
    { currency0: ZERO, zeroForOne: true },
    { currency0: ZERO, zeroForOne: false },
    { currency0: controller, zeroForOne: true },
    { currency0: controller, zeroForOne: false },
  ])("preserves $currency0 direction=$zeroForOne through the deployed struct and fee actions", ({ currency0, zeroForOne }) => {
    // Retain the real release binding here; no mocked RPC or SDK decoder.
    expect(ROUTED_TRADE_CONTRACTS_V1.universalRouter).toMatchObject({
      address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
      runtimeCodeHash: "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
    });
    const poolKey = { currency0, currency1: component, fee: 3000, tickSpacing: 60, hooks: ZERO };
    const projection = { ...projectionFixture(), markets: [{ marketId: "generic-market", kind: "uniswap_v4" as const,
      poolManager: ROUTED_TRADE_CONTRACTS_V1.poolManager.address as Address,
      currency0: { address: currency0 }, currency1: { componentId: "settlement" }, hooks: { address: ZERO }, fee: 3000, tickSpacing: 60 }],
    assuranceClaims: [{ claimType: "fee_on_programmable_routed_trades", subject: "route-fee",
      observedValue: { obligationId: "route-fee", mode: "programmable_routed", policyVersion: "programmable.custom-launch-fee.v1", rateBps: 20,
        scope: "programmable_built_or_routed_qualifying_swaps", recipient: ROUTED_FEE_RECIPIENT_V1, marketIds: ["generic-market"] },
      status: "disclosed" as const, witness: { kind: "policy" as const, ref: "fixture:fee", details: {} },
      assessor: "fixture", assessorVersion: "1", validAt: nowIso, blockNumber: "42" }] };
    const input = zeroForOne ? currency0 : component, output = zeroForOne ? component : currency0;
    // Empty, short, word-aligned, unaligned and the maximum accepted hook payload.
    for (const hookData of ["0x", "0x01020304", `0x${"ab".repeat(32)}`, `0x${"cd".repeat(33)}`, `0x${"ef".repeat(4096)}`] as Hex[]) {
      const request = parseLaunchPlanTradeRequestV1({ schemaVersion: ROUTED_TRADE_REQUEST_V1, chainId: "4663",
        launchId: projection.launchId, planHash: projection.planHash, marketId: "generic-market", owner: controller,
        zeroForOne, amountIn: "100000", slippageBps: 50, deadline: (now + 600n).toString(), hookData });
      const transaction = buildLaunchPlanRoutedSwapV1(projection, request, 50001n);
      const decoded = decodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, data: transaction.data });
      const [actions, params] = decodeAbiParameters(ACTIONS, decoded.args[1][0]!);
      const expectedSwap = { poolKey, zeroForOne, amountIn: 100000n,
        amountOutMinimum: 49750n, minHopPriceX36: 0n, hookData };
      expect(decodeAbiParameters(SWAP, params[0]!)[0]).toEqual(expectedSwap);
      const expectedParams = [encodeAbiParameters(SWAP, [expectedSwap]),
        encodeAbiParameters(PAYMENT, [input, 100000n]),
        encodeAbiParameters(PORTION, [output, ROUTED_FEE_RECIPIENT_V1, 20n]),
        encodeAbiParameters(PAYMENT, [output, 49651n])];
      expect(actions).toBe("0x060c100f"); // swap, settle, 20-bps output portion, trader minimum
      expect(params).toEqual(expectedParams);
      const expectedInputs = [encodeAbiParameters(ACTIONS, ["0x060c100f", expectedParams])];
      if (input === ZERO) expectedInputs.push(encodeAbiParameters(PORTION, [ZERO, SENDER, 0n]));
      expect(transaction.data).toBe(encodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, functionName: "execute",
        args: [input === ZERO ? "0x1004" : "0x10", expectedInputs, now + 600n] }));
      expect(transaction.to).toBe(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address);
      expect(transaction.value).toBe(input === ZERO ? "100000" : "0");
    }
    expect(launchPlanTradeAmountsV1(50001n, 20, 50)).toEqual({ grossAmountOut: "50001", platformFeeAmount: "100",
      amountOut: "49901", amountOutMinimum: "49651", grossAmountOutMinimum: "49750" });
  });
});

describe("existing Custom coin ABI bound to the deployed Robinhood Universal Router", () => {
  it.each([
    { sourceKind: undefined, buy: true }, { sourceKind: undefined, buy: false },
    { sourceKind: "multi-role-v2" as const, buy: true }, { sourceKind: "multi-role-v2" as const, buy: false },
  ])("preserves $sourceKind buy=$buy without adding a fee action", ({ sourceKind, buy }) => {
    const poolKey = { currency0: ZERO, currency1: component, fee: 3000, tickSpacing: 60, hooks: ZERO };
    const launch: RobinhoodLaunch = { routerAddress: controller, launchId: hash, tokenAddress: component, hookAddress: ZERO,
      creator: controller, poolManager: ROUTED_TRADE_CONTRACTS_V1.poolManager.address, poolId: customV4PoolId(poolKey), stampHash: hash,
      transactionHash: hash, blockNumber: "42", blockHash: hash, logIndex: 0, launchedAt: nowIso, name: "Fixture", symbol: "FIX", decimals: 18,
      ...(sourceKind ? { sourceKind } : {}) };
    const body: Omit<CustomV4SwapDescriptor, "descriptorDigest"> = { schemaVersion: CUSTOM_V4_SWAP_DESCRIPTOR, launch, poolKey,
      source: { kind: sourceKind === "multi-role-v2" ? "multi_role_v2" : "router_v1", router: controller,
        routerRuntimeCodeHash: hash, onchainLaunchId: hash, stampHash: hash }, runtimeBindings: [{ address: controller, runtimeCodeHash: hash }] };
    const descriptor = { ...body, descriptorDigest: customV4SwapDescriptorDigest(body) };
    const request = { token: component, owner: controller, buy, amountIn: "100000", slippageBps: 300, deadline: (now + 600n).toString() };
    const transaction = buildCustomV4Swap(descriptor, request, 50001n);
    const decoded = decodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, data: transaction.data });
    const [actions, params] = decodeAbiParameters(ACTIONS, decoded.args[1][0]!);
    const expectedSwap = { poolKey, zeroForOne: buy, amountIn: 100000n, amountOutMinimum: 48500n, minHopPriceX36: 0n, hookData: "0x" as Hex };
    expect(decodeAbiParameters(SWAP, params[0]!)[0]).toEqual(expectedSwap);
    expect(actions).toBe("0x060c0f");
    const expectedParams = [encodeAbiParameters(SWAP, [expectedSwap]),
      encodeAbiParameters(PAYMENT, [buy ? ZERO : component, 100000n]),
      encodeAbiParameters(PAYMENT, [buy ? component : ZERO, 48500n])];
    expect(params).toEqual(expectedParams);
    const inputs = [encodeAbiParameters(ACTIONS, ["0x060c0f", expectedParams])];
    if (buy) inputs.push(encodeAbiParameters(PORTION, [ZERO, SENDER, 0n]));
    expect(transaction.data).toBe(encodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, functionName: "execute",
      args: [buy ? "0x1004" : "0x10", inputs, now + 600n] }));
    expect(transaction.value).toBe(buy ? "100000" : "0");
    expect(transaction.to).toBe(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address);
  });
});
