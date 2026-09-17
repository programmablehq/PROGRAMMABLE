import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, getAbiItem, getAddress, keccak256, type Address } from "viem";
import { foundationFactoryAbi, foundationFactoryV2Abi, foundationLedgerAbi } from "@/lib/module-foundation/abi";
import { assertFoundationInfrastructure, assertFoundationPreparedSequence, prepareFoundationClaim, simulateFoundationV2Launch } from "@/lib/module-foundation/client";
import { FOUNDATION_ABI_ID, FOUNDATION_DEAD_ADDRESS, FOUNDATION_LP_CUSTODY_DEAD_ID, FOUNDATION_PLATFORM_RECIPIENT, FOUNDATION_SUPPLY } from "@/lib/module-foundation/constants";
import { assertFoundationV2Result, decodeFoundationLaunchResult, foundationFactoryVersion, type FoundationDeploymentBinding } from "@/lib/module-foundation/protocol";
import { readFoundationPoolDetails, verifyFoundationLaunchReceipt } from "@/lib/module-foundation/readback";
import { discoverFoundationLaunch, readFoundationLaunchIndex } from "@/lib/module-foundation/discovery";
import { foundationPositionPresentation } from "@/lib/module-foundation/ui-readback";
import { foundationV2Fixture, v2Address, v2Code, v2Hash, v2Now } from "./module-foundation-v2-fixture";

vi.mock("@/lib/module-foundation/constants", async original => {
  const actual = await original<typeof import("@/lib/module-foundation/constants")>();
  const { keccak256 } = await import("viem");
  return { ...actual, FOUNDATION_INFRASTRUCTURE: Object.fromEntries(Object.entries(actual.FOUNDATION_INFRASTRUCTURE)
    .map(([role, pin]) => [role, { ...pin, runtimeCodeHash: keccak256("0x60006000") }])) };
});
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(v2Now); vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network is forbidden in this fixture"); })); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const simulate = (f: ReturnType<typeof foundationV2Fixture>) => {
  f.state.newToken = true;
  return simulateFoundationV2Launch({ client: f.client, binding: f.binding, parameters: f.parameters, steps: f.steps,
    checkpoint: f.checkpoint, checks: f.checks, expected: f.result, price: f.price });
};

