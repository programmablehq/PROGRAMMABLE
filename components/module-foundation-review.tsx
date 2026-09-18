"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import type { FoundationLaunchReview, FoundationPoolIdentity, FoundationPositionIdentity, FoundationTransactionResult, FoundationTransactionSummary } from "@/lib/module-foundation/ui-types";
import { FOUNDATION_PLATFORM_FEE_RECIPIENT, foundationPublicUrl, foundationReviewError } from "@/lib/module-foundation/ui-types";
import styles from "./module-foundation-ui.module.css";

export function FoundationAddress({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true); setError(false);
      clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopied(false), 2_000);
    } catch { setError(true); }
  }
  return <span className={styles.addressGroup}><code className={styles.address}>{value}</code><button type="button" className={styles.iconButton} onClick={() => void copy()} aria-label={`Copy ${label}`}>{copied ? <CheckIcon size={16} aria-hidden="true" /> : <CopyIcon size={16} aria-hidden="true" />}</button><span className={styles.srOnly} role="status">{copied ? `${label} copied.` : error ? `Copy unavailable. Select the ${label} to copy it.` : ""}</span></span>;
}

export function FoundationPoolDetails({ pool, positions = [], predicted = false }: { pool: FoundationPoolIdentity; positions?: readonly FoundationPositionIdentity[]; predicted?: boolean }) {
  return <details className={styles.details}>
    <summary>Pool and liquidity details</summary>
    <div className={styles.detailsBody}>
      {predicted ? <p className={styles.help}>These identities come from the launch simulation. Confirmation verifies the actual pool and position IDs.</p> : null}
      <dl className={styles.rows}>
        <div><dt>Pool ID</dt><dd><FoundationAddress value={pool.poolId} label="pool ID" /></dd></div>
        <div><dt>Currency 0</dt><dd><FoundationAddress value={pool.currency0} label="currency 0" /></dd></div>
        <div><dt>Currency 1</dt><dd><FoundationAddress value={pool.currency1} label="currency 1" /></dd></div>
        <div><dt>LP fee</dt><dd>{pool.fee === 0x800000 ? "Dynamic" : `${pool.fee / 10_000}%`}</dd></div>
        <div><dt>Tick spacing</dt><dd>{pool.tickSpacing}</dd></div>
        <div><dt>Hook</dt><dd><FoundationAddress value={pool.hooks} label="hook address" /></dd></div>
        <div><dt>PoolManager</dt><dd><FoundationAddress value={pool.poolManager} label="PoolManager address" /></dd></div>
      </dl>
      <p className={styles.help}>The hook and selected module versions are fixed for this pool. New catalog modules can be selected for new launches.</p>
      {positions.map((position, index) => <section className={styles.position} key={`${position.label}:${index}`}>
        <h3>{position.label}</h3>
        <p>{position.ownershipDescription}</p>
        <dl className={styles.rows}>
          <div><dt>Position NFT</dt><dd>{position.tokenId ?? "Assigned at launch"}</dd></div>
          <div><dt>Owner</dt><dd><FoundationAddress value={position.owner} label={`${position.label} owner`} /></dd></div>
          <div><dt>PositionManager</dt><dd><FoundationAddress value={position.positionManager} label="PositionManager address" /></dd></div>
          <div><dt>Tick range</dt><dd>{position.tickLower} to {position.tickUpper}</dd></div>
        </dl>
      </section>)}
    </div>
  </details>;
}

export function FoundationTransactionSteps({ transactions }: { transactions: readonly FoundationTransactionSummary[] }) {
  return <section className={styles.transactionSteps} aria-label="Wallet steps">
    <h3>In your wallet</h3>
    <ol>{transactions.map((transaction, index) => <li key={`${transaction.to}:${index}`}>
      <div className={styles.stepNumber} aria-hidden="true">{index + 1}</div>
      <div className={styles.stepContent}><strong>{transaction.label}</strong><p>{transaction.effect}</p>
        <details className={styles.transactionDetails}><summary>Transaction details</summary><dl className={styles.rows}>
          <div><dt>Network ID</dt><dd>{transaction.chainId}</dd></div>
          <div><dt>To</dt><dd><FoundationAddress value={transaction.to} label="transaction destination" /></dd></div>
          <div><dt>Native value</dt><dd>{transaction.value}</dd></div>
          {transaction.spender ? <div><dt>Spender</dt><dd><FoundationAddress value={transaction.spender} label="approval spender" /></dd></div> : null}
        </dl></details>
      </div>
    </li>)}</ol>
    <p className={styles.help}>Network gas is separate. Each required approval shows its exact amount before you sign.</p>
  </section>;
}

