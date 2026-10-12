"use client";
import { DeveloperIssue } from "./developer-issue";
import { useLaunchStatusPolling } from "./use-launch-status-polling";
import { launchStatusFingerprint, launchStatusUpdateMessage } from "@/lib/custom-launch-status-update";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Hex } from "viem";
import { parseLaunchSendAttemptV1, readLaunchSendJournalV1, reconcileFinalizedLaunchSendV1 } from "@/lib/custom-launch/launch-send-journal-v1";
import { projectionObject } from "@/lib/custom-launch/launch-projection-v1";
import { multiRoleOriginalTransactionHintV3 } from "@/lib/custom-launch/multi-role-finality-version-v3";
import { readLaunchPlanResourceV1, type UniversalLaunchSource, type UniversalLaunchWalletInputV1, type UniversalLaunchWalletReviewV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { DeveloperUniversalLaunchFlow } from "./developer-universal-launch-flow";
import shared from "./developer-api-keys.module.css";
import styles from "./developer-launch-history.module.css";

type Entry = { sourceVersion: UniversalLaunchSource; controller: string; resource: Record<string, unknown> };
type Props = {
  account: string; initialLaunchId?: string | null;
  sourceOnly?: UniversalLaunchSource; openWallet?: () => void;
  getAccessToken(): Promise<string | null>; getIdentityToken(): Promise<string | null>;
  sendWallet(input: UniversalLaunchWalletInputV1): Promise<UniversalLaunchWalletReviewV1 | Hex | null>;
};
const sources = ["custom_launch_plan_v1", "multi_role_v2"] as const;
const identity = (entry: Entry) => `${entry.sourceVersion}:${entry.resource.planId ?? entry.resource.launchId}`;
class HistoryReadError extends Error { constructor(message: string, readonly status: number, readonly retryAfterMs = 0) { super(message); } }
export function LaunchHistoryMissingState({ launchId, unavailable }: { launchId: string; unavailable: boolean }) {
  return <div className={styles.statePanel}><h3>{unavailable ? "Launch data is temporarily unavailable" : "This launch could not be found"}</h3>
    <p>{unavailable ? "Keep this launch link and refresh when the service responds. An unavailable source does not mean the launch or its wallet has changed."
      : "Check that your create request returned this launch ID. Sign in with the account that created it, connect its controller wallet, then refresh. This ID may also be invalid or the plan may not have been created."}</p><code>{launchId}</code></div>;
}
export function parseEntries(value: unknown, account: string): { entries: Entry[]; nextCursor: string | null } {
  if (!projectionObject(value) || value.schemaVersion !== "programmable.website-launch-history.v1" || !Array.isArray(value.launches)
    || !(value.nextCursor === null || typeof value.nextCursor === "string")) throw new Error("Launch history is unavailable.");
  const entries = value.launches.map(candidate => {
    if (!projectionObject(candidate) || !sources.includes(candidate.sourceVersion as UniversalLaunchSource)
      || typeof candidate.controller !== "string" || candidate.controller.toLowerCase() !== account.toLowerCase()
      || !projectionObject(candidate.resource)) throw new Error("The history controller changed.");
    if (candidate.sourceVersion === "custom_launch_plan_v1") readLaunchPlanResourceV1(candidate.resource);
    return candidate as Entry;
  });
  return { entries, nextCursor: value.nextCursor };
}

/** Additional sources inside the existing API-key history. Each immutable source retains its own bytes and cursor. */
export function DeveloperUniversalLaunchHistory(props: Props) {
  const { account, getAccessToken, getIdentityToken } = props;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursors, setCursors] = useState<Partial<Record<UniversalLaunchSource, string | null>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launchUpdate, setLaunchUpdate] = useState("");
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const readCooldown = useRef(0);
  useEffect(() => { readCooldown.current = 0; }, [account]);
  const credentials = useRef({ getAccessToken, getIdentityToken });
  useEffect(() => { credentials.current = { getAccessToken, getIdentityToken }; }, [getAccessToken, getIdentityToken]);
  const request = useCallback(async (source: UniversalLaunchSource, id?: string, init?: RequestInit, suffix = "", cursor?: string,
    sharedTokens?: readonly [string | null, string | null]) => {
    if (!init?.method && Date.now() < readCooldown.current) throw new HistoryReadError("Status reads will resume automatically.", 429, readCooldown.current - Date.now());
    const loaders = credentials.current;
    const [access, identityToken] = sharedTokens ?? await Promise.all([loaders.getAccessToken(), loaders.getIdentityToken()]);
    if (!access) throw new Error("Sign in again to load your launch history.");
    const query = new URLSearchParams({ walletAddress: account, source });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/developer/custom-launch-plans${id ? `/${encodeURIComponent(id)}` : ""}${suffix}?${query}`, {
      ...init, cache: "no-store", redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      headers: { Accept: "application/json", Authorization: `Bearer ${access}`,
        ...(identityToken ? { "X-Privy-Identity-Token": identityToken } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
    const retryHeader = response.headers.get("Retry-After");
    const retryAfterMs = response.status === 429 || response.status === 503
      ? Math.min(3_600_000, Math.max(20_000, retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : retryHeader ? Date.parse(retryHeader) - Date.now() || 60_000 : 60_000)) : 0;
    if (retryAfterMs) readCooldown.current = Date.now() + retryAfterMs;
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const requestId = typeof body?.error?.requestId === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(body.error.requestId) ? body.error.requestId : "";
      throw new HistoryReadError(( response.status === 401 ? "Sign in again with the account that owns this launch."
      : response.status === 403 ? "This account or controller cannot access the launch. Check the signed-in account and controller wallet."
      : response.status === 404 ? "This launch ID is not in this account's accessible history. Check the account, controller wallet and ID."
      : "The launch service is temporarily unavailable. Your existing launch is saved; refresh to retry.") + ` HTTP ${response.status}${requestId ? ` Request ID: ${requestId}` : ""}`, response.status, retryAfterMs);
    }
    return response.json() as Promise<unknown>;
  }, [account]);
  const loadHistory = useCallback(async (signal: AbortSignal) => {
    const loaders = credentials.current;
    const sharedTokens = Promise.all([loaders.getAccessToken(), loaders.getIdentityToken()]);

    const results = await Promise.allSettled(sources.filter(source => !props.sourceOnly || source === props.sourceOnly).map(async source => {
      const tokens = await sharedTokens;
      if (props.initialLaunchId) {
        try {
          return { source, selectedUnavailable: false,
            ...parseEntries(await request(source, props.initialLaunchId, { signal }, "", undefined, tokens), account) };
        } catch (caught) {
          if (caught instanceof HistoryReadError && caught.status === 404) return { source, selectedUnavailable: false, entries: [], nextCursor: null };
          throw caught;
        }
      }
      return { source, selectedUnavailable: false,
        ...parseEntries(await request(source, undefined, { signal }, "", undefined, tokens), account) };
    }));
    if (signal.aborted) return;
    const successful = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    setEntries(previous => [...new Map([...previous, ...successful.flatMap(result => result.entries)].map(entry => [identity(entry), entry])).values()]
      .sort((a, b) => Number(String(b.resource.planId ?? b.resource.launchId) === props.initialLaunchId) - Number(String(a.resource.planId ?? a.resource.launchId) === props.initialLaunchId) || Date.parse(String(b.resource.createdAt)) - Date.parse(String(a.resource.createdAt))));
    setCursors(previous => ({ ...previous, ...Object.fromEntries(successful.map(result => [result.source, result.nextCursor])) }));
    const unavailable = results.some(result => result.status === "rejected") || successful.some(result => result.selectedUnavailable);
    setSourceUnavailable(unavailable);
    const failed = results.find(result => result.status === "rejected");
    setError(unavailable ? failed?.status === "rejected" && failed.reason instanceof Error ? failed.reason.message : "Launch data is temporarily unavailable." : null);
    setLoading(false);
    const retry = results.find(result => result.status === "rejected" && result.reason instanceof HistoryReadError && result.reason.retryAfterMs);
    if (retry?.status === "rejected") throw retry.reason;
  }, [request, account, props.initialLaunchId, props.sourceOnly]);
  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [loadHistory, refresh]);
  async function reconcilePrevious(signal: AbortSignal) {
    const attempt = parseLaunchSendAttemptV1(readLaunchSendJournalV1(account), account);
    if (!attempt || attempt.sourceVersion !== "custom_launch_plan_v1") return;
    const loaded = entries.find(entry => entry.sourceVersion === attempt.sourceVersion && entry.resource.planId === attempt.launchId);
    if (loaded) { reconcileFinalizedLaunchSendV1(attempt, loaded.resource); return; }
    const prior = parseEntries(await request(attempt.sourceVersion, attempt.launchId, { signal }), account).entries[0];
    if (!signal.aborted && prior) reconcileFinalizedLaunchSendV1(attempt, prior.resource);
  }
  useEffect(() => {
    const controller = new AbortController();
    void reconcilePrevious(controller.signal).catch(() => {});
    return () => controller.abort();
  // A refreshed history also retries an earlier still-confirming transaction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, request, refresh]);
  useLaunchStatusPolling(account, !loading, async signal => {
    if (sourceUnavailable) await loadHistory(signal);
    await reconcilePrevious(signal);
    for (const entry of entries) {
      if (signal.aborted) return;
      if (entry.resource.status === "publicly_visible" || entry.resource.status === "finalized"
        || entry.resource.status === "expired" && !entry.resource.manualReview) continue;
      const id = String(entry.resource.planId ?? entry.resource.launchId);
      const updated = parseEntries(await request(entry.sourceVersion, id, { signal }), account).entries
        .find(candidate => identity(candidate) === identity(entry));
      if (signal.aborted || !updated) continue;
      if (launchStatusFingerprint(updated.resource) !== launchStatusFingerprint(entry.resource)) {
        setLaunchUpdate(launchStatusUpdateMessage(updated.resource));
      }
      // Preserve object identity when polling returned identical bytes, so a
      // prepared wallet review is not needlessly discarded and rebuilt.
      if (JSON.stringify(updated.resource) !== JSON.stringify(entry.resource)) {
        setEntries(current => current.map(candidate => identity(candidate) === identity(entry) ? updated : candidate));
      }
    }
  });
  async function more(source: UniversalLaunchSource) {
    const cursor = cursors[source]; if (!cursor) return;
    setLoading(true);
    try {
      const result = parseEntries(await request(source, undefined, undefined, "", cursor), account);
      setEntries(previous => [...new Map([...previous, ...result.entries].map(entry => [identity(entry), entry])).values()]);
      setCursors(previous => ({ ...previous, [source]: result.nextCursor }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load more launches."); }
    finally { setLoading(false); }
  }
  return <section className={styles.history} aria-label="Custom project launch history">
    <div className={styles.heading}><button type="button" className={shared.secondaryButton} onClick={() => setRefresh(value => value + 1)} disabled={loading}>{props.initialLaunchId ? "Refresh launch" : "Refresh custom projects"}</button></div>
    {error ? <DeveloperIssue message={error} retry={() => setRefresh(value => value + 1)} chainId="4663" connect={props.openWallet} /> : null}
    <p role="status" className={styles.intro}>{loading ? "Loading custom projects…" : error ? "" : (entries.length ? "" : "No Custom Launch Plan or MultiRole requests for this controller.")}</p>
    {launchUpdate ? <p role="status" aria-live="polite" className={styles.intro}>{launchUpdate}</p> : null}
    {props.initialLaunchId && !loading && !entries.some(entry => String(entry.resource.planId ?? entry.resource.launchId) === props.initialLaunchId) ? <LaunchHistoryMissingState launchId={props.initialLaunchId} unavailable={sourceUnavailable} /> : null}
    <ul className={styles.launchList}>{entries.map((entry, index) => <DeveloperUniversalLaunchFlow key={identity(entry)} entry={entry} highlighted={String(entry.resource.planId ?? entry.resource.launchId) === props.initialLaunchId}
      autoPrepare={String(entry.resource.planId ?? entry.resource.launchId) === props.initialLaunchId || !props.initialLaunchId && index === 0} sendWallet={props.sendWallet}
      load={async () => {
        const current = parseEntries(await request(entry.sourceVersion, String(entry.resource.planId ?? entry.resource.launchId)), account).entries[0];
        setEntries(previous => previous.map(item => identity(item) === identity(current)
          && JSON.stringify(item.resource) !== JSON.stringify(current.resource) ? current : item));
        return current.resource;
      }}
      onSubmitted={async (stepId, hash) => {
        if (entry.sourceVersion === "custom_launch_plan_v1") await request(entry.sourceVersion, String(entry.resource.planId), {
          method: "POST", body: JSON.stringify({ schemaVersion: "programmable.custom-launch-plan-step-proof.v1", transactionHash: hash.toLowerCase() }),
        }, `/steps/${encodeURIComponent(stepId)}/proofs`);
        else {
          const hint = multiRoleOriginalTransactionHintV3(entry.resource);
          await request(entry.sourceVersion, String(entry.resource.launchId), { method: "POST",
            body: JSON.stringify({ schemaVersion: hint.schemaVersion, transactionHash: hash.toLowerCase() }),
          }, hint.path);
        }
        setRefresh(value => value + 1);
      }} />)}</ul>
    {sources.map(source => cursors[source] ? <button key={source} type="button" className={shared.secondaryButton} disabled={loading} onClick={() => void more(source)}>Load more {source === "multi_role_v2" ? "MultiRole" : "Custom Launch Plan"} requests</button> : null)}
  </section>;
}
