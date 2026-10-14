"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "./wallet-provider";
import { isWebsiteAdminWallet } from "@/lib/admin-access";
import { parseCustomLaunchReview } from "@/lib/custom-launch-review";
import { buildOperationsRows, describeStoredLaunchStatus, operationTokenHref, reviewOperations, type OperationsReview, type OperationsRow, type OperationsSnapshot, type ReviewListView } from "@/lib/launch-operations";
import styles from "./launch-operations.module.css";

type Diagnostic = { status: string; next: string };
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Not observed";
const chainName = (chain: number) => chain === 1 ? "Ethereum" : "Robinhood";

export function LaunchOperations() {
  const { authReady, authenticated, connecting, openWallet, wallet } = useWallet();
  const account = authenticated && isWebsiteAdminWallet(wallet?.account) ? wallet?.account : null;
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Ethereum & Robinhood</p><h1>Launch overview</h1><p>Reviews, launch progress and indexing in one place.</p></div>
      <nav aria-label="Administration"><Link href="/admin/custom-launch-reviews">Launch reviews</Link><Link href="/admin/modules">Module reviews</Link><Link href="/admin/partners">Partner access</Link></nav></header>
    {account ? <AccountOperations key={account} account={account} /> : <section className={styles.panel}>
      <h2>Admin access</h2><p>{!authReady ? "Loading your session…" : authenticated ? "Connect an authorized admin wallet." : "Sign in with your admin wallet to see the overview."}</p>
      <button disabled={!authReady || connecting} onClick={() => openWallet()}>Connect wallet</button></section>}
  </main>;
}

