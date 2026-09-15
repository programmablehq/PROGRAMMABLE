import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { compileOpenConfig, type OpenConfigContext, type OpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import {
  foundationAssetAddressesForFieldsV1, hashFoundationAssetPinsV1, mergeFoundationAssetPinsV1, parseFoundationAssetPinsV1,
  refreshFoundationAssetsV1, resolveFoundationAssetFieldsV1, resolveFoundationAssetsV1,
} from "@/lib/module-foundation/assets";
import { decodeFoundationFieldsV1, presentFoundationFieldsV1 } from "@/lib/module-foundation/presentation";
import type { FoundationConfiguration } from "@/lib/module-foundation/ui-types";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const hash = (text: string) => keccak256(toHex(text));
const now = 1_800_000_000, first = address(701), second = address(702), third = address(703);
const checkpoint = { blockNumber: 1234n, blockHash: hash("block"), timestamp: BigInt(now) };
const base: OpenConfigContext = { roles: { creator: address(42) }, assets: {
  token: { chainId: 4663, address: address(100), decimals: 18 }, quote: { chainId: 4663, address: address(101), decimals: 6 },
} };

function rpc() {
  const state = { chainId: 4663, timestamp: checkpoint.timestamp, blockHash: checkpoint.blockHash, reorg: false,
    code: "0x60016000526001601ff3" as Hex, decimals: 6, name: "Technical asset", symbol: "ASSET", supply: 1_000_000n };
  let blocks = 0;
  const getChainId = vi.fn(async () => state.chainId);
  const getBlock = vi.fn(async () => ({ number: checkpoint.blockNumber, timestamp: state.timestamp,
    hash: state.reorg && ++blocks > 1 ? hash("reorg") : state.blockHash }));
  const getCode = vi.fn(async (input: { address: Address; blockNumber: bigint }) => {
    expect(input.blockNumber).toBe(checkpoint.blockNumber); return state.code;
  });
  const readContract = vi.fn(async (input: { address: Address; functionName: string; blockNumber: bigint }) => {
    expect(input.blockNumber).toBe(checkpoint.blockNumber);
    if (input.functionName === "name") return state.name;
    if (input.functionName === "symbol") return state.symbol;
    if (input.functionName === "decimals") return state.decimals;
    if (input.functionName === "totalSupply") return state.supply;
    throw new Error(`Unexpected ERC20 read ${input.functionName}`);
  });
  const client = { getChainId, getBlock, getCode, readContract } as unknown as PublicClient;
  return { client, state, getChainId, getBlock, getCode, readContract };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now * 1000); });
afterEach(() => vi.useRealTimers());

