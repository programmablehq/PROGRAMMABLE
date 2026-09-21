import type { RobinhoodLaunch } from "./robinhood-launches";
import { moduleDetailsForLaunch, type ModuleLaunchDetailsBinding, type PublicModuleDetails } from "./module-mode/public-details";

export type LaunchPresentationSource = Pick<RobinhoodLaunch, "tokenAddress"> & Partial<Pick<RobinhoodLaunch,
  "sourceKind" | "poolId" | "quoteAsset" | "launchProjection" | "modulePackageIds" | "moduleFamilyIds" | "sourceReleaseDigest">>;
export type LaunchPairObservation = { poolId: string; quoteAsset?: { address: string; symbol: string | null } };

const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;
const NATIVE = "0x0000000000000000000000000000000000000000";
// Exact deployed identities from the existing Robinhood quote configuration, never a symbol match.
const ROBINHOOD_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
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
  if (chainId === 4663) {
    if (["module-foundation-v1", "module-engine-v1"].includes(launch.sourceKind ?? "")
      && launch.poolId && launch.quoteAsset && ADDRESS.test(launch.quoteAsset)) quote = launch.quoteAsset;
    else if (["module-native-v1", "module-native-v2"].includes(launch.sourceKind ?? "") && launch.poolId) quote = NATIVE;
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
  const knownSymbol = quote === NATIVE ? "ETH" : chainId === 4663 && same(quote, ROBINHOOD_WETH) ? "WETH"
    : chainId === 4663 && same(quote, ROBINHOOD_USDG) ? "USDG" : null;
  const label = knownSymbol ?? (same(observed?.address, quote) ? cleanSymbol(observed?.symbol) : null)
    ?? (quote ? `${quote.slice(0, 6)}…${quote.slice(-4)}` : null);
  const pair = quote && ADDRESS.test(quote) && !same(quote, launch.tokenAddress) && label ? { address: quote, label } : null;
  const binding = chainId === 4663 ? launchModuleDetailsBinding(launch) : null;
  const selected = binding ? moduleDetailsForLaunch(binding, moduleDetails ?? null) : [];
  // Foundation's non-ETH quote is the persisted result of choosing Pair another token at launch.
  const pairedModule = chainId === 4663 && launch.sourceKind === "module-foundation-v1" && pair
    && !same(pair.address, NATIVE) && !same(pair.address, ROBINHOOD_WETH);
  const modules = pairedModule ? ["Pair another token"]
    : selected.length && selected.every(item => item.details) ? selected.map(item => item.details!.title)
      : [];
  return { pair, modules, moduleCount: pairedModule ? 1 : selected.length };
}
