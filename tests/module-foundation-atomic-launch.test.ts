import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, type Hex, type PublicClient } from "viem";
import { foundationFactoryNativeAbi, foundationFactoryV2Abi } from "@/lib/module-foundation/abi";
import { assertFoundationAtomicEth, decodeFoundationLaunchCall, FOUNDATION_NATIVE_FUNDING_ID, FOUNDATION_NO_FUNDING_POOL } from "@/lib/module-foundation/atomic-launch";
import { FOUNDATION_WETH, FOUNDATION_WETH_CODE_HASH } from "@/lib/module-foundation/native-funding";
import { simulateFoundationV2Launch } from "@/lib/module-foundation/client";
import { verifyFoundationLaunchReceipt } from "@/lib/module-foundation/readback";
import { discoverFoundationLaunch } from "@/lib/module-foundation/discovery";
import { foundationV2Fixture, v2Now } from "./module-foundation-v2-fixture";

vi.mock("@/lib/module-foundation/constants", async original => {
  const actual = await original<typeof import("@/lib/module-foundation/constants")>();
  const { keccak256 } = await import("viem");
  return { ...actual, FOUNDATION_INFRASTRUCTURE: Object.fromEntries(Object.entries(actual.FOUNDATION_INFRASTRUCTURE)
    .map(([role, pin]) => [role, { ...pin, runtimeCodeHash: keccak256("0x60006000") }])) };
});
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(v2Now); vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No network in SDK fixtures"); })); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function nativeFixture() {
  const f = foundationV2Fixture(false, true);
  const transaction = f.steps[0].transaction;
  transaction.value = f.parameters.initialBuyQuoteAmount;
  transaction.data = encodeFunctionData({ abi: foundationFactoryNativeAbi, functionName: "launchWithEth", args: [f.parameters, FOUNDATION_NO_FUNDING_POOL] });
  // Model the funding source: the contract receives ETH; the caller's quote balance is untouched.
  f.state.quoteDeltaAdjustment = f.parameters.initialBuyQuoteAmount;
  f.checks[0] = { token: f.quote, account: f.account, minimumDelta: 0n };
  const original = f.methods.getTransaction.getMockImplementation()!;
  f.methods.getTransaction.mockImplementation(async () => ({ ...await original(), value: transaction.value }));
  return f;
}

describe("one-transaction native launch", () => {
  it("preserves exact custody simulation with one launch call and no caller quote debit", async () => {
    const f = nativeFixture();
    f.state.newToken = true;
    const result = await simulateFoundationV2Launch({ client: f.client, binding: f.binding, parameters: f.parameters,
      steps: f.steps, checkpoint: f.checkpoint, checks: f.checks, expected: f.result, price: f.price });
    expect(result.simulation.steps).toHaveLength(1);
    expect(result.simulation.steps[0].kind).toBe("launch");
    expect(result.simulation.balances[0].delta).toBe(0n);
    expect(result.result.initialBuyTokenAmount).toBeGreaterThan(0n);
  });

  it("verifies and discovers a native-funded receipt against exact calldata and value", async () => {
    const f = nativeFixture();
    const verified = await verifyFoundationLaunchReceipt({ client: f.client, binding: f.binding, transactionHash: f.transactionHash, expected: f.expected });
    expect(verified.details.token.address).toBe(f.token);
    const found = await discoverFoundationLaunch({ client: f.client, binding: f.binding, token: f.token, transactionHash: f.transactionHash });
    expect(found.parameters).toEqual(f.parameters);
  });

  it("rejects calldata, value and funding-pool changes before simulation", async () => {
    const f = nativeFixture();
    expect(decodeFoundationLaunchCall(f.binding, f.steps[0].transaction).native).toBe(true);
    for (const transaction of [
      { ...f.steps[0].transaction, value: 0n },
      { ...f.steps[0].transaction, data: `${f.steps[0].transaction.data}00` as Hex },
      { ...f.steps[0].transaction, data: encodeFunctionData({ abi: foundationFactoryV2Abi, functionName: "launch", args: [f.parameters] }) },
      { ...f.steps[0].transaction, data: encodeFunctionData({ abi: foundationFactoryNativeAbi, functionName: "launchWithEth", args: [f.parameters, { ...FOUNDATION_NO_FUNDING_POOL, fee: 3000 }] }) },
    ]) expect(() => decodeFoundationLaunchCall(f.binding, transaction)).toThrow("calldata");
  });

  it("requires the activated factory capability and exact canonical WETH runtime", async () => {
    const f = nativeFixture();
    const code = readFileSync(new URL("./fixtures/foundation-robinhood-weth.runtime.hex", import.meta.url), "utf8").trim() as Hex;
    const values: Record<string, unknown> = { NATIVE_FUNDING_ID: FOUNDATION_NATIVE_FUNDING_ID, wrappedEth: FOUNDATION_WETH, wrappedEthCodeHash: FOUNDATION_WETH_CODE_HASH };
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]);
    const client = { readContract, getCode: vi.fn(async () => code) } as unknown as PublicClient;
    await expect(assertFoundationAtomicEth(client, f.binding, 100n)).resolves.toBeUndefined();
    readContract.mockRejectedValueOnce(new Error("old factory: selector missing"));
    await expect(assertFoundationAtomicEth(client, f.binding, 100n)).rejects.toThrow("activated first");
    values.wrappedEthCodeHash = `0x${"00".repeat(32)}`;
    await expect(assertFoundationAtomicEth(client, f.binding, 100n)).rejects.toThrow("activated first");
  });
});
