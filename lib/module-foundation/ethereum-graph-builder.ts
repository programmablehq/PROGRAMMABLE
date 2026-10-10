import {
  concatHex, encodeAbiParameters, encodeFunctionData, getAddress, getContractAddress,
  keccak256, parseAbiParameters, stringToHex, toHex, type AbiParameter, type Address, type Hex,
} from "viem";
import bytecode from "@/contracts/spec/module-foundation/ethereum-graph-bytecode.v1.json";
import stampedBytecode from "@/contracts/spec/module-foundation/ethereum-graph-bytecode.v2.json";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import type { FoundationLaunchParametersV3 } from "./abi";
import { assertFoundationFundingPath, encodeFoundationFundingPath, type FoundationFundingHop } from "./funding-path";
import { foundationEthereumGraphAbi, type FoundationEthereumGraphSource } from "./ethereum-graph";
import {
  foundationEthereumGraphCommitment, foundationEthereumTargetSalt, predictFoundationEthereumTarget,
  type FoundationEthereumGraphIdentity, type FoundationEthereumGraphTarget,
} from "./ethereum-graph-plan";
import { foundationPoolKey } from "./pool-key";

const hash = (text: string) => keccak256(stringToHex(text));
const zero = toHex(0n, { size: 32 });
const factory = getAddress(ethereum.canonicalStamp.graphFactory.address);
const namespace = hash("programmable.module-foundation.ethereum-graph.v1");
const topology = hash("engine-token-hook.v1");
const nonceDomain = hash("programmable.module-foundation.ethereum-graph-nonce.v1");
const launchDomain = hash("programmable.module-foundation.ethereum-launch-id.v1");
const contracts = { ...bytecode.contracts, FoundationEthereumGraphProxyV2: stampedBytecode.contracts.FoundationEthereumGraphProxyV2 };
type ContractName = keyof typeof contracts;
// Only locally mined proofs are retained. Funding, deadlines and authorization are rebuilt every time.
const minedHooks = new Map<string, Readonly<{ address: Address; applicantSalt: Hex }>>();

export function foundationEthereumProxyContract(source: FoundationEthereumGraphSource) {
  if (source.sourceCommit === stampedBytecode.sourceCommit) return "FoundationEthereumGraphProxyV2" as const;
  if (source.sourceCommit === bytecode.sourceCommit) return "FoundationEthereumGraphProxyV1" as const;
  throw new Error("The Ethereum module source has no installed compiler artifact.");
}

function creation(name: ContractName, args: readonly unknown[]): Hex {
  const artifact = contracts[name];
  if (keccak256(artifact.creationBytecode as Hex) !== artifact.creationCodeHash) {
    throw new Error("The Ethereum module compiler artifact has changed.");
  }
  return concatHex([artifact.creationBytecode as Hex,
    encodeAbiParameters(artifact.constructorInputs as readonly AbiParameter[], args)]);
}

function target(name: string, initCode: Hex): FoundationEthereumGraphTarget {
  return { targetIdHash: hash(name), applicantSalt: zero, deploymentValue: 0n,
    initializerValue: 0n, initCode, initializerCalldata: "0x" };
}