describe("versioned Foundation factory source binding", () => {
  it("matches every SDK ABI item against the frozen actual Solidity compiler output", () => {
    const bytes = readFileSync(new URL("./fixtures/foundation-factory-v2.abi.json", import.meta.url));
    // Foundation contracts commit 297ac74cb3ce125f04ffe2decd877d9af6e04ba6; local compiled ABI, not a deployed runtime receipt.
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("a7f9ab6b9dc4eec8cbb70ff269d253dbfb8206f1499179afbbacd005b12a3457");
    const compiled = JSON.parse(bytes.toString()) as { type: string; name?: string; inputs?: unknown[]; outputs?: unknown[]; stateMutability?: string }[];
    const parameter = (raw: unknown, names: boolean): unknown => {
      const value = raw as { name?: string; type: string; indexed?: boolean; components?: unknown[] };
      return { type: value.type, ...(names ? { name: value.name ?? "" } : {}),
        ...(value.components ? { components: value.components.map(item => parameter(item, true)) } : {}),
        ...(value.indexed !== undefined ? { indexed: value.indexed } : {}) };
    };
    for (const item of foundationFactoryV2Abi) {
      const original = compiled.find(value => value.type === item.type && value.name === item.name)!;
      expect(original).toBeDefined();
      const inputs = (items: readonly unknown[]) => items.map(raw => {
        const normalized = parameter(raw, item.type === "event") as Record<string, unknown>;
        return item.type === "event" ? { ...normalized, indexed: normalized.indexed ?? false } : normalized;
      });
      expect(inputs(item.inputs)).toEqual(inputs(original.inputs ?? []));
      if (item.type === "function") {
        expect(item.stateMutability).toBe(original.stateMutability);
        expect(item.outputs.map(raw => parameter(raw, false))).toEqual((original.outputs ?? []).map(raw => parameter(raw, false)));
      }
    }
  });
  it("keeps exact V1 launch input bytes while decoding the independent 14-field V2 result", () => {
    const f = foundationV2Fixture();
    expect(getAbiItem({ abi: foundationFactoryV2Abi, name: "launch" }).inputs).toEqual(getAbiItem({ abi: foundationFactoryAbi, name: "launch" }).inputs);
    expect(getAbiItem({ abi: foundationFactoryV2Abi, name: "launch" }).outputs[0].components.map(item => item.name)).toEqual([
      "token", "hook", "ledger", "poolId", "basePositionOwner", "creatorPositionOwner", "roundingInventoryRecipient", "basePositionId",
      "creatorPositionId", "initialBuyTokenAmount", "baseTokenPrincipal", "baseTokenRounding", "creatorQuotePrincipal", "actualQuoteRefund",
    ]);
    const data = encodeFunctionResult({ abi: foundationFactoryV2Abi, functionName: "launch", result: f.result });
    expect(decodeFoundationLaunchResult(f.binding, data)).toEqual({ ...f.result, factoryVersion: "v2" });
    expect(() => decodeFoundationLaunchResult(f.binding, `${data}00`)).toThrow("canonical");
    expect(() => decodeFoundationLaunchResult({ ...f.binding, factoryVersion: "v1", lpCustodyId: undefined }, data)).toThrow("canonical");
  });
  it("requires a valid legacy binding and explicit V2 custody; an arbitrary missing version is not a fallback", () => {
    const f = foundationV2Fixture();
    const legacy: FoundationDeploymentBinding = { releaseDigest: f.binding.releaseDigest, sourceCommit: f.binding.sourceCommit,
      startBlock: 1n, factory: f.binding.factory, hookDeployer: f.binding.hookDeployer };
    expect(foundationFactoryVersion(legacy)).toBe("v1");
    expect(() => foundationFactoryVersion({} as FoundationDeploymentBinding)).toThrow("binding");
    expect(() => foundationFactoryVersion({ ...f.binding, lpCustodyId: v2Hash(99) })).toThrow("custody");
  });
  it("validates real factory getter results after all exact runtime hashes", async () => {
    const f = foundationV2Fixture();
    expect(keccak256(v2Code)).toBe(f.binding.factory.runtimeCodeHash);
    await expect(assertFoundationInfrastructure(f.client, f.binding)).resolves.toEqual(f.checkpoint);
    expect(f.methods.getCode).toHaveBeenCalledTimes(8);
  });
  it.each([
    ["VERSION_ID", FOUNDATION_ABI_ID], ["MODULE_ABI_ID", v2Hash(99)], ["LP_CUSTODY_ID", v2Hash(99)],
    ["LP_RECIPIENT", v2Address(3)], ["ROUNDING_INVENTORY_RECIPIENT", v2Address(0)], ["LP_FEE", 30],
  ])("rejects a mismatched %s without treating it as V1", async (field, value) => {
    const f = foundationV2Fixture(); f.state.factoryValues[field as string] = value;
    await expect(assertFoundationInfrastructure(f.client, f.binding)).rejects.toThrow(/version|custody|interface/i);
  });
});

