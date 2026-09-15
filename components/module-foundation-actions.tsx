"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Address, Hex } from "viem";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { foundationDecimalError, type FoundationAvailability, type FoundationConfiguration, type FoundationConfigurationField, type FoundationTransactionResult, type FoundationTransactionSummary, type FoundationWalletAction } from "@/lib/module-foundation/ui-types";
import { FoundationAddress, FoundationTransactionSteps, ModuleFoundationTransactionResult } from "./module-foundation-review";
import styles from "./module-foundation-ui.module.css";

export interface FoundationActionAsset { address: Address; symbol: string; decimals: number }

/** Only actual ledger readback belongs here. An omitted balance is unknown, not zero. */
export interface FoundationActionPayout {
  asset: FoundationActionAsset;
  recipient: Address;
  claimableAmount?: string;
  creditedAmount?: string;
  paidAmount?: string;
  asOfBlock?: string;
}

/** Structurally accepts the catalog's presented actions. Authority is resolved by the host. */
export interface FoundationActionDescriptor {
  id: string;
  label: string;
  description: string;
  fields: readonly FoundationConfigurationField[];
  available: boolean;
  unavailableReason?: string;
  role?: string;
  /** The host may omit actions altogether or explicitly hide actions for this wallet. */
  visible?: boolean;
  moduleId?: Hex;
  version?: string;
  digest?: Hex;
  actionId?: string;
  payout?: FoundationActionPayout;
}

export interface FoundationActionTransfer {
  asset: FoundationActionAsset;
  recipient: Address;
  /** Exact human units, with the precision of asset.decimals. */
  amount: string;
}

export interface FoundationActionReview {
  id: string;
  /** The unique presentation descriptor id, not the manifest's local actionId. */
  actionId: string;
  contextKey: string;
  account: Address;
  chainId: number;
  simulationBlock: string;
  /** Unix seconds. The host revalidates the exact intent before opening the wallet. */
  expiresAt: number;
  configuration: FoundationConfiguration;
  transfers: readonly FoundationActionTransfer[];
  transactions: readonly FoundationTransactionSummary[];
  notes?: readonly string[];
}

export interface ModuleFoundationActionsProps {
  availability: FoundationAvailability;
  /** Bind account, network, pool and current admitted source in the host. */
  contextKey: string;
  actions: readonly FoundationActionDescriptor[];
  /** Read/prepare/simulate only. This callback must never request a signature. */
  onPrepare: (actionId: string, configuration: FoundationConfiguration) => Promise<FoundationActionReview | null>;
  /** Invoked only by the explicit Continue in wallet button. */
  onConfirm: (review: FoundationActionReview) => Promise<FoundationTransactionResult>;
  onRefreshResult?: (result: FoundationTransactionResult) => Promise<FoundationTransactionResult>;
  walletAction?: FoundationWalletAction;
  /** The host's durable pending/uncertain-operation guard survives remounts. */
  submissionBlocked?: string;
}

const validAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
const configurationKey = (value: FoundationConfiguration) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
const descriptorKey = (action: FoundationActionDescriptor) => JSON.stringify([action.id, action.label, action.description, action.role, action.moduleId, action.version, action.digest, action.actionId, action.fields, action.payout?.asset, action.payout?.recipient]);
const payoutReadbackKey = (contextKey: string, action: FoundationActionDescriptor) => JSON.stringify([contextKey, action.id, action.payout?.asOfBlock]);

