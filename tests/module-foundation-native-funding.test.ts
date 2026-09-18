import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { keccak256, parseEther, type Hex, type PublicClient } from "viem";
import { assertFoundationNativeBalance, assertFoundationWrapRuntime, FOUNDATION_WETH, FOUNDATION_WETH_CODE_HASH,
  foundationSupportsEth, foundationWrappedAmount, prepareFoundationNativeFunding } from "@/lib/module-foundation/native-funding";
import { simulateFoundationV2Launch } from "@/lib/module-foundation/client";
import { foundationV2Fixture, v2Address } from "./module-foundation-v2-fixture";

const account = v2Address(3), amount = parseEther("0.005");
const code = readFileSync(new URL("./fixtures/foundation-robinhood-weth.runtime.hex", import.meta.url), "utf8").trim() as Hex;
function fixture(balance = 0n, eth = parseEther("0.02")) {
  const methods = { getBalance: vi.fn(async () => eth), getGasPrice: vi.fn(async () => 1_000_000_000n), getCode: vi.fn(async () => code) };
  return { methods, input: { client: methods as unknown as PublicClient, account, blockNumber: 100n, amount,
    quote: { address: FOUNDATION_WETH, decimals: 18, symbol: "WETH", codeHash: FOUNDATION_WETH_CODE_HASH, balance } } };
}
describe("native ETH launch funding", () => {
  it("binds ETH support to the exact chain WETH runtime rather than its symbol", () => {
    const { input } = fixture();
    expect(keccak256(code)).toBe(FOUNDATION_WETH_CODE_HASH);
    expect(foundationSupportsEth(input.quote)).toBe(true);
    for (const change of [{ address: v2Address(2) }, { decimals: 6 }, { codeHash: keccak256("0x6000") }]) {
      expect(foundationSupportsEth({ ...input.quote, ...change })).toBe(false);
    }
  });
  it.each([0n, amount])("requires no conversion when WETH already covers funding %s", async balance => {
    const f = fixture(balance);
    expect(await prepareFoundationNativeFunding({ ...f.input, amount: balance })).toEqual([]);
    expect(f.methods.getBalance).not.toHaveBeenCalled();
  });
  it.each([0n, parseEther("0.000419972738382734")])("wraps exactly the missing amount with WETH balance %s", async balance => {
    const { input } = fixture(balance), steps = await prepareFoundationNativeFunding(input);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "wrap", amount: amount - balance,
      transaction: { from: account, to: FOUNDATION_WETH, data: "0xd0e30db0", value: amount - balance } });
    expect(foundationWrappedAmount(steps, FOUNDATION_WETH)).toBe(amount - balance);
    expect(await prepareFoundationNativeFunding({ ...input, quote: { ...input.quote, balance: amount } })).toEqual([]);
  });
  it.each([0n, amount])("does not wrap without ETH left for fees: %s", async eth => {
    const { input } = fixture(0n, eth);
    await expect(prepareFoundationNativeFunding(input)).rejects.toThrow("plus network fees");
  });
  it("keeps arbitrary ERC20 funding in its own units and never sends ETH to it", async () => {
    const { input, methods } = fixture();
    await expect(prepareFoundationNativeFunding({ ...input, quote: { ...input.quote, address: v2Address(2), symbol: "TEST" } })).rejects.toThrow("0.005 TEST");
    expect(methods.getBalance).not.toHaveBeenCalled();
  });
  it("reserves gas for the complete remaining launch and rejects changed deposit bytes or runtime", async () => {
    const { input, methods } = fixture(), steps = await prepareFoundationNativeFunding(input);
    steps[0].gasUsed = 40_000n;
    await assertFoundationNativeBalance(input.client, account, steps, 100n);
    methods.getBalance.mockResolvedValue(amount + 1n);
    await expect(assertFoundationNativeBalance(input.client, account, steps, 100n)).rejects.toThrow("all launch network fees");
    await assertFoundationWrapRuntime(input.client, steps, 100n);
    methods.getCode.mockResolvedValue("0x6000");
    await expect(assertFoundationWrapRuntime(input.client, steps, 100n)).rejects.toThrow("contract changed");
    for (const change of [{ data: "0x" as Hex }, { to: v2Address(2) }, { value: amount + 1n }]) {
      expect(() => foundationWrappedAmount([{ ...steps[0], transaction: { ...steps[0].transaction, ...change } }], FOUNDATION_WETH)).toThrow("reviewed WETH deposit");
    }
    expect(() => foundationWrappedAmount([...steps, ...steps], FOUNDATION_WETH)).toThrow();
    expect(() => foundationWrappedAmount(steps, v2Address(2))).toThrow();
  });
  it("reconciles WETH credit in the full V2 simulation and stops counting it after confirmation", async () => {
    const f = foundationV2Fixture(false, true), { input } = fixture();
    const wrap = (await prepareFoundationNativeFunding({ ...input, amount: f.parameters.initialBuyQuoteAmount }))[0];
    f.state.newToken = true;
    const original = f.methods.getCode.getMockImplementation()!;
    f.methods.getCode.mockImplementation(async request => request.address === FOUNDATION_WETH ? code : original(request));
    const simulate = (steps = [wrap, ...f.steps]) => simulateFoundationV2Launch({ client: f.client, binding: f.binding,
      parameters: f.parameters, steps, checkpoint: f.checkpoint, checks: f.checks, expected: f.result, price: f.price });
    const wrapped = await simulate();
    expect(wrapped.simulation.balances[0].delta).toBe(0n);
    expect(wrapped.positions[0].owner).toBe(f.result.basePositionOwner);
    const remaining = await simulate(f.steps);
    expect(remaining.simulation.balances[0].delta).toBe(-f.parameters.initialBuyQuoteAmount);
    f.state.quoteDeltaAdjustment = -1n;
    await expect(simulate()).rejects.toThrow(/wallet balances|wallet movement/);
  });
});
