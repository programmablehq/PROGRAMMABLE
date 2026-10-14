import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, getAddress, getContractAddress, parseAbi, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import fixtureBytes from "./fixtures/custom-native30-runtimes.json";
import { ETHEREUM_CUSTOM_NATIVE30_RECIPES_V1 as recipes, isBrownieNative30RecipeV1 } from "@/lib/custom-launch/ethereum-custom-native30-recipes-v1";
import { ethereumNative30RequiredAddressesV1, materializeEthereumNative30RuntimeWordsV1, proveEthereumNative30RuntimeV1,
  rebuildEthereumNative30RuntimeProofV1, type EthereumNative30MarketV1 } from "@/lib/custom-launch/ethereum-native30-runtime-v1";
import { proveEthereumNative30TradeAccrualV1 } from "@/lib/server/custom-launch/ethereum-native30-trade-v1";
import { ETHEREUM_STAMPED_SWAP_PROTOCOL as protocol, ethereumStampedSwapTransaction, type EthereumStampedSwapRoute, type EthereumStampedSwapRequest } from "@/lib/swap/ethereum-stamped";
import { ETHEREUM_ROUTING_FEE_BOUNDARY_V1, ETHEREUM_ROUTING_FEE_POLICY_V2 as policy } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { customTradeRouterAbi } from "@/lib/custom-launch/trade-v1";
import type { TradeTraceV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

vi.mock("server-only", () => ({}));
type RecipeId = keyof typeof recipes;
const word = (value: string | bigint) => toHex(BigInt(value), { size: 32 });
const hash = `0x${"11".repeat(32)}` as Hex;
const owner = "0x1111111111111111111111111111111111111111" as Address;
const abi = parseAbi([
  "function beforeSwap(address sender,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,bytes hookData) returns(bytes4,int256,uint24)",
  "function afterSwap(address sender,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,int256 delta,bytes hookData) returns(bytes4,int128)",
  "function recordFees(uint256 platformAmount,uint256 creatorAmount)",
  "function platformAccrued() view returns(uint256)", "function creatorAccrued() view returns(uint256)",
  "function platformOwed() view returns(uint256)", "function harvestable() view returns(uint256)",
  "function moduleBudget() view returns(uint256)", "function launchTaxOwed() view returns(uint256)",
  "function balanceOf(address,uint256) view returns(uint256)",
]);
function fixture(id: RecipeId) {
  const f = fixtureBytes[id], market = f.market as EthereumNative30MarketV1;
  const hook = materializeEthereumNative30RuntimeWordsV1(recipes[id].hook, f.words as Record<string, Hex>);
  const codes: Record<string, Hex> = { [market.hooks]: hook };
  if (!isBrownieNative30RecipeV1(id)) codes[getContractAddress({ from: market.hooks, nonce: 1n })] = materializeEthereumNative30RuntimeWordsV1(
    recipes[id].vault,
    { poolManager: word(market.poolManager), kernel: word(market.hooks), creatorRecipient: fixtureBytes[id].words.OWNER as Hex });
  const proof = proveEthereumNative30RuntimeV1(market, codes)!;
  return { market, hook, codes, proof };
}
function trade(id: RecipeId, buy: boolean, options: { paid?: bigint; nativeInput?: string; unbacked?: boolean } = {}) {
  const { market, proof } = fixture(id), gross = 1_000_001n;
  const paid = options.paid ?? (gross * 30n + (!isBrownieNative30RecipeV1(id) ? 9999n : 0n)) / 10000n;
  const router = getAddress(protocol.router.address), params = { zeroForOne: buy, amountSpecified: -gross, sqrtPriceLimitX96: 1n };
  const frame = (from: Address, to: Address, input: Hex, calls: TradeTraceV1[] = []): TradeTraceV1 =>
    ({ type: "CALL", from, to, input, output: "0x", value: "0", gasUsed: "1", failed: false, calls });
  const record = frame(market.hooks, proof.feeVault, encodeFunctionData({ abi, functionName: "recordFees", args: [paid, 0n] }));
  const trace = frame(owner, router, "0x", [
    frame(market.poolManager, market.hooks, encodeFunctionData({ abi, functionName: "beforeSwap", args: [router, market, params, "0x"] })),
    frame(market.poolManager, market.hooks, encodeFunctionData({ abi, functionName: "afterSwap", args: [router, market, params, (buy ? -gross : gross) << 128n, "0x"] }), !isBrownieNative30RecipeV1(id) ? [record] : []),
  ]);
  const call = async (_to: Address, data: Hex, overrides?: Record<string, Record<string, unknown>>) => {
    const name = decodeFunctionData({ abi, data }).functionName;
    if (name === "platformAccrued" || name === "platformOwed") return word(overrides ? paid : 0n);
    if (name === "balanceOf") return word(overrides && !options.unbacked ? paid : 0n);
    return word(0n);
  };
  return { proof, router, trace, post: {}, call, request: { zeroForOne: buy, amountIn: gross.toString(), nativeInput: options.nativeInput ?? gross.toString(), hookData: "0x" as Hex } };
}

describe("exact custom hook fee recognition", () => {
  it.each(Object.keys(recipes) as RecipeId[])("reconstructs %s without accepting different runtime or treasury", id => {
    const f = fixture(id);
    expect(f.proof).toMatchObject({ recipeId: id, recipient: getAddress(policy.defaultCollection.recipient), rateBps: 30 });
    expect(ethereumNative30RequiredAddressesV1(f.market, f.hook)).toContain(getAddress(f.market.hooks));
    expect(rebuildEthereumNative30RuntimeProofV1(JSON.parse(JSON.stringify(f.proof)), f.market)).toEqual(f.proof);
    expect(proveEthereumNative30RuntimeV1(f.market, { ...f.codes, [f.market.hooks]: `0x00${f.hook.slice(4)}` })).toBeNull();
    expect(() => rebuildEthereumNative30RuntimeProofV1({ ...f.proof, recipient: owner }, f.market)).toThrow();
    expect(proveEthereumNative30RuntimeV1({ ...f.market, currency1: owner }, f.codes)).toBeNull();
  });

  it("requires the exact funded vault bound to the custom hook", () => {
    const f = fixture("duelis_native30_v1"), vault = getContractAddress({ from: f.market.hooks, nonce: 1n });
    expect(proveEthereumNative30RuntimeV1(f.market, { [f.market.hooks]: f.hook })).toBeNull();
    expect(proveEthereumNative30RuntimeV1(f.market, { ...f.codes, [vault]: "0x6000" })).toBeNull();
    const wrongKernel = materializeEthereumNative30RuntimeWordsV1(recipes.duelis_native30_v1.vault,
      { poolManager: word(f.market.poolManager), kernel: word(owner), creatorRecipient: word(owner) });
    expect(proveEthereumNative30RuntimeV1(f.market, { ...f.codes, [vault]: wrongKernel })).toBeNull();
  });

  it.each(Object.keys(recipes) as RecipeId[])("does not add a second fee to %s buys or sells", id => {
    const f = fixture(id);
    // Synthetic stamp coordinates exercise encoding, not launch admission or finality.
    const stampBinding = { launchId: hash, stampHash: hash, permitDigest: hash, routePayloadHash: hash };
    const body = { schemaVersion: "programmable.ethereum-launch-routing-fee-policy-binding.v1" as const, launchProfileVersion: "3.6.0" as const,
      launchProfileHash: `sha256:${"11".repeat(32)}` as const, policyHash: canonicalBrowserSha256V2(policy.schemaVersion, policy), policy,
      enforcementBoundary: ETHEREUM_ROUTING_FEE_BOUNDARY_V1, stampBinding };
    const route = { chainId: 1, stamp: { ...stampBinding, poolKey: f.market, poolManagerAddress: f.market.poolManager,
      blockNumber: String(BigInt(ETHEREUM_ROUTING_FEE_BOUNDARY_V1.blockNumber) + 1n) },
      feeClassification: { launchId: hash, stampHash: hash, profileVersion: "3.6.0",
        routingFeePolicy: { ...body, bindingHash: canonicalBrowserSha256V2(body.schemaVersion, body) } } } as unknown as EthereumStampedSwapRoute;
    for (const side of ["buy", "sell"] as const) {
      const request = { owner, token: f.market.currency1, side, amountIn: "1000001", slippageBps: 100, deadline: "9999999999" } as EthereumStampedSwapRequest;
      const tx = ethereumStampedSwapTransaction(route, request, 10000n, f.proof);
      const decoded = decodeFunctionData({ abi: customTradeRouterAbi, data: tx.data });
      expect(decoded.args![0]).toBe("0x1004"); // swap + refund, no native transfer command
      const [actions] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), decoded.args![1][0]!);
      expect(actions).toBe("0x060c0f"); // no TAKE_PORTION on sell
    }
  });

  it.each(Object.keys(recipes) as RecipeId[])("checks %s accrual on both sides, including rounding and actual input", async id => {
    for (const buy of [true, false]) {
      const input = trade(id, buy), result = await proveEthereumNative30TradeAccrualV1(input);
      expect(result.platformAccruedIncrease).toBe(!isBrownieNative30RecipeV1(id) ? "3001" : "3000");
      await expect(proveEthereumNative30TradeAccrualV1(trade(id, buy, { paid: 6000n }))).rejects.toThrow();
      await expect(proveEthereumNative30TradeAccrualV1(trade(id, buy, { paid: 100n }))).rejects.toThrow();
      await expect(proveEthereumNative30TradeAccrualV1(trade(id, buy, { unbacked: true }))).rejects.toThrow();
    }
    await expect(proveEthereumNative30TradeAccrualV1(trade(id, true, { nativeInput: "500000" }))).rejects.toThrow();
  });
});
