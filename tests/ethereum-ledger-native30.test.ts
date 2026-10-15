import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import fixtures from "./fixtures/ledger-native30-runtimes.json";
import { ETHEREUM_LEDGER_NATIVE30_RECIPES_V1 as recipes } from "@/lib/custom-launch/ethereum-ledger-native30-recipes-v1";
import { ethereumNative30FeeAmountV1, materializeEthereumNative30RuntimeWordsV1, proveEthereumNative30RuntimeV1,
  rebuildEthereumNative30RuntimeProofV1, type EthereumNative30MarketV1 } from "@/lib/custom-launch/ethereum-native30-runtime-v1";
import { proveEthereumNative30TradeAccrualV1 } from "@/lib/server/custom-launch/ethereum-native30-trade-v1";
import { ETHEREUM_STAMPED_SWAP_PROTOCOL as protocol, ethereumStampedSwapTransaction, ethereumStampedRuntimeBindings,
  ethereumStampedRuntimeDigest, ethereumStampedPreparationDigest, validateEthereumStampedPreparation,
  type EthereumStampedSwapRoute, type EthereumStampedSwapRequest, type EthereumStampedSwapPreparation } from "@/lib/swap/ethereum-stamped";
import { ETHEREUM_ROUTING_FEE_BOUNDARY_V1, ETHEREUM_ROUTING_FEE_POLICY_V2 as policy } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { customTradeRouterAbi } from "@/lib/custom-launch/trade-v1";
import type { TradeTraceV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

vi.mock("server-only", () => ({}));
type Id = keyof typeof recipes;
const word = (n: bigint) => toHex(n, { size: 32 });
const hash = `0x${"11".repeat(32)}` as Hex;
const owner = "0x1111111111111111111111111111111111111111" as Address;
const CALLBACKS = parseAbi([
  "function beforeSwap(address sender,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,bytes hookData) returns(bytes4,int256,uint24)",
  "function afterSwap(address sender,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,int256 delta,bytes hookData) returns(bytes4,int128)",
]);
const READ = parseAbi(["function platformCredit() view returns(uint256)", "function developmentCredit() view returns(uint256)", "function rewardCredit() view returns(uint256)",
  "function programmableFeesAccrued() view returns(uint256)", "function projectFeesAccrued() view returns(uint256)", "function totalQuoteFeesAccrued() view returns(uint256)",
  "function programmableFeeRemainder() view returns(uint256)", "function balanceOf(address,uint256) view returns(uint256)"]);
function fixture(id: Id) {
  const f = fixtures[id], market = f.market as EthereumNative30MarketV1;
  const hook = materializeEthereumNative30RuntimeWordsV1(recipes[id].hook, f.words as Record<string, Hex>);
  const proof = proveEthereumNative30RuntimeV1(market, { [market.hooks]: hook })!;
  return { market, hook, proof };
}
function scenario(id: Id, buy: boolean, broken?: "fee" | "backing" | "remainder" | "liability" | "scope") {
  const f = fixture(id), { market, proof } = f, rivet = id === "rivet_native30_v1", gross = 1_000_001n;
  const remainder = rivet ? 0n : 999_000n, expected = ethereumNative30FeeAmountV1(proof, gross, remainder);
  const paid = broken === "fee" ? expected.amount + 1n : expected.amount, other = 10n;
  const router = getAddress(protocol.router.address), params = { zeroForOne: buy, amountSpecified: -gross, sqrtPriceLimitX96: 1n };
  const frame = (from: Address, to: Address, input: Hex, calls: TradeTraceV1[] = []): TradeTraceV1 =>
    ({ type: "CALL", from, to, input, calls, output: "0x", value: "0", gasUsed: "1", failed: false });
  const trace = frame(owner, router, "0x", [
    frame(market.poolManager, market.hooks, encodeFunctionData({ abi: CALLBACKS, functionName: "beforeSwap", args: [router, market, params, "0x"] })),
    frame(market.poolManager, market.hooks, encodeFunctionData({ abi: CALLBACKS, functionName: "afterSwap", args: [broken === "scope" ? owner : router, market, params, (buy ? -gross : gross) << 128n, "0x"] })),
  ]);
  const post = { [market.hooks.toLowerCase()]: { balance: toHex(broken === "backing" ? 0n : paid + other) } };
  const call = async (_to: Address, data: Hex, overrides?: Record<string, Record<string, unknown>>) => {
    const name = decodeFunctionData({ abi: READ, data }).functionName, after = !!overrides;
    if (name === "programmableFeeRemainder") return word(after ? expected.remainder + (broken === "remainder" ? 1n : 0n) : remainder);
    if (!after) return word(0n);
    if (name === "platformCredit" || name === "programmableFeesAccrued") return word(paid);
    if (name === "developmentCredit" || name === "projectFeesAccrued") return word(other);
    if (name === "totalQuoteFeesAccrued") return word(paid + other + (broken === "liability" ? 1n : 0n));
    if (name === "balanceOf") return word(broken === "backing" ? 0n : paid + other);
    return word(0n);
  };
  return { ...f, gross, expected, proof, router, trace, post, call, balance: async () => 0n,
    request: { zeroForOne: buy, amountIn: gross.toString(), nativeInput: gross.toString(), hookData: "0x" as Hex } };
}

describe("custom 30-bps native ledgers", () => {
  it.each(Object.keys(recipes) as Id[])("binds %s to exact compiler bytes, immutable values and recipient", id => {
    const { market, hook, proof } = fixture(id);
    expect(keccak256(hook)).toBe(fixtures[id].runtimeCodeHash);
    expect(proof).toMatchObject({ recipeId: id, rateBps: 30, recipient: getAddress(policy.defaultCollection.recipient) });
    expect(rebuildEthereumNative30RuntimeProofV1(JSON.parse(JSON.stringify(proof)), market)).toEqual(proof);
    expect(proveEthereumNative30RuntimeV1(market, { [market.hooks]: `0x00${hook.slice(4)}` })).toBeNull();
    expect(() => rebuildEthereumNative30RuntimeProofV1({ ...proof, recipient: owner }, market)).toThrow();
  });

  it.each(Object.keys(recipes) as Id[])("accepts backed %s buys and sells, rejects wrong amounts, backing and callback scope", async id => {
    for (const buy of [true, false]) {
      const input = scenario(id, buy), accrued = await proveEthereumNative30TradeAccrualV1(input);
      expect(accrued.platformAccruedIncrease).toBe(input.expected.amount.toString());
      for (const broken of ["fee", "backing", "scope"] as const) await expect(proveEthereumNative30TradeAccrualV1(scenario(id, buy, broken))).rejects.toThrow();
    }
    if (id === "pidx_native30_v1") for (const broken of ["remainder", "liability"] as const)
      await expect(proveEthereumNative30TradeAccrualV1(scenario(id, true, broken))).rejects.toThrow();
  });

  it.each(Object.keys(recipes) as Id[])("encodes a single fee and validates the full %s browser preparation", async id => {
    const input = scenario(id, true), { market, proof } = input, accrued = await proveEthereumNative30TradeAccrualV1(input);
    const stampBinding = { launchId: hash, stampHash: hash, permitDigest: hash, routePayloadHash: hash };
    const body = { schemaVersion: "programmable.ethereum-launch-routing-fee-policy-binding.v1" as const, launchProfileVersion: "3.6.0" as const,
      launchProfileHash: `sha256:${"11".repeat(32)}` as const, policyHash: canonicalBrowserSha256V2(policy.schemaVersion, policy), policy,
      enforcementBoundary: ETHEREUM_ROUTING_FEE_BOUNDARY_V1, stampBinding };
    const route = { chainId: 1, stamp: { ...stampBinding, poolKey: market, poolManagerAddress: market.poolManager,
      routerAddress: owner, routerRuntimeCodeHash: hash, routeLauncherAddress: owner, routeLauncherRuntimeCodeHash: hash,
      components: proof.runtimeBindings, blockNumber: String(BigInt(ETHEREUM_ROUTING_FEE_BOUNDARY_V1.blockNumber) + 1n) },
      feeClassification: { launchId: hash, stampHash: hash, profileVersion: "3.6.0",
        routingFeePolicy: { ...body, bindingHash: canonicalBrowserSha256V2(body.schemaVersion, body) } } } as unknown as EthereumStampedSwapRoute;
    const request = { owner, token: market.currency1, side: "buy", amountIn: input.gross.toString(), slippageBps: 100, deadline: "2000" } as EthereumStampedSwapRequest;
    const transaction = ethereumStampedSwapTransaction(route, request, 10_000n, proof);
    const decoded = decodeFunctionData({ abi: customTradeRouterAbi, data: transaction.data });
    expect(decoded.args![0]).toBe("0x1004");
    expect(decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), decoded.args![1][0]!)[0]).toBe("0x060c0f");
    const bindings = ethereumStampedRuntimeBindings(route);
    const preparedBody = { schemaVersion: "programmable.ethereum-stamped-swap-preparation.v1", status: "ready", request, transaction,
      quote: { amountOut: "10000", amountOutMinimum: "9900", blockNumber: "1", blockHash: hash, blockTimestamp: "1000", validUntil: "1030" },
      evidence: { kind: "independent-rpc-simulation", runtimeBindings: bindings, runtimeBindingHash: ethereumStampedRuntimeDigest(bindings), executionDigest: `sha256:${"11".repeat(32)}` },
      fee: { policyHash: body.policyHash, rateBps: 30, routedRateBps: 0, recipient: proof.recipient, mode: "pool_enforced_native30",
        grossNativeAmount: input.gross.toString(), platformFeeAmount: input.expected.amount.toString(), netNativeAmount: (input.gross - input.expected.amount).toString(), native30Proof: proof, accrual: accrued } };
    const prepared = { ...preparedBody, preparationDigest: ethereumStampedPreparationDigest(preparedBody as unknown as EthereumStampedSwapPreparation) };
    expect(validateEthereumStampedPreparation(prepared, route, request, 1000n)).toEqual(prepared);
    if (id === "pidx_native30_v1") expect(() => validateEthereumStampedPreparation({ ...prepared,
      fee: { ...prepared.fee, accrual: { ...accrued, platformRemainderBefore: "0" } } }, route, request, 1000n)).toThrow();
  });
});
