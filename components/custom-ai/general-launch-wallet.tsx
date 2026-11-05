"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { customLaunchReviewAllowsSigning, customLaunchReviewNeedsStart } from "@/lib/custom-launch-review";
import { customLaunchWalletHandoffExpiredV1 } from "@/lib/custom-launch/developer-launch-truth-v1";
import { parseLaunchSendAttemptV1, readLaunchSendJournalV1, reconcileFinalizedLaunchSendV1, subscribeLaunchSendV1,
  type LaunchSendAttemptV1 } from "@/lib/custom-launch/launch-send-journal-v1";
import type { UniversalLaunchWalletReviewV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import { builderChain } from "@/lib/custom-ai/execution-routing";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { generalGraphFinalizedReceipt, generalWalletRequest, generalWalletValue, readGeneralWalletResource, reviewGeneralGraphWallet,
  sameGeneralGraphWalletReview, startGeneralWalletLaunch, type GeneralGraphWalletReview, type GeneralWalletResource,
  type GeneralWalletSubject } from "@/lib/custom-ai/general-wallet";
import { finalizeGraphWalletAttempt, graphWalletActionHash, readGraphWalletAttempts, rememberGraphWalletHash, subscribeGraphWalletAttempts, type GraphWalletAttempt } from "@/lib/custom-ai/general-wallet-attempt";
import { withGeneralWalletJournalLock } from "@/lib/custom-ai/general-wallet-execution";
import { releaseFinalizedBrowserWalletRequest } from "@/lib/wallet-request-lock";
import styles from "./workspace.module.css";

type Recovery = { graph?: GraphWalletAttempt[]; plan?: LaunchSendAttemptV1 | null; error?: string };
type Review = { kind: "graph"; value: GeneralGraphWalletReview } | { kind: "plan"; value: UniversalLaunchWalletReviewV1 };
export default function GeneralLaunchWallet({ subject, name, headers, disabled, onStatus, prepareCommand, preparing = false }: {
  subject: GeneralWalletSubject; name: string; headers: AISessionHeaders; disabled: boolean; onStatus(): unknown;
  prepareCommand?:string; preparing?: boolean;
}) {
  const wallet = useWallet(), lifetime = useRef<AbortController | null>(null), inFlight = useRef(false), recoveryId = useId();
  const [resource, setResource] = useState<GeneralWalletResource>(), [review, setReview] = useState<Review>();
  const [recovery, setRecovery] = useState<Recovery>({}), [receipt, setReceipt] = useState<{ hash: Hex; stepId?: string; final?: boolean }>();
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [trackingError, setTrackingError] = useState(""), [recoveryHash, setRecoveryHash] = useState("");
  const handledCommand=useRef<string|undefined>(undefined),automaticPrepare=useRef<()=>void>(()=>undefined);
  useLayoutEffect(() => { const active = new AbortController(); lifetime.current = active; return () => { active.abort(); lifetime.current = null; }; }, []);
  function assertCurrent() {
    const signal = lifetime.current?.signal;
    if (!signal) throw Error("Reopen this saved submission before continuing.");
    signal.throwIfAborted();
  }
  function syncRecovery() {
    try { setRecovery(subject.chainId === 4663 ? { plan: parseLaunchSendAttemptV1(readLaunchSendJournalV1(subject.controller), subject.controller) }
      : { graph: readGraphWalletAttempts(subject.controller, String(subject.chainId) as "1" | "8453" | "999") }); }
    catch (caught) { setRecovery({ error: caught instanceof Error ? caught.message : "The original wallet attempt could not be read." }); }
  }
  useEffect(() => {
    // Mount only reads local recovery records. No wallet, model, full-resource
    // API, start endpoint or cost estimate is called until an explicit click.
    const sync = () => {
      try { setRecovery(subject.chainId === 4663 ? { plan: parseLaunchSendAttemptV1(readLaunchSendJournalV1(subject.controller), subject.controller) }
        : { graph: readGraphWalletAttempts(subject.controller, String(subject.chainId) as "1" | "8453" | "999") }); }
      catch (caught) { setRecovery({ error: caught instanceof Error ? caught.message : "The original wallet attempt could not be read." }); }
    };
    sync(); return subject.chainId === 4663 ? subscribeLaunchSendV1(sync) : subscribeGraphWalletAttempts(sync);
  }, [subject.chainId, subject.controller]);
  const graphAttempt = recovery.graph?.find(item => item.requestId === subject.resourceId), planAttempt = recovery.plan?.launchId === subject.resourceId ? recovery.plan : undefined;
  const ownAttempt = graphAttempt ?? planAttempt;
  const otherPending = recovery.graph?.find(item => item.transactionHash === null && item.requestId !== subject.resourceId)
    ?? (recovery.plan && recovery.plan.launchId !== subject.resourceId ? recovery.plan : undefined);
  const hash = receipt?.hash ?? ownAttempt?.transactionHash ?? undefined;
  const manualReview = resource?.kind === "graph" ? resource.launch.manualReview : resource?.plan.manualReview;
  const needsStart = manualReview && customLaunchReviewNeedsStart(manualReview);
  const finalized = resource?.kind === "graph" ? resource.launch.status === "finalized"
    : Boolean(resource?.plan.steps.length && resource.plan.steps.every(step => step.status === "final")
      && ["final", "source_verified", "indexed", "publicly_visible"].includes(resource.plan.status));

  async function load() {
    assertCurrent(); const signal = lifetime.current!.signal;
    const raw = await generalWalletRequest(subject, headers, signal); assertCurrent();
    const fresh = await readGeneralWalletResource(subject, raw); assertCurrent();
    if (fresh.kind === "plan") {
      const attempt = parseLaunchSendAttemptV1(readLaunchSendJournalV1(subject.controller), subject.controller);
      if (attempt?.launchId === subject.resourceId && fresh.plan.steps.some(item => item.stepId === attempt.stepId && item.transactionDigest === attempt.binding && item.status === "final" && item.transactionHash)) {
        const reconciled = await withGeneralWalletJournalLock(subject.controller, "4663", async () => {
          assertCurrent();
          const step = fresh.plan.steps.find(item => item.stepId === attempt.stepId && item.transactionDigest === attempt.binding);
          if (!step?.transactionHash || attempt.transactionHash && attempt.transactionHash.toLowerCase() !== step.transactionHash.toLowerCase()) return false;
          await releaseFinalizedBrowserWalletRequest({ account: subject.controller, chainId: "4663", requestSubject: JSON.stringify(["custom-launch-plan-wallet-v1", attempt.binding]), assertCurrentSession: assertCurrent });
          return reconcileFinalizedLaunchSendV1(attempt, fresh.plan);
        });
        assertCurrent();
        if (!reconciled) throw Error("The confirmed transaction differs from the original saved attempt. Keep its receipt for reconciliation.");
        const step = fresh.plan.steps.find(item => item.stepId === attempt.stepId && item.transactionDigest === attempt.binding);
        if (step?.transactionHash) setReceipt({ hash: step.transactionHash, stepId: step.stepId, final: true });
      }
    } else {
      const finalHash = await generalGraphFinalizedReceipt(subject, fresh); assertCurrent();
      if (finalHash) {
        await withGeneralWalletJournalLock(subject.controller, String(subject.chainId) as "1" | "8453" | "999", async () => {
          assertCurrent();
          const attempt = readGraphWalletAttempts(subject.controller, String(subject.chainId) as "1" | "8453" | "999").find(item => item.requestId === subject.resourceId);
          if (attempt) {
            if (attempt.requestHash !== subject.requestHash || attempt.transactionHash && attempt.transactionHash !== finalHash) throw Error("The final transaction differs from the original saved attempt. Keep its receipt for reconciliation.");
            await releaseFinalizedBrowserWalletRequest({ account: subject.controller, chainId: String(subject.chainId), requestSubject: JSON.stringify(["custom-ai-graph-wallet-action-v1", attempt.actionHash]), assertCurrentSession: assertCurrent });
            const bound = attempt.transactionHash ? attempt : rememberGraphWalletHash(attempt, finalHash);
            finalizeGraphWalletAttempt(bound, { requestId: subject.resourceId, requestHash: subject.requestHash, transactionHash: finalHash, finality: "final" });
          }
        });
        assertCurrent(); setReceipt({ hash: finalHash, final: true });
      }
    }
    setResource(fresh); syncRecovery(); return fresh;
  }
  async function loadPlan() { const fresh = await load(); if (fresh.kind !== "plan") throw Error("The original launch type changed."); return fresh.plan; }
  async function capabilities() {
    assertCurrent();
    const response = await fetch("https://api.programmable.market/v4/chains/4663/custom-launch-capabilities", {
      cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.any([lifetime.current!.signal, AbortSignal.timeout(15_000)]) });
    assertCurrent(); if (!response.ok) throw Error("The current wallet bindings are unavailable. Your submission is saved.");
    const value: unknown = await response.json(); assertCurrent(); return value;
  }
  async function run(label: string, action: () => Promise<void>) {
    if (inFlight.current || disabled || preparing) return;
    inFlight.current = true; setBusy(label); setError("");
    try { assertCurrent(); await action(); }
    catch (caught) { if (lifetime.current && !lifetime.current.signal.aborted) setError(caught instanceof Error ? caught.message : "The wallet step could not finish. Your submission is saved."); }
    finally { inFlight.current = false; if (lifetime.current && !lifetime.current.signal.aborted) { setBusy(""); syncRecovery(); } }
  }
  async function prepare(prefetched?:GeneralWalletResource) {
    setReview(undefined); const fresh = prefetched ?? await load();
    if (fresh.kind === "graph" ? fresh.launch.status === "finalized" : fresh.plan.steps.length > 0
      && fresh.plan.steps.every(step => step.status === "final") && ["final", "source_verified", "indexed", "publicly_visible"].includes(fresh.plan.status)) return;
    const currentReview = fresh.kind === "graph" ? fresh.launch.manualReview : fresh.plan.manualReview;
    if (currentReview && customLaunchReviewNeedsStart(currentReview)) return;
    if (fresh.kind === "graph") {
      const value = await reviewGeneralGraphWallet(subject, fresh); assertCurrent(); setReview({ kind: "graph", value });
    } else {
      const step = fresh.plan.steps.find(item => item.status === "wallet_action_ready");
      if (!step || fresh.plan.continuation) throw Error("There is no wallet step ready yet. Check the submission details for its next step.");
      const value = await wallet.sendUniversalLaunchWalletAction({ action: "switch_chain", sourceVersion: "custom_launch_plan_v1", reviewedResource: fresh.plan,
        stepId: step.stepId, loadFreshResource: loadPlan, loadFreshCapabilities: capabilities, signal: lifetime.current!.signal });
      assertCurrent(); if (!value || typeof value === "string") throw Error("The current wallet step could not be reviewed.");
      setReview({ kind: "plan", value });
    }
  }
  async function track(observed: { hash: Hex; stepId?: string }) {
    setTrackingError("");
    try {
      if (subject.chainId === 4663 && observed.stepId) await generalWalletRequest(subject, headers, lifetime.current!.signal, { stepId: observed.stepId, transactionHash: observed.hash });
      assertCurrent(); await load(); assertCurrent(); await onStatus();
    } catch { if (lifetime.current && !lifetime.current.signal.aborted) setTrackingError("Your transaction is saved. Refresh its confirmation to continue."); }
  }
  async function send() {
    if (!review || ownAttempt || otherPending || recovery.error) return;
    const reviewed = review; setReview(undefined);
    let observed: { hash: Hex; stepId?: string };
    if (reviewed.kind === "graph") {
      const fresh = await load();
      if (fresh.kind === "graph" && fresh.launch.status === "finalized") { await onStatus(); return; }
      const current = await reviewGeneralGraphWallet(subject, fresh); assertCurrent();
      if (!sameGeneralGraphWalletReview(reviewed.value, current) || fresh.kind !== "graph") throw Error("The wallet step changed. Review the current details before confirming.");
      const action = current.router.walletAction;
      const result = await wallet.sendCustomLaunchWalletAction(action, { context: { requestId: subject.resourceId, requestHash: subject.requestHash, actionHash: graphWalletActionHash(action) },
        assertCurrent: () => { assertCurrent(); if (customLaunchWalletHandoffExpiredV1(fresh.launch, Date.now()) || fresh.launch.manualReview && !customLaunchReviewAllowsSigning(fresh.launch.manualReview)) throw Error("This wallet step expired. Refresh it before continuing."); } });
      observed = { hash: result };
    } else {
      if (resource?.kind !== "plan") throw Error("Refresh the original wallet step.");
      const result = await wallet.sendUniversalLaunchWalletAction({ action: "send", sourceVersion: "custom_launch_plan_v1", reviewedResource: resource.plan,
        stepId: reviewed.value.stepId, reviewed: reviewed.value, loadFreshResource: loadPlan, loadFreshCapabilities: capabilities, signal: lifetime.current!.signal });
      if (typeof result !== "string") throw Error("Check the original wallet activity before continuing.");
      observed = { hash: result, stepId: reviewed.value.stepId };
    }
    assertCurrent(); setReceipt(observed); syncRecovery(); await track(observed);
  }
  async function recover() {
    if (!/^0x(?!0{64}$)[a-f0-9]{64}$/iu.test(recoveryHash) || !ownAttempt) throw Error("Enter the transaction ID from your original wallet activity.");
    await load(); assertCurrent();
    let recovered: Hex | null | UniversalLaunchWalletReviewV1;
    if (graphAttempt) recovered = await wallet.recoverGeneralGraphWalletAction({ attempt: graphAttempt, transactionHash: recoveryHash as Hex, assertCurrent });
    else {
      const fresh = await loadPlan();
      recovered = await wallet.sendUniversalLaunchWalletAction({ action: "recover", sourceVersion: "custom_launch_plan_v1", reviewedResource: fresh,
        stepId: planAttempt!.stepId, recoveryHash: recoveryHash as Hex, loadFreshResource: loadPlan, loadFreshCapabilities: capabilities, signal: lifetime.current!.signal });
    }
    assertCurrent(); if (typeof recovered !== "string") throw Error("The original transaction could not be recovered yet.");
    const observed = { hash: recovered, ...(planAttempt ? { stepId: planAttempt.stepId } : {}) };
    setReceipt(observed); syncRecovery(); await track(observed);
  }

  useLayoutEffect(()=>{automaticPrepare.current=()=>{void run("Preparing wallet step…",async()=>{
    const fresh=await load(),current=fresh.kind==="graph"?fresh.launch.manualReview:fresh.plan.manualReview;
    if(current&&customLaunchReviewNeedsStart(current)){await startGeneralWalletLaunch(subject,headers,lifetime.current!.signal);assertCurrent();await onStatus();await prepare();}
    else await prepare(fresh);
  });};});
  useEffect(()=>{
    if(!prepareCommand||handledCommand.current===prepareCommand||disabled||preparing||ownAttempt||otherPending||recovery.error||finalized)return;
    handledCommand.current=prepareCommand;automaticPrepare.current();
  },[prepareCommand,disabled,preparing,ownAttempt,otherPending,recovery.error,finalized]);

  return <section className={styles.generalWallet} aria-label="Wallet step" aria-busy={Boolean(busy) || preparing}>
    <p className={styles.note}>{name} · {builderChain(subject.chainId).name}</p>
    {recovery.error && <p className={styles.error} role="alert">{recovery.error}</p>}
    {otherPending && <p className={styles.note}>An earlier launch transaction needs recovery before another one can be sent. Open its original submission to continue.</p>}
    {hash ? <><p className={styles.note} role="status">{receipt?.final ? "Transaction confirmed:" : "Transaction saved:"} <code title={hash}>{hash.slice(0, 10)}…{hash.slice(-8)}</code></p>
      <button type="button" className={styles.textButton} disabled={Boolean(busy) || disabled} onClick={() => { void run("Checking confirmation…", () => track({ hash, stepId: receipt?.stepId ?? planAttempt?.stepId })); }}>Refresh confirmation</button></>
      : ownAttempt ? <p className={styles.note} role="status">Your original wallet attempt is saved. Confirm or cancel it in your wallet, or recover its transaction below.</p> : null}
    {!hash && ownAttempt && <form className={styles.walletRecovery} onSubmit={event => { event.preventDefault(); void run("Checking transaction…", recover); }}>
      <label htmlFor={recoveryId}>Original transaction ID</label><input id={recoveryId} value={recoveryHash} maxLength={66} onChange={event => setRecoveryHash(event.target.value.trim())} placeholder="0x…" autoComplete="off" spellCheck={false} required />
      <button type="submit" className={styles.textButton} disabled={Boolean(busy) || disabled}>Recover transaction</button></form>}
    {!hash && ownAttempt && <button type="button" className={styles.textButton} disabled={Boolean(busy) || disabled} onClick={() => { void run("Checking confirmation…", async () => { await load(); await onStatus(); }); }}>Check launch confirmation</button>}
    {preparing && <p className={styles.note} role="status">Preparing your wallet step…</p>}
    {!preparing && !ownAttempt && !otherPending && !recovery.error && !finalized && <>
      {needsStart ? <button type="button" className={styles.createButton} disabled={Boolean(busy) || disabled} onClick={() => { void run("Preparing approved launch…", async () => {
        setReview(undefined); await startGeneralWalletLaunch(subject, headers, lifetime.current!.signal); assertCurrent(); await load(); await onStatus();
      }); }}>Prepare approved launch</button>
        : review ? <><p className={styles.note}>Transaction value: <strong>{generalWalletValue(review.kind === "graph" ? review.value.router.walletAction.valueWei : review.value.valueWei, subject.chainId)}</strong>.
          {review.kind === "plan" ? <> Estimated gas: {generalWalletValue(review.value.maxGasCostWei, subject.chainId)}.</> : <> Gas is shown in your wallet.</>}</p>
          <button type="button" className={styles.createButton} disabled={Boolean(busy) || disabled} onClick={() => { void run("Confirm in your wallet…", send); }}>Confirm launch in wallet</button></>
          : <button type="button" className={styles.createButton} disabled={Boolean(busy) || disabled} onClick={() => { void run("Loading wallet step…", prepare); }}>Continue launch here</button>}
    </>}
    {busy && <p className={styles.note} role="status">{busy}</p>}
    {trackingError && <p className={styles.note} role="status">{trackingError}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
