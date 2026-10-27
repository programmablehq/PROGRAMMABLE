"use client";

import Link from "next/link";
import { LaunchShareLink } from "./launch-share-link";
import { FomoTeamTagButton } from "./fomo-team-tag";
import { ProfileLaunchRewards } from "./profile-launch-rewards";
import type { LaunchClaimWalletInputV1, LaunchClaimWalletReviewV1 } from "@/lib/custom-launch/claim-handoff-v1";
import type { FoundationProfileLaunch } from "@/lib/profile/module-launches";
import type { Hex } from "viem";
import { liveLaunchObservations } from "@/lib/confirming-launches";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createSharedRequestPool, type SharedRead } from "@/lib/shared-request-pool";

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
import { activeExploreFilterCount, DEFAULT_EXPLORE_FILTERS, LAUNCH_CHAIN_OPTIONS, ROBINHOOD_EXPLORE_PAGE_SIZE, sameRobinhoodExploreRequest, type RobinhoodExploreFilters, type RobinhoodExploreRequest } from "@/lib/robinhood-explore-filters";
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
const REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const ROBINHOOD_WEBSITE_FILTERS: RobinhoodExploreFilters = { ...DEFAULT_EXPLORE_FILTERS, sort: "highest" };
const PAGE_SNAPSHOT_TTL_MS = 300_000;
const MAX_PAGE_SNAPSHOTS = 24;
const acquireRequest = createSharedRequestPool<LaunchResponse>(REQUEST_TIMEOUT_MS);

// Public, browser-only navigation state. Nothing is written during server rendering.
const rememberedSnapshots = new Map<ExploreScope | string, { value: Snapshot; savedAt: number }>();
const rememberedPageSnapshots = new Map<string, { value: Snapshot; savedAt: number }>();

function snapshotScope(value: Snapshot) {
  return value.data.account ? `profile:${value.data.account.toLowerCase()}` : value.data.scope ?? value.data.chainId!;
}

function snapshotKey(scope: ExploreScope | string, request: Request) {
  return `${scope}\u0000${request.page}\u0000${request.q}\u0000${request.sort}\u0000${request.mode ?? "all"}\u0000${request.chain ?? "all"}`;
}

function clientSnapshot(value: Snapshot) {
  return { ...value, data: { ...value.data,
    presentations: mergeRobinhoodPresentations([], value.data.presentations).items,
  } };
}

function readPageSnapshot(scope: ExploreScope | string, request: Request, now = Date.now()) {
  if (typeof window === "undefined") return null;
  const key = snapshotKey(scope, request);
  const remembered = rememberedPageSnapshots.get(key);
  if (!remembered || now - remembered.savedAt >= PAGE_SNAPSHOT_TTL_MS) {
    if (remembered) rememberedPageSnapshots.delete(key);
    return null;
  }
  return clientSnapshot(remembered.value);
}

function readRememberedSnapshot(chainId: ExploreScope | string) {
  const rememberedSnapshot = rememberedSnapshots.get(chainId);
  if (typeof window === "undefined" || !rememberedSnapshot || Date.now() - rememberedSnapshot.savedAt >= 300_000) return null;
  return clientSnapshot(rememberedSnapshot.value);
}

function rememberPageSnapshot(value: Snapshot) {
  value = { ...value, data: { ...value.data, items: liveLaunchObservations(value.data.items) } };
  if (typeof window !== "undefined") {
    rememberedPageSnapshots.set(snapshotKey(snapshotScope(value), value.request), { value, savedAt: Date.now() });
    while (rememberedPageSnapshots.size > MAX_PAGE_SNAPSHOTS) {
      const oldest = rememberedPageSnapshots.keys().next().value;
      if (oldest === undefined) break;
      rememberedPageSnapshots.delete(oldest);
    }
  }
  return value;
}

function rememberSnapshot(value: Snapshot) {
  value = { ...value, data: { ...value.data, items: liveLaunchObservations(value.data.items) } };
  if (typeof window !== "undefined") {
    const scope = snapshotScope(value);
    const entry = { value, savedAt: Date.now() };
    rememberedSnapshots.set(scope, entry);
    rememberedPageSnapshots.set(snapshotKey(scope, value.request), entry);
    while (rememberedPageSnapshots.size > MAX_PAGE_SNAPSHOTS) {
      const oldest = rememberedPageSnapshots.keys().next().value;
      if (oldest === undefined) break;
      rememberedPageSnapshots.delete(oldest);
    }
  }
  return value;
}

