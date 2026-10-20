import { foundationChainProfile } from "./module-foundation/chains";
import type { RobinhoodLaunch } from "./robinhood-launches";
import type { CanonicalTokenExploreEntry } from "./tokens";
import { moduleDetailsForLaunch, type ModuleLaunchDetailsBinding, type PublicModuleDetails } from "./module-mode/public-details";

export type LaunchPresentationSource = Pick<RobinhoodLaunch, "tokenAddress"> & Partial<Pick<RobinhoodLaunch,
  "sourceKind" | "poolId" | "quoteAsset" | "launchProjection" | "modulePackageIds" | "moduleFamilyIds" | "sourceReleaseDigest">> & {
    /** Display-only symbol read alongside the source-bound quote asset. */
    quoteSymbol?: string | null;
  };
export type LaunchPairObservation = { poolId: string; quoteAsset?: { address: string; symbol: string | null } };

/** Quote identity also exists in the saved pool proof, even without market metadata. */
export function ethereumPairPresentation(entry: CanonicalTokenExploreEntry) {
  let quoteAsset = entry.quoteAssetAddress ?? undefined;
  const proof = entry.launchStampProvenance;
  if (!quoteAsset && proof?.chainId === 1 && same(proof.poolId, entry.poolId)
    && same(proof.tokenProof.tokenAddress, entry.tokenAddress)) {
    const { currency0, currency1 } = proof.poolKey;
    if (!same(currency0, currency1)) quoteAsset = same(currency0, entry.tokenAddress) ? currency1
      : same(currency1, entry.tokenAddress) ? currency0 : undefined;
  }
  return { quoteAsset, quoteSymbol: entry.quoteAssetSymbol ?? undefined };
}

/** Immutable launch identity for display while optional market and wallet reads load. */
export function ethereumFoundationPresentation(entry: CanonicalTokenExploreEntry) {
  return { tokenAddress: entry.tokenAddress, sourceKind: "module-foundation-v1" as const,
    poolId: entry.poolId, ...ethereumPairPresentation(entry),
    symbol: entry.symbol, creator: entry.creatorAddress };
}

const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;
const NATIVE = "0x0000000000000000000000000000000000000000";
// Exact deployed identities from the existing Robinhood quote configuration, never a symbol match.
const ROBINHOOD_USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const same = (a: string | undefined | null, b: string | undefined | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const cleanSymbol = (value: string | null | undefined) => value && value.trim().length <= 32
  && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value) ? value.trim() || null : null;

export function launchModuleDetailsBinding(launch: LaunchPresentationSource): ModuleLaunchDetailsBinding | null {
  if (!["module-native-v1", "module-native-v2", "module-engine-v1"].includes(launch.sourceKind ?? "")
    || !launch.sourceReleaseDigest || !HASH.test(launch.sourceReleaseDigest)
    || !launch.modulePackageIds?.length || launch.modulePackageIds.length > 16
    || launch.modulePackageIds.length !== launch.moduleFamilyIds?.length
    || !launch.modulePackageIds.every(id => HASH.test(id)) || !launch.moduleFamilyIds.every(id => HASH.test(id))) return null;
  return { sourceKind: launch.sourceKind as ModuleLaunchDetailsBinding["sourceKind"], sourceReleaseDigest: launch.sourceReleaseDigest,
    modulePackageIds: launch.modulePackageIds, moduleFamilyIds: launch.moduleFamilyIds };
}

/** Display only: source-bound pair identity and exact selected module revisions, with no routing claim. */
export function launchPresentationDetails(launch: LaunchPresentationSource, chainId: number,
  market?: LaunchPairObservation | null, moduleDetails?: PublicModuleDetails | null) {
  let quote: string | null = null;
  if (chainId === 4663 || chainId === 1 || chainId === 8453) {
    if (launch.poolId && launch.quoteAsset && ADDRESS.test(launch.quoteAsset)) quote = launch.quoteAsset;
    else if (chainId === 4663 && ["module-native-v1", "module-native-v2"].includes(launch.sourceKind ?? "") && launch.poolId) quote = NATIVE;
    else if (launch.launchProjection) {
      const projection = launch.launchProjection;
      const pool = projection.markets.find(item => item.marketId === projection.primaryMarketId);
      const resolve = (ref: { address: string } | { componentId: string }) => "address" in ref ? ref.address
        : projection.components.find(item => item.componentId === ref.componentId)?.expectedAddress;
      if (pool) {
        const currencies = [resolve(pool.currency0), resolve(pool.currency1)];
        if (currencies.some(address => same(address, launch.tokenAddress))) quote = currencies.find(address => !same(address, launch.tokenAddress)) ?? null;
      }
    }
  }
  const observed = market?.quoteAsset && same(market.poolId, launch.poolId) && ADDRESS.test(market.quoteAsset.address)
    && !same(market.quoteAsset.address, launch.tokenAddress) ? market.quoteAsset : null;
  if (!quote && observed) quote = observed.address;
  const knownSymbol = quote === NATIVE ? "ETH" : (chainId === 4663 || chainId === 1) && same(quote, foundationChainProfile(chainId).wrappedEth.address) ? "WETH"
    : chainId === 4663 && same(quote, ROBINHOOD_USDG) ? "USDG" : null;
  const label = knownSymbol ?? (same(launch.quoteAsset, quote) ? cleanSymbol(launch.quoteSymbol) : null)
    ?? (same(observed?.address, quote) ? cleanSymbol(observed?.symbol) : null)
    ?? (quote ? `${quote.slice(0, 6)}…${quote.slice(-4)}` : null);
  const pair = quote && ADDRESS.test(quote) && !same(quote, launch.tokenAddress) && label ? { address: quote, label } : null;
  const binding = chainId === 4663 ? launchModuleDetailsBinding(launch) : null;
  const selected = binding ? moduleDetailsForLaunch(binding, moduleDetails ?? null) : [];
  // Foundation's non-ETH quote is the persisted result of choosing Pair another token at launch.
  const pairedModule = (chainId === 4663 || chainId === 1) && launch.sourceKind === "module-foundation-v1" && pair
    && !same(pair.address, NATIVE) && !same(pair.address, foundationChainProfile(chainId as 1 | 4663).wrappedEth.address);
  const modules = pairedModule ? ["Pair another token"]
    : selected.length && selected.every(item => item.details) ? selected.map(item => item.details!.title)
      : [];
  return { pair, modules, moduleCount: pairedModule ? 1 : selected.length };
}
