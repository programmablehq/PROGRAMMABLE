"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Hex } from "viem";
import { projectionObject } from "@/lib/custom-launch/launch-projection-v1";
import { multiRoleOriginalTransactionHintV3 } from "@/lib/custom-launch/multi-role-finality-version-v3";
import { readLaunchPlanResourceV1, type UniversalLaunchSource, type UniversalLaunchWalletInputV1, type UniversalLaunchWalletReviewV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { DeveloperUniversalLaunchFlow } from "./developer-universal-launch-flow";
import shared from "./developer-api-keys.module.css";
import styles from "./developer-launch-history.module.css";

type Entry = { sourceVersion: UniversalLaunchSource; controller: string; resource: Record<string, unknown> };
type Props = {
  account: string; initialLaunchId?: string | null;
  getAccessToken(): Promise<string | null>; getIdentityToken(): Promise<string | null>;
  sendWallet(input: UniversalLaunchWalletInputV1): Promise<UniversalLaunchWalletReviewV1 | Hex>;
};
const sources = ["custom_launch_plan_v1", "multi_role_v2"] as const;
const identity = (entry: Entry) => `${entry.sourceVersion}:${entry.resource.planId ?? entry.resource.launchId}`;
class HistoryReadError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export function LaunchHistoryMissingState({ launchId, unavailable }: { launchId: string; unavailable: boolean }) {
  return <div className={styles.statePanel}><h3>{unavailable ? "Launch data is temporarily unavailable" : "This launch could not be found"}</h3>
    <p>{unavailable ? "Keep this launch link and refresh when the service responds. An unavailable source does not mean the launch or its wallet has changed."
      : "The available history does not contain this launch. Check the link and connect the wallet and account that own its API key, then refresh."}</p><code>{launchId}</code></div>;
}
function parseEntries(value: unknown, account: string): { entries: Entry[]; nextCursor: string | null } {
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
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const credentials = useRef({ getAccessToken, getIdentityToken });
  useEffect(() => { credentials.current = { getAccessToken, getIdentityToken }; }, [getAccessToken, getIdentityToken]);
  const request = useCallback(async (source: UniversalLaunchSource, id?: string, init?: RequestInit, suffix = "", cursor?: string) => {
    const loaders = credentials.current;
    const [access, identityToken] = await Promise.all([loaders.getAccessToken(), loaders.getIdentityToken()]);
    if (!access) throw new Error("Sign in again to load your launch history.");
    const query = new URLSearchParams({ walletAddress: account, source });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/developer/custom-launch-plans${id ? `/${encodeURIComponent(id)}` : ""}${suffix}?${query}`, {
      ...init, cache: "no-store", redirect: "error", signal: init?.signal ?? AbortSignal.timeout(15000),
      headers: { Accept: "application/json", Authorization: `Bearer ${access}`,
        ...(identityToken ? { "X-Privy-Identity-Token": identityToken } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (!response.ok) throw new HistoryReadError(response.status === 401 ? "Sign in again with the account that owns this launch."
      : response.status === 403 ? "This account or controller cannot access the launch. Connect the wallet that owns the API key."
      : response.status === 404 ? "This launch was not found for this controller."
      : "The launch service is temporarily unavailable. Your existing launch is saved; refresh to retry.", response.status);
    return response.json() as Promise<unknown>;
  }, [account]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled(sources.map(async source => {
      const result = parseEntries(await request(source, undefined, { signal: controller.signal }), account);
      let selectedUnavailable = false;
      if (props.initialLaunchId && !result.entries.some(entry => String(entry.resource.planId ?? entry.resource.launchId) === props.initialLaunchId)) {
        try { result.entries.push(...parseEntries(await request(source, props.initialLaunchId, { signal: controller.signal }), account).entries); }
        catch (caught) { selectedUnavailable = !(caught instanceof HistoryReadError && caught.status === 404); }
      }
      return { source, selectedUnavailable, ...result };
    })).then(results => {
      if (controller.signal.aborted) return;
      const successful = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      setEntries(previous => [...new Map([...previous, ...successful.flatMap(result => result.entries)].map(entry => [identity(entry), entry])).values()]
        .sort((a, b) => Number(String(b.resource.planId ?? b.resource.launchId) === props.initialLaunchId) - Number(String(a.resource.planId ?? a.resource.launchId) === props.initialLaunchId) || Date.parse(String(b.resource.createdAt)) - Date.parse(String(a.resource.createdAt))));
      setCursors(previous => ({ ...previous, ...Object.fromEntries(successful.map(result => [result.source, result.nextCursor])) }));
      const unavailable = results.some(result => result.status === "rejected") || successful.some(result => result.selectedUnavailable);
      setSourceUnavailable(unavailable);
      setError(unavailable ? successful.some(result => result.entries.length) ? "Some custom launch sources could not be refreshed. Existing records remain available." : "Launch data is temporarily unavailable. Keep this link and refresh to retry." : null);
      setLoading(false);
    });
    const timer = window.setInterval(() => setRefresh(value => value + 1), 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [request, account, props.initialLaunchId, refresh]);
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
    <div className={styles.heading}><button type="button" className={shared.secondaryButton} onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh custom projects</button></div>
    <p role="status" className={styles.intro}>{loading ? "Loading custom projects…" : error ?? (entries.length ? "" : "No Custom Launch Plan or MultiRole requests for this controller.")}</p>
    {props.initialLaunchId && !loading && !entries.some(entry => String(entry.resource.planId ?? entry.resource.launchId) === props.initialLaunchId) ? <LaunchHistoryMissingState launchId={props.initialLaunchId} unavailable={sourceUnavailable} /> : null}
    <ul className={styles.launchList}>{entries.map((entry, index) => <DeveloperUniversalLaunchFlow key={identity(entry)} entry={entry} highlighted={String(entry.resource.planId ?? entry.resource.launchId) === props.initialLaunchId}
      autoPrepare={String(entry.resource.planId ?? entry.resource.launchId) === props.initialLaunchId || !props.initialLaunchId && index === 0} sendWallet={props.sendWallet}
      load={async () => parseEntries(await request(entry.sourceVersion, String(entry.resource.planId ?? entry.resource.launchId)), account).entries[0].resource}
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
