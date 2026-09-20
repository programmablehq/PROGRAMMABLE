import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAbiItem, type Hex } from "viem";
import { encodeFoundationLaunchEntry, foundationFactoryV2Abi, foundationFactoryV3Abi, foundationFactoryV3NativeAbi, foundationHookV2Abi } from "@/lib/module-foundation/abi";
import { assertFoundationInfrastructure, readFoundationCreatorFees, simulateFoundationV2Launch } from "@/lib/module-foundation/client";
import { assertFoundationLaunchCall, decodeFoundationLaunchCall, encodeFoundationFundingPath } from "@/lib/module-foundation/atomic-launch";
import { FOUNDATION_FACTORY_V2_ID } from "@/lib/module-foundation/constants";
import { foundationCreatorFeeFields, foundationCreatorFeeRates, type FoundationCreatorFees } from "@/lib/module-foundation/creator-fees";
import { discoverFoundationLaunch, readFoundationLaunchIndex } from "@/lib/module-foundation/discovery";
import { foundationReadbackAbi, readFoundationPoolDetails, simulateFoundationTradeFees, verifyFoundationLaunchReceipt } from "@/lib/module-foundation/readback";
import { decodeFoundationLaunchSelectionsV1 } from "@/lib/module-foundation/action-runtime";
import { bindFoundationCatalogV1, FOUNDATION_CATALOG_SCHEMA_V1 } from "@/lib/module-foundation/catalog";
import { readFoundationHookPrediction } from "@/lib/module-foundation/protocol";
import { foundationV3Fixture } from "./module-foundation-v3-fixture";
import { v2Now } from "./module-foundation-v2-fixture";

vi.mock("@/lib/module-foundation/constants", async original => {
  const actual = await original<typeof import("@/lib/module-foundation/constants")>();
  const { keccak256 } = await import("viem");
  return { ...actual, FOUNDATION_INFRASTRUCTURE: Object.fromEntries(Object.entries(actual.FOUNDATION_INFRASTRUCTURE)
    .map(([role, pin]) => [role, { ...pin, runtimeCodeHash: keccak256("0x60006000") }])) };
});
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(v2Now); vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No network in SDK fixtures"); })); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("V3 directional creator fee intent", () => {
  it("uses two independent tuple fields and getters without a synthetic scalar", () => {
    const legacy = getAbiItem({ abi: foundationFactoryV2Abi, name: "launch" }).inputs[0].components.map(field => field.name);
    const v3 = getAbiItem({ abi: foundationFactoryV3Abi, name: "launch" });
    expect(v3.inputs[0].components.map(field => field.name)).toEqual(legacy.flatMap(name => name === "creatorFeeBps" ? ["creatorBuyFeeBps", "creatorSellFeeBps"] : [name]));
    expect(v3.outputs).toEqual(getAbiItem({ abi: foundationFactoryV2Abi, name: "launch" }).outputs);
    expect(foundationHookV2Abi.some(item => item.name === "creatorBuyFeeBps")).toBe(true);
    expect(foundationHookV2Abi.some(item => (item.name as string) === "creatorFeeBps")).toBe(false);
    expect(foundationCreatorFeeRates({ creatorFeeBps: 300 })).toEqual({ creatorBuyFeeBps: 300, creatorSellFeeBps: 300 });
    expect(foundationCreatorFeeFields({ creatorBuyFeeBps: 100, creatorSellFeeBps: 700 })).not.toHaveProperty("creatorFeeBps");
  });
  it.each([{ creatorBuyFeeBps: 100 }, { creatorBuyFeeBps: 101, creatorSellFeeBps: 0 },
    { creatorFeeBps: 100, creatorBuyFeeBps: 100, creatorSellFeeBps: 100 }, { creatorBuyFeeBps: 0, creatorSellFeeBps: 1100 }])(
    "rejects invalid or ambiguous rates: %j", fees => {
      expect(() => foundationCreatorFeeRates(fees as FoundationCreatorFees)).toThrow();
    });
  it("binds both rates to exact launch bytes, prediction arguments and the admitted version", async () => {
    const f = foundationV3Fixture();
    const call = decodeFoundationLaunchCall(f.binding, f.steps[0].transaction);
    expect(call.parameters).toMatchObject({ creatorBuyFeeBps: 100, creatorSellFeeBps: 700 });
    expect(call.parameters).not.toHaveProperty("creatorFeeBps");
    expect(() => assertFoundationLaunchCall(f.binding, f.steps[0].transaction, { ...f.parameters, creatorSellFeeBps: 600 })).toThrow("settings");
    await readFoundationHookPrediction(f.client, f.binding, f.account, f.token, f.parameters, "predictHookAddress", 100n);
    expect(f.methods.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "predictHookAddress", args: [f.account, f.token, f.parameters] }));
    expect(() => decodeFoundationLaunchCall({ ...f.binding, factoryVersion: "v2" }, f.steps[0].transaction)).toThrow("calldata");
    f.state.factoryValues.VERSION_ID = FOUNDATION_FACTORY_V2_ID;
    await expect(assertFoundationInfrastructure(f.client, f.binding)).rejects.toThrow("version");
  });
  it("reconstructs admitted action selections with both original fee rates", () => {
    const f = foundationV3Fixture();
    const catalog = bindFoundationCatalogV1({ schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries: [] }, { admissions: [], releases: [] });
    const restored = decodeFoundationLaunchSelectionsV1({ catalog, calldata: f.steps[0].transaction.data });
    expect(restored).toMatchObject({ creatorBuyFeeBps: 100, creatorSellFeeBps: 700, selections: [], transactionVerified: false });
    expect(restored).not.toHaveProperty("creatorFeeBps");
  });
});

