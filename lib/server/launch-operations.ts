import "server-only";
import { isAddress, type Address } from "viem";
import { isWebsiteAdminWallet } from "@/lib/admin-access";
import { isPublicExploreIdentityV1 } from "@/lib/explore-public-visibility";
import { isDiscoverableRobinhoodToken } from "@/lib/robinhood-explore-policy";
import { isRobinhoodModuleSourceKind } from "@/lib/robinhood-launches";
import { isEthereumModuleLaunchCandidate } from "@/lib/module-foundation/ethereum-release";
import { operationIdentity, type OperationsLaunch, type OperationsSnapshot, type OperationsSource } from "@/lib/launch-operations";
import { readEthereumUnifiedExploreCatalog } from "./ethereum-explore";
import { readRobinhoodExploreCatalog } from "./robinhood-index/read";
import { readRobinhoodOperationsFeed } from "./launch-operations-robinhood-feed";
import { readProductionFinalizedCustomLaunchMetadataFeedV1 } from "./custom-launch/finalized-custom-launch-metadata-feed-v1";
import { readRecentFoundationLaunches } from "./module-foundation/recent-launch-store";
import { confirmedLaunchClients } from "./module-foundation/confirmed-launch";
import { readEthereumMissingIndexReason } from "./module-foundation/ethereum-stamp-status";
import { createPrivyWalletPrincipalAuthenticatorV1, WalletPrincipalAuthenticationErrorV1, type WalletPrincipalAuthenticatorV1 } from "./creator-article/wallet-principal.server";

const visible = (row: { tokenAddress: string }, chain: 1 | 4663) => isPublicExploreIdentityV1(row, chain)
  && (chain !== 4663 || isDiscoverableRobinhoodToken(row.tokenAddress));
const name = (value: string | null | undefined, address: string) => value || `${address.slice(0, 8)}…${address.slice(-4)}`;
type Observation = { source: OperationsSource; rows: OperationsLaunch[] };
async function bounded<T>(work: () => Promise<T>, ms = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Observation timed out")), ms); })]); }
  finally { clearTimeout(timer); }
}
async function observe(id: string, label: string, chainId: 1 | 4663 | null, work: () => Promise<Omit<Observation, "source"> & Pick<OperationsSource, "status" | "updatedAt" | "complete">>): Promise<Observation> {
  try { const value = await bounded(work); return { rows: value.rows, source: { id, label, chainId, status: value.status, updatedAt: value.updatedAt, count: value.rows.length, complete: value.complete } }; }
  catch { return { rows: [], source: { id, label, chainId, status: "unavailable", updatedAt: null, count: 0, complete: false } }; }
}

async function collectSnapshot(): Promise<OperationsSnapshot> {
  const results = await Promise.all([
    observe("index:1", "Ethereum website index", 1, async () => {
      const data = await readEthereumUnifiedExploreCatalog();
      return { status: data.status, updatedAt: data.updatedAt, complete: data.status === "ready", rows: data.entries.map(entry => ({
        chainId: 1 as const, token: entry.tokenAddress, name: name(entry.name, entry.tokenAddress), symbol: entry.symbol || "",
        mode: entry.launchCategoryProvenance.category === "classic" ? "classic" as const : isEthereumModuleLaunchCandidate(entry) ? "module" as const : "custom" as const,
        launchId: entry.launchStampProvenance?.launchId ?? entry.id, transactionHash: entry.launchTransactionHash ?? null,
        observedAt: entry.launchedAt ?? null, stamp: entry.launchStampProvenance ? "recorded" as const : "native-source" as const, listed: true,
      })) };
    }),
    observe("index:4663", "Robinhood website index", 4663, async () => {
      const data = await readRobinhoodExploreCatalog();
      return { status: data.status, updatedAt: data.updatedAt, complete: data.status === "ready", rows: data.items.filter(row => visible(row, 4663)).map(row => ({
        chainId: 4663 as const, token: row.tokenAddress, name: name(row.name, row.tokenAddress), symbol: row.symbol || "",
        mode: isRobinhoodModuleSourceKind(row.sourceKind) ? "module" as const : "custom" as const,
        launchId: row.launchProjection?.launchId ?? row.launchId, subjectHash: row.launchProjection?.planHash ?? undefined,
        transactionHash: row.transactionHash, observedAt: row.launchedAt,
        stamp: row.stampHash || row.launchProjection ? "recorded" as const : "native-source" as const, listed: true,
      })) };
    }),
    observe("feed:1", "Ethereum finalized launches", 1, async () => {
      const data = await readProductionFinalizedCustomLaunchMetadataFeedV1();
      return { status: data.status === "current" ? "ready" as const : "stale" as const, updatedAt: data.generatedAt, complete: data.status === "current",
        rows: data.launches.map(row => ({ chainId: 1 as const, token: row.token,
          name: name(row.tokenMetadataReadback.observed.name || row.tokenMetadataReadback.declared.name, row.token),
          symbol: row.tokenMetadataReadback.observed.symbol || row.tokenMetadataReadback.declared.symbol,
          mode: "custom" as const, launchId: row.routerLaunchId, requestId: row.resourceId, subjectHash: row.bindings.requestHash,
          transactionHash: row.finality.transactionHash, observedAt: row.finalizedAt, stamp: "recorded" as const,
          listed: visible({ tokenAddress: row.token }, 1),
        })) };
    }),
    observe("feed:4663", "Robinhood finalized launches", 4663, readRobinhoodOperationsFeed),
    observe("receipts", "Recent module receipts", null, async () => {
      if (!process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() && !process.env.BLOB_READ_WRITE_TOKEN?.trim()) throw new Error("Receipt storage unavailable");
      const data = await readRecentFoundationLaunches();
      return { status: "ready" as const, updatedAt: new Date().toISOString(), complete: true, rows: data.map(item => ({
        chainId: item.chainId, token: item.row.tokenAddress, name: name(item.row.name, item.row.tokenAddress), symbol: item.row.symbol || "",
        mode: "module" as const, launchId: item.row.launchId, transactionHash: item.row.transactionHash,
        observedAt: new Date(item.observedAt).toISOString(), stamp: item.chainId === 4663 ? "native-source" as const : "not-checked" as const, listed: true,
      })) };
    }),
  ]);
  return { schemaVersion: "programmable.launch-operations.v1", checkedAt: new Date().toISOString(), sources: results.map(value => value.source),
    indexed: [...results[0].rows, ...results[1].rows], published: [...results[2].rows, ...results[3].rows], recent: results[4].rows };
}

