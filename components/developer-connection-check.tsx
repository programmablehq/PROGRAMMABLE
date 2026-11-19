"use client";
import { useRef, useState, useEffect } from "react";
import type { ApiKeySummary } from "./developer-api-keys";
import { DeveloperIssue } from "./developer-issue";
import styles from "./developer-api-keys.module.css";

function retryDelaySeconds(response: Response) {
  const value = response.headers.get("Retry-After");
  if (!value || (response.status !== 429 && response.status !== 503)) return 0;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return seconds > 0 && seconds <= 2_147_483 ? seconds : 0;
}

export function DeveloperConnectionCheck({ apiKey, chainId, verify, connect }: {
  apiKey: ApiKeySummary; chainId: "1" | "4663" | "8453" | "999" | "99901" | ""; verify(): Promise<ApiKeySummary>; connect(): void;
}) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<string[]>([]), [error, setError] = useState("");
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const generation = useRef(0);
  useEffect(() => { generation.current++; }, [chainId, apiKey.id]);
  useEffect(() => {
    if (!retryAfterSeconds) return;
    const timer = window.setTimeout(() => setRetryAfterSeconds(0), retryAfterSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfterSeconds]);
  async function check() {
    if (!chainId || busy || retryAfterSeconds) return;
    const run = ++generation.current;
    setBusy(true); setResult([]); setError("");
    try {
      const key = await verify();
      if (key.revokedAt || key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) throw new Error("API_KEY_INACTIVE");
      const allowed = key.chainRestriction?.allowedChainIds;
      if (allowed && !allowed.includes(chainId)) throw new Error("API_KEY_CHAIN_RESTRICTION: permission denied for selected chain");
      if (run !== generation.current) return;
      const actions = ["create", "read"].filter(action => key.scopes.includes(`custom-launch:${action}`));
      const keyDetails = ["Wallet session verified · key active",
        allowed ? "Saved chain restriction matches" : "Legacy key: chain access is checked on each API request",
        `Saved launch permissions · ${actions.join(" and ") || "none"}`,
        "Your agent verifies the secret when it connects."];
      setResult(keyDetails);
      const response = await fetch(`/api/developer/connection?chainId=${chainId}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!response) throw new Error("API_CONNECTION_UNAVAILABLE");
      if (!response.ok) {
        if (run !== generation.current) return;
        setRetryAfterSeconds(retryDelaySeconds(response));
        const requestId = response.headers.get("X-Request-Id") || response.headers.get("X-Vercel-Id");
        const reference = requestId && /^[a-zA-Z0-9._:-]{1,128}$/.test(requestId) ? ` Request ID: ${requestId}` : "";
        throw new Error(`API_CONNECTION_UNAVAILABLE HTTP ${response.status}${reference}`);
      }
      const availability = await response.json().catch(() => null);
      if (availability?.chainId !== chainId || availability.reachable !== true || availability.authorizesKey !== false) throw new Error("API_CONNECTION_INVALID");
      if (run !== generation.current) return;
      const service = availability.createState === "active" ? "Launch service available" : `Launch service: ${availability.createState === "canary" ? "limited access" : "temporarily unavailable"}`;
      setResult([...keyDetails, service]);
    } catch (caught) { if (run === generation.current) setError(caught instanceof Error ? caught.message : "API_KEY_CHECK_FAILED"); }
    finally { setBusy(false); }
  }
  return <div className={styles.connectionCheck} key={chainId}>
    <button type="button" className={styles.secondaryButton} disabled={!chainId || busy || retryAfterSeconds > 0} onClick={() => void check()}>{busy ? "Checking connection…" : "Check connection"}</button>
    {!chainId ? <small>Choose a chain above to check access.</small> : null}
    <div role="status">{result.length ? <ul>{result.map(line => <li key={line}>{line}</li>)}</ul> : null}</div>
    {error ? <DeveloperIssue message={error} retry={() => void check()} retryAfterSeconds={retryAfterSeconds} connect={connect} chainId={chainId} /> : null}
  </div>;
}
