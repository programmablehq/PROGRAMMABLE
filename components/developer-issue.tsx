"use client";
import { useState } from "react";
import { developerRecovery, safeDeveloperDetails } from "@/lib/developer-access-feedback";
import styles from "./developer-api-keys.module.css";
export function DeveloperIssue({ message, retry, connect, chainId }: { message: string; retry?: () => void; connect?: () => void; chainId?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const recovery = developerRecovery(message);
  const details = safeDeveloperDetails(message, chainId);
  return <div className={styles.issue} role="alert">
    <strong>{recovery.title}</strong><p>{recovery.description}</p><small>Next: {recovery.owner}</small>
    <div className={styles.issueActions}>
      {(recovery.kind === "connect" && connect || retry) ? <button className={styles.secondaryButton} type="button"
        onClick={recovery.kind === "connect" && connect ? connect : retry}>{recovery.kind === "connect" && connect ? recovery.action : "Try again"}</button> : null}
      <button className={styles.secondaryButton} type="button" onClick={() => { void navigator.clipboard.writeText(details)
        .then(() => { setCopied(true); setCopyError(false); }).catch(() => setCopyError(true)); }}>{copied ? "Details copied" : "Copy error details"}</button>
    </div>
    <details><summary>Technical details</summary><pre>{details}</pre></details>
    {copyError ? <p>Select the technical details above and copy them.</p> : null}
  </div>;
}