describe("Foundation generic ERC20 asset metadata", () => {
  it("supports no additional assets and retains the app's verified base context", async () => {
    const f = rpc(), result = await resolveFoundationAssetsV1({ client: f.client, addresses: [], context: base });
    expect(result.pins).toEqual([]); expect(result.assets).toEqual([]); expect(result.context).toEqual(base);
    expect(f.readContract).not.toHaveBeenCalled(); expect(f.getCode).not.toHaveBeenCalled();
    expect(result.checkpoint).toEqual(checkpoint); expect(Object.isFrozen(result.context)).toBe(true);
  });
  it("uses the actual ERC20 reader for arbitrary addresses at one checkpoint with no transaction authority", async () => {
    const f = rpc(), result = await resolveFoundationAssetsV1({ client: f.client, addresses: [second, first, second], context: base, checkpoint });
    expect(result.pins).toEqual([[second, 6, keccak256(f.state.code)], [first, 6, keccak256(f.state.code)]]);
    expect(result.assets.map(asset => asset.address)).toEqual([second, first]);
    expect(result.context.assets?.[`erc20:${first}`]).toEqual({ chainId: 4663, address: first, decimals: 6 });
    expect(result.assets[0]).toMatchObject({ chainId: 4663, symbol: "ASSET", name: "Technical asset" });
    expect(Object.keys(result).sort()).toEqual(["assets", "checkpoint", "context", "pins", "pinsDigest"]);
    expect(f.readContract).toHaveBeenCalledTimes(8); expect(f.getCode).toHaveBeenCalledTimes(2);
    expect(f.getBlock).toHaveBeenCalledWith({ blockNumber: checkpoint.blockNumber });
    expect(base.assets).not.toHaveProperty(`erc20:${first}`);
  });
  it("preserves reviewed source aliases without creating redundant pins or accepting conflicting metadata", async () => {
    const f = rpc(), sameQuote = { ...base, assets: { ...base.assets, quoteAlias: { ...base.assets!.quote } } };
    const result = await resolveFoundationAssetsV1({ client: f.client, addresses: [base.assets!.quote.address, first], context: sameQuote });
    expect(result.pins).toHaveLength(1); expect(result.context.assets?.quoteAlias).toEqual(base.assets!.quote);
    expect(decodeFoundationFieldsV1({ type: "asset" }, { $value: base.assets!.quote.address }, undefined, result.context)).toEqual({ asset: "quote" });
    await expect(resolveFoundationAssetsV1({ client: f.client, addresses: [first], context: {
      assets: { ...sameQuote.assets, badAlias: { ...base.assets!.quote, decimals: 18 } },
    } })).rejects.toMatchObject({ code: "FOUNDATION_ASSET_CONTEXT_CONFLICT" });
  });
  it("restores compact immutable pins and refreshes their actual runtime even when aliases already exist", async () => {
    const f = rpc(), initial = await resolveFoundationAssetsV1({ client: f.client, addresses: [first], context: base });
    const restored = parseFoundationAssetPinsV1(JSON.parse(JSON.stringify(initial.pins)));
    f.getCode.mockClear(); f.state.symbol = "CURRENT";
    const fresh = await refreshFoundationAssetsV1({ client: f.client, pins: restored, context: initial.context, checkpoint });
    expect(f.getCode).toHaveBeenCalledOnce(); expect(fresh.pins).toEqual(initial.pins);
    expect(fresh.pinsDigest).toBe(initial.pinsDigest); expect(fresh.assets[0].symbol).toBe("CURRENT");
    expect(Object.keys(fresh.context.assets!)).toEqual(Object.keys(initial.context.assets!));
    f.state.decimals = 18;
    await expect(refreshFoundationAssetsV1({ client: f.client, pins: restored, context: base })).rejects.toMatchObject({ code: "FOUNDATION_ASSET_PIN_MISMATCH" });
    f.state.decimals = 6; f.state.code = "0x60ff";
    await expect(refreshFoundationAssetsV1({ client: f.client, pins: restored, context: base })).rejects.toMatchObject({ code: "FOUNDATION_ASSET_PIN_MISMATCH" });
  });
  it("deduplicates exact pin tables and enforces the combined two-additional-asset adapter boundary", async () => {
    const f = rpc(), a = await resolveFoundationAssetsV1({ client: f.client, addresses: [first] });
    const b = await resolveFoundationAssetsV1({ client: f.client, addresses: [second] });
    const c = await resolveFoundationAssetsV1({ client: f.client, addresses: [third] });
    expect(mergeFoundationAssetPinsV1(a.pins, a.pins, b.pins)).toEqual([...a.pins, ...b.pins]);
    expect(() => mergeFoundationAssetPinsV1(a.pins, b.pins, c.pins)).toThrow(/versioned adapter/);
    expect(() => mergeFoundationAssetPinsV1(a.pins, [[first, 18, a.pins[0][2]]])).toThrow(/conflicting/);
    expect(hashFoundationAssetPinsV1([...a.pins, ...b.pins])).not.toBe(hashFoundationAssetPinsV1([...b.pins, ...a.pins]));
    f.readContract.mockClear();
    await expect(resolveFoundationAssetsV1({ client: f.client, addresses: [first, second, third], context: base })).rejects.toMatchObject({ code: "FOUNDATION_ASSET_ADAPTER_LIMIT" });
    expect(f.readContract).not.toHaveBeenCalled();
  });
  it.each([
    ["duplicate", [[first, 6, hash("code")], [first, 6, hash("code")]]],
    ["shape", [[first, 6, hash("code"), "extra"]]], ["decimals", [[first, 37, hash("code")]]],
    ["address", [["0x1234", 6, hash("code")]]], ["code", [[first, 6, "0x1234"]]],
  ])("rejects malformed immutable %s bindings", (_, value) => {
    expect(() => parseFoundationAssetPinsV1(value)).toThrow();
  });
  it.each(["chain", "old-block", "wrong-checkpoint", "reorg"])("rejects %s metadata observations", async kind => {
    const f = rpc();
    if (kind === "chain") f.state.chainId = 1;
    if (kind === "old-block") f.state.timestamp = BigInt(now - 121);
    if (kind === "wrong-checkpoint") f.state.blockHash = hash("wrong");
    if (kind === "reorg") f.state.reorg = true;
    await expect(resolveFoundationAssetsV1({ client: f.client, addresses: [first], checkpoint })).rejects.toThrow();
  });
  it.each(["no-code", "invalid-decimals", "zero-supply", "unsafe-symbol"])("retains the shared ERC20 reader's %s checks", async kind => {
    const f = rpc();
    if (kind === "no-code") f.state.code = "0x";
    if (kind === "invalid-decimals") f.state.decimals = 37;
    if (kind === "zero-supply") f.state.supply = 0n;
    if (kind === "unsafe-symbol") f.state.symbol = "ASSET\u200b";
    await expect(resolveFoundationAssetsV1({ client: f.client, addresses: [first] })).rejects.toThrow();
  });
});

