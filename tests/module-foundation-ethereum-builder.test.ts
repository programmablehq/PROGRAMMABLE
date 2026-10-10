import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, getAddress, keccak256, stringToHex, type Hex } from "viem";
import fixture from "./fixtures/module-foundation-ethereum-graph.json";
import bytecode from "@/contracts/spec/module-foundation/ethereum-graph-bytecode.v1.json";
import stampedBytecode from "@/contracts/spec/module-foundation/ethereum-graph-bytecode.v2.json";
import { foundationEthereumGraphAbi, foundationEthereumRouteParameters, foundationEthereumStampAbi, type FoundationEthereumGraphSource } from "@/lib/module-foundation/ethereum-graph";
import { assertFoundationEthereumRuntime, buildFoundationEthereumGraph, predictFoundationEthereumAccounts } from "@/lib/module-foundation/ethereum-graph-builder";

const hash = (s: string) => keccak256(stringToHex(s));
function sample() {
  const [permit, , payload] = decodeFunctionData({ abi: foundationEthereumStampAbi, data: fixture.calldata as Hex }).args;
  const [route] = decodeAbiParameters(foundationEthereumRouteParameters, payload);
  const call = decodeFunctionData({ abi: foundationEthereumGraphAbi, data: route.targets[0].initializerCalldata });
  if (call.functionName !== "initializeGraph") throw new Error("Wrong fixture");
  const source: FoundationEthereumGraphSource = { chainId: 1, sourceCommit: bytecode.sourceCommit,
    releaseDigest: hash("source-release"), startBlock: 1n,
    implementation: { address: getAddress(fixture.implementation), runtimeCodeHash: fixture.implementationHash as Hex },
    proxyRuntimeCodeHash: fixture.proxyHash as Hex };
  return { source, account: permit.launchWallet, parameters: structuredClone(call.args[0]), fundingPath: [], value: permit.value };
}

