"use client";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import NextImage from "next/image";
import { DeveloperLaunchHistory, parseHistoryPage, parseLaunch, type DeveloperLaunchHistoryProps, type LaunchResource } from "./developer-launch-history";
import { DeveloperUniversalLaunchHistory, parseEntries } from "./developer-universal-launch-history";
import { DeveloperIssue } from "./developer-issue";
import { useLaunchStatusPolling } from "./use-launch-status-polling";
import { launchHistoryRefreshTimeoutMs } from "@/lib/custom-launch-history-timeouts";
import { launchOverviewItem, mergeLaunchOverview, type LaunchOverviewItem, type LaunchOverviewSource } from "@/lib/developer-launch-overview";
import shared from "./developer-api-keys.module.css";
import styles from "./developer-launch-workspace.module.css";
type Props = DeveloperLaunchHistoryProps & {
  openWallet(): void;
  sendUniversalLaunchWalletAction?: ComponentProps<typeof DeveloperUniversalLaunchHistory>["sendWallet"];
};
type HistorySource = LaunchOverviewSource | "base" | "hyperevm" | "elysium";
type HistoryCursors = Partial<Record<HistorySource, string | null>>;
type SelectedLaunch = LaunchOverviewItem & { historicalDetail?: LaunchResource };
type HistoryChain = "all" | "1" | "4663" | "8453" | "999" | "99901";
const sources = ["legacy", "base", "hyperevm", "elysium", "custom_launch_plan_v1", "multi_role_v2"] as const;
// The legacy list covers Ethereum v1–v3 and Robinhood v4.
const sourcesByChain: Record<HistoryChain, readonly HistorySource[]> = {
  all: sources,
  "1": ["legacy"],
  "4663": ["legacy", "custom_launch_plan_v1", "multi_role_v2"],
  "8453": ["base"],
  "999": ["hyperevm"],
  "99901": ["elysium"],
};
export function DeveloperLaunchWorkspace(props: Props) {
  const [items, setItems] = useState<LaunchOverviewItem[]>([]), [selected, setSelected] = useState<SelectedLaunch | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [chain, setChain] = useState<HistoryChain>("all"), [refresh, setRefresh] = useState(0);
  const selectedSources = sourcesByChain[chain];
  const [cursors, setCursors] = useState<HistoryCursors>({});
  const firstPageCursors = useRef<HistoryCursors>({});
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const tokens = useRef({ access: props.getAccessToken, identity: props.getIdentityToken });
  useEffect(() => { tokens.current = { access: props.getAccessToken, identity: props.getIdentityToken }; }, [props.getAccessToken, props.getIdentityToken]);
  const cooldown = useRef(0), inFlight = useRef<AbortController | null>(null), deepLinkDone = useRef(false);
  const read = useCallback(async (source: HistorySource, headers: Headers, signal: AbortSignal, cursor?: string | null, id?: string | null) => {
    const legacy = source === "legacy" || source === "base" || source === "hyperevm" || source === "elysium";
    const query = new URLSearchParams({ walletAddress: props.account });
    if (!legacy) query.set("source", source);
    if (source === "base") query.set("chainId", "8453");
    if (source === "elysium") query.set("chainId", "99901");
    if (source === "hyperevm") query.set("chainId", "999");
    if (cursor) query.set("cursor", cursor);
    if (legacy) {
      if (!id) query.set("limit", "5");
      else if (source === "legacy" && props.initialLaunchChainId === null) query.set("chainId", "1");
      else query.set("version", source === "legacy" ? "v4" : "v3");
    }
    const response = await fetch(`/api/developer/${legacy ? "custom-launches" : "custom-launch-plans"}${id ? `/${encodeURIComponent(id)}` : ""}?${query}`, {
      cache: "no-store", redirect: "error", headers, signal: AbortSignal.any([signal, AbortSignal.timeout(launchHistoryRefreshTimeoutMs)]) });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (id && response.status === 404) return { source, items: [], nextCursor: null };
      const retry = response.headers.get("retry-after");
      if (response.status === 429 || response.status === 503) cooldown.current = Math.max(cooldown.current, Date.now() + Math.min(3600000, /^\d+$/.test(retry ?? "") ? Number(retry) * 1000 : 20000));
      const code = typeof body?.error?.code === "string" && /^[A-Z0-9_]{1,96}$/.test(body.error.code) ? body.error.code : "";
      const requestId = typeof body?.error?.requestId === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(body.error.requestId) ? body.error.requestId : "";
      throw new Error(`HTTP ${response.status} ${code}${requestId ? ` Request ID: ${requestId}` : ""}`);
    }
    const now = Date.now();
    if (legacy) {
      const chainId = source === "base" ? "8453" : source === "hyperevm" ? "999" : source === "elysium" ? "99901" : "1";
      const launch = id ? parseLaunch(body, props.account, chainId) : null;
      const page = id ? launch ? { launches: [launch], nextCursor: null } : null : parseHistoryPage(body, props.account, chainId);
      if (!page) throw new Error("API_RESPONSE_INVALID");
      const historicalDetail = launch?.routeId === "custom-launch:create:v1" || launch?.routeId === "custom-launch:create:v2"
        ? launch : undefined;
      return { source, items: page.launches.map(item => launchOverviewItem(item as unknown as Record<string, unknown>, "legacy", now)), nextCursor: page.nextCursor, historicalDetail };
    }
    const page = parseEntries(body, props.account);
    return { source, items: page.entries.map(item => launchOverviewItem(item.resource, source, now)), nextCursor: page.nextCursor };
  }, [props.account, props.initialLaunchChainId]);
  const load = useCallback(async (pollSignal?: AbortSignal, more?: HistoryCursors) => {
    if (pollSignal?.aborted || (pollSignal && inFlight.current && !inFlight.current.signal.aborted)) return;
    if (pollSignal && Date.now() < cooldown.current) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    const signal = pollSignal ? AbortSignal.any([pollSignal, controller.signal]) : controller.signal;
    inFlight.current = controller;
    try {
      const [access, identity] = await Promise.all([tokens.current.access(), tokens.current.identity()]);
      if (signal.aborted || Date.now() < cooldown.current) return;
      if (!access) throw new Error("401 Wallet session expired");
      const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${access}` });
      if (identity) headers.set("X-Privy-Identity-Token", identity);
      const id = !deepLinkDone.current ? props.initialLaunchId : null;
      const historySources = id ? sourcesByChain[props.initialLaunchChainId ?? "1"] : selectedSources;
      const requestedSources = more ? historySources.filter(source => more[source]) : historySources;
      const failures: string[] = [];
      for (const source of requestedSources) {
        if (signal.aborted) return;
        try {
          const page = await read(source, headers, signal, more?.[source], id);
          if (signal.aborted) return;
          if (page.items.length) setItems(current => mergeLaunchOverview(current, page.items));
          if (!id) {
            // Polling the same first page must preserve progress through older launches.
            if (more || firstPageCursors.current[source] !== page.nextCursor) {
              setCursors(current => ({ ...current, [source]: page.nextCursor }));
            }
            if (!more) firstPageCursors.current[source] = page.nextCursor;
          }
          const match = id && page.items.find(item => item.id === id);
          if (match) {
            deepLinkDone.current = true;
            setSelected({ ...match, historicalDetail: page.historicalDetail });
            setError("");
            return;
          }
        } catch (caught) {
          if (signal.aborted) return;
          failures.push(caught instanceof Error ? caught.message : "API_UNAVAILABLE");
          if (!id) setError(failures.join("; "));
        }
      }
      setError(id && !failures.length ? "404 This launch was not found for the connected wallet" : failures.join("; "));
    } catch (caught) { if (!signal.aborted) setError(caught instanceof Error ? caught.message : "API_UNAVAILABLE"); }
    finally { if (inFlight.current === controller) inFlight.current = null; if (!signal.aborted) setLoading(false); }
  }, [read, props.initialLaunchId, props.initialLaunchChainId, selectedSources]);
  useEffect(() => {
    void load();
    return () => inFlight.current?.abort();
  }, [load, refresh]);
  // The refresh reads one source at a time. Each read keeps its own bounded deadline.
  useLaunchStatusPolling(props.account, !loading && !selected, signal => load(signal), 20_000, false, sources.length * launchHistoryRefreshTimeoutMs);
  function beginHistoryRead() {
    const ready = Date.now() >= cooldown.current;
    setLoading(ready);
    if (ready) setError("");
    return ready;
  }
  function retry() { if (beginHistoryRead()) setRefresh(value => value + 1); }
  function changeChain(next: HistoryChain) {
    beginHistoryRead();
    setChain(next);
  }
  function loadMore() {
    if (beginHistoryRead()) void load(undefined, cursors);
  }
  function open(item: LaunchOverviewItem) {
    deepLinkDone.current = true; setSelected(item); const url = new URL(window.location.href); url.searchParams.set("launchId", item.id); url.searchParams.set("chainId", item.chainId);
    window.history.replaceState(null, "", url); document.getElementById("launch-workspace")?.focus();
  }
  if (selected) return <div id="launch-workspace" tabIndex={-1}>
    <button type="button" className={shared.textLink} onClick={() => { setSelected(null); deepLinkDone.current = true; const url = new URL(window.location.href); url.searchParams.delete("launchId"); window.history.replaceState(null, "", url); retry(); }}>← All launches</button>
    {selected.source === "legacy" ? <DeveloperLaunchHistory {...props} detailOnly historicalDetail={selected.historicalDetail} initialLaunchId={selected.id} initialLaunchVersion={selected.version} initialLaunchChainId={selected.chainId === "1" ? null : selected.chainId} />
      : props.sendUniversalLaunchWalletAction ? <DeveloperUniversalLaunchHistory account={props.account} initialLaunchId={selected.id} sourceOnly={selected.source}
        getAccessToken={props.getAccessToken} getIdentityToken={props.getIdentityToken} sendWallet={props.sendUniversalLaunchWalletAction} openWallet={props.openWallet} /> : <DeveloperIssue message="Wallet connection unavailable" connect={props.openWallet} retry={retry} />}
  </div>;
  const visible = items.filter(item => chain === "all" || item.chainId === chain);
  return <section className={styles.workspace} id="launch-workspace" tabIndex={-1} aria-label="Your launches">
    <div className={styles.toolbar}><label>Chain <select value={chain} onChange={event => changeChain(event.target.value as HistoryChain)}><option value="all">All chains</option><option value="1">Ethereum</option><option value="4663">Robinhood</option><option value="8453">Base</option><option value="999">HyperEVM</option><option value="99901">Elysium</option></select></label>
      <button type="button" className={shared.secondaryButton} onClick={retry} disabled={loading}>Refresh launches</button></div>
    {error ? <DeveloperIssue message={error} retry={retry} connect={props.openWallet} chainId={props.initialLaunchChainId ?? undefined} /> : null}
    <p role="status">{loading ? "Loading your launches…" : visible.length ? `${visible.length} ${visible.length === 1 ? "launch" : "launches"}` : error ? "Some launches could not be loaded. Your saved requests are kept." : "No launch requests for this wallet and chain. Check your launch wallet and chain filter, then refresh."}</p>
    <ul className={styles.list}>{visible.map(item => <li key={`${item.source}:${item.id}`}><button type="button" className={styles.card} onClick={() => open(item)}>
      <span className={styles.image}>{item.image && !failedImages.includes(item.image) ? <NextImage src={item.image} alt="" width={48} height={48} unoptimized referrerPolicy="no-referrer" onError={() => setFailedImages(current => [...current, item.image!])} /> : (item.symbol || item.name).slice(0, 2)}</span>
      <span className={styles.identity}><strong>{item.name}</strong><span>{item.symbol}{item.symbol ? " · " : ""}{item.chainId === "99901" ? "Elysium" : item.chainId === "999" ? "HyperEVM" : item.chainId === "8453" ? "Base" : item.chainId === "1" ? "Ethereum" : "Robinhood"}</span><small>{item.next}</small></span>
      <span className={styles.status}>{item.status}<span aria-hidden="true"> →</span></span>
    </button></li>)}</ul>
    {selectedSources.some(source => cursors[source]) ? <button className={shared.secondaryButton} type="button" disabled={loading} onClick={loadMore}>Load more launches</button> : null}
  </section>;
}
