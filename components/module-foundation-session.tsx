"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getAddress, keccak256, type Address, type Hex, type TransactionReceipt } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { assertModuleModeWalletUnchanged, moduleModeWalletStep, switchModuleModeNetwork, useModuleModeOperation, type ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import { browserWalletRequestIsPending, subscribeToBrowserWalletRequest } from "@/lib/wallet-request-lock";
import { foundationBindingChainId, foundationChainProfile, type FoundationChainId } from "@/lib/module-foundation/chains";
import { createFoundationClient } from "@/lib/module-foundation/client";
import { fetchFoundationAvailability, FoundationProviderDisagreementError, type FoundationAvailabilityEnvelope } from "@/lib/module-foundation/availability";
import { bindFoundationCatalogV1 } from "@/lib/module-foundation/catalog";
import { readFoundationLaunchDisplay, rememberFoundationLaunchDisplay, subscribeFoundationLaunchDisplay } from "@/lib/module-foundation/launch-display-cache";
import { bindFoundationWalletStep, FOUNDATION_PENDING_EVENT, readFoundationPending, readFoundationLaunchRetry, reconcileFoundationPending, recoverFoundationPending,
  submitFoundationWalletStep, type FoundationLaunchRetry, type FoundationPreparedSequence } from "@/lib/module-foundation/wallet";
import { acknowledgeFoundationResolution, FOUNDATION_RESOLUTION_EVENT, readFoundationResolution,
  type FoundationResolution } from "@/lib/module-foundation/result-store";
import type { FoundationAvailability, FoundationTransactionResult, FoundationWalletAction } from "@/lib/module-foundation/ui-types";
import styles from "./module-foundation-ui.module.css";
import { watchFoundationRecovery } from "@/lib/module-foundation/recovery";
import { announceFoundationLaunch } from "@/lib/module-foundation/announce-launch";

export interface FoundationExecutionResult {
  result: FoundationTransactionResult;
  receipt?: TransactionReceipt;
  sequence: FoundationPreparedSequence;
  stepIndex: number;
}

