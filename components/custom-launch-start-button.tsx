"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./developer-api-keys.module.css";
import { useWallet } from "./wallet-provider";
import { customLaunchReviewNeedsStart, type CustomLaunchReview } from "@/lib/custom-launch-review";
import { preparationRetryDelayV1, waitForPreparationRetryV1 } from "@/lib/custom-launch/preparation-retry-v1";

// Preparation is authenticated and approval-gated. It never opens the wallet;
// the owner still clicks Sign and launch for the actual transaction.
export function CustomLaunchStartButton({ review, launchId, onStarted }: {
  review: CustomLaunchReview; launchId: string; onStarted: () => unknown;
}) {
  const { wallet, getAccessToken, getIdentityToken } = useWallet();
  const callbacks = useRef({ getAccessToken, getIdentityToken, onStarted });
  useEffect(() => { callbacks.current = { getAccessToken, getIdentityToken, onStarted }; }, [getAccessToken, getIdentityToken, onStarted]);
  const [retry, setRetry] = useState(0), [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const needsStart = customLaunchReviewNeedsStart(review);
  const account = wallet?.account;
  const { chainId, controller: owner, revision } = review;
  useEffect(() => {
    if (!needsStart || !account || account.toLowerCase() !== owner.toLowerCase()) return;
    const controller = new AbortController();
    void (async () => {
      let started = false;
      for (let attempt = 1; attempt <= 3 && !controller.signal.aborted; attempt++) {
       try {
        if (started) { await callbacks.current.onStarted(); return; }
        const [token, identity] = await Promise.all([callbacks.current.getAccessToken(), callbacks.current.getIdentityToken()]);
        if (controller.signal.aborted) return;
        if (!token) throw new Error("Sign in again to prepare your launch.");
        const response = await fetch("/api/custom-launch-reviews/start", { method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(identity ? { "X-Privy-Identity-Token": identity } : {}) },
          body: JSON.stringify({ chainId, launchId, walletAddress: account }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        const value = await response.json().catch(() => null);
        if (!response.ok) {
          const delay = preparationRetryDelayV1(response.status, response.headers.get("Retry-After"), attempt);
          if (delay !== null) {
            setRetrying(true);
            await waitForPreparationRetryV1(delay, controller.signal);
            continue;
          }
          throw new Error(typeof value?.error === "string" ? value.error : "Could not prepare this launch. Try again.");
        }
        started = true;
        if (!controller.signal.aborted) await callbacks.current.onStarted();
        return;
       } catch (cause) {
        if (controller.signal.aborted) return;
        // A successful start followed by a failed refresh must not start again.
        // A network interruption may already have reached the idempotent start endpoint.
        if (attempt < 3 && (started || cause instanceof TypeError || cause instanceof DOMException && cause.name === "TimeoutError")) {
          setRetrying(true);
          try { await waitForPreparationRetryV1(3000 * attempt, controller.signal); } catch { return; }
          continue;
        }
        setError(cause instanceof Error ? cause.message : "Could not prepare this launch.");
        return;
       }
      }
    })();
    return () => controller.abort();
  }, [needsStart, account, owner, chainId, launchId, revision, retry]);
  if (!needsStart) return null;
  if (!account || account.toLowerCase() !== owner.toLowerCase()) return <p>Connect the wallet that submitted this launch.</p>;
  return <div>
    {error ? <button className={styles.primaryButton} type="button" onClick={() => { setError(""); setRetrying(false); setRetry(value => value + 1); }}>Retry preparation</button>
      : <p role="status">{retrying ? "Preparation will retry automatically. Keep this launch open." : "Preparing your launch…"}</p>}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
