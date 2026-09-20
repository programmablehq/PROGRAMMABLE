import { createPublicClient, erc20Abi, http, type PublicClient } from "viem";
import { ROBINHOOD_MAINNET_RPC_URL } from "@/lib/chains";
import { parseFoundationAvailability } from "@/lib/module-foundation/availability";
import { type FoundationDeploymentBinding } from "@/lib/module-foundation/client";
import { FOUNDATION_INFRASTRUCTURE } from "@/lib/module-foundation/constants";
import { FOUNDATION_DISCOVERY_MAX_BLOCKS, readFoundationLaunchIndex, type FoundationLaunchIndexPage } from "@/lib/module-foundation/discovery";
import { foundationFactoryVersion } from "@/lib/module-foundation/protocol";
import { hasUnsafeDisplayCharacters } from "@/lib/metadata-policy";
import { isRobinhoodFoundationLaunch, type RobinhoodFoundationLaunch } from "@/lib/robinhood-launches";
import { IndexRangeTooWide, type ModuleModeIndexSource } from "./sync";

const INVENTORY_PATH = "/v1/modules/foundation/releases";
const RELEASE_PATH = "/v1/modules/foundation/availability/release/";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hash = (value: unknown): value is string => typeof value === "string" && /^0x(?!0{64}$)[0-9a-f]{64}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const encoded = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
type Entry = FoundationLaunchIndexPage["entries"][number];
export type FoundationIndexLane = {
  releaseDigest: string;
  source(signal: AbortSignal): Promise<ModuleModeIndexSource>;
};
export type FoundationIndexInventory = {
  lanes: FoundationIndexLane[];
  unavailableSources: readonly ("FOUNDATION_RELEASE_INVENTORY_UNAVAILABLE" | "FOUNDATION_ACTIVE_RELEASE_UNAVAILABLE")[];
};

/** Installed source descriptors identify candidates only. Each lane obtains fresh release acceptance. */
export async function configuredFoundationSources(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FoundationIndexInventory> {
  const base = new URL(process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL ?? "");
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("Foundation authority origin is invalid");
  }
  const read = async (path: string, requestSignal: AbortSignal = signal): Promise<unknown | null> => {
    const response = await fetcher(new URL(path, base), { cache: "no-store", redirect: "error",
      signal: AbortSignal.any([signal, requestSignal, AbortSignal.timeout(12_000)]), headers: { accept: "application/json" } });
    if (response.status === 404 && path === INVENTORY_PATH) { await response.body?.cancel(); return null; }
    if (!response.ok || response.redirected || !response.body
      || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
      || Number(response.headers.get("content-length")) > 2_097_152) throw new Error("Foundation authority unavailable");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 2_097_152) throw new Error("Foundation response too large"); chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  };
  const lane = (releaseDigest: string, version: string, path: string): FoundationIndexLane => ({ releaseDigest,
    async source(laneSignal) {
      laneSignal.throwIfAborted();
      const raw = await read(path, laneSignal), available = parseFoundationAvailability(raw);
      if (!available.available || !available.binding || available.token !== undefined
        || !same(available.binding.releaseDigest, releaseDigest) || foundationFactoryVersion(available.binding) !== version) {
        throw new Error("Foundation release authority differs or is unavailable");
      }
      return foundationIndexSource(available.binding, foundationIndexClients(laneSignal), laneSignal);
    },
  });
  const inventory = await read(INVENTORY_PATH);
  // During a rolling backend upgrade, collect the admitted active release but explicitly report
  // that historical source discovery is incomplete. Existing saved history is never replaced.
  if (inventory === null) {
    const active = parseFoundationAvailability(await read("/v1/modules/foundation/availability"));
    return { lanes: active.available && active.binding
      ? [lane(active.binding.releaseDigest, foundationFactoryVersion(active.binding), "/v1/modules/foundation/availability")] : [],
    unavailableSources: ["FOUNDATION_RELEASE_INVENTORY_UNAVAILABLE", ...(!active.available ? ["FOUNDATION_ACTIVE_RELEASE_UNAVAILABLE" as const] : [])] };
  }
  if (!object(inventory) || inventory.schemaVersion !== "programmable.module-foundation.release-inventory.v1"
    || !Array.isArray(inventory.releases) || inventory.releases.length > 8) throw new Error("Foundation release inventory is invalid");
  const lanes = inventory.releases.map(value => {
    if (!object(value) || Object.keys(value).sort().join(",") !== "availabilityPath,factoryVersion,releaseDigest"
      || !hash(value.releaseDigest) || !["v1", "v2", "v3"].includes(String(value.factoryVersion))
      || value.availabilityPath !== `${RELEASE_PATH}${value.releaseDigest}`) throw new Error("Foundation release descriptor is invalid");
    return lane(value.releaseDigest, String(value.factoryVersion), String(value.availabilityPath));
  });
  if (new Set(lanes.map(value => value.releaseDigest)).size !== lanes.length) throw new Error("Foundation release inventory is duplicated");
  return { lanes, unavailableSources: [] };
}

