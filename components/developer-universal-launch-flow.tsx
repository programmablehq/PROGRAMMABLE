"use client";

import NextImage from "next/image";
import { CustomLaunchProgress } from "./custom-launch-progress";
import { useLaunchStatusPolling } from "./use-launch-status-polling";
import { safePublicImageUrl } from "@/lib/safe-public-image-url";
import { CustomLaunchAssessment } from "./custom-launch-assessment";
import { CustomLaunchDiscussion } from "./custom-launch-discussion";
import { CustomLaunchStartButton } from "./custom-launch-start-button";
import { customLaunchReviewAllowsSigning } from "@/lib/custom-launch-review";
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
  sendWallet(input: UniversalLaunchWalletInputV1): Promise<UniversalLaunchWalletReviewV1 | Hex | null>;
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
  const ready = plan ? !!step && !plan.continuation && (!plan.manualReview || customLaunchReviewAllowsSigning(plan.manualReview)) : ["authorized", "awaiting_wallet_signature", "wallet_action_required"].includes(String(resource.status));
  const wallet = projectionObject(resource.wallet) ? resource.wallet : null;
  const summary = wallet && projectionObject(wallet.launchSummary) ? wallet.launchSummary : null;
  const title = plan?.plan.publication?.name ?? (typeof summary?.name === "string" ? summary.name : "Custom project");
  const symbol = plan?.plan.publication?.symbol ?? (typeof summary?.symbol === "string" ? summary.symbol : "");
  const imageUrl = safePublicImageUrl(plan?.plan.publication?.imageUrl ?? summary?.imageUrl);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [review, setReview] = useState<UniversalLaunchWalletReviewV1 | null>(null);
  const [busy, setBusy] = useState<"review" | "send" | "recover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [indexedHref, setIndexedHref] = useState<string | null>(null);
  const [observedSubmission, setObservedSubmission] = useState<{ stepId: string; hash: Hex } | null>(null);
  const recoveryInput = useRef<HTMLInputElement>(null);
  const actionInFlight = useRef(false);
  const recoveryId = useId();
  const navigated = useRef(false);
  const onSubmittedRef = useRef(onSubmitted);
  useEffect(() => { onSubmittedRef.current = onSubmitted; }, [onSubmitted]);
  const reviewCallbacks = useRef({ load, sendWallet, resource });
  useEffect(() => { reviewCallbacks.current = { load, sendWallet, resource }; }, [load, sendWallet, resource]);
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
  const visibleError = hash ? trackingError : error ?? trackingError;
  const submittedStepId = ownAttempt?.stepId ?? pendingStep?.stepId ?? legacySubmission?.stepId ?? observedPending?.stepId ?? "multi-role-v2";
  const hasUnresolved = !!rawJournal || !!legacySubmission || !!pendingStep || !!observedPending;
  const unknownSend = !!ownAttempt && !hash;
  const visibleReview = review?.stepId === (step?.stepId ?? "multi-role-v2") && ready && !hasUnresolved ? review : null;
  const presentation = plan ? launchFlowPresentationV1(hasUnresolved ? { ...plan, continuation: undefined } : plan, ownAttempt ? { stepId: ownAttempt.stepId,
    transactionDigest: ownAttempt.binding, transactionHash: ownAttempt.transactionHash } : null) : null;
  const steps = presentation?.steps ?? [{ id: "multi-role-v2", label: "Launch and Programmable Stamp", status: resource.status === "finalized" ? "final" as const : hash ? "broadcast" as const : "pending" as const, stamp: true }];
  const state = presentation?.state ?? { title: resource.status === "finalized" ? "Confirming website indexing" : hash ? "Transaction submitted" : ready && !hasUnresolved ? "Ready to launch" : "Preparing your launch",
    description: hash ? "Tracking continues automatically with the saved transaction hash." : ready ? "Check the wallet and current cost, then confirm the launch in your wallet." : "Tracking continues automatically. Reopen this launch to continue.", terminal: resource.status === "finalized" };

  async function loadFreshCapabilities() {
    const response = await fetch(`https://api.programmable.market/v4/chains/4663/${plan ? "custom-launch-capabilities" : "multi-role-custom-launches/capabilities"}`, { cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Current wallet bindings are unavailable. Refresh this launch to try again.");
    return response.json() as Promise<unknown>;
  }

  useEffect(() => {
    if (!ready || hasUnresolved || !autoPrepare) return;
    let current = true;
    // Session refreshes replace callbacks without changing the reviewed launch.
    // They must not cancel and restart the same automatic wallet review.
    const callbacks = reviewCallbacks.current;
    void callbacks.sendWallet({ action: "review", sourceVersion: entry.sourceVersion, reviewedResource: resource,
      stepId: step?.stepId, loadFreshResource: callbacks.load, loadFreshCapabilities: async () => {
        const response = await fetch(`https://api.programmable.market/v4/chains/4663/${entry.sourceVersion === "custom_launch_plan_v1" ? "custom-launch-capabilities" : "multi-role-custom-launches/capabilities"}`, { cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Current wallet bindings are unavailable. Refresh this launch to try again.");
        return response.json();
      } }).then(value => { if (current && typeof value !== "string") { setReview(value); setError(null); } })
      .catch(caught => { if (current) { setReview(null); setError(caught instanceof Error ? caught.message : "Could not load the wallet review."); } });
    return () => { current = false; };
  }, [ready, hasUnresolved, autoPrepare, entry.sourceVersion, resource, step?.stepId]);

  useEffect(() => {
    if (!ownAttempt || !completedHash || !completedDigest) return;
    try {
      const bound = ownAttempt.transactionHash ? ownAttempt : rememberLaunchHashV1(ownAttempt, completedHash);
      finalizeLaunchSendV1(bound, { transactionHash: completedHash, transactionDigest: completedDigest, status: "final" });
    } catch { /* The journal stays locked when exact reconciliation cannot be persisted. */ }
  }, [ownAttempt, completedHash, completedDigest]);

  useLaunchStatusPolling(`${entry.controller}:${id}:discovery`, !!ownAttempt && unknownSend && !completedHash, async signal => {
    if (!ownAttempt) return;
    const callbacks = reviewCallbacks.current;
    await callbacks.sendWallet({ action: "discover", sourceVersion: ownAttempt.sourceVersion,
      reviewedResource: callbacks.resource, stepId: ownAttempt.stepId, signal,
      loadFreshResource: callbacks.load, loadFreshCapabilities: async () => null });
  }, 20000, true);

  useLaunchStatusPolling(`${entry.controller}:${id}:${submittedStepId}:${hash ?? ""}`, !!hash && ownStep?.status !== "final", async signal => {
    if (!hash) return;
    try { await onSubmittedRef.current(submittedStepId, hash); if (!signal.aborted) setTrackingError(null); }
    catch (caught) {
      if (!signal.aborted) setTrackingError("Your transaction is saved. Confirmation will update automatically.");
      throw caught;
    }
  }, 60000, true);

  useLaunchStatusPolling(`${entry.controller}:${entry.sourceVersion}:${id}:index`, state.terminal && !indexedHref, async signal => {
    try {
      const response = await fetch(`/api/launch-projections/${encodeURIComponent(id)}?source=${entry.sourceVersion}`, { cache: "no-store", redirect: "error", signal });
      if (response.status === 202) return;
      if (!response.ok) throw new Error("Your launch is confirmed. We’re waiting for it to appear on Explore.");
      const body: unknown = await response.json();
      if (!projectionObject(body) || body.schemaVersion !== "programmable.website-indexed-launch.v1" || body.status !== "indexed") throw new Error("The website index has not confirmed this launch yet.");
      const projection = parseLaunchProjectionV1(body.projection);
      const address = projectionToRobinhoodLaunch(projection).tokenAddress;
      const href = `/token/${address}?chain=4663`;
      if (projection.launchId !== id || projection.sourceVersion !== entry.sourceVersion || projection.controller.toLowerCase() !== entry.controller.toLowerCase()
        || plan && (projection.planHash !== plan.planHash || projection.manifestDigest !== plan.manifestDigest) || body.href !== href) throw new Error("The indexed program does not match this launch. Keep this page open while it is reconciled.");
      if (signal.aborted) return;
      setIndexedHref(href); setTrackingError(null);
      if (highlighted && !navigated.current) { navigated.current = true; if (onIndexed) onIndexed(href); else router.push(href); }
    } catch (caught) {
      if (!signal.aborted) setTrackingError(caught instanceof Error ? caught.message : "Website indexing is pending.");
      throw caught;
    }
  }, 15000, true);

  async function action(mode: "review" | "send" | "recover" | "switch_chain") {
    if (mode === "recover" && !/^0x[0-9a-f]{64}$/i.test(recoveryHash)) { setError("Enter the transaction hash from the original wallet activity."); recoveryInput.current?.focus(); return; }
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(mode === "switch_chain" ? "review" : mode); setError(null);
    try {
      let currentReview = visibleReview;
      if (mode === "send" && !currentReview) {
        const prepared = await sendWallet({ action: "switch_chain", sourceVersion: entry.sourceVersion, reviewedResource: resource,
          stepId: step?.stepId, loadFreshResource: load, loadFreshCapabilities });
        if (!prepared || typeof prepared === "string") throw new Error("Unable to prepare this launch transaction.");
        currentReview = prepared;
        setReview(prepared);
      }
      const result = await sendWallet({ action: mode, sourceVersion: entry.sourceVersion, reviewedResource: resource,
        stepId: mode === "recover" ? ownAttempt?.stepId : step?.stepId, reviewed: currentReview ?? undefined,
        ...(mode === "recover" ? { recoveryHash: recoveryHash as Hex } : {}), loadFreshResource: load, loadFreshCapabilities });
      if (typeof result === "string") {
        setReview(null);
        const sentStep = mode === "recover" ? ownAttempt!.stepId : step?.stepId ?? "multi-role-v2";
        setObservedSubmission({ stepId: sentStep, hash: result });
        // The single tracking loop submits the saved hash, including after reload.
        // Do not race it with a second proof request from the click handler.
      } else setReview(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not complete the wallet action."); if (mode === "send") setReview(null); }
    finally { actionInFlight.current = false; setBusy(null); }
  }

  return <li className={styles.flow} data-highlighted={highlighted} aria-labelledby={`${recoveryId}-title`}>
    <div className={styles.topline}>
      <div className={styles.identity}>
        <div className={styles.artwork}>{imageUrl && imageUrl !== failedImage
          ? <NextImage src={imageUrl} alt="" width={64} height={64} unoptimized referrerPolicy="no-referrer" onError={() => setFailedImage(imageUrl)} />
          : <span aria-hidden="true">{(symbol || title).replace(/^\$+/, "").slice(0, 2).toUpperCase()}</span>}</div>
        <div><p className={styles.eyebrow}>Robinhood Chain</p><h3 id={`${recoveryId}-title`}>{title}</h3>{symbol ? <p className={styles.ticker}>{symbol.replace(/^\$+/, "")}</p> : null}</div>
      </div>
    </div>
    <CustomLaunchProgress status={String(resource.status)} review={plan?.manualReview} launchId={id} chainId="4663" indexed={!!indexedHref} />
    <div className={styles.progress} aria-live="polite"><h4>{indexedHref ? "Launch complete" : busy === "send" && !hash ? "Confirm in your wallet" : unknownSend ? "Checking your transaction" : ready && !hasUnresolved ? "Ready to launch" : state.title}</h4>
      <p>{indexedHref ? "Your coin is live on Explore." : busy === "send" && !hash ? "Confirm the launch in your wallet." : unknownSend ? "We’ll continue automatically when your transaction is found. If your wallet is still waiting, confirm or cancel there." : ready && !hasUnresolved ? "Your wallet opens when you choose Sign and launch." : state.description}</p></div>
    {plan?.manualReview && !hasUnresolved && !state.terminal
      ? <CustomLaunchStartButton key={`${id}:${plan.manualReview.revision}`} review={plan.manualReview} launchId={id} onStarted={load} /> : null}
    {journalError ? <p role="alert" className={styles.error}>{journalError} This launch remains paused.</p> : null}
    {attempt && !ownAttempt ? <p className={styles.notice}>A previous launch transaction needs recovery or finality. <a href={launchPlanWalletUrlV1(attempt.launchId)}>Open its launch</a> before sending another transaction.</p> : null}
    {unknownSend && busy !== "send" ? <details className={styles.recoveryDetails}><summary>I already sent it</summary><form className={styles.recovery} onSubmit={event => { event.preventDefault(); void action("recover"); }}><label htmlFor={recoveryId}>Paste the transaction ID from your wallet</label><input ref={recoveryInput} id={recoveryId} value={recoveryHash} onChange={event => setRecoveryHash(event.target.value.trim())} autoComplete="off" spellCheck={false} placeholder="0x…" aria-describedby={`${recoveryId}-nonce`} />
      <p id={`${recoveryId}-nonce`}>We’ll check the original transaction and continue tracking it.</p><button type="submit" className={shared.primaryButton} disabled={!!busy}>{busy === "recover" ? "Checking transaction…" : "Check transaction"}</button>
      <a href={`https://robinhoodchain.blockscout.com/address/${entry.controller}`} target="_blank" rel="noreferrer">View wallet activity</a></form></details> : null}
    {hash ? <p className={styles.receipt}>Transaction saved. <a href={`https://robinhoodchain.blockscout.com/tx/${hash}`} target="_blank" rel="noreferrer">View transaction</a></p> : null}
    {ready && !hasUnresolved ? <div className={styles.confirmation}>
      {visibleReview ? <p>Estimated total: <strong>{formatEther(BigInt(visibleReview.valueWei) + BigInt(visibleReview.maxGasCostWei))} ETH</strong></p> : null}
      <button className={shared.primaryButton} type="button" disabled={!!busy} onClick={() => void action("send")}>{busy ? "Confirm in your wallet…" : "Sign and launch"}</button>
    </div> : null}
    {plan?.manualReview?.expiresAt && ready && !hasUnresolved ? <p className={styles.notice}>Launch by {new Date(plan.manualReview.expiresAt).toLocaleString()}.</p> : null}
    {indexedHref ? <a className={styles.programLink} href={indexedHref}>Open program</a> : null}
    {visibleError ? <p className={styles.error} role={!hash && error ? "alert" : "status"}>{visibleError}</p> : null}
    {!hasUnresolved && (plan?.status === "expired" || plan?.status === "action_required" || plan?.continuation) ? <p className={styles.notice}>Continue with your bot using launch ID <code>{id}</code>. Replanning uses the existing API and must preserve all completed steps.</p> : null}
    <details className={styles.details}><summary>Details and review</summary>
    {plan?.preflight?.findings.length ? <details className={styles.details}><summary>Launch findings</summary><pre>{JSON.stringify(plan.preflight.findings, null, 2)}</pre></details> : null}
    <dl className={styles.summary}><div><dt>Controller wallet</dt><dd><span title={entry.controller}>{shortAddress(entry.controller)}</span></dd></div><div><dt>Wallet transactions</dt><dd>{steps.length} including Stamp</dd></div>
      <div><dt>{visibleReview ? "Current transaction value" : "Launch value limit"}</dt><dd>{formatEther(BigInt(visibleReview?.valueWei ?? plan?.plan.budgets.maxTotalValue ?? "0"))} ETH</dd></div>
      <div><dt>Current estimated gas cost</dt><dd>{visibleReview ? `${formatEther(BigInt(visibleReview.maxGasCostWei))} ETH` : ready && !hasUnresolved && autoPrepare && !error ? "Checking current cost…" : "Shown before confirmation"}</dd></div></dl>
    <ol className={styles.steps} aria-label="Launch steps">{steps.map((item, index) => <li key={item.id} data-status={item.status} aria-current={item.id === step?.stepId ? "step" : undefined}><span className={styles.stepNumber}>{item.status === "final" ? "✓" : index + 1}</span><div><span>{item.label}</span><small>{stepLabels[item.status]}{item.stamp && item.status === "pending" && plan?.plan.executor !== "atomic_execute_and_stamp_v2" ? " · after contract finality" : ""}</small></div></li>)}
      <li data-status={indexedHref ? "final" : "pending"}><span className={styles.stepNumber}>{indexedHref ? "✓" : steps.length + 1}</span><div><span>Public website index</span><small>{indexedHref ? "Indexed" : "Automatic after finality · no wallet transaction"}</small></div></li></ol>
    <dl className={styles.summary}><div><dt>Controller</dt><dd><code>{entry.controller}</code></dd></div><div><dt>Launch ID</dt><dd><code>{id}</code></dd></div></dl>
      {ownAttempt ? <p>Saved wallet attempt · nonce {BigInt(ownAttempt.nonce).toString()}</p> : null}
    <CustomLaunchAssessment value={(plan?.preflight as unknown as Record<string, unknown>)?.reviewReadiness} review={plan?.manualReview} subjectHash={plan?.manualReview?.subjectHash} chainId={plan?.manualReview?.chainId} tradeChecks={plan?.manualReview?.tradeChecks} />
    {plan?.manualReview ? <CustomLaunchDiscussion review={plan.manualReview} launchId={id} onUpdated={load} /> : null}
      <pre>{JSON.stringify({ manifestDigest: plan?.manifestDigest, components: plan?.plan.components, markets: plan?.plan.markets, feeObligations: plan?.plan.feeObligations,
        transaction: visibleReview?.transaction, decodedOperation: visibleReview?.decodedOperation, controllerAuthorization: visibleReview?.controllerAuthorization,
        preconditions: visibleReview?.preconditions, postconditions: visibleReview?.postconditions, recovery: ownAttempt, continuation: plan?.continuation, status: resource.status }, null, 2)}</pre></details>
  </li>;
}
