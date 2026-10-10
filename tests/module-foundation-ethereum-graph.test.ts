import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, getAddress, keccak256, stringToHex, type Hex } from "viem";
import fixture from "./fixtures/module-foundation-ethereum-graph.json";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import {
  assertFoundationEthereumStampEnvelope, decodeFoundationEthereumGraphLaunch, foundationEthereumRouteParameters, foundationEthereumStampAbi,
  type FoundationEthereumGraphSource,
} from "@/lib/module-foundation/ethereum-graph";
import { foundationPoolId } from "@/lib/module-foundation/route";
import type { LaunchStampProvenanceV1 } from "@/lib/tokens";
import { selectFoundationMinedCall } from "@/lib/module-foundation/mined-call";

const hash = (value: string) => keccak256(stringToHex(value));

/** Real fork call bytes; the local signature stub is not production authorization. */
function candidate() {
  const data = fixture.calldata as Hex;
  const call = decodeFunctionData({ abi: foundationEthereumStampAbi, data });
  const [permit, stamp, payload] = call.args;
  const [graph] = decodeAbiParameters(foundationEthereumRouteParameters, payload);
  const transactionHash = hash("fork-test-transaction"), stampHash = hash("fork-test-stamp");
  const provenance: LaunchStampProvenanceV1 = {
    schemaVersion: "programmable.launch-stamp-provenance.v1", chainId: 1, kind: "custom-graph",
    routerAddress: permit.router, routerRuntimeCodeHash: ethereum.canonicalStamp.router.runtimeCodeHash as Hex,
    routerStartBlock: "25717612", finalityConfirmations: 64,
    launchId: stamp.launchId, stampHash, launchWallet: permit.launchWallet, transactionHash,
    blockNumber: fixture.forkBlock, blockHash: hash("fork-block"), transactionIndex: 0,
    routeLogIndex: 9, launchLogIndex: 10, finalizedAtBlockNumber: String(Number(fixture.forkBlock) + 64),
    finalizedAtBlockHash: hash("finalized-block"), poolManagerAddress: getAddress(ethereum.contracts.poolManager.address),
    poolId: foundationPoolId(stamp.poolKey), poolKey: stamp.poolKey, poolKeyHash: hash("pool-key"),
    componentSetHash: hash("component-set"), routePayloadHash: permit.routePayloadHash,
    routeLauncherAddress: getAddress(ethereum.canonicalStamp.graphFactory.address),
    routeLauncherRuntimeCodeHash: ethereum.canonicalStamp.graphFactory.runtimeCodeHash as Hex,
    expectedResultHash: permit.expectedResultHash, permitDigest: hash("fork-permit"),
    components: stamp.components.map((component, index) => ({
      address: component.account, kind: component.kind === 1 ? "token" : component.kind === 2 ? "hook" : "other",
      scope: "exclusive", runtimeCodeHash: component.runtimeCodeHash, logIndex: index,
      exclusiveProof: { launchId: stamp.launchId, stampHash },
    })),
    tokenProof: { tokenAddress: stamp.token, launchId: stamp.launchId, stampHash },
    poolProof: { poolManagerAddress: getAddress(ethereum.contracts.poolManager.address),
      poolId: foundationPoolId(stamp.poolKey), launchId: stamp.launchId, stampHash },
  };
  const source: FoundationEthereumGraphSource = { chainId: 1, sourceCommit: "a".repeat(40),
    releaseDigest: hash("admitted-source-test-fixture"), startBlock: BigInt(fixture.forkBlock),
    implementation: { address: getAddress(fixture.implementation), runtimeCodeHash: fixture.implementationHash as Hex },
    proxyRuntimeCodeHash: fixture.proxyHash as Hex };
  return { source, provenance, graph, call, transaction: {
    hash: transactionHash, from: permit.launchWallet, to: permit.router, data, value: permit.value,
  } };
}

