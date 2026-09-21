"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { formatEther, type Hex } from "viem";
import { parseLaunchProjectionV1, projectionObject, projectionToRobinhoodLaunch } from "@/lib/custom-launch/launch-projection-v1";
import { launchFlowPresentationV1 } from "@/lib/custom-launch/launch-flow-v1";
import { finalizeLaunchSendV1, parseLaunchSendAttemptV1, readLaunchSendJournalV1, rememberLaunchHashV1, subscribeLaunchSendV1 } from "@/lib/custom-launch/launch-send-journal-v1";
import { launchPlanWalletUrlV1, readLaunchPlanResourceV1, type UniversalLaunchSource, type UniversalLaunchWalletInputV1, type UniversalLaunchWalletReviewV1 } from "@/lib/custom-launch/wallet-handoff-plan-v1";
import shared from "./developer-api-keys.module.css";
import styles from "./developer-universal-launch-flow.module.css";

export type UniversalLaunchEntryV1 = { sourceVersion: UniversalLaunchSource; controller: string; resource: Record<string, unknown> };
type Props = {
  entry: UniversalLaunchEntryV1; highlighted?: boolean; autoPrepare?: boolean;
  load(): Promise<unknown>;
  sendWallet(input: UniversalLaunchWalletInputV1): Promise<UniversalLaunchWalletReviewV1 | Hex>;
  onSubmitted(step: string, hash: Hex): Promise<void>;
  onIndexed?(href: string): void;
};
const stepLabels = { pending: "Waiting", wallet_action_ready: "Ready", broadcast: "Submitted", mined: "Confirming finality", final: "Final", failed: "Needs attention" };
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function DeveloperUniversalLaunchFlow({ entry, highlighted = false, autoPrepare = true, load, sendWallet, onSubmitted, onIndexed }: Props) {
  const router = useRouter();
  const { resource } = entry;
  const plan = entry.sourceVersion === "custom_launch_plan_v1" ? readLaunchPlanResourceV1(resource) : null;
  const id = String(resource.planId ?? resource.launchId);
  const step = plan?.steps.find(item => item.status === "wallet_action_ready");
  const ready = plan ? !!step && !plan.continuation : ["authorized", "awaiting_wallet_signature", "wallet_action_required"].includes(String(resource.status));
  const wallet = projectionObject(resource.wallet) ? resource.wallet : null;
  const summary = wallet && projectionObject(wallet.launchSummary) ? wallet.launchSummary : null;
  const title = plan?.plan.publication?.name ?? (typeof summary?.name === "string" ? summary.name : "Custom project");
  const [review, setReview] = useState<UniversalLaunchWalletReviewV1 | null>(null);
  const [busy, setBusy] = useState<"review" | "send" | "recover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [indexedHref, setIndexedHref] = useState<string | null>(null);
  const [observedSubmission, setObservedSubmission] = useState<{ stepId: string; hash: Hex } | null>(null);
  const recoveryInput = useRef<HTMLInputElement>(null);
  const recoveryId = useId();
  const navigated = useRef(false);
  const onSubmittedRef = useRef(onSubmitted);
  useEffect(() => { onSubmittedRef.current = onSubmitted; }, [onSubmitted]);
  const rawJournal = useSyncExternalStore(subscribeLaunchSendV1, () => readLaunchSendJournalV1(entry.controller), () => null);
  const legacyRaw = useSyncExternalStore(subscribeLaunchSendV1, () => {
    try { return window.localStorage.getItem(`programmable:launch-submission:4663:${entry.controller.toLowerCase()}:${entry.sourceVersion}:${id}`); }
    catch { return null; }
  }, () => null);
  let legacySubmission: { stepId: string; transactionHash: Hex } | null = null;
  try {
    const value: unknown = legacyRaw ? JSON.parse(legacyRaw) : null;
    if (projectionObject(value) && typeof value.transactionHash === "string" && /^0x[0-9a-f]{64}$/i.test(value.transactionHash)
      && typeof value.stepId === "string" && (plan ? plan.steps.some(item => item.stepId === value.stepId && item.transactionDigest === value.transactionDigest && item.status !== "final")
        : value.stepId === "multi-role-v2" && resource.walletTransactionPreimageHash === value.transactionDigest && resource.status !== "finalized")) {
      legacySubmission = { stepId: value.stepId, transactionHash: value.transactionHash as Hex };
    }
  } catch { /* Legacy receipts are supplemental; the new send journal remains the send boundary. */ }
  const { attempt, journalError } = useMemo(() => {
    try { return { attempt: parseLaunchSendAttemptV1(rawJournal, entry.controller), journalError: null }; }
    catch (caught) { return { attempt: null, journalError: caught instanceof Error ? caught.message : "The saved wallet attempt is unavailable." }; }
  }, [rawJournal, entry.controller]);
  const ownAttempt = attempt?.launchId === id && attempt.sourceVersion === entry.sourceVersion ? attempt : null;
  const multiFinality = projectionObject(resource.finality) ? resource.finality : null;
  const ownStep = ownAttempt ? plan?.steps.find(item => item.stepId === ownAttempt.stepId && item.transactionDigest === ownAttempt.binding)
    ?? (entry.sourceVersion === "multi_role_v2" && resource.status === "finalized" && multiFinality?.state === "ethereum_finalized"
      && typeof multiFinality.transactionHash === "string" && /^0x[0-9a-f]{64}$/i.test(multiFinality.transactionHash)
      && resource.walletTransactionPreimageHash === ownAttempt.binding ? { status: "final", transactionDigest: ownAttempt.binding, transactionHash: multiFinality.transactionHash as Hex } : null) : null;
  const completedHash = ownStep?.status === "final" ? ownStep.transactionHash : null;
  const completedDigest = ownStep?.transactionDigest;
  const pendingStep = plan?.steps.find(item => item.transactionHash && item.status !== "final");
  const observedPending = observedSubmission && !(plan ? plan.steps.find(item => item.stepId === observedSubmission.stepId)?.status === "final" : resource.status === "finalized") ? observedSubmission : null;
  const hash = ownAttempt?.transactionHash ?? pendingStep?.transactionHash ?? legacySubmission?.transactionHash ?? observedPending?.hash ?? null;
  const submittedStepId = ownAttempt?.stepId ?? pendingStep?.stepId ?? legacySubmission?.stepId ?? observedPending?.stepId ?? "multi-role-v2";
  const hasUnresolved = !!rawJournal || !!legacySubmission || !!pendingStep || !!observedPending;
  const unknownSend = !!ownAttempt && !hash;
  const visibleReview = review?.stepId === (step?.stepId ?? "multi-role-v2") && ready && !hasUnresolved ? review : null;
  const presentation = plan ? launchFlowPresentationV1(hasUnresolved ? { ...plan, continuation: undefined } : plan, ownAttempt ? { stepId: ownAttempt.stepId,
    transactionDigest: ownAttempt.binding, transactionHash: ownAttempt.transactionHash } : null) : null;
  const steps = presentation?.steps ?? [{ id: "multi-role-v2", label: "Launch and Programmable Stamp", status: resource.status === "finalized" ? "final" as const : hash ? "broadcast" as const : "pending" as const, stamp: true }];
  const state = presentation?.state ?? { title: resource.status === "finalized" ? "Confirming website indexing" : hash ? "Transaction submitted" : ready ? "Ready to launch" : "Preparing your launch",
    description: hash ? "Tracking continues automatically with the saved transaction hash." : ready ? "Check the wallet and current cost, then confirm the launch in your wallet." : "Tracking continues automatically. Reopen this launch to continue.", terminal: resource.status === "finalized" };

  async function loadFreshCapabilities() {
    const response = await fetch(`https://api.programmable.market/v4/chains/4663/${plan ? "custom-launch-capabilities" : "multi-role-custom-launches/capabilities"}`, { cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Current wallet bindings are unavailable. Refresh this launch to try again.");
    return response.json() as Promise<unknown>;
  }

  useEffect(() => {
    if (!ready || hasUnresolved || !autoPrepare) return;
    let current = true;
    void sendWallet({ action: "review", sourceVersion: entry.sourceVersion, reviewedResource: resource,
      stepId: step?.stepId, loadFreshResource: load, loadFreshCapabilities: async () => {
        const response = await fetch(`https://api.programmable.market/v4/chains/4663/${entry.sourceVersion === "custom_launch_plan_v1" ? "custom-launch-capabilities" : "multi-role-custom-launches/capabilities"}`, { cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Current wallet bindings are unavailable. Refresh this launch to try again.");
        return response.json();
      } }).then(value => { if (current && typeof value !== "string") { setReview(value); setError(null); } })
      .catch(caught => { if (current) { setReview(null); setError(caught instanceof Error ? caught.message : "Could not load the wallet review."); } });
    return () => { current = false; };
  }, [ready, hasUnresolved, autoPrepare, entry.sourceVersion, resource, step?.stepId, load, sendWallet]);

  useEffect(() => {
    if (!ownAttempt || !completedHash || !completedDigest) return;
    try {
      const bound = ownAttempt.transactionHash ? ownAttempt : rememberLaunchHashV1(ownAttempt, completedHash);
      finalizeLaunchSendV1(bound, { transactionHash: completedHash, transactionDigest: completedDigest, status: "final" });
    } catch { /* The journal stays locked when exact reconciliation cannot be persisted. */ }
  }, [ownAttempt, completedHash, completedDigest]);

  useEffect(() => {
    if (!hash || ownStep?.status === "final") return;
    let active = true; let inFlight = false;
    const track = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await onSubmittedRef.current(submittedStepId, hash); if (active) setTrackingError(null); }
      catch { if (active) setTrackingError("The transaction is saved. Tracking will retry automatically with the same hash."); }
      finally { inFlight = false; }
    };
    void track(); const timer = window.setInterval(() => void track(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [hash, submittedStepId, ownStep?.status]);

  useEffect(() => {
    if (!state.terminal) return;
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch(`/api/launch-projections/${encodeURIComponent(id)}?source=${entry.sourceVersion}`, { cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (response.status === 202) return;
        if (!response.ok) throw new Error("Website indexing is temporarily unavailable. Your completed launch is saved; this page will keep checking.");
        const body: unknown = await response.json();
        if (!projectionObject(body) || body.schemaVersion !== "programmable.website-indexed-launch.v1" || body.status !== "indexed") throw new Error("The website index has not confirmed this launch yet.");
        const projection = parseLaunchProjectionV1(body.projection);
        const address = projectionToRobinhoodLaunch(projection).tokenAddress;
        const href = `/token/${address}?chain=4663`;
        if (projection.launchId !== id || projection.sourceVersion !== entry.sourceVersion || projection.controller.toLowerCase() !== entry.controller.toLowerCase()
          || plan && (projection.planHash !== plan.planHash || projection.manifestDigest !== plan.manifestDigest) || body.href !== href) throw new Error("The indexed program does not match this launch. Keep this page open while it is reconciled.");
        setIndexedHref(href); setTrackingError(null);
        if (highlighted && !navigated.current) { navigated.current = true; if (onIndexed) onIndexed(href); else router.push(href); }
      } catch (caught) { if (!controller.signal.aborted) setTrackingError(caught instanceof Error ? caught.message : "Website indexing is pending."); }
    };
    void check(); const timer = window.setInterval(() => void check(), 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [state.terminal, id, entry.sourceVersion, entry.controller, plan, highlighted, onIndexed, router]);

  async function action(mode: "review" | "send" | "recover" | "switch_chain") {
    if (mode === "recover" && !/^0x[0-9a-f]{64}$/i.test(recoveryHash)) { setError("Enter the transaction hash from the original wallet activity."); recoveryInput.current?.focus(); return; }
    setBusy(mode === "switch_chain" ? "review" : mode); setError(null);
    try {
      const result = await sendWallet({ action: mode, sourceVersion: entry.sourceVersion, reviewedResource: resource,
        stepId: mode === "recover" ? ownAttempt?.stepId : step?.stepId, reviewed: review ?? undefined,
        ...(mode === "recover" ? { recoveryHash: recoveryHash as Hex } : {}), loadFreshResource: load, loadFreshCapabilities });
      if (typeof result === "string") {
        setReview(null);
        const sentStep = mode === "recover" ? ownAttempt!.stepId : step?.stepId ?? "multi-role-v2";
        setObservedSubmission({ stepId: sentStep, hash: result });
        try { await onSubmitted(sentStep, result); }
        catch { setTrackingError("The transaction is saved. Tracking will retry automatically with the same hash."); }
      } else setReview(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not complete the wallet action."); if (mode === "send") setReview(null); }
    finally { setBusy(null); }
  }

  return <li className={styles.flow} data-highlighted={highlighted} aria-labelledby={`${recoveryId}-title`}>
    <div className={styles.topline}><div><p className={styles.eyebrow}>Programmable Launch</p><h3 id={`${recoveryId}-title`}>{title}</h3></div><span className={styles.network}>Robinhood Chain · 4663</span></div>
    {plan?.plan.publication?.description ? <p className={styles.description}>{plan.plan.publication.description}</p> : null}
    <div className={styles.progress} aria-live="polite"><h4>{indexedHref ? "Your program is ready" : busy === "send" ? "Confirm in your wallet" : unknownSend ? "Recover your wallet transaction" : state.title}</h4>
      <p>{indexedHref ? "The finalized launch is stored in the website index." : unknownSend ? "The wallet call may have been sent. Check the original wallet activity or explorer and recover its hash. This step stays paused until the same transaction is verified." : state.description}</p></div>
    <dl className={styles.summary}><div><dt>Controller wallet</dt><dd><span title={entry.controller}>{shortAddress(entry.controller)}</span></dd></div><div><dt>Wallet transactions</dt><dd>{steps.length} including Stamp</dd></div>
      <div><dt>{visibleReview ? "Current transaction value" : "Launch value limit"}</dt><dd>{formatEther(BigInt(visibleReview?.valueWei ?? plan?.plan.budgets.maxTotalValue ?? "0"))} ETH</dd></div>
      <div><dt>Current estimated gas cost</dt><dd>{visibleReview ? `${formatEther(BigInt(visibleReview.maxGasCostWei))} ETH` : ready && !hasUnresolved && autoPrepare && !error ? "Checking current cost…" : "Shown before confirmation"}</dd></div></dl>
    <ol className={styles.steps} aria-label="Launch steps">{steps.map((item, index) => <li key={item.id} data-status={item.status} aria-current={item.id === step?.stepId ? "step" : undefined}><span className={styles.stepNumber}>{item.status === "final" ? "✓" : index + 1}</span><div><span>{item.label}</span><small>{stepLabels[item.status]}{item.stamp && item.status === "pending" && plan?.plan.executor !== "atomic_execute_and_stamp_v2" ? " · after contract finality" : ""}</small></div></li>)}
      <li data-status={indexedHref ? "final" : "pending"}><span className={styles.stepNumber}>{indexedHref ? "✓" : steps.length + 1}</span><div><span>Public website index</span><small>{indexedHref ? "Indexed" : "Automatic after finality · no wallet transaction"}</small></div></li></ol>
    {journalError ? <p role="alert" className={styles.error}>{journalError} This launch remains paused.</p> : null}
    {attempt && !ownAttempt ? <p className={styles.notice}>A previous launch transaction needs recovery or finality. <a href={launchPlanWalletUrlV1(attempt.launchId)}>Open its launch</a> before sending another transaction.</p> : null}
    {unknownSend && busy !== "send" ? <form className={styles.recovery} onSubmit={event => { event.preventDefault(); void action("recover"); }}><label htmlFor={recoveryId}>Transaction hash from your wallet</label><input ref={recoveryInput} id={recoveryId} value={recoveryHash} onChange={event => setRecoveryHash(event.target.value.trim())} autoComplete="off" spellCheck={false} placeholder="0x…" aria-describedby={`${recoveryId}-nonce`} />
      <p id={`${recoveryId}-nonce`}>This attempt is bound to controller nonce {BigInt(ownAttempt.nonce).toString()}. A missing provider result will keep it paused.</p><button type="submit" className={shared.primaryButton} disabled={!!busy}>{busy === "recover" ? "Checking transaction…" : "Recover transaction"}</button>
      <a href={`https://robinhoodchain.blockscout.com/address/${entry.controller}`} target="_blank" rel="noreferrer">Open controller activity</a></form> : null}
    {hash ? <p className={styles.receipt}>Transaction saved. <a href={`https://robinhoodchain.blockscout.com/tx/${hash}`} target="_blank" rel="noreferrer"><code>{hash}</code></a></p> : null}
    {visibleReview ? <div className={styles.confirmation}><p>Next: <strong>{steps.find(item => item.id === visibleReview.stepId)?.label ?? "Launch and Stamp"}</strong>. Estimated total for this transaction: <strong>{formatEther(BigInt(visibleReview.valueWei) + BigInt(visibleReview.maxGasCostWei))} ETH</strong>.</p>
      {visibleReview.createdAddress ? <p>Direct contract deployment. Your wallet is the constructor sender.</p> : null}
      {visibleReview.controllerAuthorization ? <p>Confirm the bound Safe nonce and owner threshold in the controller wallet. Signature collection and finality remain pending.</p> : null}
      <button className={shared.primaryButton} type="button" disabled={!!busy} onClick={() => void action("send")}>{busy === "send" ? "Confirm in your wallet…" : "Confirm in wallet"}</button><p className={styles.hint}>The exact transaction is checked again before opening your wallet.{steps.length > 1 ? " Later steps show their own current gas cost." : " This transaction includes the Programmable Stamp."}</p></div>
      : ready && !hasUnresolved ? <button className={shared.secondaryButton} type="button" disabled={!!busy} onClick={() => void action("switch_chain")}>{busy ? "Checking wallet…" : error && /chain|network|controller account/i.test(error) ? "Switch network and check wallet" : "Refresh wallet review"}</button> : null}
    {indexedHref ? <a className={styles.programLink} href={indexedHref}>Open program</a> : null}
    {(error || trackingError) ? <p className={styles.error} role={error ? "alert" : "status"}>{error ?? trackingError}</p> : null}
    {plan?.preflight?.findings.length ? <details className={styles.details}><summary>Launch findings</summary><pre>{JSON.stringify(plan.preflight.findings, null, 2)}</pre></details> : null}
    {!hasUnresolved && (plan?.status === "expired" || plan?.status === "action_required" || plan?.continuation) ? <p className={styles.notice}>Continue with your bot using launch ID <code>{id}</code>. Replanning uses the existing API and must preserve all completed steps.</p> : null}
    <details className={styles.details}><summary>Transaction and launch details</summary><dl className={styles.summary}><div><dt>Controller</dt><dd><code>{entry.controller}</code></dd></div><div><dt>Launch ID</dt><dd><code>{id}</code></dd></div></dl>
      <pre>{JSON.stringify({ manifestDigest: plan?.manifestDigest, components: plan?.plan.components, markets: plan?.plan.markets, feeObligations: plan?.plan.feeObligations,
        transaction: visibleReview?.transaction, decodedOperation: visibleReview?.decodedOperation, controllerAuthorization: visibleReview?.controllerAuthorization,
        preconditions: visibleReview?.preconditions, postconditions: visibleReview?.postconditions, recovery: ownAttempt, continuation: plan?.continuation, status: resource.status }, null, 2)}</pre></details>
  </li>;
}