function exactAmount(value: string | undefined, decimals: number): bigint | null {
  if (value === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 255 || foundationDecimalError(value, decimals)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
}

export function foundationActionUnavailableReason(action: FoundationActionDescriptor): string | null {
  if (action.visible === false) return "This action is not available for this wallet.";
  if (!action.available) return action.unavailableReason || "This action is currently unavailable.";
  if (action.payout) {
    const payout = action.payout;
    const amount = exactAmount(payout.claimableAmount, payout.asset.decimals);
    if (!validAddress(payout.recipient) || !validAddress(payout.asset.address) || !payout.asOfBlock || !/^\d+$/.test(payout.asOfBlock) || amount === null) return "A current, verified fee balance is needed before payout.";
    if (amount === 0n) return "No fees are available to pay out.";
    if (action.fields.length) return "The fixed payout details could not be verified.";
  }
  return null;
}

/** Lightweight form checks. The source compiler retains all schema, bounds and role checks. */
export function foundationActionFieldErrors(action: FoundationActionDescriptor, configuration: FoundationConfiguration): Record<string, string> {
  const errors: Record<string, string> = Object.create(null);
  const keys = new Set(action.fields.map(field => field.key));
  for (const key of Object.keys(configuration)) if (!keys.has(key)) errors[key] = "This field is not editable in the current action.";
  for (const field of action.fields) {
    const value = configuration[field.key];
    if (value === undefined || value === "") {
      if (field.required) errors[field.key] = `Complete ${field.label}.`;
      continue;
    }
    if (field.kind === "boolean") {
      if (typeof value !== "boolean") errors[field.key] = `Choose a setting for ${field.label}.`;
      continue;
    }
    if (typeof value !== "string") { errors[field.key] = `Enter a value for ${field.label}.`; continue; }
    if (field.required && !value.trim()) errors[field.key] = `Complete ${field.label}.`;
    if (field.kind === "address" && !validAddress(value)) errors[field.key] = `Enter a valid address for ${field.label}.`;
    if (field.kind === "integer" && !/^\d+$/.test(value)) errors[field.key] = `Enter a whole number for ${field.label}.`;
    if (field.kind === "decimal" && !/^\d+(?:\.\d+)?$/.test(value)) errors[field.key] = `Enter a decimal amount for ${field.label}.`;
    if (field.kind === "select" && !field.options?.some(option => option.value === value)) errors[field.key] = `Choose an available option for ${field.label}.`;
  }
  return errors;
}

export function foundationActionReviewError(review: FoundationActionReview, action: FoundationActionDescriptor, configuration: FoundationConfiguration, contextKey: string, chainId: number, now = Date.now()): string | null {
  if (review.contextKey !== contextKey) return "Your wallet, pool or source version changed. Review this action again.";
  if (!Number.isSafeInteger(review.expiresAt) || review.expiresAt * 1_000 <= now) return "This review expired. Review again for a current simulation.";
  if (review.actionId !== action.id || review.chainId !== chainId || configurationKey(review.configuration) !== configurationKey(configuration)) return "The simulation differs from your action. Review again.";
  if (!review.id || !validAddress(review.account) || !/^\d+$/.test(review.simulationBlock) || !review.transactions.length || review.transactions.some(transaction => transaction.chainId !== chainId || !validAddress(transaction.to) || (transaction.spender !== undefined && !validAddress(transaction.spender)) || !transaction.effect.trim() || exactAmount(transaction.value, 18) === null)) return "The exact wallet steps could not be verified. Review again.";
  if (review.transfers.some(transfer => !validAddress(transfer.recipient) || !validAddress(transfer.asset.address) || exactAmount(transfer.amount, transfer.asset.decimals) === null)) return "The transfer recipient or amount could not be verified. Review again.";
  if (action.payout) {
    const payout = action.payout, transfer = review.transfers[0];
    if (review.transfers.length !== 1 || !transfer || transfer.recipient.toLowerCase() !== payout.recipient.toLowerCase() || transfer.asset.address.toLowerCase() !== payout.asset.address.toLowerCase() || transfer.asset.symbol !== payout.asset.symbol || transfer.asset.decimals !== payout.asset.decimals || exactAmount(transfer.amount, transfer.asset.decimals) !== exactAmount(payout.claimableAmount, payout.asset.decimals)) return "The payout differs from the displayed fee balance or recipient. Refresh its balance and review again.";
  }
  return foundationActionUnavailableReason(action);
}

function humanError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : "The action could not complete. Please try again.";
  return message.length <= 320 ? message : "The action could not complete. Check its status before trying again.";
}

