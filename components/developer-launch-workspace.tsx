"use client";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import NextImage from "next/image";
import { DeveloperLaunchHistory, parseHistoryPage, parseLaunch, type DeveloperLaunchHistoryProps } from "./developer-launch-history";
import { DeveloperUniversalLaunchHistory, parseEntries } from "./developer-universal-launch-history";
import { DeveloperIssue } from "./developer-issue";
import { useLaunchStatusPolling } from "./use-launch-status-polling";
import { launchOverviewItem, mergeLaunchOverview, type LaunchOverviewItem, type LaunchOverviewSource } from "@/lib/developer-launch-overview";
import { settleSequentially } from "@/lib/settle-sequentially";
import shared from "./developer-api-keys.module.css";
import styles from "./developer-launch-workspace.module.css";
type Props = DeveloperLaunchHistoryProps & {
  openWallet(): void;
  sendUniversalLaunchWalletAction?: ComponentProps<typeof DeveloperUniversalLaunchHistory>["sendWallet"];
};
type HistorySource = LaunchOverviewSource | "base";
const sources = ["legacy", "base", "custom_launch_plan_v1", "multi_role_v2"] as const;
export function DeveloperLaunchWorkspace(props: Props) {
  const [items, setItems] = useState<LaunchOverviewItem[]>([]), [selected, setSelected] = useState<LaunchOverviewItem | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [chain, setChain] = useState("all"), [refresh, setRefresh] = useState(0);
  const [cursors, setCursors] = useState<Partial<Record<HistorySource, string | null>>>({});
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const tokens = useRef({ access: props.getAccessToken, identity: props.getIdentityToken });
  useEffect(() => { tokens.current = { access: props.getAccessToken, identity: props.getIdentityToken }; }, [props.getAccessToken, props.getIdentityToken]);
  const cooldown = useRef(0), inFlight = useRef<AbortSignal | null>(null), deepLinkDone = useRef(false);
  const read = useCallback(async (source: HistorySource, headers: Headers, signal: AbortSignal, cursor?: string | null, id?: string | null) => {
    const legacy = source === "legacy" || source === "base";
    const query = new URLSearchParams({ walletAddress: props.account });
    if (!legacy) query.set("source", source);
    if (source === "base") query.set("chainId", "8453");
    if (cursor) query.set("cursor", cursor);
    if (legacy) query.set(id ? "version" : "limit", id ? source !== "base" && props.initialLaunchChainId === "4663" ? "v4" : "v3" : "5");
    const response = await fetch(`/api/developer/${legacy ? "custom-launches" : "custom-launch-plans"}${id ? `/${encodeURIComponent(id)}` : ""}?${query}`, {
      cache: "no-store", redirect: "error", headers, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
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
      const launch = id ? parseLaunch(body, props.account) : null;
      const page = id ? launch ? { launches: [launch], nextCursor: null } : null : parseHistoryPage(body, props.account);
      if (!page) throw new Error("API_RESPONSE_INVALID");
      return { source, items: page.launches.map(item => launchOverviewItem(item as unknown as Record<string, unknown>, "legacy", now)), nextCursor: page.nextCursor };
    }
    const page = parseEntries(body, props.account);
    return { source, items: page.entries.map(item => launchOverviewItem(item.resource, source, now)), nextCursor: page.nextCursor };
  }, [props.account, props.initialLaunchChainId]);
  const load = useCallback(async (signal: AbortSignal, more?: Partial<Record<HistorySource, string | null>>) => {
    if (inFlight.current && !inFlight.current.aborted || Date.now() < cooldown.current) return;
    inFlight.current = signal;
    try {
      const [access, identity] = await Promise.all([tokens.current.access(), tokens.current.identity()]);
      if (!access) throw new Error("401 Wallet session expired");
      const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${access}` });
      if (identity) headers.set("X-Privy-Identity-Token", identity);
      const id = !deepLinkDone.current ? props.initialLaunchId : null;
      const requestedSources = sources.filter(source => (!more || more[source]) && (!id || (props.initialLaunchChainId === "8453"
        ? source === "base" : source !== "base" && (props.initialLaunchChainId !== null || source === "legacy"))));
      const results = await settleSequentially(requestedSources, source => read(source, headers, signal, more?.[source], id));
      if (signal.aborted) return;
      const successful = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      const found = successful.flatMap(result => result.items);
      setItems(current => mergeLaunchOverview(current, found));
      setCursors(current => ({ ...current, ...Object.fromEntries(successful.map(result => [result.source, result.nextCursor])) }));
      const failures = results.flatMap(result => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "API_UNAVAILABLE"] : []);
      setError(failures.join("; "));
      if (id) {
        const match = found.find(item => item.id === id);
        if (match) { setSelected(match); deepLinkDone.current = true; }
        else if (!failures.length) setError("404 This launch was not found for the connected wallet");
      }
    } catch (caught) { if (!signal.aborted) setError(caught instanceof Error ? caught.message : "API_UNAVAILABLE"); }
    finally { if (inFlight.current === signal) inFlight.current = null; if (!signal.aborted) setLoading(false); }
  }, [read, props.initialLaunchId, props.initialLaunchChainId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refresh]);
  useLaunchStatusPolling(props.account, !loading && !selected, signal => load(signal));
  function retry() { setRefresh(value => value + 1); }
  function open(item: LaunchOverviewItem) {
    deepLinkDone.current = true; setSelected(item); const url = new URL(window.location.href); url.searchParams.set("launchId", item.id); url.searchParams.set("chainId", item.chainId);
    window.history.replaceState(null, "", url); document.getElementById("launch-workspace")?.focus();
  }
  if (selected) return <div id="launch-workspace" tabIndex={-1}>
    <button type="button" className={shared.textLink} onClick={() => { setSelected(null); deepLinkDone.current = true; const url = new URL(window.location.href); url.searchParams.delete("launchId"); window.history.replaceState(null, "", url); retry(); }}>← All launches</button>
    {selected.source === "legacy" ? <DeveloperLaunchHistory {...props} detailOnly initialLaunchId={selected.id} initialLaunchVersion={selected.version} initialLaunchChainId={selected.chainId === "1" ? null : selected.chainId} />
      : props.sendUniversalLaunchWalletAction ? <DeveloperUniversalLaunchHistory account={props.account} initialLaunchId={selected.id} sourceOnly={selected.source}
        getAccessToken={props.getAccessToken} getIdentityToken={props.getIdentityToken} sendWallet={props.sendUniversalLaunchWalletAction} openWallet={props.openWallet} /> : <DeveloperIssue message="Wallet connection unavailable" connect={props.openWallet} retry={retry} />}
  </div>;
  const visible = items.filter(item => chain === "all" || item.chainId === chain);
  return <section className={styles.workspace} id="launch-workspace" tabIndex={-1} aria-label="Your launches">
    <div className={styles.toolbar}><label>Chain <select value={chain} onChange={event => setChain(event.target.value)}><option value="all">All chains</option><option value="1">Ethereum</option><option value="4663">Robinhood</option><option value="8453">Base</option></select></label>
      <button type="button" className={shared.secondaryButton} onClick={retry} disabled={loading}>Refresh launches</button></div>
    {error ? <DeveloperIssue message={error} retry={retry} connect={props.openWallet} /> : null}
    <p role="status">{loading ? "Loading your launches…" : visible.length ? `${visible.length} ${visible.length === 1 ? "launch" : "launches"}` : error ? "Some launches could not be loaded. Your saved requests are kept." : "No launch requests yet."}</p>
    <ul className={styles.list}>{visible.map(item => <li key={`${item.source}:${item.id}`}><button type="button" className={styles.card} onClick={() => open(item)}>
      <span className={styles.image}>{item.image && !failedImages.includes(item.image) ? <NextImage src={item.image} alt="" width={48} height={48} unoptimized referrerPolicy="no-referrer" onError={() => setFailedImages(current => [...current, item.image!])} /> : (item.symbol || item.name).slice(0, 2)}</span>
      <span className={styles.identity}><strong>{item.name}</strong><span>{item.symbol}{item.symbol ? " · " : ""}{item.chainId === "8453" ? "Base" : item.chainId === "1" ? "Ethereum" : "Robinhood"}</span><small>{item.next}</small></span>
      <span className={styles.status}>{item.status}<span aria-hidden="true"> →</span></span>
    </button></li>)}</ul>
    {Object.values(cursors).some(Boolean) ? <button className={shared.secondaryButton} type="button" disabled={loading} onClick={() => { const controller = new AbortController(); setLoading(true); void load(controller.signal, cursors).finally(() => setLoading(false)); }}>Load more launches</button> : null}
  </section>;
}