/** Predict the launch account and token before quote routing or module configuration. */
export function predictFoundationEthereumAccounts(input: {
  source: FoundationEthereumGraphSource; account: Address; tokenSalt: Hex;
  metadata: FoundationLaunchParametersV3["metadata"];
}) {
  const { source, metadata, tokenSalt } = input, account = getAddress(input.account);
  if (source.chainId !== 1 || BigInt(account) === 0n
    || !/^0x[\da-f]{64}$/i.test(tokenSalt) || BigInt(tokenSalt) === 0n) {
    throw new Error("The Ethereum launch source, wallet or salt is invalid.");
  }
  const length = (text: string) => new TextEncoder().encode(text).length;
  if (!metadata.name || length(metadata.name) > 48 || !metadata.symbol || length(metadata.symbol) > 12
    || length(metadata.description) > 280 || !metadata.imageURI || length(metadata.imageURI) > 2048
    || length(metadata.website) > 2048 || !/^0x(?:[\da-f]{2}){0,1200}$/i.test(metadata.socialData)) {
    throw new Error("The coin details exceed the Ethereum token's metadata limits.");
  }
  const identity: FoundationEthereumGraphIdentity = {
    routeNamespace: namespace, topologyHash: topology,
    routeNonce: keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,bytes32,address,bytes32"),
      [nonceDomain, 1n, source.implementation.address, source.releaseDigest, account, tokenSalt])),
  };
  const proxyContract = foundationEthereumProxyContract(source);
  const engineTarget = target("engine", creation(proxyContract,
    [source.implementation.address, source.implementation.runtimeCodeHash, account,
      ...(proxyContract === "FoundationEthereumGraphProxyV2" ? [identity.routeNonce] : [])]));
  const engine = predictFoundationEthereumTarget(identity, engineTarget);
  const tokenTarget = target("token", creation("FoundationTokenV1", [metadata, engine]));
  const token = predictFoundationEthereumTarget(identity, tokenTarget);
  const launchId = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,address"),
    [launchDomain, identity.routeNonce, token]));
  return { identity, engine, token, engineTarget, tokenTarget, launchId };
}

/** No network calls. Each mining slice yields so a changed wallet/draft can cancel promptly. */
export async function mineFoundationEthereumHook(input: {
  identity: FoundationEthereumGraphIdentity; initCode: Hex; signal?: AbortSignal; maximumAttempts?: number;
}) {
  const maximum = input.maximumAttempts ?? 262_144;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_048_576) throw new Error("Invalid hook mining limit.");
  input.signal?.throwIfAborted();
  const initHash = keccak256(input.initCode), targetIdHash = hash("hook");
  const key = `${input.identity.routeNamespace}:${input.identity.topologyHash}:${input.identity.routeNonce}:${initHash}`;
  const cached = minedHooks.get(key);
  if (cached && BigInt(cached.applicantSalt) < BigInt(maximum)) return { ...cached };
  for (let index = 0; index < maximum; index++) {
    if (index % 256 === 0) {
      input.signal?.throwIfAborted();
      if (index) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const applicantSalt = toHex(BigInt(index), { size: 32 });
    const effectiveSalt = foundationEthereumTargetSalt(input.identity, { targetIdHash, applicantSalt });
    const address = getContractAddress({ opcode: "CREATE2", from: factory, salt: effectiveSalt, bytecodeHash: initHash });
    if ((BigInt(address) & 0x3fffn) === 0x20ccn) {
      const result = { address, applicantSalt };
      if (minedHooks.size >= 16) minedHooks.delete(minedHooks.keys().next().value!);
      minedHooks.set(key, Object.freeze(result));
      return { ...result };
    }
  }
  throw new Error("A hook address was not found within this preparation attempt. Try a new launch salt.");
}