export function createOperationsSnapshotReader(read = collectSnapshot, now = Date.now) {
  let cache: { value: OperationsSnapshot; until: number } | undefined;
  let pending: Promise<OperationsSnapshot> | undefined;
  return async () => {
    if (cache && cache.until > now()) return cache.value;
    pending ??= read().then(value => { cache = { value, until: now() + (value.sources.some(source => source.status === "unavailable") ? 5_000 : 30_000) }; return value; }).finally(() => { pending = undefined; });
    return await pending;
  };
}
export const readLaunchOperations = createOperationsSnapshotReader();

export async function inspectOperationsStamp(chainId: 1 | 4663, token: string, snapshot: OperationsSnapshot) {
  const key = operationIdentity({ chainId, token });
  const indexed = snapshot.indexed.find(row => operationIdentity(row) === key);
  if (indexed) return { status: indexed.stamp === "native-source" ? "Native launch source recorded" : "Stamp recorded in website index",
    next: "The canonical launch is indexed. External terminal badges are maintained by those terminals." };
  const published = snapshot.published.find(row => operationIdentity(row) === key);
  if (published) return { status: "Finalized launch published · website index not observed", next: "Check the index source and its latest checkpoint. Do not relaunch the coin." };
  const recent = snapshot.recent.find(row => operationIdentity(row) === key);
  if (!recent) return { status: "No launch observation in this snapshot", next: "Refresh or open the exact request. Absence here does not prove a failed launch." };
  if (chainId === 4663) return { status: "Module receipt recorded · index pending", next: "The module has native launch provenance. A missing Router stamp field alone is not an error. Check index finality." };
  const clients = confirmedLaunchClients(1);
  const tips = await Promise.all(clients.map(client => client.getBlock({ blockTag: "finalized" })));
  const blockNumber = tips.reduce((value, block) => block.number < value ? block.number : value, tips[0].number);
  const blocks = await Promise.all(clients.map(client => client.getBlock({ blockNumber })));
  if (blocks[0].hash !== blocks[1].hash) throw new Error("Finalized providers disagree");
  const result = await readEthereumMissingIndexReason({ clients: [clients[0], clients[1]], token: token as Address, blockNumber });
  return result === "MODULE_STAMP_MISSING" ? { status: "Stamp missing at the finalized checkpoint", next: "Investigate the original launch transaction and source before attempting any recovery." }
    : { status: "Awaiting finality or website indexing", next: "Refresh after the next index update. Do not send the launch again." };
}

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Authorization, X-Privy-Identity-Token" };
export function createLaunchOperationsRoute(input: { authenticator: WalletPrincipalAuthenticatorV1; read: typeof readLaunchOperations; inspect?: typeof inspectOperationsStamp }) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
      if ((request.headers.get("origin") && request.headers.get("origin") !== url.origin)
        || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Origin mismatch" }, { status: 403, headers });
      const allowed = ["walletAddress", "chainId", "token"];
      if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) return Response.json({ error: "Invalid request" }, { status: 400, headers });
      const wallet = url.searchParams.get("walletAddress"), token = url.searchParams.get("token"), chain = url.searchParams.get("chainId");
      if (!wallet || !isAddress(wallet) || ((chain !== null || token !== null) && (!(chain === "1" || chain === "4663") || !token || !isAddress(token)))) return Response.json({ error: "Invalid request" }, { status: 400, headers });
      const principal = await input.authenticator.authenticate(request);
      if (!isWebsiteAdminWallet(wallet) || !principal.wallets.some(value => value.toLowerCase() === wallet.toLowerCase())) return Response.json({ error: "Admin wallet required" }, { status: 403, headers });
      const snapshot = await input.read();
      if (token) return Response.json(await bounded(() => (input.inspect ?? inspectOperationsStamp)(Number(chain) as 1 | 4663, token, snapshot)), { headers });
      return Response.json(snapshot, { headers });
    } catch (error) {
      return Response.json({ error: error instanceof WalletPrincipalAuthenticationErrorV1 ? "Sign in again with your admin wallet." : "Observation unavailable. Try again." },
        { status: error instanceof WalletPrincipalAuthenticationErrorV1 ? error.status : 503, headers });
    }
  };
}
export async function routeLaunchOperations(request: Request) {
  try { return await createLaunchOperationsRoute({ authenticator: createPrivyWalletPrincipalAuthenticatorV1(), read: readLaunchOperations })(request); }
  catch { return Response.json({ error: "Observation unavailable. Try again." }, { status: 503, headers }); }
}
