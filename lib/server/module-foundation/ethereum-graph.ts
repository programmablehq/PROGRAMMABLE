import { assertFoundationEthereumTransaction } from "@/lib/module-foundation/ethereum-graph-builder";
import { readFoundationMinedCall } from "@/lib/module-foundation/mined-call";
import { decodeFoundationEthereumTransaction } from "@/lib/module-foundation/ethereum-graph";
import "server-only";
import { getAddress, keccak256, type PublicClient } from "viem";
import { hydrateLaunchStampAnchor, type LaunchStampAnchor } from "@/lib/alchemy/launch-stamp.server";
import type { ReadyOnchainDeployment } from "@/lib/onchain/types";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import { foundationFactoryV3Abi } from "@/lib/module-foundation/abi";
import { FOUNDATION_LP_CUSTODY_DEAD_ID } from "@/lib/module-foundation/constants";
import {
  decodeFoundationEthereumGraphLaunch, foundationEthereumGraphAbi, type FoundationEthereumGraphSource,
} from "@/lib/module-foundation/ethereum-graph";
import { assertFoundationV2Result, readFoundationV2Positions, type FoundationDeploymentBinding } from "@/lib/module-foundation/protocol";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Enrich one canonical stamped launch after its host source has been admitted.
 * The existing stamp reader remains the authority for receipt, Router, component,
 * pool and finality evidence. No new event or parallel launch identity is created.
 * Call from background indexing, not from per-card browser polling.
 */
export async function readFoundationEthereumGraphLaunch(input: {
  client: PublicClient; deployment: ReadyOnchainDeployment; anchor: LaunchStampAnchor;
  source: FoundationEthereumGraphSource; signal?: AbortSignal;
}) {
  const { client, deployment, anchor, source, signal } = input;
  signal?.throwIfAborted();
  const hydrated = await hydrateLaunchStampAnchor(deployment, anchor, { client });
  signal?.throwIfAborted();
  const tx = await client.getTransaction({ hash: anchor.transactionHash });
  if (tx.blockNumber !== anchor.blockNumber || !tx.blockHash || !same(tx.blockHash, anchor.blockHash)
    || tx.transactionIndex !== anchor.transactionIndex) throw new Error("The module transaction is not in the stamped block.");
  const launchCall = await readFoundationMinedCall(client, tx, {
    account: hydrated.launchStampProvenance.launchWallet, target: getAddress(ethereum.canonicalStamp.router.address),
    accepts(call) { try { return same(decodeFoundationEthereumTransaction(call).token, anchor.token); } catch { return false; } },
  });
  const candidate = decodeFoundationEthereumGraphLaunch({ source, provenance: hydrated.launchStampProvenance,
    transaction: { hash: tx.hash, ...launchCall } });
  await assertFoundationEthereumTransaction({ source, transaction: launchCall, signal });
  const blockNumber = anchor.blockNumber, address = candidate.engine;
  const [implementationCode, proxyCode, implementation, implementationHash, graphFactory, launchWallet, initialized, parametersHash, result] = await Promise.all([
    client.getCode({ address: source.implementation.address, blockNumber }),
    client.getCode({ address, blockNumber }),
    client.readContract({ address, abi: foundationEthereumGraphAbi, functionName: "implementation", blockNumber }),
    client.readContract({ address, abi: foundationEthereumGraphAbi, functionName: "implementationCodeHash", blockNumber }),
    client.readContract({ address, abi: foundationEthereumGraphAbi, functionName: "GRAPH_FACTORY", blockNumber }),
    client.readContract({ address, abi: foundationEthereumGraphAbi, functionName: "LAUNCH_WALLET", blockNumber }),
    client.readContract({ address, abi: foundationEthereumGraphAbi, functionName: "initialized", blockNumber }),
    client.readContract({ address, abi: foundationEthereumGraphAbi, functionName: "parametersHash", blockNumber }),
    client.readContract({ address, abi: foundationFactoryV3Abi, functionName: "launchOf", args: [candidate.token], blockNumber }),
  ]);
  signal?.throwIfAborted();
  if (!implementationCode || !proxyCode || !same(keccak256(implementationCode), source.implementation.runtimeCodeHash)
    || !same(keccak256(proxyCode), source.proxyRuntimeCodeHash)
    || !same(implementation, source.implementation.address) || !same(implementationHash, source.implementation.runtimeCodeHash)
    || !same(graphFactory, ethereum.canonicalStamp.graphFactory.address)
    || !same(launchWallet, launchCall.from) || !initialized || !same(parametersHash, candidate.parametersHash)
    || !same(result.token, candidate.token) || !same(result.hook, candidate.hook) || !same(result.poolId, anchor.poolId)) {
    throw new Error("The module launch account differs from the admitted source or stamped settings.");
  }
  assertFoundationV2Result(result, candidate.parameters);
  const positions = await readFoundationV2Positions(client, result, candidate.parameters.quote, candidate.parameters.initialTick, blockNumber);
  const block = await client.getBlock({ blockNumber });
  if (!block.hash || !same(block.hash, anchor.blockHash)) throw new Error("The module launch block changed during verification.");
  signal?.throwIfAborted();
  // Per-token binding: the shared implementation is never mistaken for the
  // account holding this token's launch record. This binding cannot launch again.
  const binding: FoundationDeploymentBinding = {
    ethereumGraph: source, chainId: 1, factoryVersion: "v3", lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID,
    platformFeeBps: source.platformFeeBps ?? 30,
    releaseDigest: source.releaseDigest, sourceCommit: source.sourceCommit, startBlock: source.startBlock,
    factory: { address, runtimeCodeHash: source.proxyRuntimeCodeHash },
    hookDeployer: { address: getAddress(ethereum.canonicalStamp.graphFactory.address),
      runtimeCodeHash: ethereum.canonicalStamp.graphFactory.runtimeCodeHash as `0x${string}` },
  };
  return { ...hydrated, ...candidate, binding, result: { ...result, factoryVersion: "v3" as const }, positions,
    evidence: "canonical-ethereum-module-launch" as const };
}
