import "server-only";
import { unstable_cache } from "next/cache";
import { DEFAULT_EXPLORE_FILTERS, type RobinhoodExploreFilters } from "@/lib/robinhood-explore-filters";
import { readRobinhoodMarkets, readRobinhoodPresentations } from "@/lib/server/robinhood-presentation";
import type { RobinhoodCoinMarket, RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import type { RobinhoodProfilePageSize } from "@/lib/robinhood-launches";
import { exploreCatalog, launchList, moduleModeSnapshots, profileLaunchList, snapshotLaunches, tokenLaunchRecord } from "./model";
import { indexStore } from "./store";

// A page reads the saved list only. Failures never fall through to an RPC.
const readSnapshot = unstable_cache(async () => (await indexStore().read())?.snapshot ?? null,
  ["robinhood-website-index-v1"], { revalidate: 15 });

export async function readRobinhoodLaunches(page = 1, query = "", filters: RobinhoodExploreFilters = DEFAULT_EXPLORE_FILTERS, pageSize: 6 | 8 | 10 | 50 = 50) {
  try {
    const snapshot = await readSnapshot();
    const visible = exploreCatalog(snapshot);
    const markets = await readRobinhoodMarkets(visible).catch(() => new Map<string, RobinhoodCoinMarket>());
    const caps = new Map(Array.from(markets).flatMap(([address, market]) => {
      const value = market.marketCapUsd;
      // A pool's calculated FDV is not a reported market capitalization.
      return value === null || !Number.isFinite(value) || value <= 0 ? [] : [[address.toLowerCase(), value] as const];
    }));
    const volumes = new Map(Array.from(markets).flatMap(([address, market]) => {
      const value = market.volume24hUsd;
      return value === null || !Number.isFinite(value) || value < 0 ? [] : [[address, value] as const];
    }));
    const list = launchList(snapshot, page, query, Date.now(), filters, caps, pageSize, volumes, new Set(caps.keys()));
    // Ranking and card values use the same full-catalog market observation.
    return { ...list, sourceEvidence: snapshot ? {
      router: { source: "canonical-launch-stamp-router", sourceAddress: snapshot.routerAddress, binding: snapshot.binding,
        startBlock: snapshot.startBlock, cursor: snapshot.cursor, finalizedBlock: snapshot.finalizedBlock, updatedAt: snapshot.updatedAt },
      modules: moduleModeSnapshots(snapshot).map(source => ({ source: source.sourceKind, sourceAddress: source.sourceAddress,
        ...(source.factoryVersion ? { factoryVersion: source.factoryVersion } : {}),
        releaseDigest: source.releaseDigest, startBlock: source.startBlock, cursor: source.cursor,
        finalizedBlock: source.finalizedBlock, updatedAt: source.updatedAt })),
      launchProjections: snapshot.launchProjections ? { sourceUrl: snapshot.launchProjections.sourceUrl,
        updatedAt: snapshot.launchProjections.updatedAt, nextCursor: snapshot.launchProjections.nextCursor } : null,
    } : null, presentations: await readRobinhoodPresentations(list.items, markets).catch(() => list.items.map(row => ({
      tokenAddress: row.tokenAddress, imageUrl: null, description: null, links: [], market: markets.get(row.tokenAddress.toLowerCase()) ?? null,
    }))) };
  } catch { return { ...launchList(null, page, query, Date.now(), filters, undefined, pageSize), sourceEvidence: null, presentations: [] as RobinhoodCoinPresentation[] }; }
}

export async function readRobinhoodToken(address: string) {
  try {
    return tokenLaunchRecord(await readSnapshot(), address);
  } catch { return { status: "unavailable" as const, updatedAt: null, token: null }; }
}

/** A direct coin visit shares Explore's exact catalog market cache and observation. */
export async function readRobinhoodTokenPresentation(address: string) {
  try {
    const snapshot = await readSnapshot();
    const record = tokenLaunchRecord(snapshot, address);
    if (!record.token) return { ...record, presentation: null };
    const markets = await readRobinhoodMarkets(exploreCatalog(snapshot)).catch(() => new Map<string, RobinhoodCoinMarket>());
    const presentations = await readRobinhoodPresentations([record.token], markets).catch(() => [] as RobinhoodCoinPresentation[]);
    return { ...record, presentation: presentations[0] ?? null };
  } catch {
    return { status: "unavailable" as const, updatedAt: null, token: null, presentation: null };
  }
}

export async function readRobinhoodProfileLaunches(account: string, page = 1, pageSize: RobinhoodProfilePageSize = 50) {
  const unavailable = profileLaunchList(null, account, page, Date.now(), pageSize);
  try { return profileLaunchList(await readSnapshot(), unavailable.account, page, Date.now(), pageSize); }
  catch { return unavailable; }
}

export async function readRobinhoodProfileClaimDescriptors(account: string) {
  if (!/^0x[0-9a-f]{40}$/i.test(account)) throw new Error("Invalid claim account");
  const rows = snapshotLaunches(await readSnapshot());
  const claims = rows.flatMap(row => row.launchProjection?.claimDescriptors.flatMap(descriptor =>
    [descriptor.requiredController, descriptor.beneficiary].some(value => value.toLowerCase() === account.toLowerCase())
      ? [{ launchId: row.launchId, name: row.name, descriptor }] : []) ?? []);
  // A descriptor may be referenced by multiple finalized launch records; one claim liability is shown once.
  return [...new Map(claims.map(claim => [`${claim.descriptor.chainId}:${claim.descriptor.accrualContract.toLowerCase()}:${claim.descriptor.claimId}`, claim])).values()];
}
