"use client";
import { CustomLaunchAssessment } from "./custom-launch-assessment";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./wallet-provider";
import { parseCustomLaunchReview, type CustomLaunchReview } from "@/lib/custom-launch-review";
import { reviewLinksV4 } from "@/lib/custom-launch-review-workflow";
import discussionStyles from "./custom-launch-discussion.module.css";
import styles from "./developer-api-keys.module.css";

type DiscussionProps = { review: CustomLaunchReview; launchId: string; onUpdated: () => unknown };

export function CustomLaunchDiscussion(props: DiscussionProps) {
  const { wallet } = useWallet();
  return <LaunchDiscussion key={`${wallet?.account ?? "disconnected"}:${props.launchId}:${props.review.reviewId}`} {...props} />;
}

function LaunchDiscussion({ review, launchId, onUpdated }: DiscussionProps) {
  const { wallet, getAccessToken, getIdentityToken } = useWallet();
  const [message, setMessage] = useState(""), [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [assessment, setAssessment] = useState<unknown>(null);
  const assessmentBusy = useRef(false);
  const account = wallet?.account;
  const active = useRef(account);
  useEffect(() => { active.current = account; return () => { active.current = undefined; }; }, [account]);
  async function readAssessment() {
    if (!account || assessment || assessmentBusy.current) return;
    assessmentBusy.current = true;
    try {
      const [token, identity] = await Promise.all([getAccessToken(), getIdentityToken()]);
      if (!token || active.current !== account) return;
      const response = await fetch("/api/custom-launch-reviews/feedback", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(identity ? { "X-Privy-Identity-Token": identity } : {}) },
        body: JSON.stringify({ operation: "ownerRead", chainId: review.chainId, launchId, walletAddress: account }), signal: AbortSignal.timeout(70000) });
      if (response.ok) { const value = await response.json(); if (active.current === account) setAssessment(value.assessment ?? null); }
    } catch { /* The stored review and reply remain usable during a diagnostics outage. */ }
    finally { assessmentBusy.current = false; }
  }
  async function reply() {
    if (busy || !account || account.toLowerCase() !== review.controller.toLowerCase()) return;
    const attachments = links.split(/\r?\n/u).map(s => s.trim()).filter(Boolean);
    if (!message.trim() || !reviewLinksV4(attachments)) { setNotice("Add a message and up to 3 HTTPS document links."); return; }
    setBusy(true); setNotice("");
    try {
      const [token, identity] = await Promise.all([getAccessToken(), getIdentityToken()]);
      if (!token || active.current !== account) throw new Error("Reconnect the submitting wallet.");
      const response = await fetch("/api/custom-launch-reviews/feedback", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(identity ? { "X-Privy-Identity-Token": identity } : {}) },
        body: JSON.stringify({ operation: "reply", chainId: review.chainId, launchId, walletAddress: account,
          subjectHash: review.subjectHash, revision: review.revision, message: message.trim(), links: attachments }),
        signal: AbortSignal.timeout(20000) });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Could not save your reply. Refresh and retry.");
      parseCustomLaunchReview(value.review);
      if (active.current !== account) return;
      setMessage(""); setLinks(""); setNotice("Reply sent. No new application is needed for these documents."); await onUpdated();
    } catch (cause) { if (active.current === account) setNotice(cause instanceof Error ? cause.message : "Could not send reply."); }
    finally { if (active.current === account) setBusy(false); }
  }
  if (review.supersededBy) return <p>Continue with request {review.supersededBy.launchId}.</p>;
  return <details className={discussionStyles.discussion} onToggle={event => { if (event.currentTarget.open) void readAssessment(); }}>
    <summary>Review messages{review.discussion?.length ? ` (${review.discussion.length})` : ""}</summary>
    {review.reason ? <section aria-label="Review decision"><strong>Programmable review</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{review.reason}</p></section> : null}
    <CustomLaunchAssessment value={assessment} review={review} subjectHash={review.subjectHash} chainId={review.chainId} tradeChecks={review.tradeChecks} />
    {review.discussion?.map(entry => <div key={entry.revision}>
      <strong>{entry.author === "reviewer" ? "Programmable" : "Your team"}</strong>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.message}</p>
      {entry.links.map(link => <p key={link}><a href={link} target="_blank" rel="noopener noreferrer">{link}</a></p>)}
    </div>)}
    {["pending", "rejected"].includes(review.state) ? <>
      <label>Reply or deployment details<textarea maxLength={12000} value={message} onChange={event => setMessage(event.target.value)} disabled={busy} /></label>
      <label>Document links (one per line, up to 3)<textarea maxLength={6200} value={links} onChange={event => setLinks(event.target.value)} disabled={busy} /></label>
      <p>Documents can be added here. Changes to contracts or launch settings require a new submission.</p>
      <button className={styles.primaryButton} type="button" disabled={busy || !message.trim() || account?.toLowerCase() !== review.controller.toLowerCase()} onClick={() => void reply()}>{busy ? "Sending…" : "Send reply"}</button>
    </> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </details>;
}