function foundationIndexClients(signal: AbortSignal): readonly [PublicClient, PublicClient] {
  const urls = [process.env.ROBINHOOD_RPC_URL?.trim() || "https://rpc-robinhood.blockmachine.io",
    process.env.ROBINHOOD_RPC_SECONDARY_URL?.trim() || ROBINHOOD_MAINNET_RPC_URL].map(value => new URL(value));
  if (urls.some(url => url.protocol !== "https:" || url.username || url.password) || urls[0].hostname === urls[1].hostname) {
    throw new Error("Independent Foundation index providers are required");
  }
  return urls.map(url => createPublicClient({ transport: http(url.href, {
    timeout: 8_000, retryCount: 0, fetchOptions: { signal },
  }) })) as unknown as readonly [PublicClient, PublicClient];
}

/** Reuse the canonical Foundation reader inside the existing finalized, checkpointed background job. */
export async function foundationIndexSource(binding: FoundationDeploymentBinding, clients: readonly [PublicClient, PublicClient], signal?: AbortSignal): Promise<ModuleModeIndexSource> {
  const version = foundationFactoryVersion(binding);
  const tips = await Promise.all(clients.map(async client => {
    if (await client.getChainId() !== 4663) throw new Error("Foundation index chain mismatch");
    return client.getBlock({ blockTag: "finalized" });
  }));
  const boundary = tips[0].number < tips[1].number ? tips[0].number : tips[1].number;
  if (boundary < binding.startBlock) throw new Error("Foundation factory is not finalized");
  const canonical = async (number: bigint) => {
    signal?.throwIfAborted();
    const blocks = await Promise.all(clients.map(client => client.getBlock({ blockNumber: number })));
    if (blocks.some(block => block.number !== number || !block.hash)
      || !same(blocks[0].hash, blocks[1].hash) || blocks[0].timestamp !== blocks[1].timestamp) throw new Error("Foundation providers disagree on the canonical block");
    return blocks[0];
  };
  const block = async (number: bigint) => ({ number: number.toString(), hash: (await canonical(number)).hash });
  const finalized = await block(boundary);
  const publicRow = async (entry: Entry): Promise<RobinhoodFoundationLaunch> => {
    const launched = await canonical(entry.blockNumber);
    const identity = await Promise.all(clients.map(client => Promise.allSettled((["name", "symbol"] as const).map(functionName =>
      client.readContract({ address: entry.token, abi: erc20Abi, functionName, blockNumber: boundary })))));
    const text = (field: number) => {
      const first = identity[0][field], second = identity[1][field];
      return first.status === "fulfilled" && second.status === "fulfilled" && first.value === second.value
        && first.value.length <= 128 && !hasUnsafeDisplayCharacters(first.value) ? first.value : null;
    };
    const row: RobinhoodFoundationLaunch = {
      sourceKind: "module-foundation-v1", factoryVersion: version, sourceAddress: binding.factory.address,
      sourceReleaseDigest: binding.releaseDigest, routerAddress: null, stampHash: null,
      launchId: entry.poolId, tokenAddress: entry.token, hookAddress: entry.hook, creator: entry.creator,
      poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address, poolId: entry.poolId, quoteAsset: entry.quote,
      feeLedgerAddress: entry.ledger, metadataHash: entry.metadataHash, compositionHash: entry.compositionHash,
      transactionHash: entry.transactionHash, blockNumber: entry.blockNumber.toString(), blockHash: entry.blockHash,
      logIndex: entry.logIndex, launchedAt: new Date(Number(launched.timestamp) * 1_000).toISOString(),
      name: text(0), symbol: text(1), decimals: 18,
    };
    if (!isRobinhoodFoundationLaunch(row)) throw new Error("Foundation launch identity is invalid");
    return row;
  };
  return { sourceKind: "module-foundation-v1", factoryVersion: version, sourceAddress: binding.factory.address, releaseDigest: binding.releaseDigest,
    startBlock: binding.startBlock, finalized, block,
    async launches(fromBlock, toBlock) {
      if (fromBlock < binding.startBlock || toBlock < fromBlock || toBlock > boundary) throw new Error("Foundation range is outside finality");
      if (toBlock - fromBlock + 1n > FOUNDATION_DISCOVERY_MAX_BLOCKS) throw new IndexRangeTooWide("Foundation range exceeds reader budget");
      const entries: Entry[] = [];
      let cursor: FoundationLaunchIndexPage["nextCursor"] = null;
      do {
        signal?.throwIfAborted();
        let pages: FoundationLaunchIndexPage[];
        try { pages = await Promise.all(clients.map(client => readFoundationLaunchIndex({ client, binding,
          fromBlock, toBlock, verificationBlock: boundary, pageSize: 100, ...(cursor ? { cursor } : {}), signal }))); }
        catch (error) {
          if (fromBlock < toBlock && error instanceof Error && /too busy|block range|too many results|response size/i.test(error.message)) throw new IndexRangeTooWide();
          throw error;
        }
        if (encoded(pages[0]) !== encoded(pages[1])) throw new Error("Foundation providers disagree on launch evidence");
        entries.push(...pages[0].entries);
        cursor = pages[0].nextCursor;
        if (cursor && fromBlock < toBlock) throw new IndexRangeTooWide("Split a busy Foundation range before indexing it");
        if (entries.length > 2_000) throw new Error("Foundation block exceeds its launch budget");
      } while (cursor);
      const rows: RobinhoodFoundationLaunch[] = [];
      // Limit hydration pressure independently of the SDK's bounded verification workers.
      for (let offset = 0; offset < entries.length; offset += 4) rows.push(...await Promise.all(entries.slice(offset, offset + 4).map(publicRow)));
      await canonical(toBlock);
      return rows;
    },
  };
}
