import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, type Hex, type PublicClient } from "viem";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import type { FoundationEthereumGraphSource } from "./ethereum-graph";
import { assertFoundationEthereumRuntime, foundationEthereumProxyContract, type buildFoundationEthereumGraph } from "./ethereum-graph-builder";
import { prepareFoundationEthereumStamp } from "./ethereum-graph-plan";

export const foundationEthereumFactoryGraphAbi = parseAbi([
  "struct Authorization { bytes32 routeNamespace; bytes32 routeNonce; bytes32 topologyHash; bytes32 graphCommitment; address authorizedLauncher; uint256 totalValue; }",
  "struct Target { bytes32 targetIdHash; bytes32 applicantSalt; uint256 deploymentValue; uint256 initializerValue; bytes initCode; bytes initializerCalldata; }",
  "function deployGraph(Authorization authorization,Target[] targets) payable returns (address[] deployments,bytes32[] runtimeCodeHashes,bytes[] runtimeCodes,bytes32 graphDeploymentHash)",
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
type Graph = Awaited<ReturnType<typeof buildFoundationEthereumGraph>>;

/** Read-only execution against both providers. The balance override funds only the simulated Router. */
export async function simulateFoundationEthereumGraph(input: {
  clients: readonly [PublicClient, PublicClient]; source: FoundationEthereumGraphSource;
  graph: Graph; signal?: AbortSignal;
}) {
  const { clients, source, graph, signal } = input;
  signal?.throwIfAborted();
  const heads = await Promise.all(clients.map(async client => {
    const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock()]);
    if (chainId !== 1 || !block.hash || block.number === null) throw new Error("Ethereum simulation requires mainnet providers.");
    return block;
  }));
  const blockNumber = heads[0].number < heads[1].number ? heads[0].number : heads[1].number;
  const blocks = await Promise.all(clients.map(client => client.getBlock({ blockNumber })));
  const block = blocks[0];
  if (!block.hash || !same(block.hash, blocks[1].hash!) || block.timestamp !== blocks[1].timestamp
    || blockNumber < source.startBlock || graph.parameters.deadline <= block.timestamp
    || graph.parameters.deadline > block.timestamp + 3_600n) {
    throw new Error("The providers or launch deadline do not match the same Ethereum block.");
  }
  const router = getAddress(ethereum.canonicalStamp.router.address);
  const factory = getAddress(ethereum.canonicalStamp.graphFactory.address);
  const authorization = { ...graph.identity, graphCommitment: graph.graphCommitment,
    authorizedLauncher: router, totalValue: graph.totalValue };
  const data = encodeFunctionData({ abi: foundationEthereumFactoryGraphAbi, functionName: "deployGraph",
    args: [authorization, graph.targets] });
  const pins = [ethereum.canonicalStamp.router, ethereum.canonicalStamp.graphFactory,
    ...["poolManager", "positionManager", "universalRouter", "permit2", "wrappedEth"].map(key =>
      ethereum.contracts[key as keyof typeof ethereum.contracts]), source.implementation,
    ...graph.parameters.modules.map(module => ({ address: module.factory, runtimeCodeHash: module.factoryCodeHash }))];
  const uniquePins = [...new Map(pins.map(pin => [pin.address.toLowerCase(), pin])).values()];
  if (pins.some(pin => uniquePins.some(other => same(pin.address, other.address) && !same(pin.runtimeCodeHash, other.runtimeCodeHash)))) {
    throw new Error("The Ethereum dependency bindings conflict.");
  }
  const results = await Promise.all(clients.map(async client => {
    await Promise.all(uniquePins.map(async pin => {
      const code = await client.getCode({ address: getAddress(pin.address), blockNumber });
      if (!code || !same(keccak256(code), pin.runtimeCodeHash)) throw new Error("An Ethereum module dependency has changed.");
    }));
    signal?.throwIfAborted();
    const result = await client.call({ account: router, to: factory, data, value: graph.totalValue,
      blockNumber, gas: 16_777_216n, stateOverride: [{ address: router, balance: graph.totalValue }] });
    if (!result.data) throw new Error("The Ethereum graph simulation returned no result.");
    return result.data;
  }));
  signal?.throwIfAborted();
  if (!same(results[0], results[1])) throw new Error("The providers returned different Ethereum launch results.");
  const [addresses, hashes, runtimes, graphDeploymentHash] = decodeFunctionResult({
    abi: foundationEthereumFactoryGraphAbi, functionName: "deployGraph", data: results[0],
  });
  if (addresses.length !== 3 || hashes.length !== 3 || runtimes.length !== 3) throw new Error("The Ethereum graph has unexpected outputs.");
  const expected = [graph.engine, graph.token, graph.hook];
  const names = [foundationEthereumProxyContract(source), "FoundationTokenV1", "FoundationHookV2"] as const;
  for (let i = 0; i < 3; i++) {
    if (!same(addresses[i], expected[i]) || !same(keccak256(runtimes[i]), hashes[i])) throw new Error("The simulated Ethereum output changed.");
    assertFoundationEthereumRuntime(names[i], runtimes[i]);
  }
  if (!same(hashes[0], source.proxyRuntimeCodeHash)) throw new Error("The proxy differs from the selected Ethereum release.");
  const plan = prepareFoundationEthereumStamp({ identity: graph.identity, targets: graph.targets,
    account: graph.account, launchId: graph.launchId, poolKey: graph.poolKey,
    validAfter: block.timestamp > 30n ? block.timestamp - 30n : 0n,
    deadline: graph.parameters.deadline < block.timestamp + 300n ? graph.parameters.deadline : block.timestamp + 300n,
    outputs: addresses.map((account, targetIndex) => ({ account, targetIndex,
      targetIdHash: graph.targets[targetIndex].targetIdHash, runtimeCodeHash: hashes[targetIndex] })),
  });
  if (!same(plan.route.expectedGraphDeploymentHash, graphDeploymentHash)) throw new Error("The Ethereum graph deployment commitment changed.");
  const checks = await Promise.all(clients.map(client => client.getBlock({ blockNumber })));
  if (checks.some(check => !check.hash || !same(check.hash, block.hash!))) throw new Error("The Ethereum simulation block was reorganized.");
  signal?.throwIfAborted();
  return { plan, block: { number: blockNumber, hash: block.hash as Hex, timestamp: block.timestamp },
    providerCount: 2 as const, authoritySignature: null };
}