function FoundationActionForm({ action, disabled, busy, blockedReason, walletAction, initialConfiguration, onPrepare }: {
  action: FoundationActionDescriptor; disabled: boolean; busy: boolean; blockedReason?: string;
  walletAction?: FoundationWalletAction; initialConfiguration?: FoundationConfiguration; onPrepare: (configuration: FoundationConfiguration) => Promise<void>;
}) {
  const id = useId();
  const [configuration, setConfiguration] = useState<FoundationConfiguration>(() => ({ ...Object.fromEntries(action.fields.flatMap(field => field.defaultValue !== undefined ? [[field.key, field.defaultValue]] : field.kind === "boolean" ? [[field.key, false]] : [])), ...initialConfiguration }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unavailable = blockedReason || foundationActionUnavailableReason(action);
  function change(key: string, value: string | boolean) {
    setConfiguration(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: "" }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || unavailable) return;
    if (!walletAction) {
      const problems = foundationActionFieldErrors(action, configuration);
      setErrors(problems);
      const first = Object.keys(problems)[0];
      if (first) { const control = event.currentTarget.elements.namedItem(first); if (control instanceof HTMLElement) control.focus(); return; }
    }
    await onPrepare(configuration);
  }
  const fields = <div className={styles.moduleFields}>{action.fields.map((field, index) => {
    const fieldId = `${id}-${index}`, errorId = `${fieldId}-error`, helpId = `${fieldId}-help`;
    const shared = { id: fieldId, name: field.key, disabled: disabled || Boolean(unavailable), "aria-invalid": Boolean(errors[field.key]) || undefined, "aria-describedby": `${helpId} ${errorId}` };
    return <div className={styles.field} key={field.key}>
      {field.kind === "boolean" ? <label className={styles.checkLabel} htmlFor={fieldId}><input {...shared} type="checkbox" checked={configuration[field.key] === true} onChange={event => change(field.key, event.target.checked)} /><span><strong>{field.label}</strong></span></label> : <><label htmlFor={fieldId}>{field.label}{!field.required ? <span>Optional</span> : null}</label>{field.kind === "select" ? <select {...shared} value={typeof configuration[field.key] === "string" ? configuration[field.key] as string : ""} onChange={event => change(field.key, event.target.value)}><option value="">Choose an option</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input {...shared} type="text" inputMode={field.kind === "integer" ? "numeric" : field.kind === "decimal" ? "decimal" : undefined} autoComplete="off" spellCheck={field.kind === "text"} value={typeof configuration[field.key] === "string" ? configuration[field.key] as string : ""} onChange={event => change(field.key, event.target.value)} />}</>}
      <p id={helpId} className={styles.help}>{field.description}</p><p id={errorId} className={styles.error}>{errors[field.key]}</p>
    </div>;
  })}</div>;
  const submitButton = <div className={styles.actions}><button type="submit" className={styles.secondaryButton} disabled={disabled || Boolean(unavailable) || walletAction?.busy} aria-busy={busy || walletAction?.busy}>{busy ? "Simulating action…" : walletAction?.label ?? (action.payout ? "Review payout" : "Review action")}</button></div>;
  return <section className={styles.module} aria-labelledby={`${id}-title`}>
    <div className={styles.moduleHeading}><div><h3 id={`${id}-title`}>{action.label}</h3><p>{action.description}</p></div></div>
    {action.payout ? <div className={styles.detailsBody}><dl className={styles.rows}>
      <div><dt>Available to pay</dt><dd>{action.payout.claimableAmount === undefined ? "Not available" : `${action.payout.claimableAmount} ${action.payout.asset.symbol}`}</dd></div>
      <div><dt>Fees credited</dt><dd>{action.payout.creditedAmount === undefined ? "Not available" : `${action.payout.creditedAmount} ${action.payout.asset.symbol}`}</dd></div>
      <div><dt>Paid onchain</dt><dd>{action.payout.paidAmount === undefined ? "Not available" : `${action.payout.paidAmount} ${action.payout.asset.symbol}`}</dd></div>
      <div><dt>Recipient</dt><dd><FoundationAddress value={action.payout.recipient} label={`${action.label} recipient`} /></dd></div>
    </dl>{action.payout.asOfBlock ? <p className={styles.help}>Fee balances read at block {action.payout.asOfBlock}.</p> : null}</div> : null}
    <form noValidate onSubmit={event => void submit(event)}>{action.fields.length ? <details className={styles.details}><summary>Configure action</summary>{fields}{submitButton}</details> : submitButton}</form>
    {unavailable ? <p className={styles.help} role="status">{unavailable}</p> : null}
  </section>;
}

export function ModuleFoundationActionReview({ review, action, configuration, contextKey, chainId, busy, blockedReason, error, onConfirm, onEdit }: {
  review: FoundationActionReview; action: FoundationActionDescriptor; configuration: FoundationConfiguration;
  contextKey: string; chainId: number; busy: boolean; blockedReason?: string; error?: string;
  onConfirm: () => void; onEdit: () => void;
}) {
  const id = useId(), heading = useRef<HTMLHeadingElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { heading.current?.focus(); const timer = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer); }, []);
  const invalid = foundationActionReviewError(review, action, configuration, contextKey, chainId, now);
  return <section className={styles.reviewPanel} aria-labelledby={`${id}-title`} style={{ overflowWrap: "anywhere" }}>
    <div className={styles.sectionHeading}><span className={styles.eyebrow}>{action.payout ? "Payout review" : "Action review"}</span><h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{action.label}</h2><p>Check the simulated effects before continuing in your wallet.</p></div>
    <p className={styles.simulated}><CheckIcon size={16} aria-hidden="true" />Simulated at block {review.simulationBlock}</p>
    <dl className={styles.rows}><div><dt>Wallet</dt><dd><FoundationAddress value={review.account} label="action wallet" /></dd></div><div><dt>Network ID</dt><dd>{review.chainId}</dd></div></dl>
    {review.transfers.map((transfer, index) => <section className={`${styles.position} ${styles.details}`} key={`${transfer.asset.address}:${transfer.recipient}:${index}`}><h3>{action.payout ? "Fee payout" : `Transfer ${index + 1}`}</h3><dl className={styles.rows}><div><dt>Amount</dt><dd>{transfer.amount} {transfer.asset.symbol}</dd></div><div><dt>Recipient</dt><dd><FoundationAddress value={transfer.recipient} label={`transfer ${index + 1} recipient`} /></dd></div><div><dt>Token</dt><dd><FoundationAddress value={transfer.asset.address} label={`transfer ${index + 1} token`} /></dd></div></dl></section>)}
    {action.fields.length ? <details className={styles.details}><summary>Action settings</summary><div className={styles.detailsBody}><dl className={styles.rows}>{action.fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{typeof configuration[field.key] === "boolean" ? configuration[field.key] ? "On" : "Off" : configuration[field.key] || "Not set"}</dd></div>)}</dl></div></details> : null}
    <FoundationTransactionSteps transactions={review.transactions} />
    {review.notes?.length ? <ul className={styles.notes}>{review.notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : null}
    <p className={styles.help}>Review expires at {new Date(review.expiresAt * 1_000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" })} UTC. Continuing checks the current wallet and simulation again.</p>
    <p className={styles.error} role="alert">{error || invalid || blockedReason || ""}</p>
    <div className={styles.actions}><button className={styles.secondaryButton} type="button" onClick={onEdit} disabled={busy}>Back to actions</button><button className={styles.primaryButton} type="button" onClick={onConfirm} disabled={busy || Boolean(blockedReason) || Boolean(invalid)} aria-busy={busy}>{busy ? "Waiting for wallet…" : "Continue in wallet"}</button></div>
  </section>;
}

export function ModuleFoundationActions({ availability, contextKey, actions, onPrepare, onConfirm, onRefreshResult, walletAction, submissionBlocked }: ModuleFoundationActionsProps) {
  const id = useId();
  const [prepared, setPrepared] = useState<{ action: FoundationActionDescriptor; configuration: FoundationConfiguration; review: FoundationActionReview } | null>(null);
  const [result, setResult] = useState<FoundationTransactionResult | null>(null);
  const [busy, setBusy] = useState<"prepare" | "confirm" | "refresh" | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [completedPayouts, setCompletedPayouts] = useState<ReadonlySet<string>>(() => new Set());
  const [savedConfigurations, setSavedConfigurations] = useState<Record<string, { contextKey: string; descriptor: string; configuration: FoundationConfiguration }>>({});
  const lock = useRef(false), active = useRef(true), generation = useRef(0);
  const latest = useRef({ contextKey, availability, actions, submissionBlocked });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { latest.current = { contextKey, availability, actions, submissionBlocked }; }, [contextKey, availability, actions, submissionBlocked]);
  useEffect(() => { generation.current += 1; }, [contextKey, availability.chainId]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const unavailable = availability.status !== "ready" ? availability.reason || (availability.status === "checking" ? "Checking the current pool and action bindings…" : "Actions are currently unavailable for this pool.") : undefined;
  const blockedReason = submissionBlocked || unavailable;
  const currentAction = prepared ? actions.find(action => action.id === prepared.action.id) : undefined;
  const changedAction = prepared && (!currentAction || descriptorKey(currentAction) !== descriptorKey(prepared.action)) ? "This action changed. Review its current source and settings again." : undefined;
  const duplicateIds = new Set(actions.map(action => action.id)).size !== actions.length;
  const catalogProblem = duplicateIds ? "The action list could not be verified. Refresh before continuing." : undefined;
  function completedReason(action: FoundationActionDescriptor) { return action.payout && completedPayouts.has(payoutReadbackKey(contextKey, action)) ? "Refresh fee balances after this payout before preparing another." : undefined; }

  async function prepare(action: FoundationActionDescriptor, configuration: FoundationConfiguration) {
    if (lock.current || blockedReason || catalogProblem || foundationActionUnavailableReason(action) || completedReason(action)) return;
    if (walletAction) {
      lock.current = true; setBusy("prepare"); setPreparingId(action.id); setError("");
      try { await walletAction.onClick(); } catch (caught) { if (active.current) setError(humanError(caught)); }
      finally { lock.current = false; if (active.current) { setBusy(null); setPreparingId(null); } }
      return;
    }
    if (Object.keys(foundationActionFieldErrors(action, configuration)).length) return;
    const context = latest.current.contextKey, version = generation.current, config = { ...configuration };
    setSavedConfigurations(current => ({ ...current, [action.id]: { contextKey: context, descriptor: descriptorKey(action), configuration: config } }));
    lock.current = true; setBusy("prepare"); setPreparingId(action.id); setError("");
    try {
      const review = await onPrepare(action.id, config);
      if (!active.current) return;
      if (latest.current.contextKey !== context || generation.current !== version) throw new Error("Your wallet, pool or source version changed. Review this action again.");
      const current = latest.current.actions.find(entry => entry.id === action.id);
      if (!current || descriptorKey(current) !== descriptorKey(action) || latest.current.availability.status !== "ready" || latest.current.submissionBlocked) throw new Error("This action changed or became unavailable. Review again.");
      if (!review) return;
      const problem = foundationActionReviewError(review, current, config, context, latest.current.availability.chainId);
      if (problem) throw new Error(problem);
      setPrepared({ action: current, configuration: config, review });
    } catch (caught) { if (active.current) setError(humanError(caught)); }
    finally { lock.current = false; if (active.current) { setBusy(null); setPreparingId(null); } }
  }

  async function confirm() {
    if (!prepared || lock.current || blockedReason || changedAction || catalogProblem || !currentAction) return;
    const problem = foundationActionReviewError(prepared.review, currentAction, prepared.configuration, latest.current.contextKey, latest.current.availability.chainId);
    if (problem) { setError(problem); return; }
    lock.current = true; setBusy("confirm"); setError("");
    try {
      const receipt = await onConfirm(prepared.review);
      if (active.current) {
        setResult(receipt);
        if (receipt.status === "confirmed" && prepared.action.payout) setCompletedPayouts(current => new Set([...current, payoutReadbackKey(prepared.review.contextKey, prepared.action)]));
      }
    } catch (caught) { if (active.current) setError(humanError(caught)); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  }

  async function refresh() {
    if (!result || !onRefreshResult || lock.current) return;
    lock.current = true; setBusy("refresh"); setError("");
    try {
      const receipt = await onRefreshResult(result);
      if (active.current) {
        setResult(receipt);
        if (receipt.status === "confirmed" && prepared?.action.payout) setCompletedPayouts(current => new Set([...current, payoutReadbackKey(prepared.review.contextKey, prepared.action)]));
      }
    } catch (caught) { if (active.current) setError(humanError(caught)); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  }

  function back() { setPrepared(null); setResult(null); setError(""); requestAnimationFrame(() => heading.current?.focus()); }
  if (result) return <div className={styles.mainColumn}><ModuleFoundationTransactionResult result={result} onRefresh={onRefreshResult ? () => void refresh() : undefined} refreshing={busy === "refresh"} /><p className={styles.error} role="alert">{error}</p>{result.status === "confirmed" || result.status === "reverted" ? <button type="button" className={styles.secondaryButton} onClick={back}>Return to actions</button> : null}</div>;
  if (prepared) return <ModuleFoundationActionReview review={prepared.review} action={currentAction ?? prepared.action} configuration={prepared.configuration} contextKey={contextKey} chainId={availability.chainId} busy={busy === "confirm"} blockedReason={blockedReason || changedAction || catalogProblem} error={error} onConfirm={() => void confirm()} onEdit={back} />;
  const visible = actions.filter(action => action.visible !== false);
  return <section className={styles.form} aria-labelledby={`${id}-title`} style={{ overflowWrap: "anywhere" }}>
    <div className={styles.sectionHeading}><h2 id={`${id}-title`} ref={heading} tabIndex={-1}>Manage coin</h2><p>Prepare payouts and available module actions for this pool.</p></div>
    {visible.some(action => action.payout) ? <div className={styles.sectionHeading}><p>A fee balance is credit held in the fee ledger. A payout transfers the available amount to the recipient shown below. Credit alone does not mean it reached a wallet.</p></div> : null}
    {blockedReason || catalogProblem ? <p className={styles.error} role="status">{blockedReason || catalogProblem}</p> : null}
    <div className={styles.catalog}>{visible.length ? visible.map(action => <FoundationActionForm key={`${contextKey}:${descriptorKey(action)}`} action={action} disabled={Boolean(busy || blockedReason || catalogProblem)} busy={preparingId === action.id} blockedReason={completedReason(action)} walletAction={walletAction} initialConfiguration={savedConfigurations[action.id]?.contextKey === contextKey && savedConfigurations[action.id]?.descriptor === descriptorKey(action) ? savedConfigurations[action.id].configuration : undefined} onPrepare={configuration => prepare(action, configuration)} />) : <p className={styles.help}>No management actions are available for this wallet.</p>}</div>
    <p className={styles.error} role="alert">{error}</p>
  </section>;
}