function exploreRequestUrl(chainId: ExploreScope, profileAccount: string | undefined, request: Request) {
  const query = new URLSearchParams({ page: String(request.page), pageSize: String(ROBINHOOD_EXPLORE_PAGE_SIZE),
    q: request.q, sort: request.sort, mode: request.mode ?? "all" });
  // Make the combined catalog's cache identity explicit. This lets a
  // provider recovery replace an older degraded all-chain response
  // without adding a per-request nonce or bypassing shared caching.
  if (chainId === "all" && !profileAccount && (!request.chain || request.chain === "all")) query.set("chain", "all");
  if (chainId === "all" && request.chain && request.chain !== "all") query.set("chain", String(request.chain));
  if (profileAccount) query.set("account", profileAccount);
  const endpoint = profileAccount ? "/api/profile/launches" : chainId === "all" ? "/api/explore/launches" : `/api/explore/${chainId === 8453 ? "base" : chainId === 4663 ? "robinhood" : "ethereum"}`;
  return `${endpoint}?${query}`;
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

function isKnownCustomSourceKind(value: unknown): value is "custom-ai-v1" {
  return value === "custom-ai-v1";
}

function isLaunch(value: unknown, chainId: ViewChainId): value is Launch {
  if (!isObject(value)) return false;
  if (chainId === 4663 && isRobinhoodProjectedLaunch(value)) return true;
  return typeof value.launchId === "string" && (chainId === 4663 ? HASH.test(value.launchId) : value.launchId.length > 0 && value.launchId.length <= 256)
    && (chainId !== 1 || value.category === "classic" || value.category === "custom")
    && (value.mode === undefined || value.mode === "classic" || value.mode === "custom" || value.mode === "module")
    && (value.sourceKind === undefined || isKnownCustomSourceKind(value.sourceKind) || isRobinhoodModuleLaunch(value))
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
    ? isObject(item) && (item.chainId === 1 || item.chainId === 4663 || item.chainId === 8453) && isLaunch(item, item.chainId)
    : isLaunch(item, chainId);
  if (!isObject(value) || (chainId === "all" ? value.scope !== "all" : value.chainId !== chainId)
    || !["ready", "syncing", "stale", "partial", "unavailable"].includes(String(value.status))
    || !isDate(value.updatedAt) || !Array.isArray(value.items)
    || value.items.length > 50 || !value.items.every(validLaunch) || !isObject(value.page)
    || !Array.isArray(value.presentations) || value.presentations.length > 50
    || !value.presentations.every((item) => isObject(item) && typeof item.tokenAddress === "string" && ADDRESS.test(item.tokenAddress)
      && (chainId !== "all" || item.chainId === 1 || item.chainId === 4663 || item.chainId === 8453))) {
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

function acquireLaunchRead(chainId: ExploreScope, account: string | undefined, request: Request) {
  const url = exploreRequestUrl(chainId, account, request);
  return acquireRequest(url, async signal => {
    const response = await fetch(url, { signal, cache: account ? "no-store" : "default", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Launch request failed");
    const data = readLaunchListResponse(await response.json(), chainId, account);
    signal.throwIfAborted();
    const selectedChain = request.chain ?? "all";
    if (data.page.size !== ROBINHOOD_EXPLORE_PAGE_SIZE
      || data.page.number !== Math.min(request.page, Math.max(1, data.page.totalPages))
      || chainId === "all" && selectedChain !== "all" && data.items.some(item => item.chainId !== selectedChain)) {
      throw new Error("Launch response differs from the selected page or chain");
    }
    return data;
  });
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
  const chainName = chainId === "all" ? "Programmable" : chainId === 8453 ? "Base" : chainId === 4663 ? "Robinhood" : "Ethereum";
  const defaultFilters = profile ? DEFAULT_EXPLORE_FILTERS : chainId !== 1 && chainId !== 8453 ? ROBINHOOD_WEBSITE_FILTERS : ETHEREUM_EXPLORE_FILTERS;
  const headingId = useId();
  const searchId = useId();
  const statusId = useId();
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const profileAccount = profile?.account;
  const refreshInterval = profileAccount ? 30_000 : REFRESH_MS;
  const cacheKey = profile ? `profile:${profile.account.toLowerCase()}` : chainId;
  const defaultRequest = { page: 1, q: "", ...defaultFilters };
  const [initial] = useState(() => readRememberedSnapshot(cacheKey) ?? readPageSnapshot(cacheKey, defaultRequest));
  const [search, setSearch] = useState(initial?.request.q ?? "");
  const [request, setRequest] = useState<Request>(initial?.request ?? defaultRequest);
  const requestRef = useRef(request);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [failedRequest, setFailedRequest] = useState<Request | null>(null);
  const [now, setNow] = useState(Date.now);
  const prefetchingRequests = useRef(new Map<string, SharedRead<LaunchResponse>>());
  const presentations = new Map((snapshot?.data.presentations ?? []).map((item) => [exploreIdentityKey(item), item]));

  const navigate = useCallback((update: (current: Request) => Request) => {
    const next = update(requestRef.current);
    if (sameRobinhoodExploreRequest(requestRef.current, next)) return;
    requestRef.current = next;
    const cached = readPageSnapshot(cacheKey, next);
    if (cached) setSnapshot(cached);
    setFailedRequest(null);
    setLoading(!cached);
    setNow(Date.now());
    setRequest(next);
  }, [cacheKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const q = search.trim();
      navigate(current => current.q === q ? current : { ...current, page: 1, q });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, navigate]);

  useEffect(() => {
    if (!readEnabled) return;
    let disposed = false;
    let active: SharedRead<LaunchResponse> | null = null;
    let refreshTimer: number | undefined;
    const isVisible = () => document.visibilityState !== "hidden";
    const remembered = readPageSnapshot(cacheKey, request) ?? readRememberedSnapshot(cacheKey);
    let lastAttemptAt = remembered && sameRobinhoodExploreRequest(remembered.request, request)
      ? remembered.fetchedAt : 0;

    function schedule() {
      window.clearTimeout(refreshTimer);
      if (!disposed && isVisible()) refreshTimer = window.setTimeout(load, Math.max(0, refreshInterval - (Date.now() - lastAttemptAt)));
    }

    function releasePrefetches() {
      for (const read of prefetchingRequests.current.values()) read.release();
      prefetchingRequests.current.clear();
    }

    async function load() {
      if (disposed || active || !isVisible()) return;
      const read = acquireLaunchRead(chainId, profileAccount, request);
      active = read;
      setLoading(true);

      try {
        const data = await read.promise;
        if (disposed || active !== read) return;
        setSnapshot((current) => {
          const sameRequest = sameRobinhoodExploreRequest(current?.request, request);
          if (sameRequest && current && current.data.items.length > 0
            && data.items.length === 0 && data.status !== "ready") {
            return rememberSnapshot({ request, fetchedAt: Date.now(), data: { ...current.data, status: data.status, sources: data.sources,
              presentations: mergeRobinhoodPresentations(current.data.presentations, null).items,
            } });
          }
          const presentations = mergeRobinhoodPresentations(current?.data.presentations ?? [], data.presentations).items;
          rememberRobinhoodTokenPresentations(presentations.map(item => ({ ...item, chainId: item.chainId ?? (chainId === 8453 ? 8453 : chainId === 1 ? 1 : 4663) })));
          return rememberSnapshot({ request, fetchedAt: Date.now(), data: { ...data,
            presentations,
          } });
        });
        setFailedRequest(null);
        setNow(Date.now());
      } catch {
        if (!disposed && active === read) {
          setFailedRequest(request);
          setSnapshot((current) => current ? rememberSnapshot({ ...current, data: { ...current.data,
            presentations: mergeRobinhoodPresentations(current.data.presentations, null).items,
          } }) : null);
        }
      } finally {
        read.release();
        if (!disposed && active === read) {
          active = null;
          lastAttemptAt = Date.now();
          setLoading(false);
          schedule();
        }
      }
    }

    function visibilityChanged() {
      window.clearTimeout(refreshTimer);
      if (isVisible()) schedule();
      else {
        active?.release();
        active = null;
        releasePrefetches();
        setLoading(false);
      }
    }

    if (lastAttemptAt > 0 && Date.now() - lastAttemptAt < refreshInterval) schedule();
    else void load();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      disposed = true;
      active?.release();
      active = null;
      releasePrefetches();
      window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [chainId, cacheKey, profileAccount, readEnabled, refreshInterval, request]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = search.trim();
    navigate(current => current.page === 1 && current.q === q ? current : { ...current, page: 1, q });
  }

  function clearSearch() {
    setSearch("");
    navigate(current => current.page === 1 && current.q === "" ? current : { ...current, page: 1, q: "" });
    searchRef.current?.focus();
  }

  function applyFilters(filters: RobinhoodExploreFilters) {
    navigate(current => ({ ...current, sort: filters.sort, mode: filters.mode ?? "all", chain: filters.chain ?? "all", page: 1 }));
  }

  function changePage(page: number) {
    navigate(current => ({ ...current, page }));
  }

  const failed = sameRobinhoodExploreRequest(failedRequest, request);
  const sameRequest = sameRobinhoodExploreRequest(snapshot?.request, request);
  const pending = !sameRequest && !failed;
  const data = sameRequest ? snapshot?.data : undefined;
  // Keep existing rows during refresh, but never label a different page or
  // filter's rows as the newly selected result. Cached navigation is immediate.
  const displayedData = data;
  const displayChain = request.chain && request.chain !== "all" ? request.chain : null;
  const displayedItems = displayedData?.items.filter(launch => displayChain === null || (launch.chainId ?? 4663) === displayChain);
  const pinned = chainId !== 1 && (request.chain === undefined || request.chain === "all" || request.chain === 4663)
    ? snapshot?.data.items.find(launch => isPinnedRobinhoodToken(launch.tokenAddress, launch.chainId ?? 4663)) : null;
  const items = liveLaunchObservations(displayedItems ?? (pending && pinned ? [pinned] : []), now);
  const hasRows = items.length > 0;
  const updatingSearch = search.trim() !== request.q;
  const hasFilters = activeExploreFilterCount(request) > 0;
  const slots = pending && !profile ? Math.max(0, ROBINHOOD_EXPLORE_PAGE_SIZE - items.length) : 0;
  const sameCatalog = snapshot && sameRobinhoodExploreRequest({ ...snapshot.request, page: request.page }, request);
  const pageInfo = data?.page ?? (sameCatalog ? snapshot.data.page : undefined);
  const pageNumber = data?.page.number ?? request.page;
  const canPrevious = enabled && !updatingSearch && pageNumber > 1;
  const canNext = enabled && !updatingSearch && Boolean(pageInfo && pageNumber < pageInfo.totalPages);

  function prefetchPage(page: number) {
    if (profileAccount || !data?.page.hasMore || page < 1) return;
    const next = { ...request, page };
    const key = snapshotKey(cacheKey, next);
    if (readPageSnapshot(cacheKey, next) || prefetchingRequests.current.has(key)) return;
    const read = acquireLaunchRead(chainId, profileAccount, next);
    prefetchingRequests.current.set(key, read);
    void read.promise.then(prefetched => {
      rememberPageSnapshot({ request: next, fetchedAt: Date.now(), data: prefetched });
    }).catch(() => {
      // Prefetch is an optimization. The normal page request remains authoritative.
    }).finally(() => {
      read.release();
      if (prefetchingRequests.current.get(key) === read) prefetchingRequests.current.delete(key);
    });
  }
  const Heading = embedded ? "h2" : "h1";
  const StateHeading = embedded ? "h3" : "h2";
  const count = displayedData?.page.matchingItems ?? displayedData?.page.totalItems ?? 0;
  const noMatches = Boolean(data && pinned && count === 0 && (request.q || hasFilters));
  const statusText = pending ? hasRows ? "Updating results…" : "Loading results…" : loading && !hasRows ? "Loading results…" : failed
    ? hasRows ? "Checking for updates automatically." : "Couldn’t load launches. Checking again automatically."
    : displayedData?.status === "stale" || displayedData?.status === "unavailable"
      ? hasRows ? "Checking for updates automatically." : "Couldn’t load launches. Checking again automatically."
      : displayedData?.status === "partial"
        ? "Some launches couldn’t load. Checking for updates automatically."
      : displayedData?.status === "syncing"
        ? "Checking for new launches."
        : updatingSearch ? "Searching…" : "";
  const emptyTitle = loading
    ? `Loading ${chainName} launches`
    : failed || displayedData?.status === "unavailable"
      ? "Launches are temporarily unavailable"
      : (snapshot?.request.q || hasFilters) && (displayedData?.status === "stale" || displayedData?.status === "partial")
        ? "No matching launches in the available index"
      : displayedData?.status === "stale" || displayedData?.status === "partial"
        ? "Launches are temporarily unavailable"
      : displayedData?.status === "syncing"
        ? `Checking ${chainName} launches`
        : snapshot?.request.q || hasFilters ? "No matching launches" : "No launches yet";

  return (
    <div ref={listRef} className={`${styles.page} ${profile ? styles.profilePage : "page-width"}`}>
      <header className={profile ? styles.profileHeading : styles.heading}>
        <Heading data-explore-heading id={headingId} tabIndex={-1}>{profile ? "Launches" : "Explore"}</Heading>
        {profile?.enableClaims && profile.onAllRewards ? (
          <button type="button" className={styles.rewardsButton} onClick={profile.onAllRewards}>
            Claim rewards
          </button>
        ) : null}
      </header>

      <section className={styles.body} aria-labelledby={headingId}>
        <div className={styles.toolbar} role="group" aria-label={profile ? "Launches controls" : "Explore controls"}>
          {!profile ? <><form className={styles.search} role="search" onSubmit={submitSearch}>
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
            chainOptions={chainId === "all" ? LAUNCH_CHAIN_OPTIONS : undefined}
            modeOptions={chainId === 8453 ? ETHEREUM_EXPLORE_MODES.filter(option => option.value !== "classic") : chainId === 1 ? ETHEREUM_EXPLORE_MODES : undefined}
            sortOptions={chainId === 1 || chainId === 8453 ? [{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }] : undefined} /></> : null}
          <nav className={styles.pagination} aria-label="Launch pages">
            <button type="button" aria-disabled={!canPrevious} aria-label="Previous page" title="Previous page" aria-controls={listId}
              onClick={() => { if (canPrevious) changePage(pageNumber - 1); }}>
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
            <button type="button" aria-disabled={!canNext} aria-label="Next page" title="Next page" aria-controls={listId}
              onPointerEnter={() => { if (canNext && data) prefetchPage(data.page.number + 1); }}
              onFocus={() => { if (canNext && data) prefetchPage(data.page.number + 1); }}
              onClick={() => { if (canNext) changePage(pageNumber + 1); }}>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </nav>
        </div>

        <p className="sr-only" id={statusId} role="status">
          {statusText || (data ? `${count} ${count === 1 ? "launch" : "launches"}. Page ${data.page.number} of ${Math.max(1, data.page.totalPages)}.` : null)}
        </p>
        {noMatches && !loading && !failed ? <p className={styles.status}>No matches.</p> : null}

        {profile && pending && !hasRows ? <p className={styles.profileLoading}>Loading launches…</p> : hasRows || pending ? (
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
                <Link className={styles.cardLink} prefetch={false} href={launch.confirmation === "confirmed"
                  ? `/modules/${launch.tokenAddress}?chainId=${launchChainId}&transaction=${launch.transactionHash}`
                  : `/token/${launch.tokenAddress}${launchChainId === 4663 ? "" : `?chain=${launchChainId}`}`}>
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
                    </span>
                  </div>
                  <div className={styles.cardFooter}>
                    {hasAsset ? <div className={styles.marketCap} title={details?.market ? `Observed ${new Date(details.market.observedAt).toUTCString()}` : "Market data is temporarily unavailable; the launch remains indexed"}>
                      <span title={valuation.title}>{valuation.label}</span>
                      {details?.market && valuation.value !== null
                        ? <AnimatedMarketCap metric={{ kind: "usd", value: valuation.value }} replayKey={`${identity}:${details.market.poolId.toLowerCase()}:${valuation.label}`} />
                        : <strong className={styles.marketUnavailable}>Unavailable</strong>}
                    </div> : null}
                    {launch.launchedAt ? <time className={styles.launched} dateTime={launch.launchedAt} title={`Launched ${new Date(launch.launchedAt).toUTCString()}`}>{coinAge(launch.launchedAt, now)}</time> : null}
                  </div>
                </Link>
                {details?.links.length ? <RobinhoodProjectLinks links={details.links}
                  name={launch.name?.trim() || (hasAsset ? "Token" : "Project")} className={styles.socials} /> : null}
                {profile?.enableClaims && launchChainId !== 8453 && profile.account.toLowerCase() === launch.creator.toLowerCase() ? <div className={styles.profileCardActions}>
                  <div className={styles.profileCardRewards}><ProfileLaunchRewards launch={launch} account={profile.account} chainId={launchChainId}
                    sendWallet={profile.sendWallet} onEthereumClaim={profile.onEthereumClaim} /></div>
                  <FomoTeamTagButton name={launch.name?.trim() || "your coin"} />
                </div> : null}
                {hasAsset && profile?.enableClaims && profile.account.toLowerCase() === launch.creator.toLowerCase()
                  ? <LaunchShareLink href={`/token/${launch.tokenAddress}?chain=${launchChainId}`} /> : null}
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
            <p>{loading || displayedData?.status === "syncing" ? "Indexed launches will appear here." : !failed && (snapshot?.request.q || hasFilters) && displayedData?.status !== "unavailable" ? "Try another search or change the filters." : failed || displayedData?.status === "unavailable" || displayedData?.status === "stale" || displayedData?.status === "partial" ? "Try again shortly." : `New ${chainName} launches appear after indexing.`}</p>
            {!loading && snapshot?.request.q ? <button className={styles.textButton} type="button" onClick={clearSearch}>Clear search</button> : null}
            {!loading && hasFilters ? <button className={styles.textButton} type="button" onClick={() => applyFilters(defaultFilters)}>Clear filters</button> : null}
          </div>
        )}
      </section>
    </div>
  );
}
