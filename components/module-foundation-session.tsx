"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getAddress, keccak256, type Address, type Hex, type TransactionReceipt } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { assertModuleModeWalletUnchanged, moduleModeWalletStep, switchModuleModeNetwork, useModuleModeOperation, type ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import { browserWalletRequestIsPending, subscribeToBrowserWalletRequest } from "@/lib/wallet-request-lock";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import { createFoundationClient } from "@/lib/module-foundation/client";
import { fetchFoundationAvailability, type FoundationAvailabilityEnvelope } from "@/lib/module-foundation/availability";
import { bindFoundationCatalogV1 } from "@/lib/module-foundation/catalog";
import { bindFoundationWalletStep, FOUNDATION_PENDING_EVENT, readFoundationPending, reconcileFoundationPending,
  submitFoundationWalletStep, type FoundationPreparedSequence } from "@/lib/module-foundation/wallet";
import { acknowledgeFoundationResolution, FOUNDATION_RESOLUTION_EVENT, readFoundationResolution,
  type FoundationResolution } from "@/lib/module-foundation/result-store";
import type { FoundationAvailability, FoundationTransactionResult, FoundationWalletAction } from "@/lib/module-foundation/ui-types";
import styles from "./module-foundation-ui.module.css";

export interface FoundationExecutionResult {
  result: FoundationTransactionResult;
  receipt?: TransactionReceipt;
  sequence: FoundationPreparedSequence;
  stepIndex: number;
}
export function useFoundationSession(token?: Address) {
  const walletContext = useWallet();
  const { wallet, authenticated, sessionReady, authReady, connecting, openingWallet, switchingNetwork, disconnecting, openWallet, switchNetwork, sendModuleModeTransaction } = walletContext;
  const client = useMemo(() => createFoundationClient(), []);
  const targetKey = token?.toLowerCase() ?? "launch";
  const [envelopeState, setEnvelopeState] = useState<{ targetKey: string; refresh: number; value: FoundationAvailabilityEnvelope | null } | null>(null);
  const envelope = envelopeState?.targetKey === targetKey ? envelopeState.value : null;
  const [refresh, setRefresh] = useState(0);
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
  const subscribeRequest = useCallback((listener: () => void) => subscribeToBrowserWalletRequest(account, "4663", listener), [account]);
  const requestSnapshot = useCallback(() => browserWalletRequestIsPending(account, "4663"), [account]);
  const requestPending = useSyncExternalStore(subscribeRequest, requestSnapshot, () => false);
  const subscribePending = useCallback((listener: () => void) => {
    window.addEventListener("storage", listener); window.addEventListener(FOUNDATION_PENDING_EVENT, listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener(FOUNDATION_PENDING_EVENT, listener); };
  }, []);
  const pendingSnapshot = useCallback(() => {
    try { return account ? JSON.stringify(readFoundationPending(account)) : "null"; }
    catch { return "unreadable"; }
  }, [account]);
  const pending = useSyncExternalStore(subscribePending, pendingSnapshot, () => "null");
  const subscribeResolution = useCallback((listener: () => void) => {
    window.addEventListener("storage", listener); window.addEventListener(FOUNDATION_RESOLUTION_EVENT, listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener(FOUNDATION_RESOLUTION_EVENT, listener); };
  }, []);
  const resolutionSnapshot = useCallback(() => {
    try { return account ? JSON.stringify(readFoundationResolution(account)) : "null"; }
    catch { return "unreadable"; }
  }, [account]);
  const resolutionState = useSyncExternalStore(subscribeResolution, resolutionSnapshot, () => "null");
  const resolution = useMemo(() => resolutionState === "null" || resolutionState === "unreadable" ? null
    : JSON.parse(resolutionState) as FoundationResolution, [resolutionState]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchFoundationAvailability(controller.signal, token).then(value => {
      if (!controller.signal.aborted) setEnvelopeState({ targetKey, refresh, value });
    }).catch(() => { if (!controller.signal.aborted) setEnvelopeState({ targetKey, refresh, value: null }); });
    return () => controller.abort();
  }, [refresh, token, targetKey]);
  const availability: FoundationAvailability = { status: availabilityError ? "unavailable" : !envelope ? "checking" : envelope.available ? "ready" : "unavailable",
    chainId: 4663, chainName: "Robinhood Chain", reason: availabilityError ? "Launch availability could not be checked. Retry to keep working with this release." : envelope?.reason ?? undefined };
  const contextKey = `${account ?? "disconnected"}:${wallet?.chainId ?? "none"}:${authenticated}:${sessionReady}:${targetKey}:${envelope?.binding?.releaseDigest ?? "unavailable"}`;
  const currentContext = useRef(contextKey);
  useLayoutEffect(() => { walletRef.current = walletSnapshot; sourceRef.current = envelope; currentContext.current = contextKey; }, [walletSnapshot, envelope, contextKey]);
  function assertCurrent(expectedAccount: Address, expectedContext = currentContext.current) {
    if (!mounted.current || expectedContext !== currentContext.current) throw new Error("Your wallet or launch version changed. Review again.");
    assertModuleModeWalletUnchanged(walletRef.current, expectedAccount);
  }
  async function resolveAuthority() {
    const current = await fetchFoundationAvailability(undefined, token);
    if (!current.available || !current.binding) throw new Error(current.reason ?? "This release is unavailable.");
    if (current.binding.releaseDigest !== sourceRef.current?.binding?.releaseDigest) throw new Error("The authorized launch version changed. Reload the release and review again.");
    return current.binding;
  }
  async function resolveCatalog() {
    const current = await fetchFoundationAvailability(undefined, token);
    if (!current.available || !current.binding || current.binding.releaseDigest !== sourceRef.current?.binding?.releaseDigest) throw new Error("The admitted module catalog changed. Reload and review again.");
    return bindFoundationCatalogV1(current.catalog.document, current.catalog.authority);
  }
  const walletStep = moduleModeWalletStep(walletSnapshot);
  const walletBusy = !authReady || connecting || openingWallet || switchingNetwork || disconnecting;
  const walletAction: FoundationWalletAction | undefined = walletStep === "prepare" ? undefined : {
    label: walletStep === "connect" ? "Connect wallet" : "Switch to Robinhood Chain", busy: walletBusy,
    onClick: walletStep === "connect" ? openWallet : () => switchModuleModeNetwork(switchNetwork),
  };
  const preparationBlocked = pending !== "null" ? "A previous wallet operation needs confirmation before you continue."
    : resolutionState === "unreadable" ? "The saved transaction result could not be read. Check wallet activity before continuing."
    : savedLegacy.blocked ? "A previous Module Mode operation needs recovery before you continue."
      : requestPending ? "Complete the open wallet request before continuing." : undefined;
  const submissionBlocked = preparationBlocked ?? (resolution ? "Review the saved transaction result before starting another operation." : undefined);

  async function execute(sequence: FoundationPreparedSequence): Promise<FoundationExecutionResult> {
    if (executing.current || used.current.has(sequence)) throw new Error("Review a fresh operation before continuing.");
    assertCurrent(sequence.account);
    if (savedLegacy.blocked || readFoundationPending(sequence.account) || readFoundationResolution(sequence.account)) throw new Error("Resolve the previous wallet operation first.");
    executing.current = true; used.current.add(sequence);
    const expectedContext = currentContext.current;
    try {
      for (let index = 0; index < sequence.steps.length; index++) {
        assertCurrent(sequence.account, expectedContext);
        const step = sequence.steps[index];
        if (mounted.current) setProgress(`Step ${index + 1} of ${sequence.steps.length}: ${step.label}`);
        const preparation = bindFoundationWalletStep({ client, sequence, index, resolveAuthority, resolveCatalog });
        const hash = await submitFoundationWalletStep(preparation, sendModuleModeTransaction);
        const outcome: FoundationExecutionResult = { sequence, stepIndex: index,
          result: { status: "submitted", transactionHash: hash, explorerUrl: `${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${hash}`,
            operationComplete: false, stepLabel: step.label,
            message: `${step.label} was submitted. Confirmation is being checked.` } };
        outcomes.current.set(hash, outcome);
        try {
          await client.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 2_000 });
          outcome.receipt = await reconcileFoundationPending(client, sequence.account, hash);
          outcome.result = { ...outcome.result, status: outcome.receipt.status === "success" ? "confirmed" : "reverted",
            operationComplete: outcome.receipt.status === "success" && index === sequence.steps.length - 1,
            blockNumber: outcome.receipt.blockNumber.toString(), message: outcome.receipt.status === "success"
              ? `${step.label} is confirmed onchain. Settlement finality is checked separately.`
              : `${step.label} reverted. Network gas may have been charged.` };
          if (outcome.receipt.status === "reverted" || index === sequence.steps.length - 1) return outcome;
          // The reviewed sequence already authorizes continuing after each successful approval or ETH conversion.
          // Only intermediate prerequisites are acknowledged here; the final outcome remains durable.
          const saved = readFoundationResolution(sequence.account);
          if ((step.kind !== "approve" && step.kind !== "wrap") || !saved || saved.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("Review the saved transaction before continuing.");
          await acknowledgeFoundationResolution(sequence.account, saved.operationId);
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
      || (transaction.chainId !== undefined && transaction.chainId !== 4663)) throw new Error("The saved transaction does not match the reviewed operation.");
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
    await acknowledgeFoundationResolution(account, operationId);
    if (resetDraft) setResultGeneration(value => value + 1);
  }
  return { client, account, walletContext, availability, envelope, contextKey, walletAction, submissionBlocked, preparationBlocked,
    pending, resolution, resolutionState, resultGeneration, acknowledgeResult, progress, assertCurrent, resolveAuthority, resolveCatalog, execute, refreshResult,
    retryAvailability: () => setRefresh(value => value + 1) };
}

