"use client";
import { customLaunchTradeEvidence } from "@/lib/custom-launch-trade-evidence";
import { CustomLaunchAssessment } from "./custom-launch-assessment";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/wallet-provider";
import { isWebsiteAdminWallet } from "@/lib/admin-access";
import { customLaunchOwnerException, customLaunchReviewLabel, customLaunchReviewOverdue, parseCustomLaunchReview, type CustomLaunchReview } from "@/lib/custom-launch-review";
import { buildOperationsRows, reviewListView, reviewProject, type OperationsReview, type ReviewListView } from "@/lib/launch-operations";
import styles from "./custom-launch-review-console.module.css";
type ReviewRow = CustomLaunchReview & { launchId: string; requestSummary: Record<string, unknown> };
type ReviewDetail = CustomLaunchReview & { launchId: string; request: Record<string, unknown>; technicalStatus: Record<string, unknown>; assessment?: unknown; operations?: unknown };
export function CustomLaunchReviewConsole({ initialReviewId }: { initialReviewId?: string } = {}) {
  const { authReady, authenticated, connecting, openWallet, wallet } = useWallet();
  const account = authenticated && isWebsiteAdminWallet(wallet?.account) ? wallet?.account : null;
  return <main className={styles.page}>
    <header><Link href="/admin/launch-operations">Launch overview</Link> · <Link href="/admin/partners">Partner access</Link><h1>Custom launch reviews</h1><p>Review applications within 24 hours. Approval opens a separate 24-hour launch window.</p></header>
    {account ? <AccountReviews key={`${account}:${initialReviewId ?? ""}`} account={account} initialReviewId={initialReviewId} /> :
      <section><p>{!authReady ? "Loading…" : authenticated ? "Connect an authorized admin wallet to continue." : "Sign in with your admin wallet."}</p><button disabled={connecting || !authReady} onClick={() => openWallet()}>Connect wallet</button></section>}
  </main>;
}

