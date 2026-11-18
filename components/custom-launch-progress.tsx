"use client";
import { useState } from "react";
import { launchExecutionProgress } from "@/lib/custom-launch-execution-progress";
import type { CustomLaunchReview } from "@/lib/custom-launch-review";
import styles from "./custom-launch-progress.module.css";

export function CustomLaunchProgress({ status, review, launchId, chainId, indexed = false }: {
  status: string; review?: CustomLaunchReview | null; launchId: string; chainId: string; indexed?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const execution = launchExecutionProgress(status);
  const complete = indexed || execution?.complete === true;
  const stage = complete ? 2 : execution || review?.state === "approved" || !review && ["authorized", "awaiting_wallet_signature", "wallet_action_required", "wallet_action_ready"].includes(status) ? 1 : 0;
  const href = `/developers/api-keys?view=history&chainId=${encodeURIComponent(chainId)}&launchId=${encodeURIComponent(launchId)}`;
  return <div className={styles.progress}>
    <ol aria-label="Launch progress">{["Review", "Launch", "Complete"].map((label, index) => <li key={label}
      data-done={index < stage || complete} aria-current={index === stage ? "step" : undefined}>
      <span aria-hidden="true">{index < stage || complete ? "✓" : index + 1}</span>{label}
    </li>)}</ol>
    <button type="button" onClick={() => { void Promise.resolve().then(() => navigator.clipboard.writeText(new URL(href, window.location.origin).href))
      .then(() => { setCopied(true); setCopyFailed(false); }).catch(() => setCopyFailed(true)); }}>{copied ? "Link copied" : "Copy launch link"}</button>
    <span className={styles.srOnly} role="status">{copied ? "Launch link copied" : ""}</span>
    {copyFailed ? <a href={href}>Open your launch link</a> : null}
  </div>;
}