describe("V3 canonical readback, native funding and fees", () => {
  it("verifies the V3 event and both hook rates while preserving DEAD custody", async () => {
    const f = foundationV3Fixture();
    const details = await readFoundationPoolDetails({ client: f.client, binding: f.binding, token: f.token });
    expect(details).toMatchObject({ creatorBuyFeeBps: 100, creatorSellFeeBps: 700, record: { factoryVersion: "v3" } });
    expect(details).not.toHaveProperty("creatorFeeBps");
    const verified = await verifyFoundationLaunchReceipt({ client: f.client, binding: f.binding, transactionHash: f.transactionHash, expected: f.expected });
    expect(verified.event.factoryVersion).toBe("v3");
    f.fees.creatorSellFeeBps = 600;
    await expect(verifyFoundationLaunchReceipt({ client: f.client, binding: f.binding, transactionHash: f.transactionHash, expected: f.expected })).rejects.toThrow("disagrees");
    expect(f.methods.readContract.mock.calls.some(([read]) => read.functionName === "creatorFeeBps")).toBe(false);
  });
  it("discovers and indexes V3 using its own event identity", async () => {
    const f = foundationV3Fixture();
    const found = await discoverFoundationLaunch({ client: f.client, binding: f.binding, token: f.token, transactionHash: f.transactionHash });
    expect(found.parameters).toMatchObject({ creatorBuyFeeBps: 100, creatorSellFeeBps: 700 });
    const page = await readFoundationLaunchIndex({ client: f.client, binding: f.binding, fromBlock: 1n, toBlock: 100n });
    expect(page.entries[0].factoryVersion).toBe("v3");
    expect(f.methods.getLogs).toHaveBeenCalledWith(expect.objectContaining({ event: getAbiItem({ abi: foundationFactoryV3Abi, name: "FoundationLaunchedV3" }) }));
  });
  it("keeps one native-funded call with distinct rates and zero caller quote debit", async () => {
    const f = foundationV3Fixture(0, 1000, true), transaction = f.steps[0].transaction;
    transaction.value = f.parameters.initialBuyQuoteAmount;
    transaction.data = encodeFoundationLaunchEntry(f.parameters, { functionName: "launchWithEthRoute", fundingPath: encodeFoundationFundingPath([]) });
    f.state.quoteDeltaAdjustment = f.parameters.initialBuyQuoteAmount;
    f.checks[0] = { token: f.quote, account: f.account, minimumDelta: 0n };
    f.state.newToken = true;
    expect(decodeFoundationLaunchCall(f.binding, transaction)).toMatchObject({ native: true, parameters: { creatorBuyFeeBps: 0, creatorSellFeeBps: 1000 } });
    const checked = await simulateFoundationV2Launch({ client: f.client, binding: f.binding, parameters: f.parameters, steps: f.steps,
      checkpoint: f.checkpoint, checks: f.checks, expected: f.result, price: f.price });
    expect(checked.simulation.steps).toHaveLength(1);
    expect(checked.simulation.balances[0].delta).toBe(0n);
    expect(checked.result.factoryVersion).toBe("v3");
    expect(getAbiItem({ abi: foundationFactoryV3NativeAbi, name: "launchWithEthRoute" }).inputs[0].components[5].name).toBe("creatorSellFeeBps");
  });
  it("checks buy and sell logs against their own rates and directional carry", async () => {
    const f = foundationV3Fixture(100, 700);
    await expect(readFoundationCreatorFees(f.client, f.binding, f.hook, 100n)).resolves.toEqual(f.fees);
    const originalRead = f.state.readOverride;
    f.state.readOverride = read => read.address === f.hook && read.functionName === "feeCarry"
      ? [0, read.args?.[0] ? 9_000 : 5_000] : originalRead?.(read);
    const steps = ["buy", "sell"].map(kind => ({ ...f.steps[0], kind: kind as "buy" | "sell" }));
    const swap = (buy: boolean, creatorQuote: bigint) => ({ address: f.hook,
      topics: encodeEventTopics({ abi: foundationReadbackAbi, eventName: "FoundationSwap", args: { poolId: f.pool.poolId, router: f.account } }),
      data: encodeAbiParameters(getAbiItem({ abi: foundationReadbackAbi, name: "FoundationSwap" }).inputs.filter(item => !("indexed" in item && item.indexed)),
        [buy, true, 10_001n, 30n, creatorQuote, 0n, 0n]) });
    let sellFee = 700n;
    f.methods.simulateCalls.mockImplementation(async () => ({ results: [
      { data: encodeFunctionResult({ abi: foundationReadbackAbi, functionName: "platformReceived", result: 0n }) },
      { data: encodeFunctionResult({ abi: foundationReadbackAbi, functionName: "creatorReceived", result: 0n }) },
      { data: "0x" as Hex, logs: [swap(true, 100n)] }, { data: "0x" as Hex, logs: [swap(false, sellFee)] },
      { data: encodeFunctionResult({ abi: foundationReadbackAbi, functionName: "platformReceived", result: 60n }) },
      { data: encodeFunctionResult({ abi: foundationReadbackAbi, functionName: "creatorReceived", result: 800n }) },
    ].map(item => ({ ...item, status: "success" as const, gasUsed: 100n })) }));
    const result = await simulateFoundationTradeFees({ client: f.client, binding: f.binding, pool: f.pool, steps, checkpoint: f.checkpoint });
    expect(result).toMatchObject({ creatorBuyFeeBps: 100, creatorSellFeeBps: 700, creatorQuote: 800n,
      nextCarry: { buy: { platform: 30, creator: 9100 }, sell: { platform: 30, creator: 5700 } } });
    sellFee = 100n;
    await expect(simulateFoundationTradeFees({ client: f.client, binding: f.binding, pool: f.pool, steps, checkpoint: f.checkpoint })).rejects.toThrow("carry arithmetic");
  });
});
