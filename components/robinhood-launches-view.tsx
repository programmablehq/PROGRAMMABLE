"use client";

import Link from "next/link";
import { ProfileLaunchRewards } from "@/components/profile-launch-rewards";
import type { LaunchClaimWalletInputV1, LaunchClaimWalletReviewV1 } from "@/lib/custom-launch/claim-handoff-v1";
import type { FoundationProfileLaunch } from "@/lib/profile/module-launches";
import type { Hex } from "viem";
import { liveLaunchObservations } from "@/lib/confirming-launches";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ExploreFilters } from "@/components/explore-filters";
import { ChainMark } from "@/components/chain-mark";
import { exploreIdentityKey } from "@/lib/unified-explore";
import { launchPresentationDetails, type LaunchPresentationSource } from "@/lib/launch-presentation-details";
import { AnimatedMarketCap } from "@/components/animated-market-cap";
import { ETHEREUM_EXPLORE_FILTERS, ETHEREUM_EXPLORE_MODES } from "@/lib/ethereum-explore";
import { useRouteViewChain, type ViewChainId } from "@/components/view-chain";
import { MODULE_TOKEN_FALLBACK_IMAGE, RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";
import { RobinhoodProjectLinks } from "@/components/robinhood-project-links";
import { rememberRobinhoodTokenPresentations } from "@/components/robinhood-presentation-cache";
import { coinAge, coinPairTicker, coinValuation, mergeRobinhoodPresentations, type RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { activeExploreFilterCount, DEFAULT_EXPLORE_FILTERS, ROBINHOOD_EXPLORE_PAGE_SIZE, sameRobinhoodExploreRequest, type RobinhoodExploreFilters, type RobinhoodExploreRequest } from "@/lib/robinhood-explore-filters";
import { isRobinhoodModuleLaunch } from "@/lib/robinhood-launches";
import { isRobinhoodProjectedLaunch } from "@/lib/custom-launch/launch-projection-v1";
import { isPinnedRobinhoodToken } from "@/lib/robinhood-explore-policy";
import styles from "@/components/robinhood-launches-view.module.css";

export type Launch = LaunchPresentationSource & {
  foundationClaim?: FoundationProfileLaunch;
  chainId?: ViewChainId;
  launchProjection?: import("@/lib/custom-launch/launch-plan-v1").LaunchProjectionV1;
  launchId: string;
  tokenAddress: string;
  hookAddress: string | null;
  category?: "classic" | "custom";
  mode?: "classic" | "custom" | "module";
  confirmation?: "confirmed" | "confirming";
  observationExpiresAt?: number;
  creator: string;
  transactionHash: string;
  blockNumber: string;
  launchedAt: string | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
};

type LaunchResponse = {
  account?: string;
  chainId?: ViewChainId;
  scope?: "all";
  status: "ready" | "syncing" | "stale" | "partial" | "unavailable";
  sources?: Record<string, string>;
  updatedAt: string | null;
  items: Launch[];
  presentations: RobinhoodCoinPresentation[];
  page: {
    number: number;
    size: number;
    totalItems: number;
    matchingItems?: number;
    totalPages: number;
    hasMore: boolean;
  };
};

type Request = RobinhoodExploreRequest;
type ExploreScope = ViewChainId | "all";
type Snapshot = { request: Request; data: LaunchResponse; fetchedAt: number };

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const REFRESH_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const ROBINHOOD_WEBSITE_FILTERS: RobinhoodExploreFilters = { ...DEFAULT_EXPLORE_FILTERS, sort: "highest" };

// Public, browser-only navigation state. Nothing is written during server rendering.
const rememberedSnapshots = new Map<ExploreScope | string, { value: Snapshot; savedAt: number }>();
function readRememberedSnapshot(chainId: ExploreScope | string) {
  const rememberedSnapshot = rememberedSnapshots.get(chainId);
  if (typeof window === "undefined" || !rememberedSnapshot || Date.now() - rememberedSnapshot.savedAt >= 300_000) return null;
  const value = rememberedSnapshot.value;
  return { ...value, data: { ...value.data,
    presentations: mergeRobinhoodPresentations([], value.data.presentations).items,
  } };
}
function rememberSnapshot(value: Snapshot) {
  value = { ...value, data: { ...value.data, items: liveLaunchObservations(value.data.items) } };
  if (typeof window !== "undefined") rememberedSnapshots.set(value.data.account ? `profile:${value.data.account.toLowerCase()}` : value.data.scope ?? value.data.chainId!, { value, savedAt: Date.now() });
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 4_096);
}

function isLaunch(value: unknown, chainId: ViewChainId): value is Launch {
  if (!isObject(value)) return false;
  if (chainId === 4663 && isRobinhoodProjectedLaunch(value)) return true;
  return typeof value.launchId === "string" && (chainId === 4663 ? HASH.test(value.launchId) : value.launchId.length > 0 && value.launchId.length <= 256)
    && (chainId !== 1 || value.category === "classic" || value.category === "custom")
    && (value.mode === undefined || value.mode === "classic" || value.mode === "custom" || value.mode === "module")
    && (value.sourceKind === undefined || isRobinhoodModuleLaunch(value))
    && typeof value.tokenAddress === "string" && ADDRESS.test(value.tokenAddress)
    && ((typeof value.hookAddress === "string" && ADDRESS.test(value.hookAddress)) || (value.sourceKind === "module-engine-v1" && value.hookAddress === null))
    && typeof value.creator === "string" && ADDRESS.test(value.creator)
    && typeof value.transactionHash === "string" && HASH.test(value.transactionHash)
    && typeof value.blockNumber === "string" && /^\d+$/.test(value.blockNumber)
    && isDate(value.launchedAt) && isText(value.name) && isText(value.symbol)
    && (value.decimals === null || (Number.isInteger(value.decimals)
      && Number(value.decimals) >= 0 && Number(value.decimals) <= 255));
}

export function readLaunchListResponse(value: unknown, chainId: ExploreScope, account?: string): LaunchResponse {
  if (account && (!isObject(value) || value.account !== account.toLowerCase() || !Array.isArray(value.items)
    || value.items.some(item => !isObject(item) || typeof item.creator !== "string" || item.creator.toLowerCase() !== account.toLowerCase()))) {
    throw new Error("Invalid profile owner");
  }
  const validLaunch = (item: unknown) => chainId === "all"
    ? isObject(item) && (item.chainId === 1 || item.chainId === 4663) && isLaunch(item, item.chainId)
    : isLaunch(item, chainId);
  if (!isObject(value) || (chainId === "all" ? value.scope !== "all" : value.chainId !== chainId)
    || !["ready", "syncing", "stale", "partial", "unavailable"].includes(String(value.status))
    || !isDate(value.updatedAt) || !Array.isArray(value.items)
    || value.items.length > 50 || !value.items.every(validLaunch) || !isObject(value.page)
    || !Array.isArray(value.presentations) || value.presentations.length > 50
    || !value.presentations.every((item) => isObject(item) && typeof item.tokenAddress === "string" && ADDRESS.test(item.tokenAddress)
      && (chainId !== "all" || item.chainId === 1 || item.chainId === 4663))) {
    throw new Error("Invalid launch response");
  }
  const page = value.page;
  if (!Number.isSafeInteger(page.number) || Number(page.number) < 1
    || (page.size !== ROBINHOOD_EXPLORE_PAGE_SIZE && page.size !== 50) || !Number.isSafeInteger(page.totalItems) || Number(page.totalItems) < 0
    || !Number.isSafeInteger(page.totalPages) || Number(page.totalPages) < 0
    || (page.matchingItems !== undefined && (!Number.isSafeInteger(page.matchingItems) || Number(page.matchingItems) < 0 || Number(page.matchingItems) > Number(page.totalItems)))
    || typeof page.hasMore !== "boolean") {
    throw new Error("Invalid launch pagination");
  }
  return value as LaunchResponse;
}

export function RobinhoodLaunchesView({
  embedded = false,
  chainId,
}: Readonly<{ embedded?: boolean; chainId?: ViewChainId }>) {
  const { hydrated, viewChainId } = useRouteViewChain(chainId);

  const selectedChain = chainId ?? viewChainId;
  return <IndexedLaunchList key={selectedChain} chainId={selectedChain} embedded={embedded} enabled={hydrated} />;
}

export function UnifiedLaunchesView({ embedded = false }: { embedded?: boolean }) {
  return <IndexedLaunchList chainId="all" embedded={embedded} enabled />;
}

type ProfileListOptions = {
  account: string;
  launchChainId: ViewChainId;
  enableClaims?: boolean;
  sendWallet?: (input: LaunchClaimWalletInputV1) => Promise<LaunchClaimWalletReviewV1 | Hex>;
  onEthereumClaim?: (token: string) => void;
  onAllRewards?: () => void;
};

export function UnifiedProfileLaunches(props: ProfileListOptions) {
  return <IndexedLaunchList key={props.account.toLowerCase()} chainId="all" embedded enabled profile={props} />;
}

function IndexedLaunchList({ embedded, enabled, chainId, profile }: { embedded: boolean; enabled: boolean; chainId: ExploreScope; profile?: ProfileListOptions }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(!embedded);
  const readEnabled = enabled && (!embedded || inView);
  useEffect(() => {
    if (!embedded || !listRef.current) return;
    if (typeof window.IntersectionObserver !== "function") {
      const frame = window.requestAnimationFrame(() => setInView(true));
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(entries => {
      setInView(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: "160px 0px" });
    observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [embedded]);
  const chainName = chainId === "all" ? "Programmable" : chainId === 4663 ? "Robinhood" : "Ethereum";
  const defaultFilters = profile ? DEFAULT_EXPLORE_FILTERS : chainId !== 1 ? ROBINHOOD_WEBSITE_FILTERS : ETHEREUM_EXPLORE_FILTERS;
  const headingId = useId();
  const searchId = useId();
  const statusId = useId();
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const profileAccount = profile?.account;
  const refreshInterval = profileAccount ? 30_000 : REFRESH_MS;
  const cacheKey = profile ? `profile:${profile.account.toLowerCase()}` : chainId;
  const [initial] = useState(() => readRememberedSnapshot(cacheKey));
  const [search, setSearch] = useState(initial?.request.q ?? "");
  const [request, setRequest] = useState<Request>(initial?.request ?? { page: 1, q: "", ...defaultFilters });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [failedRequest, setFailedRequest] = useState<Request | null>(null);
  const [now, setNow] = useState(Date.now);
  const presentations = new Map((snapshot?.data.presentations ?? []).map((item) => [exploreIdentityKey(item), item]));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const q = search.trim();
      setRequest((current) => current.q === q ? current : { ...current, page: 1, q });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!readEnabled) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let refreshTimer: number | undefined;
    const isVisible = () => document.visibilityState !== "hidden";
    const remembered = readRememberedSnapshot(cacheKey);
    let lastAttemptAt = remembered && sameRobinhoodExploreRequest(remembered.request, request)
      ? remembered.fetchedAt : 0;

    function schedule() {
      window.clearTimeout(refreshTimer);
      if (!disposed && isVisible()) refreshTimer = window.setTimeout(load, Math.max(0, refreshInterval - (Date.now() - lastAttemptAt)));
    }

    async function load() {
      if (disposed || controller || !isVisible()) return;
      const activeController = new AbortController();
      controller = activeController;
      const timeout = window.setTimeout(() => activeController.abort(), REQUEST_TIMEOUT_MS);
      setLoading(true);

      try {
        const query = new URLSearchParams({ page: String(request.page), pageSize: String(ROBINHOOD_EXPLORE_PAGE_SIZE),
          q: request.q, sort: request.sort, mode: request.mode ?? "all" });
        if (profileAccount) query.set("account", profileAccount);
        const endpoint = profileAccount ? "/api/profile/launches" : chainId === "all" ? "/api/explore/launches" : `/api/explore/${chainId === 4663 ? "robinhood" : "ethereum"}`;
        const response = await fetch(`${endpoint}?${query}`, {
          signal: activeController.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("Launch request failed");
        const data = readLaunchListResponse(await response.json(), chainId, profileAccount);
        if (disposed || activeController.signal.aborted) return;
        setSnapshot((current) => {
          const sameRequest = sameRobinhoodExploreRequest(current?.request, request);
          if (sameRequest && current && current.data.items.length > 0
            && data.items.length === 0 && data.status !== "ready") {
            return rememberSnapshot({ request, fetchedAt: Date.now(), data: { ...current.data, status: data.status, sources: data.sources,
              presentations: mergeRobinhoodPresentations(current.data.presentations, null).items,
            } });
          }
          const presentations = mergeRobinhoodPresentations(current?.data.presentations ?? [], data.presentations).items;
          rememberRobinhoodTokenPresentations(presentations.map(item => ({ ...item, chainId: item.chainId ?? (chainId === 1 ? 1 : 4663) })));
          return rememberSnapshot({ request, fetchedAt: Date.now(), data: { ...data,
            presentations,
          } });
        });
        setFailedRequest(null);
        setNow(Date.now());
      } catch {
        if (!disposed) {
          setFailedRequest(request);
          setSnapshot((current) => current ? rememberSnapshot({ ...current, data: { ...current.data,
            presentations: mergeRobinhoodPresentations(current.data.presentations, null).items,
          } }) : null);
        }
      } finally {
        window.clearTimeout(timeout);
        controller = null;
        if (!disposed) {
          lastAttemptAt = Date.now();
          setLoading(false);
          schedule();
        }
      }
    }

    function visibilityChanged() {
      window.clearTimeout(refreshTimer);
      if (isVisible()) schedule();
    }

    if (lastAttemptAt > 0 && Date.now() - lastAttemptAt < refreshInterval) schedule();
    else void load();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [chainId, cacheKey, profileAccount, readEnabled, refreshInterval, request]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = search.trim();
    setRequest((current) => current.page === 1 && current.q === q ? current : { ...current, page: 1, q });
  }

  function clearSearch() {
    setSearch("");
    setRequest((current) => current.page === 1 && current.q === "" ? current : { ...current, page: 1, q: "" });
    searchRef.current?.focus();
  }

  function applyFilters(filters: RobinhoodExploreFilters) {
    setRequest((current) => current.sort === filters.sort && (current.mode ?? "all") === (filters.mode ?? "all")
      ? current : { ...current, ...filters, page: 1 });
  }

  function changePage(page: number) {
    setRequest((current) => current.page === page ? current : { ...current, page });
  }

  const failed = sameRobinhoodExploreRequest(failedRequest, request);
  const sameRequest = sameRobinhoodExploreRequest(snapshot?.request, request);
  const pending = !sameRequest && !failed;
  const data = sameRequest ? snapshot?.data : undefined;
  const pinned = chainId !== 1 ? snapshot?.data.items.find(launch => isPinnedRobinhoodToken(launch.tokenAddress, launch.chainId ?? 4663)) : null;
  const items = liveLaunchObservations(data?.items ?? (pending && pinned ? [pinned] : []), now);
  const hasRows = items.length > 0;
  const updatingSearch = search.trim() !== request.q;
  const hasFilters = activeExploreFilterCount(request) > 0;
  const slots = pending ? Math.max(0, ROBINHOOD_EXPLORE_PAGE_SIZE - items.length) : 0;
  const canPrevious = enabled && !pending && !updatingSearch && Boolean(data && data.page.number > 1);
  const canNext = enabled && !pending && !updatingSearch && Boolean(data?.page.hasMore);
  const Heading = embedded ? "h2" : "h1";
  const StateHeading = embedded ? "h3" : "h2";
  const count = data?.page.matchingItems ?? data?.page.totalItems ?? 0;
  const noMatches = Boolean(data && pinned && count === 0 && (request.q || hasFilters));
  const statusText = pending || (loading && !hasRows) ? "Loading results…" : failed
    ? hasRows ? "Checking for updates automatically." : "Couldn’t load launches. Checking again automatically."
    : data?.status === "stale" || data?.status === "unavailable"
      ? hasRows ? "Checking for updates automatically." : "Couldn’t load launches. Checking again automatically."
      : data?.status === "partial"
        ? "Some launches couldn’t load. Checking for updates automatically."
      : data?.status === "syncing"
        ? "Checking for new launches."
        : updatingSearch ? "Searching…" : "";
  const emptyTitle = loading
    ? `Loading ${chainName} launches`
    : failed || data?.status === "unavailable"
      ? "Launches are temporarily unavailable"
      : (snapshot?.request.q || hasFilters) && (data?.status === "stale" || data?.status === "partial")
        ? "No matching launches in the available index"
      : data?.status === "stale" || data?.status === "partial"
        ? "Launches are temporarily unavailable"
      : data?.status === "syncing"
        ? `Checking ${chainName} launches`
        : snapshot?.request.q || hasFilters ? "No matching launches" : "No launches yet";

  return (
    <div ref={listRef} className={`${styles.page} ${profile ? styles.profilePage : "page-width"}`}>
      <header className={profile ? styles.profileHeading : styles.heading}>
        <Heading data-explore-heading id={headingId} tabIndex={-1}>{profile ? "Launches" : "Explore"}</Heading>
        {profile?.enableClaims ? <div className={styles.profileActions}>
          {profile.onAllRewards ? <button className={styles.rewardsButton} type="button" onClick={profile.onAllRewards}>Claim rewards</button> : null}
          <Link className={styles.launchButton} href={`/launch/modules/foundation?chainId=${profile.launchChainId}`}>Launch a coin</Link>
        </div> : null}
      </header>

      <section className={styles.body} aria-labelledby={headingId}>
        <div className={styles.toolbar} role="group" aria-label={profile ? "Launches controls" : "Explore controls"}>
          <form className={styles.search} role="search" onSubmit={submitSearch}>
            <Search aria-hidden="true" size={18} />
            <label className="sr-only" htmlFor={searchId}>Search {chainName} launches by name, symbol or address</label>
            <input
              id={searchId}
              ref={searchRef}
              name="q"
              aria-controls={listId}
              type="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); clearSearch(); } }}
              aria-describedby={statusId}
            />
            {search ? (
              <button className={styles.clearSearch} type="button" onClick={clearSearch} aria-label="Clear search">
                <X aria-hidden="true" size={16} />
              </button>
            ) : null}
          </form>
          <ExploreFilters value={request} onApply={applyFilters} defaultValue={defaultFilters}
            modeOptions={chainId === 1 ? ETHEREUM_EXPLORE_MODES : undefined}
            sortOptions={chainId === 1 ? [{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }] : undefined} />
          <nav className={styles.pagination} aria-label="Launch pages">
            <button type="button" aria-disabled={!canPrevious} aria-label="Previous page" title="Previous page" aria-controls={listId}
              onClick={() => { if (canPrevious && data) changePage(data.page.number - 1); }}>
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
            <button type="button" aria-disabled={!canNext} aria-label="Next page" title="Next page" aria-controls={listId}
              onClick={() => { if (canNext && data) changePage(data.page.number + 1); }}>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </nav>
        </div>

        <p className="sr-only" id={statusId} role="status">
          {statusText || (data ? `${count} ${count === 1 ? "launch" : "launches"}. Page ${data.page.number} of ${Math.max(1, data.page.totalPages)}.` : null)}
        </p>
        {noMatches && !loading && !failed ? <p className={styles.status}>No matches.</p> : null}

        {hasRows || pending ? (
          <ul className={styles.list} id={listId} aria-label={`${chainName} launches`} aria-busy={pending}>
            {items.map((launch, index) => {
              const launchChainId = launch.chainId ?? (chainId === "all" ? 4663 : chainId);
              const identity = exploreIdentityKey({ ...launch, chainId: launchChainId });
              const details = presentations.get(chainId === "all" ? identity : exploreIdentityKey({ tokenAddress: launch.tokenAddress }));
              const valuation = coinValuation(details?.market);
              const pair = launchPresentationDetails(launch, launchChainId, details?.market).pair;
              const hasAsset = !launch.launchProjection || launch.launchProjection.primaryComponentId !== null;
              // The unified index classifies Ethereum modules from their launch
              // provenance. They do not have Robinhood's source record shape.
              const launchMode = launch.mode ?? (launch.category === "classic" ? "classic" : isRobinhoodModuleLaunch(launch) ? "module" : "custom");
              return (
              <li key={identity} className={styles.item}>
                <article className={styles.row}>
                <Link className={styles.cardLink} href={launch.confirmation === "confirmed"
                  ? `/modules/${launch.tokenAddress}?chainId=${launchChainId}&transaction=${launch.transactionHash}`
                  : `/token/${launch.tokenAddress}${launchChainId === 1 ? "?chain=1" : ""}`}>
                  <RobinhoodCoinArtwork
                    eager={index < 5}
                    imageUrl={details?.imageUrl} loading={loading && !details}
                    fallbackImageUrl={launchMode === "module" ? MODULE_TOKEN_FALLBACK_IMAGE : undefined}
                    className={styles.artwork}
                  />
                  <div className={styles.identity}>
                    <div className={styles.nameRow}>
                      <strong className={styles.name} title={launch.name?.trim() || (launch.launchProjection ? "Unnamed contract" : "Unnamed token")}>{launch.name?.trim() || (launch.launchProjection ? "Unnamed contract" : "Unnamed token")}</strong>
                      {hasAsset ? <span className={styles.symbol} title={pair?.address}>{coinPairTicker(launch.symbol || details?.symbol, pair?.label)}</span> : null}
                    </div>
                    <span className={styles.mode}>{{ classic: "Classic", module: "Module", custom: "Custom" }[launchMode]}
                      <ChainMark chainId={launchChainId} className={styles.chainMark} />
                      {launch.confirmation === "confirming" ? <span className={styles.confirming}>Confirming</span> : null}
                    </span>
                  </div>
                  <div className={styles.cardFooter}>
                    {hasAsset ? <div className={styles.marketCap} title={details?.market ? `Observed ${new Date(details.market.observedAt).toUTCString()}` : "Market data is not available yet"}>
                      <span title={valuation.title}>{valuation.label}</span>
                      {details?.market && valuation.value !== null
                        ? <AnimatedMarketCap metric={{ kind: "usd", value: valuation.value }} replayKey={`${identity}:${details.market.poolId.toLowerCase()}:${valuation.label}`} />
                        : <strong>—</strong>}
                    </div> : null}
                    {launch.launchedAt ? <time className={styles.launched} dateTime={launch.launchedAt} title={`Launched ${new Date(launch.launchedAt).toUTCString()}`}>{coinAge(launch.launchedAt, now)}</time> : null}
                  </div>
                </Link>
                {details?.links.length ? <RobinhoodProjectLinks links={details.links}
                  name={launch.name?.trim() || (hasAsset ? "Token" : "Project")} className={styles.socials} /> : null}
                {profile?.enableClaims ? <ProfileLaunchRewards launch={launch} account={profile.account} chainId={launchChainId} sendWallet={profile.sendWallet} onEthereumClaim={profile.onEthereumClaim} /> : null}
                </article>
              </li>
            );})}
            {Array.from({ length: slots }, (_, index) => <li key={`slot-${index}`}
              className={`${styles.item} ${pending ? styles.skeleton : styles.emptySlot}`} aria-hidden="true">
              <div className={styles.row}>
                <div className={`${styles.artwork} ${styles.skeletonArtwork}`} />
                <div className={styles.identity}>
                  <span className={`${styles.skeletonLine} ${styles.skeletonName}`} />
                  <span className={`${styles.skeletonLine} ${styles.skeletonSymbol}`} />
                  <span className={`${styles.skeletonLine} ${styles.skeletonMode}`} />
                </div>
                <div className={styles.cardFooter}>{chainId !== 1 ? <div className={styles.marketCap}>
                  <span className={`${styles.skeletonLine} ${styles.skeletonCaption}`} />
                  <span className={`${styles.skeletonLine} ${styles.skeletonNumber}`} />
                </div> : null}<span className={`${styles.skeletonLine} ${styles.skeletonAge}`} /></div>
                <div className={styles.socials}>{[0, 1, 2, 3].map(index => <span className={styles.skeletonSocial} key={index} />)}</div>
              </div>
            </li>)}
          </ul>
        ) : (
          <div className={styles.empty} id={listId} aria-busy={loading}>
            <StateHeading>{emptyTitle}</StateHeading>
            <p>{loading || data?.status === "syncing" ? "Verified launches will appear here." : !failed && (snapshot?.request.q || hasFilters) && data?.status !== "unavailable" ? "Try another search or change the filters." : failed || data?.status === "unavailable" || data?.status === "stale" || data?.status === "partial" ? "Try again shortly." : `New ${chainName} launches appear after verification.`}</p>
            {!loading && snapshot?.request.q ? <button className={styles.textButton} type="button" onClick={clearSearch}>Clear search</button> : null}
            {!loading && hasFilters ? <button className={styles.textButton} type="button" onClick={() => applyFilters(defaultFilters)}>Clear filters</button> : null}
          </div>
        )}
      </section>
    </div>
  );
}