function AccountOperations({ account }: { account: string }) {
  const { getAccessToken, getIdentityToken } = useWallet();
  const [reviews, setReviews] = useState<OperationsReview[] | null>(null);
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [errors, setErrors] = useState<string[]>([]), [busy, setBusy] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string | null>(null), [now, setNow] = useState(Date.now());
  const [chain, setChain] = useState("all"), [group, setGroup] = useState("all"), [query, setQuery] = useState("");
  const [view, setView] = useState<ReviewListView>("current");
  const [limit, setLimit] = useState(25), [diagnostics, setDiagnostics] = useState<Record<string, Diagnostic>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const active = useRef(true), inFlight = useRef<AbortController | null>(null), diagnosticFlight = useRef(false);
  const requestHeaders = useCallback(async () => {
    const [access, identity] = await Promise.all([getAccessToken(), getIdentityToken()]);
    if (!access) throw new Error("Reconnect your admin wallet.");
    return { Authorization: `Bearer ${access}`, ...(identity ? { "X-Privy-Identity-Token": identity } : {}) };
  }, [getAccessToken, getIdentityToken]);
  const load = useCallback(async () => {
    if (inFlight.current && !inFlight.current.signal.aborted) return;
    const controller = new AbortController();
    const signal = controller.signal;
    inFlight.current = controller;
    setBusy(true);
    try {
      const headers = await requestHeaders();
      const params = new URLSearchParams({ walletAddress: account });
      const read = async (path: string) => {
        const response = await fetch(`${path}?${params}`, { headers, cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]) });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Reconnect an authorized admin wallet." : "Data could not be refreshed.");
        return response.json();
      };
      const results = await Promise.allSettled([read("/api/admin/custom-launch-reviews"), read("/api/admin/launch-operations")]);
      if (!active.current || signal?.aborted) return;
      const problems: string[] = [];
      if (results[0].status === "fulfilled") {
        const value = results[0].value;
        if (!Array.isArray(value.reviews) || value.reviews.length > 100) throw new Error("Unexpected review response.");
        value.reviews.forEach(parseCustomLaunchReview);
        setReviews(value.reviews);
      } else { setReviews(null); problems.push("Reviews unavailable. Reconnect your admin wallet or refresh."); }
      if (results[1].status === "fulfilled" && results[1].value.schemaVersion === "programmable.launch-operations.v1") setSnapshot(results[1].value);
      else { setSnapshot(null); problems.push("Index observations unavailable. Refresh to try again."); }
      setErrors(problems); setCheckedAt(new Date().toISOString()); setNow(Date.now());
    } catch (error) {
      if (active.current && !signal?.aborted) { setReviews(null); setSnapshot(null); setErrors([error instanceof Error ? error.message : "Overview unavailable."]); }
    } finally { if (inFlight.current === controller) inFlight.current = null; if (active.current && !signal.aborted) setBusy(false); }
  }, [account, requestHeaders]);
  useEffect(() => {
    active.current = true;
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { active.current = false; inFlight.current?.abort(); window.clearInterval(timer); };
  }, [load]);
  async function diagnose(row: OperationsRow) {
    if (diagnosticFlight.current) return;
    diagnosticFlight.current = true; setChecking(row.id);
    try {
      const headers = await requestHeaders();
      const params = new URLSearchParams({ walletAddress: account });
      let path: string;
      if (row.token) { path = "/api/admin/launch-operations"; params.set("chainId", String(row.chainId)); params.set("token", row.token); }
      else { path = "/api/admin/custom-launch-reviews"; params.set("reviewId", row.reviewId!); }
      const response = await fetch(`${path}?${params}`, { headers, cache: "no-store", signal: AbortSignal.timeout(65_000) });
      if (!response.ok) throw new Error("The detail check is unavailable. Open the review or try again.");
      const value = await response.json();
      const result = row.token ? value as Diagnostic : describeStoredLaunchStatus(value.review.technicalStatus,
        reviewOperations(parseCustomLaunchReview(value.review), value.review.operations));
      if (active.current) setDiagnostics(previous => ({ ...previous, [row.id]: result }));
    } catch (error) {
      if (active.current) setDiagnostics(previous => ({ ...previous, [row.id]: { status: "Not checked", next: error instanceof Error ? error.message : "Try again." } }));
    } finally { diagnosticFlight.current = false; if (active.current) setChecking(null); }
  }
  const allRows = useMemo(() => buildOperationsRows(reviews ?? [], snapshot, now), [reviews, snapshot, now]);
  const chainRows = allRows.filter(row => chain === "all" || String(row.chainId) === chain);
  const currentRows = chainRows.filter(row => row.view === "current");
  const historyRows = chainRows.filter(row => row.view === "history").sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""));
  const rows = (view === "current" ? currentRows : historyRows).filter(row => (group === "all" || group === row.group)
    && `${row.name} ${row.symbol} ${row.token ?? ""} ${row.reviewId ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const counts = { review: currentRows.filter(row => row.group === "review").length, attention: currentRows.filter(row => row.group === "attention").length, waiting: currentRows.filter(row => row.group === "waiting").length };
  const historyChecks = historyRows.filter(row => row.group === "attention").length;
  const selectView = (next: ReviewListView) => { setView(next); setGroup("all"); setLimit(25); };
  const sources = snapshot?.sources.filter(source => chain === "all" || source.chainId === null || String(source.chainId) === chain) ?? [];
  const complete = reviews !== null && snapshot !== null && sources.every(source => source.status === "ready" && source.complete);
  return <>
    <div className={styles.toolbar}><p role="status">{busy ? "Refreshing observations…" : checkedAt ? `Updated ${date(checkedAt)} · refreshes every minute while open` : "Waiting for observations"}</p><button disabled={busy} onClick={() => void load()}>Refresh</button></div>
    {errors.map(error => <p className={styles.notice} role="alert" key={error}>{error}</p>)}
    <section className={styles.stats} aria-label="Current work queue totals">
      <button onClick={() => { setView("current"); setGroup("review"); setLimit(25); }}><span>Needs review</span><strong>{reviews === null ? "—" : counts.review}</strong></button>
      <button onClick={() => { setView("current"); setGroup("attention"); setLimit(25); }}><span>Needs checking</span><strong>{snapshot === null ? "—" : counts.attention}</strong></button>
      <button onClick={() => { setView("current"); setGroup("waiting"); setLimit(25); }}><span>Waiting</span><strong>{reviews === null ? "—" : counts.waiting}</strong></button>
    </section>
    <section className={styles.networks} aria-label="Chain indexes">{[1, 4663].filter(id => chain === "all" || String(id) === chain).map(id => {
      const source = snapshot?.sources.find(source => source.id === `index:${id}`);
      const indexed = snapshot?.indexed.filter(row => row.chainId === id) ?? [];
      return <div className={styles.panel} key={id}><div className={styles.networkTitle}><h2>{chainName(id)}</h2><span className={styles.badge}>{source?.status ?? "Not checked"}</span></div>
        <p>{source && source.status !== "unavailable" ? `${indexed.filter(row => row.mode === "module").length} module · ${indexed.filter(row => row.mode === "custom").length} custom launches in the website index` : "Index data has not been loaded."}</p>
        <small>Source updated {date(source?.updatedAt ?? null)}</small></div>;
    })}</section>
    <section className={styles.panel} aria-labelledby="queue-title"><h2 id="queue-title">Launch requests</h2>
      <div className={styles.views} role="group" aria-label="Request view">
        <button aria-pressed={view === "current"} onClick={() => selectView("current")}>Current <span>{currentRows.length}</span></button>
        <button aria-pressed={view === "history"} onClick={() => selectView("history")}>History <span>{historyRows.length}</span>{historyChecks > 0 && <small>{historyChecks} to check</small>}</button>
      </div>
      <div className={styles.filters}>
        <label>Chain<select value={chain} onChange={event => { setChain(event.target.value); setLimit(25); }}><option value="all">Both chains</option><option value="1">Ethereum</option><option value="4663">Robinhood</option></select></label>
        <label>Show<select value={group} onChange={event => { setGroup(event.target.value); setLimit(25); }}><option value="all">All {view === "current" ? "current" : "history"}</option>{view === "current" && <option value="review">Needs review</option>}<option value="attention">Needs checking</option>{view === "current" ? <option value="waiting">Waiting</option> : <option value="complete">Completed or replaced</option>}</select></label>
        <label className={styles.search}>Search<input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(25); }} placeholder="Name, symbol, address or review ID" /></label>
      </div>
      <p role="status" className={styles.muted}>{rows.length} matching items{!complete ? " · observations incomplete" : ""}</p>
      {rows.length === 0 && <p>{busy ? "Loading…" : !complete ? "No items in this view. Some sources could not be checked." : view === "current" ? "No current requests need action. Earlier requests are in History." : "No requests in this history view."}</p>}
      <ul className={styles.queue}>{rows.slice(0, limit).map(row => <li key={row.id}>
        <div className={styles.itemHeading}><div><strong>{row.name}</strong>{row.symbol && <span className={styles.muted}> {row.symbol.replace(/^\$+/, "")}</span>}<p className={styles.muted}>{chainName(row.chainId)} · {row.mode === "module" ? "Module" : "Custom"} · {date(row.updatedAt)}</p></div><span className={styles.badge}>{row.status}</span></div>
        <p><strong>{row.owner === "None" ? "No action needed" : `Next: ${row.owner}`}</strong> · {row.next}</p>
        <div className={styles.actions}>{row.reviewId && <Link href={`/admin/custom-launch-reviews?reviewId=${row.reviewId}`}>Open review</Link>}{row.token && <Link href={operationTokenHref({ chainId: row.chainId, token: row.token })}>Open coin</Link>}
          {row.replacementReviewId && <Link href={`/admin/custom-launch-reviews?reviewId=${row.replacementReviewId}`}>Open current request</Link>}
          <button disabled={checking !== null} onClick={() => void diagnose(row)}>{checking === row.id ? "Checking…" : "Check status"}</button></div>
        {diagnostics[row.id] && <div className={styles.diagnostic} role="status"><strong>{diagnostics[row.id].status}</strong><p>{diagnostics[row.id].next}</p></div>}
      </li>)}</ul>
      {rows.length > limit && <button onClick={() => setLimit(previous => previous + 25)}>Show 25 more</button>}
    </section>
    <details className={styles.coverage}><summary>Observation coverage</summary>
      <p>Latest {reviews?.length ?? "unavailable"} custom launch reviews (up to 100), canonical website indexes, finalized custom launch feeds and confirmed module receipts from the last hour. An absent entry is not proof that a transaction failed. Wallet drafts that were never submitted cannot be seen here.</p>
      <p>Native module provenance does not require a Router stamp field. External terminal labels are not checked. Status checks never sign, approve, retry or publish a launch.</p>
      <ul>{sources.map(source => <li key={source.id}>{source.label}: {source.status}{!source.complete ? " · incomplete" : ""} · {source.count} records · {date(source.updatedAt)}</li>)}</ul>
    </details>
  </>;
}