export function FoundationFeeDisclosure({ creatorFeeBps, quoteSymbol }: { creatorFeeBps: number; quoteSymbol: string }) {
  return <div className={styles.feeDisclosure}>
    <dl className={styles.rows}>
      <div><dt>Programmable platform fee</dt><dd>0.3% <span className={styles.muted}>fixed</span></dd></div>
      <div><dt>Creator fee</dt><dd>{creatorFeeBps / 100}%</dd></div>
      <div className={styles.totalRow}><dt>Combined swap fees</dt><dd>{(creatorFeeBps + 30) / 100}%</dd></div>
    </dl>
    <p className={styles.help}>Charged on every buy and sell in this launch pool, in {quoteSymbol}. Uniswap LP and protocol fees are separate.</p>
    <details className={styles.transactionDetails}><summary>Platform fee recipient</summary><FoundationAddress value={FOUNDATION_PLATFORM_FEE_RECIPIENT} label="platform fee recipient" /><p className={styles.help}>This additional 0.3% cannot be removed, redirected or used by optional modules.</p></details>
  </div>;
}

export function ModuleFoundationLaunchReview({ review, contextKey, symbol, busy, disabled, error, moduleSummary = [], onConfirm, onEdit }: {
  review: FoundationLaunchReview; contextKey: string; symbol: string; busy: boolean; disabled?: boolean; error?: string;
  moduleSummary?: readonly { name: string; version: string; fields: readonly { label: string; value: string }[] }[];
  onConfirm: () => void; onEdit: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); const timer = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer); }, []);
  const invalid = foundationReviewError(review, contextKey, now);
  return <section className={styles.reviewPanel} aria-labelledby="foundation-review-title">
    <div className={styles.sectionHeading}><span className={styles.eyebrow}>Launch review</span><h2 ref={heading} tabIndex={-1} id="foundation-review-title">Ready for your review</h2><p>Check the amounts and ownership before opening your wallet.</p></div>
    <div className={styles.simulated}><CheckIcon size={16} aria-hidden="true" /><span>Simulated at block {review.simulationBlock}</span></div>
    <dl className={styles.rows}>
      <div><dt>Supply</dt><dd>{review.supply} {symbol}</dd></div>
      <div><dt>Starting market cap</dt><dd>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(review.actualStartMarketCapUsd))}</dd></div>
      <div><dt>Initial buy</dt><dd>{review.initialBuy} {review.quote.symbol}</dd></div>
      <div><dt>Minimum from initial buy</dt><dd>{review.minimumInitialTokens} {symbol}</dd></div>
      <div><dt>Additional creator liquidity</dt><dd>{review.additionalLiquidity} {review.quote.symbol}</dd></div>
      <div><dt>Launch wallet</dt><dd><FoundationAddress value={review.account} label="launch wallet" /></dd></div>
    </dl>
    {review.factoryVersion === "v2" ? <section className={styles.position} aria-labelledby="foundation-custody-title">
      <h3 id="foundation-custody-title">Launch liquidity is permanent</h3>
      <p>The base LP NFT and any additional LP NFT shown in this review go directly to the burn address. The liquidity stays in the pool. You cannot withdraw it, transfer its NFT or collect proceeds belonging to that position.</p>
      <dl className={styles.rows}>
        <div><dt>Maximum wallet funding</dt><dd>{review.quoteFunding.maximum} {review.quote.symbol}</dd></div>
        <div><dt>Additional liquidity committed</dt><dd>{review.quoteFunding.principal} {review.quote.symbol}</dd></div>
        <div><dt>Funding returned</dt><dd>{review.quoteFunding.refund} {review.quote.symbol}</dd></div>
      </dl>
      <p className={styles.help}>The funding includes your initial buy. Creator fees from trading remain separately claimable. Later liquidity added by other people has its own ownership.</p>
      <details className={styles.transactionDetails}><summary>Burn address and rounding remainder</summary>
        <FoundationAddress value={review.roundingInventory.recipient} label="burn address" />
        <p className={styles.help}>The launch also sends {review.roundingInventory.tokenAmount} {symbol} left over from position rounding to this address. These coins cannot be recovered; the token&apos;s total supply stays unchanged.</p>
      </details>
    </section> : null}
    <FoundationFeeDisclosure creatorFeeBps={review.creatorFeeBps} quoteSymbol={review.quote.symbol} />
    <details className={styles.details}><summary>Coin and metadata</summary><div className={styles.detailsBody}><dl className={styles.rows}>
      <div><dt>Coin address</dt><dd><FoundationAddress value={review.tokenAddress} label="coin address" /></dd></div>
      <div><dt>Metadata hash</dt><dd><FoundationAddress value={review.metadataHash} label="metadata hash" /></dd></div>
      {review.metadataUri && foundationPublicUrl(review.metadataUri) ? <div><dt>Metadata</dt><dd><a href={review.metadataUri} target="_blank" rel="noreferrer">View saved metadata <ArrowUpRightIcon size={14} aria-hidden="true" /></a></dd></div> : null}
    </dl></div></details>
    <FoundationPoolDetails pool={review.pool} positions={review.positions} predicted />
    <details className={styles.details}><summary>Selected modules · {moduleSummary.length}</summary><div className={styles.detailsBody}>{moduleSummary.length ? moduleSummary.map(module => <section key={`${module.name}:${module.version}`} className={styles.position}><h3>{module.name}</h3><p>Version {module.version}</p><dl className={styles.rows}>{module.fields.map(field => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section>) : <p className={styles.help}>No optional modules. The fixed platform fee remains active.</p>}</div></details>
    <FoundationTransactionSteps transactions={review.transactions} />
    {review.notes?.length ? <ul className={styles.notes}>{review.notes.map(note => <li key={note}>{note}</li>)}</ul> : null}
    <p className={styles.help}>Review expires at {new Date(review.expiresAt * 1_000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" })} UTC. The wallet request checks the simulation again.</p>
    <p className={styles.error} role="alert">{error || invalid || ""}</p>
    <div className={styles.actions}><button type="button" className={styles.secondaryButton} onClick={onEdit} disabled={busy}>Edit coin</button><button type="button" className={styles.primaryButton} onClick={onConfirm} disabled={busy || disabled || Boolean(invalid)} aria-busy={busy}>{busy ? "Waiting for wallet…" : "Continue in wallet"}</button></div>
  </section>;
}

export function ModuleFoundationTransactionResult({ result, onRefresh, refreshing = false }: { result: FoundationTransactionResult; onRefresh?: () => void; refreshing?: boolean }) {
  const title = result.status === "confirmed" ? "Transaction confirmed" : result.status === "reverted" ? "Transaction reverted" : result.status === "submitted" ? "Transaction submitted" : "Confirmation needs checking";
  return <section className={styles.resultPanel} aria-labelledby="foundation-result-title">
    <span className={styles.eyebrow}>Transaction</span><h2 id="foundation-result-title">{title}</h2>
    <p>{result.message ?? (result.status === "confirmed" ? "The receipt was verified onchain." : result.status === "reverted" ? "The transaction did not complete. Network gas may have been charged." : "The transaction hash is saved. Wait for a verified receipt before submitting again.")}</p>
    <dl className={styles.rows}><div><dt>Transaction hash</dt><dd><FoundationAddress value={result.transactionHash} label="transaction hash" /></dd></div>{result.blockNumber ? <div><dt>Confirmed block</dt><dd>{result.blockNumber}</dd></div> : null}{result.metadataStatus ? <div><dt>Metadata</dt><dd>{result.metadataStatus === "indexed" ? "Visible in the index" : result.metadataStatus === "stored" ? "Stored; index confirmation pending" : "Checking storage and index"}</dd></div> : null}</dl>
    <div className={styles.actions}>{foundationPublicUrl(result.explorerUrl) ? <a className={styles.secondaryButton} href={result.explorerUrl} target="_blank" rel="noreferrer">View transaction <ArrowUpRightIcon size={16} aria-hidden="true" /></a> : null}{onRefresh && ((result.status !== "confirmed" && result.status !== "reverted") || result.verificationStatus === "pending") ? <button className={styles.primaryButton} type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Checking…" : result.verificationStatus === "pending" ? "Check transaction details" : "Check confirmation"}</button> : null}{result.status === "confirmed" && result.tokenUrl && (result.tokenUrl.startsWith("/") && !result.tokenUrl.startsWith("//") || foundationPublicUrl(result.tokenUrl)) ? <a className={styles.primaryButton} href={result.tokenUrl}>View coin <ArrowUpRightIcon size={16} aria-hidden="true" /></a> : null}</div>
    {result.status === "confirmed" && result.pool ? <FoundationPoolDetails pool={result.pool} positions={result.positions} /> : null}
  </section>;
}