/** Fixed bytecode and constructor ABI. This builds a candidate, never an authorization. */
export async function buildFoundationEthereumGraph(input: {
  source: FoundationEthereumGraphSource; account: Address; parameters: FoundationLaunchParametersV3;
  fundingPath: readonly FoundationFundingHop[]; value: bigint; signal?: AbortSignal;
}) {
  // Snapshot before the first await: later edits must not change the submitted settings.
  const p = structuredClone(input.parameters), path = structuredClone(input.fundingPath);
  const account = getAddress(input.account), value = input.value;
  if (p.modules.length > 8 || p.creatorBuyFeeBps < 0 || p.creatorBuyFeeBps > 1_000
    || p.creatorSellFeeBps < 0 || p.creatorSellFeeBps > 1_000 || value < 0n || value >= (1n << 127n)) {
    throw new Error("The Ethereum module settings exceed the launch limits.");
  }
  const amount = p.initialBuyQuoteAmount + p.additionalQuoteAmount;
  if (amount > 0n) assertFoundationFundingPath(p.quote, path, 1);
  else if (path.length || value !== 0n) throw new Error("An unfunded launch must not include a funding path or ETH.");
  if (amount > 0n && (value === 0n || (getAddress(p.quote) === getAddress(ethereum.contracts.wrappedEth.address) && value < amount))) {
    throw new Error("The ETH budget does not cover the initial funding.");
  }
  const predicted = predictFoundationEthereumAccounts({ source: input.source, account, tokenSalt: p.tokenSalt, metadata: p.metadata });
  const hookTarget = target("hook", creation("FoundationHookV2", [ethereum.contracts.poolManager.address,
    predicted.engine, predicted.token, p.quote, account, p.initialTick, p.creatorBuyFeeBps, p.creatorSellFeeBps, p.modules]));
  const mined = await mineFoundationEthereumHook({ identity: predicted.identity, initCode: hookTarget.initCode, signal: input.signal });
  input.signal?.throwIfAborted();
  hookTarget.applicantSalt = mined.applicantSalt;
  p.hookSalt = mined.applicantSalt;
  const engineTarget = { ...predicted.engineTarget, initializerValue: value,
    initializerCalldata: encodeFunctionData({ abi: foundationEthereumGraphAbi, functionName: "initializeGraph",
      args: [p, predicted.token, mined.address, encodeFoundationFundingPath(path, 1)] }) };
  const targets = [engineTarget, predicted.tokenTarget, hookTarget];
  const commitment = foundationEthereumGraphCommitment(predicted.identity, targets);
  return { identity: predicted.identity, launchId: predicted.launchId, account, engine: predicted.engine, token: predicted.token,
    hook: mined.address, targets, ...commitment, parameters: p,
    poolKey: foundationPoolKey({ token: predicted.token, quote: p.quote, hook: mined.address }) };
}

/** Compiler-template check supplements onchain getters for every immutable value. */
export function assertFoundationEthereumRuntime(name: ContractName, runtime: Hex) {
  const artifact = contracts[name];
  if (!/^0x(?:[\da-f]{2})+$/i.test(runtime) || runtime.length !== artifact.runtimeTemplate.length) {
    throw new Error(`Unexpected ${name} runtime length.`);
  }
  let masked = runtime.toLowerCase().slice(2), expected = artifact.runtimeTemplate.toLowerCase().slice(2);
  for (const { start, length } of artifact.immutableReferences) {
    const from = start * 2, to = from + length * 2, zeros = "0".repeat(length * 2);
    masked = masked.slice(0, from) + zeros + masked.slice(to);
    expected = expected.slice(0, from) + zeros + expected.slice(to);
  }
  if (masked !== expected) throw new Error(`Unexpected ${name} runtime instructions.`);
}

/** Rebuild every target and every permit field from installed source before accepting wallet bytes. */
export async function assertFoundationEthereumTransaction(input: {
  source: FoundationEthereumGraphSource; transaction: { from: Address; to: Address; data: Hex; value: bigint }; signal?: AbortSignal;
}) {
  const { decodeFoundationEthereumTransaction } = await import("./ethereum-graph");
  const { prepareFoundationEthereumStamp, encodeFoundationEthereumStamp } = await import("./ethereum-graph-plan");
  const decoded = decodeFoundationEthereumTransaction(input.transaction);
  if (getAddress(input.transaction.to) !== getAddress(ethereum.canonicalStamp.router.address)
    || getAddress(decoded.permit.launchWallet) !== getAddress(input.transaction.from)) throw new Error("The Ethereum launch wallet or router changed.");
  const graph = await buildFoundationEthereumGraph({ source: input.source, account: input.transaction.from,
    parameters: decoded.parameters, fundingPath: decoded.path, value: input.transaction.value, signal: input.signal });
  const plan = prepareFoundationEthereumStamp({ identity: graph.identity, targets: graph.targets, outputs: decoded.route.expectedOutputs,
    launchId: graph.launchId, account: graph.account, poolKey: graph.poolKey, validAfter: decoded.permit.validAfter, deadline: decoded.permit.deadline });
  if (encodeFoundationEthereumStamp(plan, decoded.signature).data.toLowerCase() !== input.transaction.data.toLowerCase()) throw new Error("The signed Ethereum graph differs from its installed source.");
  return { graph, decoded };
}