describe("Ethereum Module Mode canonical graph readback", () => {
  it("allows the stamped wallet envelope and rejects direct-factory or substituted-wallet requests", () => {
    const { transaction } = candidate();
    expect(() => assertFoundationEthereumStampEnvelope(transaction, transaction.from)).not.toThrow();
    expect(() => assertFoundationEthereumStampEnvelope({ ...transaction,
      to: getAddress(ethereum.canonicalStamp.graphFactory.address) }, transaction.from)).toThrow("stamp router");
    expect(() => assertFoundationEthereumStampEnvelope(transaction,
      getAddress("0x0000000000000000000000000000000000000001"))).toThrow("stamp router");
    const call = decodeFunctionData({ abi: foundationEthereumStampAbi, data: transaction.data });
    const data = encodeFunctionData({ abi: foundationEthereumStampAbi, functionName: call.functionName,
      args: [{ ...call.args[0], launchWallet: getAddress("0x0000000000000000000000000000000000000001") }, call.args[1], call.args[2], call.args[3]] });
    expect(() => assertFoundationEthereumStampEnvelope({ ...transaction, data }, transaction.from)).toThrow("another wallet");
  });
  it("decodes the same source-bound launch inside a smart-wallet transaction", () => {
    const input = candidate(), original = input.transaction;
    const outer = { hash: original.hash, from: getAddress("0x0000000000000000000000000000000000000001"),
      to: getAddress("0x0000000000000000000000000000000000000002"), input: "0xabcd" as Hex, value: 0n,
      blockNumber: BigInt(input.provenance.blockNumber), blockHash: input.provenance.blockHash, transactionIndex: 0 };
    const traced = selectFoundationMinedCall({ type: "CALL", from: outer.from, to: outer.to, input: outer.input, value: "0x0",
      calls: [{ type: "CALL", from: original.from, to: original.to, input: original.data, value: `0x${original.value.toString(16)}` }] },
    outer, { account: original.from, target: original.to, accepts: () => true });
    expect(decodeFoundationEthereumGraphLaunch({ ...input, transaction: { hash: original.hash, ...traced } }).token)
      .toBe(getAddress(input.provenance.tokenProof.tokenAddress));
  });
  it("restores the exact modules and metadata from call bytes exercised on the Ethereum fork", () => {
    const input = candidate(), decoded = decodeFoundationEthereumGraphLaunch(input);
    expect(decoded.engine).toBe(getAddress(input.graph.expectedOutputs[0].account));
    expect(decoded.token).toBe(getAddress(input.provenance.tokenProof.tokenAddress));
    expect(decoded.hook).toBe(getAddress(input.provenance.poolKey.hooks));
    expect(decoded.parameters.metadata.name).toBe("Ethereum Module Fixture");
    expect(decoded.parameters.modules).toHaveLength(2);
    expect(decoded.parameters.creatorBuyFeeBps).toBe(100);
    expect(decoded.parameters.creatorSellFeeBps).toBe(300);
    expect(decoded.parameters.initialBuyQuoteAmount).toBe(5_000_000_000_000_000n);
  });

  it("requires the exact admitted proxy runtime and Ethereum source", () => {
    const input = candidate();
    expect(() => decodeFoundationEthereumGraphLaunch({ ...input,
      source: { ...input.source, proxyRuntimeCodeHash: hash("different-runtime") } })).toThrow();
    expect(() => decodeFoundationEthereumGraphLaunch({ ...input,
      source: { ...input.source, chainId: 4663 } as unknown as FoundationEthereumGraphSource })).toThrow();
    expect(() => decodeFoundationEthereumGraphLaunch({ ...input,
      source: { ...input.source, startBlock: BigInt(input.provenance.blockNumber) + 1n } })).toThrow();
  });

  it("does not classify a Classic route or an arbitrary Custom Hook as Module Mode", () => {
    const input = candidate();
    expect(() => decodeFoundationEthereumGraphLaunch({ ...input,
      provenance: { ...input.provenance, kind: "classic" } })).toThrow();
    expect(() => decodeFoundationEthereumGraphLaunch({ ...input,
      provenance: { ...input.provenance, components: input.provenance.components.filter(c => c.kind !== "other") } })).toThrow();
    expect(() => decodeFoundationEthereumGraphLaunch({ ...input,
      provenance: { ...input.provenance, routeLauncherRuntimeCodeHash: hash("another-factory") } })).toThrow();
  });

  it("rejects another payer, destination, transaction hash or ETH amount", () => {
    const input = candidate();
    for (const change of [{ from: getAddress("0x0000000000000000000000000000000000000001") },
      { to: null }, { hash: hash("different-transaction") }, { value: 0n }]) {
      expect(() => decodeFoundationEthereumGraphLaunch({ ...input, transaction: { ...input.transaction, ...change } })).toThrow();
    }
  });

  it("rejects altered payload bytes even if the transaction has the correct selector", () => {
    const input = candidate(), [permit, stamp, payload, signature] = input.call.args;
    const corrupted = `${payload.slice(0, -2)}${payload.endsWith("00") ? "01" : "00"}` as Hex;
    const data = encodeFunctionData({ abi: foundationEthereumStampAbi, functionName: "launchAndStampV1",
      args: [permit, stamp, corrupted, signature] });
    expect(() => decodeFoundationEthereumGraphLaunch({ ...input, transaction: { ...input.transaction, data } })).toThrow();
    expect(() => decodeFoundationEthereumGraphLaunch({ ...input, transaction: {
      ...input.transaction, data: `${input.transaction.data}00` as Hex } })).toThrow();
  });

  it("keeps historical readback independent of a permit's current expiry", () => {
    const input = candidate();
    // The frozen fork's permit is historical. This reader does not authorize sending it again.
    expect(input.call.args[0].deadline).toBeLessThan(2_000_000_000n);
    expect(decodeFoundationEthereumGraphLaunch(input).launchId).toBe(input.provenance.launchId);
  });
});