/** Newly launched coins can reach the page before both providers observe their registration. */
export async function loadFoundationSessionAvailability(signal: AbortSignal, token?: Address, chainId: FoundationChainId = 4663): Promise<FoundationAvailabilityEnvelope> {
  const attempts = 4;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal.throwIfAborted();
    try {
      const value = await (chainId === 4663 ? fetchFoundationAvailability(signal, token) : fetchFoundationAvailability(signal, token, chainId));
      signal.throwIfAborted();
      if (value.available || value.indexPending || value.stampMissing || (!token && !value.providerDisagreement) || attempt === attempts - 1) return value;
    } catch (error) {
      signal.throwIfAborted();
      if (!token || attempt === attempts - 1) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2_000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new Error("Coin availability could not be checked.");
}

export function useFoundationSession(token?: Address, chainId: FoundationChainId = 4663) {
  const profile = foundationChainProfile(chainId);
  const walletContext = useWallet();
  const { wallet, authenticated, sessionReady, authReady, connecting, openingWallet, switchingNetwork, disconnecting, openWallet, switchNetwork, sendModuleModeTransaction } = walletContext;
  // Batch independent reads without caching their answers. Wallet checks still use fresh chain state.
  const client = useMemo(() => createFoundationClient({ batchRpc: true, chainId }), [chainId]);
  const targetKey = `${chainId}:${token?.toLowerCase() ?? "launch"}`;
  const [envelopeState, setEnvelopeState] = useState<{ targetKey: string; refresh: number; value: FoundationAvailabilityEnvelope | null } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const indexRetries = useRef({ targetKey, count: 0 });
  const displayEnvelope = useSyncExternalStore(subscribeFoundationLaunchDisplay, useCallback(() => readFoundationLaunchDisplay(Date.now(), chainId), [chainId]), () => null);
  const envelope = envelopeState?.targetKey === targetKey && (!token || envelopeState.refresh === refresh) ? envelopeState.value : null;
  const availabilityError = envelopeState?.targetKey === targetKey && envelopeState.refresh === refresh && envelopeState.value === null;
  const [progress, setProgress] = useState("");
  const [resultGeneration, setResultGeneration] = useState(0);
  const account = wallet?.account ? getAddress(wallet.account) : undefined;
  const walletSnapshot = useMemo<ModuleModeWalletSnapshot>(() => ({ account: wallet?.account, chainId: wallet?.chainId, authenticated, sessionReady }),
    [wallet?.account, wallet?.chainId, authenticated, sessionReady]);
  const walletRef = useRef(walletSnapshot);
  const sourceRef = useRef(envelope);
  const mounted = useRef(true);
  const executing = useRef(false);
  const used = useRef(new WeakSet<FoundationPreparedSequence>());
  const outcomes = useRef(new Map<Hex, FoundationExecutionResult>());
  const savedLegacy = useModuleModeOperation(account);
  const subscribeRequest = useCallback((listener: () => void) => subscribeToBrowserWalletRequest(account, String(chainId), listener), [account, chainId]);
  const requestSnapshot = useCallback(() => browserWalletRequestIsPending(account, String(chainId)), [account, chainId]);
  const requestPending = useSyncExternalStore(subscribeRequest, requestSnapshot, () => false);
  const subscribePending = useCallback((listener: () => void) => {
    window.addEventListener("storage", listener); window.addEventListener(FOUNDATION_PENDING_EVENT, listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener(FOUNDATION_PENDING_EVENT, listener); };
  }, []);
  const pendingSnapshot = useCallback(() => {
    try { return account ? JSON.stringify(readFoundationPending(account, chainId)) : "null"; }
    catch { return "unreadable"; }
  }, [account, chainId]);
  const pending = useSyncExternalStore(subscribePending, pendingSnapshot, () => "null");
  const pendingTransactionHash = useMemo(() => {
    if (pending === "null" || pending === "unreadable") return null;
    return (JSON.parse(pending) as { transactionHash: Hex | null }).transactionHash;
  }, [pending]);
  const [launchRetry, setLaunchRetry] = useState<FoundationLaunchRetry | null>(null);
  const retryAvailable = !token && !requestPending && launchRetry?.chainId === chainId
    && launchRetry.account === account && pending !== "null" && pending !== "unreadable"
    && JSON.parse(pending).operationId === launchRetry.operationId;
  const checkPending = useCallback(async (knownHash?: Hex) => {
    if (!account) return;
    try {
      const receipt = await recoverFoundationPending(client, account, knownHash);
      setLaunchRetry(null);
      return receipt;
    } catch (error) {
      const retry = !token && !knownHash ? await readFoundationLaunchRetry(client, account) : null;
      setLaunchRetry(retry);
      if (!retry) throw error;
      return null;
    }
  }, [account, client, token]);
  useEffect(() => {
    // An active submission already waits for its receipt. Recovery is for interrupted or reloaded sessions.
    if (!account || pending === "null" || pending === "unreadable" || progress || requestPending || executing.current) return;
    const start = () => watchFoundationRecovery({
      reconcile: () => checkPending(),
      visible: () => document.visibilityState === "visible",
    });
    let stop = start();
    const visibility = () => { stop(); if (document.visibilityState === "visible") stop = start(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { stop(); document.removeEventListener("visibilitychange", visibility); };
  }, [account, checkPending, pendingTransactionHash, pending, progress, requestPending]);
  const subscribeResolution = useCallback((listener: () => void) => {
    window.addEventListener("storage", listener); window.addEventListener(FOUNDATION_RESOLUTION_EVENT, listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener(FOUNDATION_RESOLUTION_EVENT, listener); };
  }, []);
  const resolutionSnapshot = useCallback(() => {
    try { return account ? JSON.stringify(readFoundationResolution(account, chainId)) : "null"; }
    catch { return "unreadable"; }
  }, [account, chainId]);
  const resolutionState = useSyncExternalStore(subscribeResolution, resolutionSnapshot, () => "null");
  const resolution = useMemo(() => resolutionState === "null" || resolutionState === "unreadable" ? null
    : JSON.parse(resolutionState) as FoundationResolution, [resolutionState]);
  useEffect(() => {
    if (resolution?.status === "success" && resolution.metadata?.stepKind === "launch" && resolution.metadata.token
      && Date.now() - resolution.resolvedAt < 60 * 60_000) {
      void announceFoundationLaunch({ chainId, token: resolution.metadata.token, transactionHash: resolution.transactionHash });
    }
  }, [resolution, chainId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadFoundationSessionAvailability(controller.signal, token, chainId).then(value => {
      if (!controller.signal.aborted) {
        if (!token) rememberFoundationLaunchDisplay(value);
        setEnvelopeState({ targetKey, refresh, value });
      }
    }).catch(() => { if (!controller.signal.aborted) setEnvelopeState({ targetKey, refresh, value: null }); });
    return () => controller.abort();
  }, [refresh, token, targetKey, chainId]);
  useEffect(() => {
    if (indexRetries.current.targetKey !== targetKey) indexRetries.current = { targetKey, count: 0 };
    if (chainId !== 1 || !token || !envelope?.indexPending || indexRetries.current.count >= 20) return;
    // Finality takes minutes. Do not repeat rapid provider reads or poll background tabs.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      indexRetries.current.count++;
      window.clearInterval(timer);
      setRefresh(value => value + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [chainId, token, targetKey, envelope?.indexPending]);
  const availability: FoundationAvailability = { status: availabilityError ? "unavailable" : !envelope ? "checking" : envelope.available ? "ready" : "unavailable",
    chainId, chainName: profile.name, reason: availabilityError ? "Launch availability could not be checked. Retry to keep working with this release." : envelope?.reason ?? undefined };
  const contextKey = `${account ?? "disconnected"}:${wallet?.chainId ?? "none"}:${authenticated}:${sessionReady}:${targetKey}:${envelope?.binding?.releaseDigest ?? "unavailable"}`;
  const currentContext = useRef(contextKey);
  const authorityRequest = useRef<{ context: string; promise: Promise<FoundationAvailabilityEnvelope> } | null>(null);
  useLayoutEffect(() => { walletRef.current = walletSnapshot; sourceRef.current = envelope; currentContext.current = contextKey; }, [walletSnapshot, envelope, contextKey]);
  function assertCurrent(expectedAccount: Address, expectedContext = currentContext.current) {
    if (!mounted.current || expectedContext !== currentContext.current) throw new Error("Your wallet or launch version changed. Review again.");
    assertModuleModeWalletUnchanged(walletRef.current, expectedAccount, chainId);
  }
  function readCurrentAuthority() {
    const context = currentContext.current;
    if (authorityRequest.current?.context === context) return authorityRequest.current.promise;
    const promise = fetchFoundationAvailability(undefined, token, chainId).finally(() => {
      if (authorityRequest.current?.promise === promise) authorityRequest.current = null;
    });
    authorityRequest.current = { context, promise };
    return promise;
  }
  async function resolveAuthority() {
    const current = await readCurrentAuthority();
    if (current.providerDisagreement) throw new FoundationProviderDisagreementError();
    if (!current.available || !current.binding) throw new Error(current.reason ?? "This release is unavailable.");
    if (current.binding.releaseDigest !== sourceRef.current?.binding?.releaseDigest) throw new Error("The authorized launch version changed. Reload the release and review again.");
    return current.binding;
  }
  async function resolveCatalog() {
    const current = await readCurrentAuthority();
    if (current.providerDisagreement) throw new FoundationProviderDisagreementError();
    if (!current.available || !current.binding || current.binding.releaseDigest !== sourceRef.current?.binding?.releaseDigest) throw new Error("The admitted module catalog changed. Reload and review again.");
    return bindFoundationCatalogV1(current.catalog.document, current.catalog.authority);
  }
  const walletStep = moduleModeWalletStep(walletSnapshot, chainId);
  // A coin page may defer wallet loading until Connect is pressed.
  const walletBusy = connecting || openingWallet || switchingNetwork || disconnecting || (walletStep !== "connect" && !authReady);
  const walletAction: FoundationWalletAction | undefined = walletStep === "prepare" ? undefined : {
    label: walletStep === "connect" ? "Connect wallet" : `Switch to ${profile.name}`, busy: walletBusy,
    onClick: walletStep === "connect" ? openWallet : () => switchModuleModeNetwork(switchNetwork, chainId),
  };
  const preparationBlocked = pending !== "null" && !retryAvailable ? "Checking your previous wallet transaction. Your coin details are saved."
    : resolutionState === "unreadable" ? "The saved transaction result could not be read. Check wallet activity before continuing."
    : (chainId === 4663 && savedLegacy.blocked) ? "A previous Module Mode operation needs recovery before you continue."
      : requestPending ? "Complete the open wallet request before continuing." : undefined;
  const submissionBlocked = preparationBlocked ?? (resolution ? "Review the saved transaction result before starting another operation." : undefined);

  async function execute(sequence: FoundationPreparedSequence): Promise<FoundationExecutionResult> {
    if (executing.current || used.current.has(sequence)) throw new Error("Review a fresh operation before continuing.");
    if (foundationBindingChainId(sequence.binding) !== chainId) throw new Error("This preparation belongs to a different launch network.");
    assertCurrent(sequence.account);
    if ((chainId === 4663 && savedLegacy.blocked) || (readFoundationPending(sequence.account, chainId) && !retryAvailable)
      || readFoundationResolution(sequence.account, chainId)) throw new Error("Resolve the previous wallet operation first.");
    const retry = retryAvailable ? launchRetry! : undefined;
    executing.current = true; used.current.add(sequence);
    const expectedContext = currentContext.current;
    try {
      for (let index = 0; index < sequence.steps.length; index++) {
        assertCurrent(sequence.account, expectedContext);
        const step = sequence.steps[index];
        if (mounted.current) setProgress(sequence.kind === "launch" ? "Confirm in your wallet…" : `Step ${index + 1} of ${sequence.steps.length}: ${step.label}`);
        const preparation = bindFoundationWalletStep({ client, sequence, index, resolveAuthority, resolveCatalog });
        const hash = await submitFoundationWalletStep(preparation, sendModuleModeTransaction, true, retry);
        if (mounted.current) setProgress(sequence.kind === "launch" ? "Creating your coin…" : "Waiting for confirmation…");
        const outcome: FoundationExecutionResult = { sequence, stepIndex: index,
          result: { status: "submitted", transactionHash: hash, explorerUrl: `${profile.explorer}/tx/${hash}`,
            operationComplete: false, stepLabel: step.label,
            message: `${step.label} was submitted. Confirmation is being checked.` } };
        outcomes.current.set(hash, outcome);
        try {
          await client.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 2_000 });
          outcome.receipt = await reconcileFoundationPending(client, sequence.account, hash);
          if (outcome.receipt.status === "success" && sequence.kind === "launch" && step.kind === "launch") {
            void announceFoundationLaunch({ chainId, token: sequence.result.token, transactionHash: hash });
          }
          outcome.result = { ...outcome.result, status: outcome.receipt.status === "success" ? "confirmed" : "reverted",
            operationComplete: outcome.receipt.status === "success" && index === sequence.steps.length - 1,
            blockNumber: outcome.receipt.blockNumber.toString(), message: outcome.receipt.status === "success"
              ? `${step.label} is confirmed onchain. Settlement finality is checked separately.`
              : `${step.label} reverted. Network gas may have been charged.` };
          if (outcome.receipt.status === "reverted" || index === sequence.steps.length - 1) return outcome;
          // The reviewed sequence already authorizes continuing after each successful approval or ETH conversion.
          // Only intermediate prerequisites are acknowledged here; the final outcome remains durable.
          const saved = readFoundationResolution(sequence.account, chainId);
          if ((step.kind !== "approve" && step.kind !== "wrap") || !saved || saved.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("Review the saved transaction before continuing.");
          await acknowledgeFoundationResolution(sequence.account, saved.operationId, chainId);
        } catch {
          outcome.result = outcome.receipt ? { ...outcome.result, message: "The exact transaction is confirmed. Review its saved result before continuing the remaining steps." }
            : { ...outcome.result, status: "unconfirmed", message: "The transaction hash is saved. Check confirmation before continuing." };
          return outcome;
        }
      }
      throw new Error("The transaction sequence was empty.");
    } finally { executing.current = false; if (mounted.current) setProgress(""); }
  }
  async function refreshResult(result: FoundationTransactionResult): Promise<FoundationExecutionResult> {
    const outcome = outcomes.current.get(result.transactionHash);
    if (!outcome) throw new Error("Use the saved-operation recovery below to check this transaction.");
    const receipt = outcome.receipt ? await client.getTransactionReceipt({ hash: result.transactionHash })
      : await reconcileFoundationPending(client, outcome.sequence.account, result.transactionHash);
    const expected = outcome.sequence.steps[outcome.stepIndex].transaction;
    const transaction = await client.getTransaction({ hash: result.transactionHash });
    if (receipt.transactionHash.toLowerCase() !== result.transactionHash.toLowerCase()
      || getAddress(receipt.from) !== getAddress(outcome.sequence.account) || !receipt.to || getAddress(receipt.to) !== getAddress(expected.to)
      || transaction.hash.toLowerCase() !== result.transactionHash.toLowerCase() || getAddress(transaction.from) !== getAddress(expected.from)
      || !transaction.to || getAddress(transaction.to) !== getAddress(expected.to) || keccak256(transaction.input) !== keccak256(expected.data)
      || transaction.value !== expected.value || transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber
      || (transaction.chainId !== undefined && transaction.chainId !== chainId)) throw new Error("The saved transaction does not match the reviewed operation.");
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) throw new Error("The confirmation block changed. Check again.");
    outcome.receipt = receipt;
    outcome.result = { ...result, status: receipt.status === "success" ? "confirmed" : "reverted", blockNumber: receipt.blockNumber.toString(),
      operationComplete: receipt.status === "success" && outcome.stepIndex === outcome.sequence.steps.length - 1,
      message: receipt.status === "success" ? "This transaction is confirmed. Review again if further wallet steps remain." : "The transaction reverted. Network gas may have been charged." };
    return outcome;
  }
  async function acknowledgeResult(operationId: string, resetDraft = true) {
    if (!account || executing.current) throw new Error("Wait for the current operation to finish.");
    await acknowledgeFoundationResolution(account, operationId, chainId);
    if (resetDraft) setResultGeneration(value => value + 1);
  }
  return { chainId, profile, client, account, walletContext, availability, envelope, displayEnvelope: token ? null : displayEnvelope, contextKey, walletAction, submissionBlocked, preparationBlocked,
    pending, pendingTransactionHash, retryAvailable, checkPending, resolution, resolutionState, resultGeneration, acknowledgeResult, progress, assertCurrent, resolveAuthority, resolveCatalog, execute, refreshResult,
    retryAvailability: () => setRefresh(value => value + 1) };
}

export function FoundationSessionStatus({ session, editingNewLaunch = false, showProgress = true, hideSuccessfulLaunch = false, hideSuccessfulTrade = false, inline = false }: {
  session: ReturnType<typeof useFoundationSession>; editingNewLaunch?: boolean; showProgress?: boolean;
  hideSuccessfulLaunch?: boolean; hideSuccessfulTrade?: boolean; inline?: boolean;
}) {
  const [hash, setHash] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const recovery = session.pending !== "null";
  const saved = session.resolution;
  const hideResolved = !recovery && saved?.status === "success"
    && ((hideSuccessfulLaunch && saved.metadata?.stepKind === "launch")
      || (hideSuccessfulTrade && (saved.metadata?.stepKind === "buy" || saved.metadata?.stepKind === "sell")));
  const resolved = hideResolved ? null : saved;
  if (!showProgress && session.progress) return null;
  if (!session.progress && !recovery && (session.resolutionState === "null" || hideResolved) && !message) return null;
  const check = () => {
    if (busy || !session.account) return;
    setBusy(true); setMessage("");
    void session.checkPending(hash.trim() ? hash.trim() as Hex : undefined)
      .then(() => setMessage(""))
      .catch(error => setMessage(error instanceof Error ? error.message : "Wallet activity could not be checked. Try again."))
      .finally(() => setBusy(false));
  };
  return <div className={inline ? styles.inlineRecovery : `${styles.page} ${styles.sessionStatus}`}>
    {showProgress && session.progress ? <p role="status">{session.progress}</p> : null}
    {!session.progress && resolved ? <details className={styles.savedResult} open={!editingNewLaunch} aria-label="Saved transaction result"><summary>{editingNewLaunch
      ? resolved.status === "success" ? "Previous transaction confirmed" : resolved.status === "replaced" ? "Previous transaction replaced" : "Previous transaction reverted"
      : resolved.status === "success" ? "Your transaction is confirmed" : resolved.status === "replaced" ? "Your transaction was replaced" : "Your transaction reverted"}</summary>
      <p>{resolved.status === "success" && resolved.metadata?.stepKind === "wrap"
        ? "Your ETH was converted to WETH and is in your wallet. Review the launch again to continue; the converted amount will be used first."
        : resolved.status === "success" && resolved.metadata?.stepKind === "approve"
        ? "The approval is confirmed. Review the remaining operation with current balances before continuing."
        : resolved.status === "success" ? editingNewLaunch ? "You can configure a new coin below. Your previous transaction is available here."
          : `Your ${resolved.metadata?.stepKind === "launch" ? "launch" : "transaction"} is saved at block ${resolved.blockNumber}. You can return to its details after reloading this page.`
          : resolved.status === "replaced" ? "Your wallet cancelled or replaced the previous request. You can continue with your coin details below." : "The request did not complete. Network gas may have been charged."}</p>
      <p><a href={`${foundationChainProfile(foundationBindingChainId(resolved)).explorer}/tx/${resolved.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a>
        {resolved.status === "success" && resolved.metadata?.stepKind === "launch" && resolved.metadata.token
          ? <> · <a href={`/modules/${resolved.metadata.token}?${foundationBindingChainId(resolved) === 1 ? "chainId=1&" : ""}transaction=${resolved.transactionHash}`}>View Coin</a></> : null}</p>
      {!recovery ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => {
        setBusy(true); setMessage(""); void session.acknowledgeResult(resolved.operationId, !editingNewLaunch)
          .catch(error => setMessage(error instanceof Error ? error.message : "The saved result could not be acknowledged."))
          .finally(() => setBusy(false));
      }}>{busy ? "Continuing…" : editingNewLaunch ? "Dismiss" : resolved.status === "success" && resolved.metadata?.stepKind === "launch" ? "Create another coin" : "Continue"}</button> : null}
    </details> : null}
    {session.resolutionState === "unreadable" ? <p role="alert">The saved transaction result could not be read. Check wallet activity before continuing.</p> : null}
    {recovery && !session.progress && session.retryAvailable ? <p role="status">Your previous request did not finish. You can retry the launch below.</p> : null}
    {recovery && !session.progress && !session.retryAvailable ? <details className={styles.savedResult} open aria-label="Recover wallet operation">
      <summary>{session.pendingTransactionHash ? "Waiting for transaction confirmation" : "Check previous wallet transaction"}</summary>
      <p>{session.pendingTransactionHash ? "Confirmation is checked automatically, including transactions sped up in your wallet."
        : "We are checking your wallet activity. If the request is still open in your wallet, confirm or cancel it there."}</p>
      {session.pendingTransactionHash ? <p><a href={`${session.profile.explorer}/tx/${session.pendingTransactionHash}`} target="_blank" rel="noreferrer">View transaction</a></p> : null}
      <button type="button" className={styles.secondaryButton} onClick={check} disabled={busy}>{busy ? "Checking…" : "Check wallet activity"}</button>
      {!session.pendingTransactionHash ? <details><summary>Add transaction hash</summary><div className={styles.field}>
        <label htmlFor="foundation-recovery-hash">Transaction hash (optional)</label>
        <input id="foundation-recovery-hash" value={hash} onChange={event => setHash(event.target.value)} placeholder="0x…" autoComplete="off" />
      </div></details> : null}
    </details> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
