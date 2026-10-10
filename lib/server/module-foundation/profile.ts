import "server-only";
import { readWebsiteRouterCustomIdentitySnapshotV1 } from "@/lib/alchemy/router-custom-public.server";
import { ethereumModuleSourceForStamp } from "@/lib/module-foundation/ethereum-release";
import { MODULE_PROFILE_PAGE_SIZE, type EthereumModuleProfile, type EthereumProfileModuleLaunch } from "@/lib/profile/module-launches";
import { readRecentFoundationLaunches } from "./recent-launch-store";

/** Complete canonical history plus verified new receipts. No market ranking or module-name allowlist. */
export async function readEthereumProfileModules(account: string, requestedPage = 1): Promise<EthereumModuleProfile> {
  const normalized = account.toLowerCase();
  if (!/^0x[\da-f]{40}$/.test(normalized)) throw new Error("Invalid profile account");
  const [catalog, recent] = await Promise.all([
    readWebsiteRouterCustomIdentitySnapshotV1().catch(() => null),
    readRecentFoundationLaunches().catch(() => []),
  ]);
  const rows = new Map<string, EthereumProfileModuleLaunch>();
  for (const item of recent) {
    if (item.chainId !== 1 || item.row.creator.toLowerCase() !== normalized) continue;
    rows.set(item.row.tokenAddress.toLowerCase(), { ...item.row, imageUrl: item.presentation.imageUrl });
  }
  for (const entry of catalog?.entries ?? []) {
    const p = entry.launchStampProvenance;
    const source = ethereumModuleSourceForStamp(entry);
    if (!p || !source || p.launchWallet.toLowerCase() !== normalized) continue;
    const quoteAsset = p.poolKey.currency0.toLowerCase() === entry.tokenAddress.toLowerCase() ? p.poolKey.currency1 : p.poolKey.currency0;
    rows.set(entry.tokenAddress.toLowerCase(), {
      tokenAddress: entry.tokenAddress, creator: p.launchWallet, hookAddress: p.poolKey.hooks,
      poolId: p.poolId, quoteAsset, sourceReleaseDigest: source.releaseDigest,
      name: entry.name || null, symbol: entry.symbol || null, imageUrl: entry.imageUrl ?? null,
      launchedAt: entry.launchedAt && Number.isFinite(Date.parse(entry.launchedAt)) ? entry.launchedAt : null,
      blockNumber: p.blockNumber, logIndex: p.launchLogIndex,
    });
  }
  const items = [...rows.values()].sort((a, b) => BigInt(a.blockNumber) === BigInt(b.blockNumber)
    ? b.logIndex - a.logIndex || a.tokenAddress.localeCompare(b.tokenAddress)
    : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1);
  const totalPages = Math.ceil(items.length / MODULE_PROFILE_PAGE_SIZE);
  const number = Math.min(Math.max(1, requestedPage), Math.max(1, totalPages));
  return {
    chainId: 1, account: normalized, status: catalog ? catalog.status === "current" ? "ready" : "stale" : items.length ? "stale" : "unavailable",
    updatedAt: catalog?.generatedAt ?? null, items: items.slice((number - 1) * MODULE_PROFILE_PAGE_SIZE, number * MODULE_PROFILE_PAGE_SIZE),
    page: { number, size: MODULE_PROFILE_PAGE_SIZE, totalItems: items.length, totalPages, hasMore: number < totalPages },
  };
}
