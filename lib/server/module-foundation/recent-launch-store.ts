import "server-only";
import { get, put } from "@vercel/blob";
import { isRobinhoodFoundationLaunch } from "@/lib/robinhood-launches";
import { exploreIdentityKey } from "@/lib/unified-explore";
import { RECENT_LAUNCH_LIMIT, selectRecentFoundationLaunches, type RecentFoundationLaunch } from "@/lib/module-foundation/recent-launches";
import { confirmedLaunchClients } from "./confirmed-launch";
import type { FoundationChainId } from "@/lib/module-foundation/chains";

const path = "website-index/module-foundation/confirmed-v1.json";
const maxBytes = 1_048_576;
type Snapshot = { items: RecentFoundationLaunch[]; etag: string | null };
const empty = (): Snapshot => ({ items: [], etag: null });
const token = () => process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
let saved: { expires: number; value: Promise<Snapshot> } | undefined;
const blocks = new Map<string, { expires: number; value: Promise<boolean> }>();

async function load(): Promise<Snapshot> {
  const credential = token();
  if (!credential) return empty();
  const response = await get(path, { token: credential, access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
  if (!response) return empty();
  if (response.statusCode !== 200 || !response.stream) throw new Error("Recent launches could not be read.");
  const reader = response.stream.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > maxBytes) throw new Error("Recent launch data exceeds its limit.");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (data?.version !== 1 || !Array.isArray(data.items) || data.items.length > RECENT_LAUNCH_LIMIT
    || !data.items.every((item: RecentFoundationLaunch) => (item.chainId === 1 || item.chainId === 4663)
      && Number.isSafeInteger(item.observedAt) && isRobinhoodFoundationLaunch(item.row)
      && item.presentation?.tokenAddress === item.row.tokenAddress
      && item.presentation?.chainId === item.chainId && item.presentation?.market === null
      && Array.isArray(item.presentation?.links))) throw new Error("Recent launch data is invalid.");
  // Conditional writes require the strong object version returned by the
  // identity response; a weak representation validator must not be rewritten.
  const etag = response.blob.etag.trim();
  if (!/^"[\da-f]{32}"$/i.test(etag)) throw new Error("Recent launch version is invalid.");
  return { items: data.items, etag };
}
function snapshot() {
  if (!saved || saved.expires <= Date.now()) {
    const value = load(); saved = { expires: Date.now() + 5_000, value };
    void value.catch(() => { if (saved?.value === value) saved = undefined; });
  }
  return saved.value;
}

export async function saveRecentFoundationLaunch(item: RecentFoundationLaunch) {
  const credential = token();
  if (!credential) throw new Error("Recent launch storage is unavailable.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await load();
    if (previous.items.some(old => old.chainId === item.chainId && old.row.transactionHash === item.row.transactionHash
      && old.row.blockHash === item.row.blockHash && old.row.tokenAddress === item.row.tokenAddress)) return;
    const items = selectRecentFoundationLaunches([...previous.items, item], new Set());
    const body = JSON.stringify({ version: 1, items });
    if (Buffer.byteLength(body) > maxBytes) throw new Error("Recent launch data exceeds its limit.");
    try {
      await put(path, body, { token: credential, access: "private", addRandomSuffix: false, contentType: "application/json",
        allowOverwrite: previous.etag !== null, ...(previous.etag ? { ifMatch: previous.etag } : {}), cacheControlMaxAge: 60 });
      saved = undefined; return;
    } catch (error) { saved = undefined; if (attempt === 2) throw error; }
  }
}

function canonical(chainId: FoundationChainId, number: string, hash: string): Promise<boolean> {
  const key = `${chainId}:${number}:${hash}`, cached = blocks.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = Promise.all(confirmedLaunchClients(chainId).map(async client => {
    const [chain, block] = await Promise.all([client.getChainId(), client.getBlock({ blockNumber: BigInt(number) })]);
    return chain === chainId && block.hash?.toLowerCase() === hash.toLowerCase();
  })).then(results => results.every(Boolean)).catch(() => false);
  if (blocks.size >= 128) blocks.delete(blocks.keys().next().value!);
  blocks.set(key, { expires: Date.now() + 15_000, value });
  return value;
}

/** No token metadata or price API calls. Indexed rows supersede these temporary receipt observations. */
export async function readRecentFoundationLaunches(indexed: ReadonlySet<string> = new Set()) {
  const candidates = selectRecentFoundationLaunches((await snapshot()).items, indexed);
  const checked = await Promise.all(candidates.map(async item =>
    await canonical(item.chainId, item.row.blockNumber, item.row.blockHash) ? item : null));
  return checked.filter((item): item is RecentFoundationLaunch => item !== null);
}

export async function findRecentFoundationLaunch(chainId: FoundationChainId, address: string) {
  const item = selectRecentFoundationLaunches((await snapshot()).items, new Set()).find(item =>
    exploreIdentityKey({ chainId: item.chainId, tokenAddress: item.row.tokenAddress }) === `${chainId}:${address.toLowerCase()}`);
  return item && await canonical(chainId, item.row.blockNumber, item.row.blockHash) ? item : null;
}