describe("Foundation source asset fields", () => {
  it("defers only an unmaterialized source alias during address collection without inventing an address", () => {
    const schema: OpenConfigSchema = { type: "record", fields: { future: { type: "asset" }, existing: { type: "asset" } }, required: ["future", "existing"] };
    const input = { schema, defaults: { future: { asset: "token" } }, configuration: { "/existing": first }, deferredAssetKeys: ["token"] };
    expect(foundationAssetAddressesForFieldsV1(input)).toEqual([first]);
    expect(foundationAssetAddressesForFieldsV1({ ...input, configuration: { "/future": "token", "/existing": first } })).toEqual([first]);
    expect(foundationAssetAddressesForFieldsV1({ ...input, configuration: { "/future": "", "/existing": first } })).toEqual([first]);
    expect(presentFoundationFieldsV1(schema, input.defaults).find(field => field.key === "/future")).toMatchObject({ kind: "address", required: false });
    expect(foundationAssetAddressesForFieldsV1({ ...input, context: base })).toEqual([base.assets!.token.address, first]);
    expect(decodeFoundationFieldsV1(schema, { "/future": "", "/existing": base.assets!.quote.address }, input.defaults, base))
      .toEqual({ future: { asset: "token" }, existing: { asset: "quote" } });
  });
  it("keeps literal asset addresses checked and refuses deferred identities at final decode and resolution", async () => {
    const f = rpc(), schema: OpenConfigSchema = { type: "asset" };
    expect(foundationAssetAddressesForFieldsV1({ schema, configuration: { $value: first }, deferredAssetKeys: ["token"] })).toEqual([first]);
    expect(() => decodeFoundationFieldsV1(schema, { $value: "token" })).toThrow();
    const incomplete = { client: f.client, schema, configuration: { $value: "token" }, deferredAssetKeys: ["token"] };
    await expect(resolveFoundationAssetFieldsV1(incomplete)).rejects.toMatchObject({ code: "FOUNDATION_ASSET_CONTEXT_REQUIRED" });
    expect(f.readContract).not.toHaveBeenCalled();
  });
  it("presents any ERC20 address, resolves its metadata, then encodes the exact verified address", async () => {
    const f = rpc(), schema: OpenConfigSchema = { type: "record", fields: { asset: { type: "asset" } }, required: ["asset"] };
    expect(presentFoundationFieldsV1(schema)[0]).toMatchObject({ key: "/asset", kind: "address" });
    expect(() => decodeFoundationFieldsV1(schema, { "/asset": first })).toThrow(/metadata before preparation/);
    const resolved = await resolveFoundationAssetFieldsV1({ client: f.client, schema, configuration: { "/asset": first }, context: base });
    const compiled = compileOpenConfig(schema, resolved.value, resolved.context);
    expect(compiled.bindings).toEqual([{ path: "/asset", kind: "asset", reference: `erc20:${first}`, resolved: { chainId: "4663", address: first, decimals: 6 } }]);
    expect(decodeAbiParameters([{ type: "tuple", components: [{ name: "asset", type: "address" }] }], compiled.encoded)).toEqual([{ asset: first }]);
    expect(presentFoundationFieldsV1(schema, compiled.value, resolved.context)[0].defaultValue).toBe(first);
    expect(decodeFoundationFieldsV1(schema, { "/asset": first }, undefined, resolved.context)).toEqual(resolved.value);
  });
  it("finds assets through source-declared arrays, variants and fixed values while ignoring ordinary address fields", async () => {
    const f = rpc(), schema: OpenConfigSchema = { type: "record", fields: {
      recipient: { type: "address" }, assets: { type: "array", items: { type: "asset" }, maxItems: 2 },
      branch: { type: "variant", tag: "mode", variants: { typed: { type: "record", fields: { asset: { type: "asset" } }, required: ["asset"] } } },
      fixed: { type: "asset", binding: { mode: "fixed", value: { chainId: 4663, address: first, decimals: 6 } } },
    }, required: ["recipient", "assets", "branch", "fixed"] };
    const configuration = { "/recipient": third, "/assets": JSON.stringify([second, first]), "/branch": JSON.stringify({ mode: "typed", asset: second }) };
    expect(foundationAssetAddressesForFieldsV1({ schema, configuration, context: base })).toEqual([second, first]);
    const resolved = await resolveFoundationAssetFieldsV1({ client: f.client, schema, configuration, context: base });
    expect(resolved.pins.map(pin => pin[0])).toEqual([second, first]);
    expect(compileOpenConfig(schema, resolved.value, resolved.context).bindings.filter(binding => binding.kind === "asset")).toHaveLength(4);
    expect(f.getCode.mock.calls.map(([call]) => call.address)).not.toContain(third);
  });
  it("never accepts supplied decimals as authority, including literal JSON and hidden fixed subtrees", async () => {
    const f = rpc(), schema: OpenConfigSchema = { type: "array", maxItems: 1, items: { type: "asset" } };
    const literal = { chainId: 4663, address: first, decimals: 18 };
    await expect(resolveFoundationAssetFieldsV1({ client: f.client, schema, configuration: { $value: JSON.stringify([literal]) } })).rejects.toMatchObject({ code: "FOUNDATION_ASSET_METADATA_MISMATCH" });
    literal.decimals = 6;
    const actual = await resolveFoundationAssetFieldsV1({ client: f.client, schema, configuration: { $value: JSON.stringify([literal]) } });
    expect(actual.pins).toHaveLength(1);
    expect(() => decodeFoundationFieldsV1(schema, { $value: JSON.stringify([literal]) })).toThrow(/metadata before preparation/);
    const fixed: OpenConfigSchema = { type: "array", maxItems: 1, items: { type: "record", fields: {
      asset: { type: "asset", binding: { mode: "fixed", value: { ...literal, decimals: 18 } } },
    }, required: ["asset"] } };
    await expect(resolveFoundationAssetFieldsV1({ client: f.client, schema: fixed, configuration: { $value: "[{}]" } })).rejects.toMatchObject({ code: "FOUNDATION_ASSET_METADATA_MISMATCH" });
  });
  it("rejects unknown fields and oversized or executable structured data before metadata reads", async () => {
    const f = rpc(), schema: OpenConfigSchema = { type: "array", items: { type: "asset" }, maxItems: 1 };
    const cases: FoundationConfiguration[] = [{ $value: "(()=>evil())()" }, { hidden: first }, { $value: JSON.stringify([first, second]) }];
    for (const configuration of cases) {
      await expect(resolveFoundationAssetFieldsV1({ client: f.client, schema, configuration })).rejects.toThrow();
    }
    expect(f.readContract).not.toHaveBeenCalled();
  });
});
