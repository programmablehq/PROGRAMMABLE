import {
  decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress,
  keccak256, parseAbi, parseAbiParameters, type Address, type Hex,
} from "viem";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import type { LaunchStampProvenanceV1 } from "@/lib/tokens";
import { encodeFoundationParameters, foundationFactoryV3Abi, type FoundationLaunchParametersV3 } from "./abi";
import { assertFoundationFundingPath } from "./funding-path";
import { foundationPoolId, foundationPoolKey } from "./pool-key";

const launch = foundationFactoryV3Abi.find(item => item.type === "function" && item.name === "launch")!;
export const foundationEthereumGraphAbi = [{ ...launch, name: "initializeGraph", stateMutability: "payable",
  inputs: [...launch.inputs, { name: "token", type: "address" }, { name: "hook", type: "address" }, { name: "fundingPath", type: "bytes" }],
} as const, ...parseAbi([
  "function implementation() view returns (address)",
  "function implementationCodeHash() view returns (bytes32)",
  "function GRAPH_FACTORY() view returns (address)",
  "function LAUNCH_WALLET() view returns (address)",
  "function parametersHash() view returns (bytes32)",
  "function initialized() view returns (bool)",
])] as const;

export const foundationEthereumStampAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct Component { uint8 resultIndex; address account; bytes32 runtimeCodeHash; uint8 kind; uint8 scope; }",
  "struct Stamp { bytes32 launchId; address token; bytes32 tokenRuntimeCodeHash; PoolKey poolKey; bytes32 hookRuntimeCodeHash; Component[] components; }",
  "struct Permit { uint256 chainId; address router; address launchWallet; uint8 kind; bytes32 routePayloadHash; bytes32 expectedResultHash; bytes32 stampRequestHash; bytes32 nonce; uint64 validAfter; uint64 deadline; uint256 value; }",
  "function launchAndStampV1(Permit permit,Stamp stampRequest,bytes routePayload,bytes signature) payable returns (bytes32)",
]);
export const foundationEthereumRouteParameters = parseAbiParameters(
  "(bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,bytes32 graphCommitment,(bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes initCode,bytes initializerCalldata)[] targets,(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)[] expectedOutputs,bytes32 expectedGraphDeploymentHash)",
);
const fundingParameters = parseAbiParameters("(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[]");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nonzeroHash = (value: string) => /^0x[0-9a-f]{64}$/i.test(value) && BigInt(value) !== 0n;

/** Supplied by source admission, never by a token's metadata or a browser request. */
export interface FoundationEthereumGraphSource {
  chainId: 1;
  releaseDigest: Hex;
  sourceCommit: string;
  startBlock: bigint;
  implementation: { address: Address; runtimeCodeHash: Hex };
  proxyRuntimeCodeHash: Hex;
}

/**
 * Decode a candidate from an already verified canonical stamp. This function does
 * not grant wallet authority or establish source admission. The server reader also
 * verifies the proxy, implementation, storage and launch result on chain.
 * Historical permits may have expired; their signatures are not reusable authority.
 */