describe("V2 ephemeral NFT custody and exact quote settlement", () => {
  it("rejects changed signed calldata before any simulation or settlement read", async () => {
    const f = foundationV2Fixture(); f.steps[0].transaction.data = "0x";
    await expect(simulate(f)).rejects.toThrow("calldata");
    expect(f.methods.simulateCalls).not.toHaveBeenCalled();
    expect(f.methods.readContract).not.toHaveBeenCalled();
  });
  it("preserves the additional admitted module-asset balance checks with V2 NFT checks", async () => {
    const f = foundationV2Fixture(), asset = v2Address(90);
    f.checks.push({ token: asset, account: f.account, minimumDelta: 0n });
    const checked = await simulate(f);
    expect(checked.simulation.balances[2]).toMatchObject({ token: asset, account: f.account, delta: 90n });
    f.checks[2].minimumDelta = 91n;
    await expect(simulate(f)).rejects.toThrow("actual simulated wallet balances");
  });
  it.each([true, false])("checks the actual simulated NFTs, with optional LP=%s", async optional => {
    const f = foundationV2Fixture(optional), checked = await simulate(f);
    expect(checked.positions).toHaveLength(optional ? 2 : 1);
    expect(checked.positions.every(position => position.owner === FOUNDATION_DEAD_ADDRESS && position.liquidity > 0n)).toBe(true);
    expect(f.methods.simulateCalls).toHaveBeenCalledTimes(2);
    expect(checked.result).not.toHaveProperty("baseVault");
  });
  it.each([77n, 78n].flatMap(id => [[id, "owner"], [id, "approved"], [id, "liquidity"]] as const))(
    "rejects NFT %s with wrong %s despite a correct result tuple", async (id, field) => {
      const f = foundationV2Fixture();
      if (field === "owner") f.state.owner.set(id, f.account);
      else if (field === "approved") f.state.approved.set(id, f.account);
      else f.state.liquidity.set(id, 0n);
      await expect(simulate(f)).rejects.toThrow(/NFT|custody/);
    },
  );
  it("accepts extra construction quote refund and reconciles the exact wallet movement", async () => {
    const f = foundationV2Fixture(); f.state.extraRefund = 5_000n;
    const checked = await simulate(f);
    expect(checked.result.actualQuoteRefund).toBe(f.result.actualQuoteRefund + 5_000n);
    expect(checked.simulation.balances[0].delta).toBe(checked.result.actualQuoteRefund - f.parameters.initialBuyQuoteAmount - f.parameters.additionalQuoteAmount);
    f.state.quoteDeltaAdjustment = -1n;
    await expect(simulate(f)).rejects.toThrow("wallet movement");
  });
  it.each(["factoryQuoteAfter", "factoryTokenAfter", "inventoryBalance"] as const)("rejects incorrect %s", async field => {
    const f = foundationV2Fixture(); f.state[field] = field === "inventoryBalance" ? 0n : 999n;
    if (field === "inventoryBalance" && f.result.baseTokenRounding === 0n) {
      f.state.result.baseTokenRounding = 1n; f.state.result.baseTokenPrincipal -= 1n;
    }
    await expect(simulate(f)).rejects.toThrow(/settlement|principal/);
  });
  it("rejects a fake creator NFT without principal and missing optional-owner zero", () => {
    const f = foundationV2Fixture(false);
    expect(() => assertFoundationV2Result({ ...f.result, creatorPositionOwner: FOUNDATION_DEAD_ADDRESS }, f.parameters)).toThrow("custody");
    expect(() => assertFoundationV2Result({ ...f.result, creatorPositionId: 78n, creatorPositionOwner: FOUNDATION_DEAD_ADDRESS }, f.parameters)).toThrow("principal");
  });
});