export function FoundationSessionStatus({ session, editingNewLaunch = false }: { session: ReturnType<typeof useFoundationSession>; editingNewLaunch?: boolean }) {
  const [hash, setHash] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const recovery = session.pending !== "null";
  const resolved = session.resolution;
  if (!session.progress && !recovery && session.resolutionState === "null" && !message) return null;
  return <div className={`${styles.page} ${styles.sessionStatus}`}>
    {session.progress ? <p role="status">{session.progress}</p> : null}
    {!session.progress && resolved ? <details className={styles.savedResult} open={!editingNewLaunch} aria-label="Saved transaction result"><summary>{editingNewLaunch
      ? resolved.status === "success" ? "Previous transaction confirmed" : "Previous transaction reverted"
      : resolved.status === "success" ? "Your transaction is confirmed" : "Your transaction reverted"}</summary>
      <p>{resolved.status === "success" && resolved.metadata?.stepKind === "wrap"
        ? "Your ETH was converted to WETH and is in your wallet. Review the launch again to continue; the converted amount will be used first."
        : resolved.status === "success" && resolved.metadata?.stepKind === "approve"
        ? "The approval is confirmed. Review the remaining operation with current balances before continuing."
        : resolved.status === "success" ? editingNewLaunch ? "You can configure a new coin below. Your previous transaction is available here."
          : `Your ${resolved.metadata?.stepKind === "launch" ? "launch" : "transaction"} is saved at block ${resolved.blockNumber}. You can return to its details after reloading this page.`
          : "The request did not complete. Network gas may have been charged."}</p>
      <p><a href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${resolved.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a>
        {resolved.status === "success" && resolved.metadata?.stepKind === "launch" && resolved.metadata.token
          ? <> · <a href={`/modules/${resolved.metadata.token}?transaction=${resolved.transactionHash}`}>View coin details</a></> : null}</p>
      {!recovery ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => {
        setBusy(true); setMessage(""); void session.acknowledgeResult(resolved.operationId, !editingNewLaunch)
          .catch(error => setMessage(error instanceof Error ? error.message : "The saved result could not be acknowledged."))
          .finally(() => setBusy(false));
      }}>{busy ? "Continuing…" : editingNewLaunch ? "Dismiss" : resolved.status === "success" && resolved.metadata?.stepKind === "launch" ? "Create another coin" : "Continue"}</button> : null}
    </details> : null}
    {session.resolutionState === "unreadable" ? <p role="alert">The saved transaction result could not be read. Check wallet activity before continuing.</p> : null}
    {recovery ? <section aria-label="Recover wallet operation"><h2>Check your previous transaction</h2><p>The saved request stays protected until its exact transaction is found onchain.</p>
      <form className={styles.field} onSubmit={event => { event.preventDefault(); if (busy || !session.account) return; setBusy(true); setMessage("");
        void reconcileFoundationPending(session.client, session.account, hash.trim() ? hash.trim() as Hex : undefined)
          .then(receipt => setMessage(receipt.status === "success" ? "The exact transaction is confirmed. Review your next operation again." : "The transaction reverted. You can review again."))
          .catch(error => setMessage(error instanceof Error ? error.message : "The transaction could not be checked."))
          .finally(() => setBusy(false)); }}>
        <label htmlFor="foundation-recovery-hash">Transaction hash from your wallet, if it was not saved</label>
        <input id="foundation-recovery-hash" value={hash} onChange={event => setHash(event.target.value)} placeholder="0x…" autoComplete="off" />
        <button type="submit" className={styles.secondaryButton} disabled={busy}>{busy ? "Checking…" : "Check exact transaction"}</button>
      </form></section> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