export function decodeFoundationEthereumGraphLaunch(input: {
  source: FoundationEthereumGraphSource; provenance: LaunchStampProvenanceV1;
  transaction: { hash: Hex; from: Address; to: Address | null; data: Hex; value: bigint };
}) {
  const { source, provenance: proof, transaction: tx } = input;
  const canonical = ethereum.canonicalStamp;
  if (source.chainId !== 1 || !nonzeroHash(source.releaseDigest) || !/^[a-f0-9]{40}$/.test(source.sourceCommit)
    || source.startBlock <= 0n || BigInt(source.implementation.address) === 0n
    || !nonzeroHash(source.implementation.runtimeCodeHash) || !nonzeroHash(source.proxyRuntimeCodeHash)
    || proof.chainId !== 1 || proof.kind !== "custom-graph"
    || !same(proof.routerAddress, canonical.router.address) || !same(proof.routerRuntimeCodeHash, canonical.router.runtimeCodeHash)
    || !same(proof.routeLauncherAddress, canonical.graphFactory.address)
    || !same(proof.routeLauncherRuntimeCodeHash, canonical.graphFactory.runtimeCodeHash)
    || BigInt(proof.blockNumber) < source.startBlock || !same(proof.transactionHash, tx.hash)
    || !tx.to || !same(tx.to, canonical.router.address) || !same(tx.from, proof.launchWallet)
    || tx.data.length > 524_288 * 2 + 2 || proof.components.length !== 3) throw new Error("The launch does not match this Ethereum module source.");

  const others = proof.components.filter(component => component.kind === "other");
  const tokens = proof.components.filter(component => component.kind === "token");
  const hooks = proof.components.filter(component => component.kind === "hook");
  if (others.length !== 1 || tokens.length !== 1 || hooks.length !== 1
    || proof.components.some(component => component.scope !== "exclusive")
    || !same(others[0].runtimeCodeHash, source.proxyRuntimeCodeHash)
    || !same(tokens[0].address, proof.tokenProof.tokenAddress) || !same(hooks[0].address, proof.poolKey.hooks)) {
    throw new Error("The stamped components do not identify one module launch account, token and hook.");
  }
  const engine = getAddress(others[0].address), token = getAddress(tokens[0].address), hook = getAddress(hooks[0].address);
  const decoded = decodeFunctionData({ abi: foundationEthereumStampAbi, data: tx.data });
  if (!same(encodeFunctionData({ abi: foundationEthereumStampAbi, functionName: decoded.functionName, args: decoded.args }), tx.data)) {
    throw new Error("The stamp transaction has a noncanonical encoding.");
  }
  const [permit, stamp, payload] = decoded.args;
  if (permit.chainId !== 1n || permit.kind !== 1 || !same(permit.router, canonical.router.address)
    || !same(permit.launchWallet, tx.from) || permit.value !== tx.value
    || !same(permit.expectedResultHash, proof.expectedResultHash)
    || !same(permit.routePayloadHash, proof.routePayloadHash) || !same(keccak256(payload), proof.routePayloadHash)
    || !same(stamp.launchId, proof.launchId) || !same(stamp.token, token)
    || !same(stamp.tokenRuntimeCodeHash, tokens[0].runtimeCodeHash) || !same(stamp.hookRuntimeCodeHash, hooks[0].runtimeCodeHash)
    || !same(foundationPoolId(stamp.poolKey), proof.poolId)) throw new Error("The transaction differs from the canonical launch stamp.");
  const [route] = decodeAbiParameters(foundationEthereumRouteParameters, payload);
  if (!same(encodeAbiParameters(foundationEthereumRouteParameters, [route]), payload)
    || route.targets.length !== 3 || route.expectedOutputs.length !== 3 || !same(route.routeNonce, permit.nonce)) {
    throw new Error("The Ethereum module graph is not canonical.");
  }
  const expectedAddresses = [engine, token, hook];
  for (let index = 0; index < 3; index++) {
    const target = route.targets[index], output = route.expectedOutputs[index];
    const component = proof.components.find(item => same(item.address, expectedAddresses[index]))!;
    if (output.targetIndex !== index || !same(output.targetIdHash, target.targetIdHash)
      || !same(output.account, expectedAddresses[index]) || !same(output.runtimeCodeHash, component.runtimeCodeHash)
      || target.deploymentValue !== 0n || target.initializerValue !== (index === 0 ? tx.value : 0n)
      || (index > 0 && target.initializerCalldata !== "0x")) throw new Error("The module graph has an unexpected target or funding recipient.");
  }
  const initialized = decodeFunctionData({ abi: foundationEthereumGraphAbi, data: route.targets[0].initializerCalldata });
  if (initialized.functionName !== "initializeGraph"
    || !same(encodeFunctionData({ abi: foundationEthereumGraphAbi, functionName: initialized.functionName, args: initialized.args }), route.targets[0].initializerCalldata)) {
    throw new Error("The graph does not initialize the reviewed module launch account.");
  }
  const [parameters, initializedToken, initializedHook, fundingPath] = initialized.args;
  if (!same(initializedToken, token) || !same(initializedHook, hook)
    || !same(foundationPoolId(foundationPoolKey({ token, quote: parameters.quote, hook })), proof.poolId)
    || parameters.modules.length > 8) throw new Error("The module settings belong to another token or pool.");
  const [path] = decodeAbiParameters(fundingParameters, fundingPath);
  if (!same(encodeAbiParameters(fundingParameters, [path]), fundingPath)) throw new Error("The ETH funding path is not canonical.");
  const funding = parameters.initialBuyQuoteAmount + parameters.additionalQuoteAmount;
  if (funding > 0n) {
    assertFoundationFundingPath(parameters.quote, path, 1);
    if (tx.value === 0n || (same(parameters.quote, ethereum.contracts.wrappedEth.address) && tx.value < funding)) {
      throw new Error("The ETH value does not cover the launch funding.");
    }
  }
  return { engine, token, hook, parameters: parameters as FoundationLaunchParametersV3, fundingPath,
    parametersHash: keccak256(encodeFoundationParameters(parameters)), launchId: proof.launchId };
}

/** Decode settings only. Callers must also verify the fixed graph and successful canonical execution. */
export function decodeFoundationEthereumTransaction(transaction: { data: Hex; value: bigint }) {
  const decoded = decodeFunctionData({ abi: foundationEthereumStampAbi, data: transaction.data });
  const [permit, stamp, payload, signature] = decoded.args;
  if (encodeFunctionData({ abi: foundationEthereumStampAbi, functionName: decoded.functionName, args: decoded.args }).toLowerCase() !== transaction.data.toLowerCase()
    || permit.chainId !== 1n || permit.kind !== 1 || !same(permit.router, ethereum.canonicalStamp.router.address)
    || permit.value !== transaction.value || !same(keccak256(payload), permit.routePayloadHash)) throw new Error("Invalid Ethereum module transaction.");
  const [route] = decodeAbiParameters(foundationEthereumRouteParameters, payload);
  if (route.targets.length !== 3 || route.expectedOutputs.length !== 3 || encodeAbiParameters(foundationEthereumRouteParameters, [route]).toLowerCase() !== payload.toLowerCase()) throw new Error("Invalid Ethereum module graph.");
  const initializer = decodeFunctionData({ abi: foundationEthereumGraphAbi, data: route.targets[0].initializerCalldata });
  if (initializer.functionName !== "initializeGraph") throw new Error("Invalid Ethereum module initializer.");
  const [parameters, token, hook, fundingPath] = initializer.args;
  const [path] = decodeAbiParameters(fundingParameters, fundingPath);
  return { permit, stamp, route, signature, parameters, token, hook, engine: getAddress(route.expectedOutputs[0].account), path };
}

/** The wallet must never send a simulation's direct factory call as the launch. */
export function assertFoundationEthereumStampEnvelope(transaction: {
  from: Address; to: Address; data: Hex; value: bigint;
}, account: Address): void {
  if (!same(transaction.to, ethereum.canonicalStamp.router.address) || !same(transaction.from, account)) {
    throw new Error("Ethereum launches must use the Programmable stamp router. Prepare the launch again.");
  }
  const { permit } = decodeFoundationEthereumTransaction(transaction);
  if (!same(permit.launchWallet, account)) throw new Error("The launch stamp belongs to another wallet.");
}