describe("V2 canonical readback and receipt", () => {
  it.each(["platform", "creator"] as const)("preserves fixed-recipient %s hook-ledger claims independently of irretrievable NFTs", async beneficiary => {
    const f = foundationV2Fixture(), caller = v2Address(19);
    const recipient = beneficiary === "platform" ? FOUNDATION_PLATFORM_RECIPIENT : f.account, amount = beneficiary === "platform" ? 20n : 80n;
    const functionName = beneficiary === "platform" ? "claimPlatform" : "claimCreator";
    f.methods.simulateCalls.mockImplementation(async ({ calls }) => {
      expect(calls).toHaveLength(3);
      for (const call of [calls[0], calls[2]]) {
        expect(call.to).toBe(f.quote);
        expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({ functionName: "balanceOf", args: [recipient] });
      }
      expect(calls[1].to).toBe(f.ledger);
      expect(decodeFunctionData({ abi: foundationLedgerAbi, data: calls[1].data })).toEqual({ functionName, args: undefined });
      return { results: [encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: 500n }),
        encodeFunctionResult({ abi: foundationLedgerAbi, functionName, result: amount }),
        encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: 500n + amount })]
        .map(data => ({ status: "success" as const, data, gasUsed: 100n })) };
    });
    const sequence = await prepareFoundationClaim({ client: f.client, binding: f.binding, account: caller, pool: f.pool, beneficiary });
    expect(sequence.recipient).toBe(recipient);
    expect(sequence.minimumOutput).toBe(amount);
    expect(sequence.provenance.positions?.base.owner).toBe(FOUNDATION_DEAD_ADDRESS);
    expect(sequence.provenance.positions?.creator?.owner).toBe(FOUNDATION_DEAD_ADDRESS);
    expect(sequence.balances[0].delta).toBe(amount);
    expect(() => assertFoundationPreparedSequence(sequence)).not.toThrow();
  });
  it("keeps both NFTs at DEAD, unchanged totalSupply and independent backed hook claims", async () => {
    const f = foundationV2Fixture(), details = await readFoundationPoolDetails({ client: f.client, binding: f.binding, token: f.token });
    expect(details.positions.base.custody).toBe("dead-v1");
    expect(details.positions.base).not.toHaveProperty("vault");
    expect(details.positions.creator?.owner).toBe(FOUNDATION_DEAD_ADDRESS);
    expect(details.token.totalSupply).toBe(FOUNDATION_SUPPLY);
    expect(details.ledger.platform.withdrawable).toBe(20n);
    expect(details.ledger.creator.withdrawable).toBe(80n);
    const positions = foundationPositionPresentation(details);
    expect(positions.every(position => position.custody === "dead-v1" && !position.ownershipDescription.includes("vault"))).toBe(true);
  });
  it("binds the V2 event, stored actual refund and direct zero-to-DEAD NFT mints", async () => {
    const f = foundationV2Fixture(); f.state.extraRefund = 5n;
    const result = await verifyFoundationLaunchReceipt({ client: f.client, binding: f.binding, transactionHash: f.transactionHash, expected: f.expected });
    expect(result.event.factoryVersion).toBe("v2");
    if (result.event.factoryVersion !== "v2") throw new Error("Expected V2");
    expect(result.event.actualQuoteRefund).toBe(f.result.actualQuoteRefund + 5n);
    expect(result.event.custodyId).toBe(FOUNDATION_LP_CUSTODY_DEAD_ID);
  });
  it("uses actual receipt NFT IDs when another mint occurred after simulation", async () => {
    const f = foundationV2Fixture();
    f.expected.result.basePositionId = 50n; f.expected.result.creatorPositionId = 51n;
    const receipt = await verifyFoundationLaunchReceipt({ client: f.client, binding: f.binding, transactionHash: f.transactionHash, expected: f.expected });
    expect(receipt.event).toMatchObject({ factoryVersion: "v2", basePositionId: 77n, creatorPositionId: 78n });
  });
  it.each([77n, 78n])("rejects an intermediate owner for NFT %s even if its final owner is DEAD", async id => {
    const f = foundationV2Fixture(), receipt = await f.methods.getTransactionReceipt();
    f.methods.getTransactionReceipt.mockResolvedValue({ ...receipt, logs: [f.launchLog(), f.mintLog(77n), f.mintLog(78n), f.mintLog(id, f.account)] });
    await expect(verifyFoundationLaunchReceipt({ client: f.client, binding: f.binding, transactionHash: f.transactionHash, expected: f.expected })).rejects.toThrow("directly");
  });
  it("rejects a forged stored refund while preserving the actual receipt", async () => {
    const f = foundationV2Fixture(), receipt = await f.methods.getTransactionReceipt();
    f.methods.getTransactionReceipt.mockResolvedValue(receipt); f.state.extraRefund = 7n;
    await expect(verifyFoundationLaunchReceipt({ client: f.client, binding: f.binding, transactionHash: f.transactionHash, expected: f.expected })).rejects.toThrow("disagrees");
  });
  it("discovers a V2 direct launch with its own event decoder and binding", async () => {
    const f = foundationV2Fixture();
    const discovered = await discoverFoundationLaunch({ client: f.client, binding: f.binding, token: f.token, transactionHash: f.transactionHash });
    expect(discovered.receipt.event.factoryVersion).toBe("v2");
    const page = await readFoundationLaunchIndex({ client: f.client, binding: f.binding, fromBlock: 1n, toBlock: 100n });
    expect(page.entries[0].factoryVersion).toBe("v2");
    expect(page.entries[0]).not.toHaveProperty("baseVault");
  });
  it("rejects a wrong live creator NFT owner during a later read", async () => {
    const f = foundationV2Fixture(); f.state.owner.set(78n, getAddress(v2Address(88)) as Address);
    await expect(readFoundationPoolDetails({ client: f.client, binding: f.binding, token: f.token })).rejects.toThrow("creator launch NFT");
  });
});
