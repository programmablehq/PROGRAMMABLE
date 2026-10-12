import "server-only";
import { createPublicClient, http, isAddressEqual } from "viem";
import { mainnet } from "viem/chains";
import { CANONICAL_LAUNCH_STAMP_24H_V1, type LauncherToken, type CanonicalTokenExploreEntry } from "../tokens";
import { getWebsiteReadOnchainDeployment } from "../onchain/config";
import { readProductionFinalizedCustomLaunchMetadataFeedV1 } from "../server/custom-launch/finalized-custom-launch-metadata-feed-v1";
import { createLaunchStampReaderV1 } from "./launch-stamp.server";
import { readAlchemyRouterCustomIdentitySourceV1, type AlchemyRouterCustomIdentitySourceV1 } from "./explore.server";

const binding = CANONICAL_LAUNCH_STAMP_24H_V1;
const reader = createLaunchStampReaderV1({
  routerAddress: binding.routerAddress,
  routerRuntimeCodeHash: binding.routerRuntimeCodeHash,
  routerStartBlock: BigInt(binding.routerStartBlock),
  initialCursor: { blockNumber: "26152285", blockHash: "0x107bb00ee9e213c54edff92c851c361d4b1eb02f0ffef86bde6a68aef5cea6c8" },
});
// Only immutable, fully verified launch identities are retained here. Prices and
// later presentation metadata continue through the existing market read model.
const identities = new Map<string, LauncherToken>();

type DiscoveryCandidate = Readonly<{
  router: `0x${string}`;
  routerLaunchId: `0x${string}`;
  token: `0x${string}`;
  hook: `0x${string}`;
  poolId: `0x${string}`;
  finality: Readonly<{ blockNumber: string; blockHash: `0x${string}`; transactionHash: `0x${string}`; logIndex: number }>;
}>;

/** Saved identities supply discovery hints when optional API metadata disappears.
 * Every hint still passes the same onchain event, code and finality checks below. */
export function mergeSuccessorDiscoveryCandidatesV1(
  feed: readonly DiscoveryCandidate[], saved: readonly CanonicalTokenExploreEntry[], boundary: bigint,
): readonly DiscoveryCandidate[] {
  const candidates = new Map<string, DiscoveryCandidate>();
  const add = (item: DiscoveryCandidate) => {
    if (!isAddressEqual(item.router, binding.routerAddress) || BigInt(item.finality.blockNumber) > boundary) return;
    const key = item.routerLaunchId.toLowerCase();
    const existing = candidates.get(key);
    const identity = (value: DiscoveryCandidate) => JSON.stringify([
      value.token.toLowerCase(), value.hook.toLowerCase(), value.poolId.toLowerCase(),
      value.finality.blockNumber, value.finality.blockHash.toLowerCase(),
      value.finality.transactionHash.toLowerCase(), value.finality.logIndex,
    ]);
    if (existing && identity(existing) !== identity(item)) throw new Error("Conflicting successor launch discovery identities");
    candidates.set(key, item);
  };
  for (const item of feed) add(item);
  for (const entry of saved) {
    const stamp = entry.launchStampProvenance;
    if (stamp?.kind !== "custom-graph" || stamp.chainId !== 1 ||
      !isAddressEqual(stamp.routerAddress, binding.routerAddress) ||
      stamp.routerRuntimeCodeHash.toLowerCase() !== binding.routerRuntimeCodeHash.toLowerCase()) continue;
    add({ router: stamp.routerAddress, routerLaunchId: stamp.launchId, token: entry.tokenAddress,
      hook: entry.hookAddress, poolId: entry.poolId, finality: { blockNumber: stamp.blockNumber,
        blockHash: stamp.blockHash, transactionHash: stamp.transactionHash, logIndex: stamp.launchLogIndex } });
  }
  if (candidates.size > 10_000) throw new Error("Successor launch discovery exceeds its bound");
  return [...candidates.values()];
}

/** The API feed discovers candidate blocks; receipts, getters, code hashes and
 * 64 confirmations independently establish the canonical onchain identity. */
export async function readAllEthereumCustomIdentitySourcesV1(
  savedEntries: readonly CanonicalTokenExploreEntry[] = [],
): Promise<AlchemyRouterCustomIdentitySourceV1> {
  const [legacy, feed] = await Promise.all([
    readAlchemyRouterCustomIdentitySourceV1(),
    readProductionFinalizedCustomLaunchMetadataFeedV1(),
  ]);
  const boundary = BigInt(legacy.slice.cursor.blockNumber);
  const candidates = mergeSuccessorDiscoveryCandidatesV1(feed.launches, savedEntries, boundary);
  if (candidates.length === 0) return legacy;
  const deployment = getWebsiteReadOnchainDeployment("production");
  if (deployment.status !== "ready") throw new Error("Ethereum launch identity reader unavailable");
  const client = createPublicClient({ chain: mainnet, transport: http(deployment.rpcUrl, { retryCount: 1, timeout: 12_000 }) });
  const latest = await client.getBlock();
  const state = await client.getBlock({ blockNumber: boundary });
  if (!latest.hash || !state.hash || state.hash.toLowerCase() !== legacy.slice.cursor.blockHash.toLowerCase()) {
    throw new Error("Ethereum custom identity snapshot boundary changed");
  }
  const tokens: LauncherToken[] = [];
  const blocks = [...new Set(candidates.map(item => item.finality.blockNumber))];
  // Bound concurrent RPC work. Never drop a candidate on a provider failure;
  // the existing durable snapshot remains available while the refresh retries.
  for (let offset = 0; offset < blocks.length; offset += 3) {
    const batches = await Promise.all(blocks.slice(offset, offset + 3).map(async block => {
      const anchors = await reader.scanLaunchStampAnchors(client, {
        fromBlock: BigInt(block), toBlock: BigInt(block), latestBlock: latest.number,
      });
      const output: LauncherToken[] = [];
      for (const item of candidates.filter(candidate => candidate.finality.blockNumber === block)) {
        const anchor = anchors.find(value => value.launchId.toLowerCase() === item.routerLaunchId.toLowerCase()
          && value.transactionHash.toLowerCase() === item.finality.transactionHash.toLowerCase()
          && value.blockHash.toLowerCase() === item.finality.blockHash.toLowerCase()
          && value.logIndex === item.finality.logIndex && isAddressEqual(value.token, item.token)
          && isAddressEqual(value.hook, item.hook) && value.poolId.toLowerCase() === item.poolId.toLowerCase());
        if (!anchor) throw new Error("Finalized launch metadata has no matching canonical Router event");
        const key = `${anchor.blockHash}:${anchor.transactionHash}:${anchor.logIndex}`;
        let token = identities.get(key);
        if (!token) {
          token = (await reader.hydrateLaunchStampAnchor(deployment, anchor, {
            client, latestBlock: { number: latest.number, hash: latest.hash!, timestamp: latest.timestamp },
            stateBlock: { number: state.number, hash: state.hash!, timestamp: state.timestamp },
          })).token;
          if (identities.size >= 10_000) identities.delete(identities.keys().next().value!);
          identities.set(key, token);
        }
        output.push(token);
      }
      return output;
    }));
    tokens.push(...batches.flat());
  }
  return { ...legacy, status: feed.status === "last-known-good" ? "last-known-good" : legacy.status,
    slice: { ...legacy.slice, tokens: [...legacy.slice.tokens, ...tokens] } };
}
