"use client";
import { useRef, useState, useEffect } from "react";
import type { ApiKeySummary } from "./developer-api-keys";
import { DeveloperIssue } from "./developer-issue";
import styles from "./developer-api-keys.module.css";
export function DeveloperConnectionCheck({ apiKey, chainId, verify, connect }: {
  apiKey: ApiKeySummary; chainId: "1" | "4663" | "8453" | ""; verify(): Promise<ApiKeySummary>; connect(): void;
}) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<string[]>([]), [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => { generation.current++; }, [chainId, apiKey.id]);
  async function check() {
    if (!chainId || busy) return;
    const run = ++generation.current;
    setBusy(true); setResult([]); setError("");
    try {
      const key = await verify();
      if (key.revokedAt || key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) throw new Error("API_KEY_INACTIVE");
      const allowed = key.chainRestriction?.allowedChainIds;
      if (allowed && !allowed.includes(chainId)) throw new Error("API_KEY_CHAIN_RESTRICTION: permission denied for selected chain");
      const response = await fetch(`/api/developer/connection?chainId=${chainId}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`API_CONNECTION_UNAVAILABLE HTTP ${response.status}`);
      const availability = await response.json();
      if (availability.chainId !== chainId || availability.reachable !== true || availability.authorizesKey !== false) throw new Error("API_CONNECTION_INVALID");
      if (run !== generation.current) return;
      setResult(["Wallet session verified · key active",
        allowed ? "Saved chain restriction matches" : "Legacy key: chain access is checked on each API request",
        key.scopes.includes("custom-launch:create") ? "Permissions: create and read" : "Permissions: read only",
        availability.createState === "active" ? "Launch service available" : `Launch service: ${availability.createState === "canary" ? "limited access" : "temporarily unavailable"}`,
        "This checks the saved key settings and service status. Your agent verifies the secret when it connects."]);
    } catch (caught) { if (run === generation.current) setError(caught instanceof Error ? caught.message : "API_CONNECTION_UNAVAILABLE"); }
    finally { setBusy(false); }
  }
  return <div className={styles.connectionCheck} key={chainId}>
    <button type="button" className={styles.secondaryButton} disabled={!chainId || busy} onClick={() => void check()}>{busy ? "Checking connection…" : "Check connection"}</button>
    {!chainId ? <small>Choose a chain above to check access.</small> : null}
    <div role="status">{result.length ? <ul>{result.map(line => <li key={line}>{line}</li>)}</ul> : null}</div>
    {error ? <DeveloperIssue message={error} retry={() => void check()} connect={connect} chainId={chainId} /> : null}
  </div>;
}
