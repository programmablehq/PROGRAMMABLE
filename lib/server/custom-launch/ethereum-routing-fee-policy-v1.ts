import "server-only";
import { get, put } from "@vercel/blob";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { ETHEREUM_ROUTING_FEE_BOUNDARY_V1, ETHEREUM_ROUTING_FEE_POLICY_HASH_V1, validateEthereumFeeClassificationV1, type EthereumFeeClassificationV1 } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import { metadataMatchesRouterEntryV1, readProductionFinalizedCustomLaunchMetadataFeedV1,
  type FinalizedCustomLaunchMetadataFeedV1 } from "./finalized-custom-launch-metadata-feed-v1";

const schema = "programmable.ethereum-verified-fee-classification.v1";
const maxBytes = 16_384;
export type EthereumFeeClassificationStoreV1 = {
  read(key: string): Promise<unknown | null>;
  write(key: string, record: unknown): Promise<void>;
};

function durableStore(): EthereumFeeClassificationStoreV1 {
  const token = process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const path = (key: string) => `website-index/ethereum/fee-classifications-v1/${key.slice(7)}.json`;
  return {
    async read(key) {
      if (!token) throw new Error("Ethereum fee classification storage is unavailable");
      const response = await get(path(key), { token, access: "private", useCache: false, abortSignal: AbortSignal.timeout(3_000) });
      if (!response) return null;
      if (response.statusCode !== 200 || !response.stream) throw new Error("Ethereum fee classification could not be read");
      const reader = response.stream.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > maxBytes) throw new Error("Ethereum fee classification is too large");
          chunks.push(part.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } finally { await reader.cancel().catch(() => undefined); }
    },
    async write(key, record) {
      if (!token) throw new Error("Ethereum fee classification storage is unavailable");
      const body = JSON.stringify(record);
      if (Buffer.byteLength(body) > maxBytes) throw new Error("Ethereum fee classification is too large");
      await put(path(key), body, { token, access: "private", addRandomSuffix: false, allowOverwrite: false,
        contentType: "application/json", abortSignal: AbortSignal.timeout(3_000) });
    },
  };
}

function identityKey(entry: CanonicalTokenExploreEntry): string {
  // Finalized checkpoints advance; the actual launch, execution proof and pool
  // identity are immutable and must all remain bound to the saved policy.
  const { finalizedAtBlockNumber: _number, finalizedAtBlockHash: _hash, ...stamp } = entry.launchStampProvenance!;
  void _number; void _hash;
  return canonicalBrowserSha256V2(schema, { stamp, token: entry.tokenAddress, hook: entry.hookAddress,
    poolId: entry.poolId, policyHash: ETHEREUM_ROUTING_FEE_POLICY_HASH_V1 });
}

function savedClassification(record: unknown, key: string, entry: CanonicalTokenExploreEntry): EthereumFeeClassificationV1 {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError("Invalid saved Ethereum fee classification");
  const value = record as { schemaVersion: string; identityKey: string; classification: EthereumFeeClassificationV1 };
  if (Object.keys(value).sort().join() !== "classification,identityKey,schemaVersion"
    || value.schemaVersion !== schema || value.identityKey !== key) throw new TypeError("Saved Ethereum fee classification identity differs");
  return validateEthereumFeeClassificationV1(value.classification, entry.launchStampProvenance!);
}

/** The reviewed boundary precedes all profile 3.6 authorizations. Older stamps
 * retain their original route; newer stamps require explicit API classification.
 * Missing data never becomes a zero-fee authorization. */
export async function readEthereumFeeClassificationV1(entry: CanonicalTokenExploreEntry,
  readFeed: () => Promise<FinalizedCustomLaunchMetadataFeedV1> = readProductionFinalizedCustomLaunchMetadataFeedV1,
  store: EthereumFeeClassificationStoreV1 = durableStore(),
): Promise<EthereumFeeClassificationV1 | undefined> {
  const stamp = entry.launchStampProvenance;
  if (!stamp || stamp.chainId !== 1 || stamp.kind !== "custom-graph") throw new TypeError("Ethereum launch stamp required");
  if (BigInt(stamp.blockNumber) <= BigInt(ETHEREUM_ROUTING_FEE_BOUNDARY_V1.blockNumber)) return undefined;
  const key = identityKey(entry);
  const saved = await store.read(key);
  if (saved !== null) return savedClassification(saved, key, entry);
  const matches = (await readFeed()).launches.filter(row => row.routerLaunchId.toLowerCase() === stamp.launchId.toLowerCase());
  if (matches.length !== 1 || !metadataMatchesRouterEntryV1(matches[0]!, entry)) {
    throw new TypeError("Ethereum launch fee classification is not available yet");
  }
  const metadata = matches[0]!;
  if (metadata.chainId !== "1" || metadata.routingFeePolicy?.schemaVersion === "programmable.base-launch-routing-fee-policy-binding.v1") throw new TypeError("Ethereum fee policy chain differs");
  const classification = validateEthereumFeeClassificationV1({ launchId: stamp.launchId, stampHash: stamp.stampHash,
    profileVersion: metadata.launchProfileVersion, routingFeePolicy: metadata.routingFeePolicy ?? null }, stamp);
  const record = { schemaVersion: schema, identityKey: key, classification };
  try {
    await store.write(key, record);
  } catch (error) {
    // A concurrent request may have inserted this immutable record first.
    const concurrent = await store.read(key);
    if (concurrent === null) throw error;
    if (canonicalBrowserSha256V2(schema, savedClassification(concurrent, key, entry))
      !== canonicalBrowserSha256V2(schema, classification)) throw new TypeError("Conflicting saved Ethereum fee classification");
  }
  return classification;
}