function AccountReviews({ account, initialReviewId }: { account: string; initialReviewId?: string }) {
  const { getAccessToken, getIdentityToken } = useWallet();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [reviews, setReviews] = useState<ReviewRow[]>([]), [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [view, setView] = useState<ReviewListView>("current"), [query, setQuery] = useState(""), [limit, setLimit] = useState(25);
  const [replacementId, setReplacementId] = useState("");
  const [tradeReport, setTradeReport] = useState("");
  const selectedReview = useRef(initialReviewId);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [reason, setReason] = useState("");
  const request = useCallback(async (reviewId?: string, decision?: { review: ReviewDetail; choice: "approve" | "reject" | "request_information" | "replace" | "record_checks"; reason: string; replacementReviewId?: string; report?: unknown }) => {
    if (!account) throw new Error("Connect an admin wallet.");
    const [token, identityToken] = await Promise.all([getAccessToken(), getIdentityToken()]);
    if (!token || !active.current) throw new Error("Reconnect your admin wallet.");
    const query = new URLSearchParams({ walletAddress: account });
    if (reviewId && !decision) query.set("reviewId", reviewId);
    const response = await fetch(`/api/admin/custom-launch-reviews?${query}`, {
      method: decision ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(identityToken ? { "X-Privy-Identity-Token": identityToken } : {}), "Content-Type": "application/json" },
      body: decision ? JSON.stringify({ reviewId: decision.review.reviewId, subjectHash: decision.review.subjectHash, revision: decision.review.revision,
        ...(decision.choice === "record_checks" ? { operation: decision.choice, report: decision.report } : decision.choice === "request_information" ? { operation: decision.choice, message: decision.reason, links: [] }
          : decision.choice === "replace" ? { operation: decision.choice, replacementReviewId: decision.replacementReviewId }
          : { decision: decision.choice, reason: decision.reason }) }) : undefined,
      signal: AbortSignal.timeout(70_000),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value?.error?.code === "REVIEW_PLATFORM_FEE_EVIDENCE_REQUIRED" ? "Record passing buy and sell checks for the 0.3% platform fee collected by this pool before approving." : value?.error?.code === "REVIEW_EMBEDDED_DEADLINE_TOO_SHORT" ? "The embedded deadline does not cover the 24-hour launch window. Ask the team to repack it." : response.status === 409 ? "This review changed. Refresh before deciding." : response.status === 403 ? "This wallet is not authorized to review launches." : "Could not load launch reviews. Try again.");
    if (!active.current) throw new Error("Wallet changed. Refresh to continue.");
    return value;
  }, [account, getAccessToken, getIdentityToken]);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const selected = selectedReview.current;
      const [value, refreshed] = await Promise.all([request(), selected ? request(selected) : Promise.resolve(null)]);
      value.reviews.forEach(parseCustomLaunchReview); setReviews(value.reviews);
      if (refreshed && selectedReview.current === selected) { parseCustomLaunchReview(refreshed.review); setDetail(refreshed.review); }
    }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load reviews."); }
    finally { setBusy(false); }
  }, [request]);
  useEffect(() => {
    if (!initialReviewId) return;
    let current = true;
    request(initialReviewId).then(value => {
      parseCustomLaunchReview(value.review);
      if (current && selectedReview.current === initialReviewId) {
        setDetail(value.review);
        setView(reviewListView({ ...value.review, requestSummary: { operations: value.review.operations } }, Date.now()));
      }
    }).catch(error => { if (current) setError(error instanceof Error ? error.message : "Unable to load launch."); });
    return () => { current = false; };
  }, [initialReviewId, request]);
  useEffect(() => {
    let current = true;
    request().then(value => {
      value.reviews.forEach(parseCustomLaunchReview);
      if (current) setReviews(value.reviews);
    }).catch(error => {
      if (current) setError(error instanceof Error ? error.message : "Unable to load reviews.");
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [request]);
  async function select(reviewId: string) {
    selectedReview.current = reviewId;
    setBusy(true); setError(""); setDetail(null); setReason(""); setReplacementId(""); setTradeReport("");
    try { const value = await request(reviewId); parseCustomLaunchReview(value.review); if (selectedReview.current === reviewId) setDetail(value.review); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load launch."); } finally { setBusy(false); }
  }
  async function decide(decision: "approve" | "reject" | "request_information" | "replace" | "record_checks") {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      const value = await request(detail.reviewId, { review: detail, choice: decision, reason, ...(decision === "replace" ? { replacementReviewId: replacementId } : decision === "record_checks" ? { report: JSON.parse(tradeReport) } : {}) }); const updated = parseCustomLaunchReview(value.review);
      setDetail(current => current ? { ...current, ...updated } : null);
      setReviews(current => current.map(item => item.reviewId === updated.reviewId ? { ...item, ...updated } : item));
    } catch (e) { setError(e instanceof Error ? e.message : "Decision could not be saved."); } finally { setBusy(false); }
  }
  const currentPlatformFee = detail && customLaunchTradeEvidence(detail.tradeChecks, detail.subjectHash, detail.chainId).currentPlatformFee;
  const ownerException = detail && customLaunchOwnerException(detail);
  const canDecide = detail && !detail.supersededBy && customLaunchReviewLabel(detail, now) !== "Approved";
  const replacements = detail ? reviews.filter(r => r.chainId === detail.chainId && r.controller === detail.controller && Date.parse(r.submittedAt) > Date.parse(detail.submittedAt) && !r.supersededBy) : [];
  const progress = detail ? buildOperationsRows([{ ...detail, requestSummary: { operations: detail.operations } } as OperationsReview], null, now)[0] : null;
  const currentReviews = reviews.filter(review => reviewListView(review, now) === "current");
  const historyReviews = reviews.filter(review => reviewListView(review, now) === "history");
  const visibleReviews = (view === "current" ? currentReviews : historyReviews).filter(review => {
    const project = reviewProject(review);
    return `${project.name} ${project.symbol} ${review.controller} ${review.launchId} ${review.reviewId}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  return <>
      <button disabled={busy} onClick={() => void load()}>Refresh</button>
      <div className={styles.layout}><section aria-label="Launch review queue">
        <div className={styles.views} role="group" aria-label="Review view">
          <button aria-pressed={view === "current"} onClick={() => { setView("current"); setLimit(25); }}>Current <span>{currentReviews.length}</span></button>
          <button aria-pressed={view === "history"} onClick={() => { setView("history"); setLimit(25); }}>History <span>{historyReviews.length}</span></button>
        </div>
        <label className={styles.search}>Search reviews<input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(25); }} placeholder="Name, wallet or request ID" /></label>
        {!busy && !error && visibleReviews.length === 0 && <p>{query.trim() ? "No matching requests in this view." : view === "current" ? "No current requests. Earlier decisions are in History." : "No earlier requests."}</p>}
        {visibleReviews.slice(0, limit).map(review => <button className={styles.row} key={review.reviewId} disabled={busy} aria-pressed={detail?.reviewId === review.reviewId} onClick={() => void select(review.reviewId)}>
          <strong>{reviewProject(review).name}</strong><span>{review.chainId === "8453" ? "Base" : review.chainId === "1" ? "Ethereum" : "Robinhood"} · {customLaunchReviewLabel(review, now)}</span>
          {customLaunchReviewOverdue(review, now) && <strong>Review overdue</strong>}<small>{new Date(review.submittedAt).toLocaleString()}</small>
        </button>)}
        {visibleReviews.length > limit && <button onClick={() => setLimit(previous => previous + 25)}>Show more</button>}
      </section><section aria-label="Selected launch">{detail ? <>
        <h2>{customLaunchReviewLabel(detail, now)}</h2><p className={styles.address}>{detail.controller}</p>
        {detail.state === "pending" && <p>{customLaunchReviewOverdue(detail, now) ? "Review overdue. The application remains open." : `Review due ${new Date(detail.reviewDueAt ?? Date.parse(detail.submittedAt) + 86_400_000).toLocaleString()}.`}</p>}
        {detail.expiresAt && <p>Launch window ends {new Date(detail.expiresAt).toLocaleString()}.</p>}
        {progress ? <section aria-label="Next launch step"><strong>{progress.status}</strong><p>{progress.owner === "None" ? "No action needed" : `Next: ${progress.owner}`}</p><p>{progress.next}</p></section> : null}
        {detail.requiresRepack && <p>The team must repack with the current contract bindings before a 24-hour approval can be issued.</p>}
        {detail.reason && <p>{detail.reason}</p>}
        {detail.discussion?.length ? <section aria-label="Review conversation">{detail.discussion.map(entry => <div key={entry.revision}>
          <strong>{entry.author === "applicant" ? "Team reply" : "Programmable"}</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.message}</p>
          {entry.links.map(link => <p key={link}><a href={link} target="_blank" rel="noopener noreferrer">{link}</a></p>)}
        </div>)}</section> : null}
        <CustomLaunchAssessment value={detail.assessment} tradeChecks={detail.tradeChecks} subjectHash={detail.subjectHash} chainId={detail.chainId} review={detail} admin />
        {canDecide && detail.state !== "approved" ? <details><summary>Record targeted trading checks</summary><p>Run the review-trade-checks-v4 operator tool with this review ID and subject hash, then paste its report. The report must prove that the pool collects 0.3% for the platform on buys and sells. This does not approve the launch.</p><textarea aria-label="Fork trading report JSON" maxLength={12000} value={tradeReport} onChange={e => setTradeReport(e.target.value)} /><button disabled={busy || !tradeReport.trim()} onClick={() => void decide("record_checks")}>Save check report</button></details> : null}
        <details><summary>Technical checks</summary><pre>{JSON.stringify(detail.technicalStatus, null, 2)}</pre></details>
        <details><summary>Submitted launch and source</summary><pre>{JSON.stringify(detail.request, null, 2)}</pre></details>
        <p className={styles.address}>Reviewed version: {detail.subjectHash}</p>
        {canDecide && <>{ownerException ? <p role="note">{ownerException.approvalReason}</p> : !currentPlatformFee && <p>Approval requires passing 0.3% platform fee checks for this pool.</p>}<label>Note to the team <textarea maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
          <div className={styles.actions}><button disabled={busy || detail.requiresRepack === true || (!currentPlatformFee && !ownerException)} onClick={() => void decide("approve")}>{ownerException ? "Approve owner exception for 24 hours" : "Approve for 24 hours"}</button><button disabled={busy || !reason.trim()} onClick={() => void decide("reject")}>Request changes</button><button disabled={busy || !reason.trim() || detail.state === "approved"} onClick={() => void decide("request_information")}>Ask for information</button></div>
          {replacements.length && detail.state !== "approved" ? <div><label>Replace this old request with<select value={replacementId} onChange={event => setReplacementId(event.target.value)} disabled={busy}>
            <option value="">Choose the newer request</option>{replacements.map(r => <option value={r.reviewId} key={r.reviewId}>{r.launchId} · {new Date(r.submittedAt).toLocaleString()}</option>)}
          </select></label><button disabled={busy || !replacementId} onClick={() => void decide("replace")}>Mark as replaced</button></div> : null}</>}
      </> : <p role="status">{busy ? "Loading launch reviews…" : "Select a launch to review its submitted configuration and checks."}</p>}</section></div>
    {error && <p role="alert">{error}</p>}
  </>;
}