describe("Ethereum graph materialization", () => {
  it("binds the V2 proxy constructor to the same nonce used by the canonical factory salt", () => {
    const input = sample();
    const source = { ...input.source, sourceCommit: stampedBytecode.sourceCommit };
    const graph = predictFoundationEthereumAccounts({ source, account: input.account,
      metadata: input.parameters.metadata, tokenSalt: input.parameters.tokenSalt });
    const artifact = stampedBytecode.contracts.FoundationEthereumGraphProxyV2;
    expect(graph.engineTarget.initCode.startsWith(artifact.creationBytecode)).toBe(true);
    const values = decodeAbiParameters([
      { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" },
    ], `0x${graph.engineTarget.initCode.slice(artifact.creationBytecode.length)}` as Hex);
    expect(values).toEqual([source.implementation.address, source.implementation.runtimeCodeHash,
      input.account, graph.identity.routeNonce]);
    expect(() => predictFoundationEthereumAccounts({ source: { ...source, sourceCommit: "f".repeat(40) },
      account: input.account, metadata: input.parameters.metadata, tokenSalt: input.parameters.tokenSalt })).toThrow("compiler artifact");
  });

  it("separates wallet, release and token-salt namespaces without RPC", () => {
    const input = sample(), p = { ...input, metadata: input.parameters.metadata, tokenSalt: input.parameters.tokenSalt };
    const a = predictFoundationEthereumAccounts(p);
    expect(predictFoundationEthereumAccounts(p)).toEqual(a);
    for (const change of [{ account: getAddress("0x0000000000000000000000000000000000000001") },
      { tokenSalt: hash("different salt") }, { source: { ...p.source, releaseDigest: hash("new source") } }]) {
      const b = predictFoundationEthereumAccounts({ ...p, ...change });
      expect(b.identity.routeNonce).not.toBe(a.identity.routeNonce);
      expect(b.engine).not.toBe(a.engine);
      expect(b.token).not.toBe(a.token);
    }
  });

  it("mines a valid hook and binds the exact token, module configuration and funding into its initializer", async () => {
    const input = sample(), graph = await buildFoundationEthereumGraph(input);
    expect(BigInt(graph.hook) & 0x3fffn).toBe(0x20ccn);
    expect(graph.totalValue).toBe(input.value);
    expect(graph.targets.map(t => t.initializerValue)).toEqual([input.value, 0n, 0n]);
    expect(graph.targets.slice(1).map(t => t.initializerCalldata)).toEqual(["0x", "0x"]);
    const call = decodeFunctionData({ abi: foundationEthereumGraphAbi, data: graph.targets[0].initializerCalldata });
    expect(call.functionName).toBe("initializeGraph");
    if (call.functionName !== "initializeGraph") throw new Error();
    expect(call.args[0]).toEqual(graph.parameters);
    expect(call.args[1]).toBe(graph.token);
    expect(call.args[2]).toBe(graph.hook);
    expect(graph.parameters.modules).toEqual(input.parameters.modules);
    expect(graph.parameters.metadata).toEqual(input.parameters.metadata);
  }, 30_000);

  it("reuses its own exact hook proof when only funding protection changes", async () => {
    const input = sample(), first = await buildFoundationEthereumGraph(input);
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      const changed = { ...input.parameters, initialBuyMinimumTokenAmount: input.parameters.initialBuyMinimumTokenAmount + 1n };
      const next = await buildFoundationEthereumGraph({ ...input, parameters: changed });
      expect(next.hook).toBe(first.hook);
      expect(next.parameters.initialBuyMinimumTokenAmount).toBe(changed.initialBuyMinimumTokenAmount);
      expect(next.targets[0].initializerCalldata).not.toBe(first.targets[0].initializerCalldata);
      expect(timer).not.toHaveBeenCalled();
      const controller = new AbortController(); controller.abort(new Error("Draft changed"));
      await expect(buildFoundationEthereumGraph({ ...input, signal: controller.signal })).rejects.toThrow("Draft changed");
    } finally { timer.mockRestore(); }
  }, 30_000);

  it("cancels a stale preparation and rejects insufficient or unsolicited funding", async () => {
    const input = sample(), controller = new AbortController();
    controller.abort(new Error("Wallet changed"));
    await expect(buildFoundationEthereumGraph({ ...input, signal: controller.signal })).rejects.toThrow("Wallet changed");
    await expect(buildFoundationEthereumGraph({ ...input, value: input.value - 1n })).rejects.toThrow("budget");
    await expect(buildFoundationEthereumGraph({ ...input, parameters: { ...input.parameters,
      initialBuyQuoteAmount: 0n, additionalQuoteAmount: 0n } })).rejects.toThrow("unfunded");
  });

  it("checks metadata bytes before mining, including non-ASCII characters", () => {
    const input = sample(), p = { ...input, metadata: input.parameters.metadata, tokenSalt: input.parameters.tokenSalt };
    expect(() => predictFoundationEthereumAccounts({ ...p, metadata: { ...p.metadata, imageURI: "" } })).toThrow("metadata");
    expect(() => predictFoundationEthereumAccounts({ ...p, metadata: { ...p.metadata, name: "界".repeat(17) } })).toThrow("metadata");
    expect(() => predictFoundationEthereumAccounts({ ...p, metadata: { ...p.metadata, symbol: "界".repeat(4) } })).not.toThrow();
  });

  it("permits immutable substitutions but rejects altered runtime instructions", () => {
    const a = bytecode.contracts.FoundationEthereumGraphProxyV1, runtime = a.runtimeTemplate as Hex;
    expect(() => assertFoundationEthereumRuntime("FoundationEthereumGraphProxyV1", runtime)).not.toThrow();
    const ref = a.immutableReferences[0], start = 2 + ref.start * 2;
    const withImmutable = `${runtime.slice(0, start)}${"01".repeat(ref.length)}${runtime.slice(start + ref.length * 2)}` as Hex;
    expect(() => assertFoundationEthereumRuntime("FoundationEthereumGraphProxyV1", withImmutable)).not.toThrow();
    expect(() => assertFoundationEthereumRuntime("FoundationEthereumGraphProxyV1", `0xfe${runtime.slice(4)}`)).toThrow("instructions");
    expect(() => assertFoundationEthereumRuntime("FoundationEthereumGraphProxyV1", "0x00")).toThrow("length");
  });
});
