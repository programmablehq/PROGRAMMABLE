"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { parseUnits, type Address } from "viem";
import { foundationDecimalError, foundationPublicUrl, foundationReviewError, type FoundationAvailability, type FoundationPoolIdentity, type FoundationPositionIdentity, type FoundationQuoteAsset, type FoundationTradeDraft, type FoundationTradeReview, type FoundationTransactionResult, type FoundationWalletAction } from "@/lib/module-foundation/ui-types";
import { FoundationAddress, FoundationPoolDetails } from "./module-foundation-review";
import { RobinhoodChart } from "./robinhood-chart";
import { ResponsiveTradePanel } from "./responsive-trade-panel";
import { displaySwapAmount } from "./swap-amount";
import type { FoundationCreatorFees } from "@/lib/module-foundation/creator-fees";
import { FOUNDATION_DEFAULT_IMAGE } from "@/lib/module-foundation/default-image";
import { coinDollars, coinValuation, type RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import styles from "./module-foundation-ui.module.css";

export type ModuleFoundationMarketProps = FoundationCreatorFees & {
  availability: FoundationAvailability;
  contextKey: string;
  coin: { address: Address; name: string; symbol: string; description: string; decimals: number; balance?: string; imageURI?: string; socialLinks?: readonly { label: string; url: string }[] };
  quote: FoundationQuoteAsset;
  /** Wallet input/output asset; pool identity and fee accounting still use quote. */
  tradeAsset?: FoundationQuoteAsset;
  /** Native input balance after reserving network gas. */
  maximumBuyAmount?: string;
  pool: FoundationPoolIdentity;
  positions?: readonly FoundationPositionIdentity[];
  market?: RobinhoodCoinMarket | null;
  marketLoading?: boolean;
  marketDelayed?: boolean;
  walletAction?: FoundationWalletAction;
  submissionBlocked?: string;
  onPrepareTrade: (draft: FoundationTradeDraft) => Promise<FoundationTradeReview | null>;
  onConfirmTrade: (review: FoundationTradeReview) => Promise<FoundationTransactionResult>;
  onRefreshResult?: (result: FoundationTransactionResult) => Promise<FoundationTransactionResult>;
  /** Rendered by the catalog action adapter. No product-specific action switch. */
  moduleActions?: ReactNode;
  feeLedger?: { asOfBlock: string; platformCredited: string; platformPaid: string; creatorCredited: string; creatorPaid: string };
}

function humanError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : "The trade could not be prepared. Please try again.";
  return message.length <= 320 ? message : "The trade could not complete. Check its status before trying again.";
}

export function foundationInlineTradeError(review: FoundationTradeReview, draft: FoundationTradeDraft, contextKey: string, chainId: number): string | null {
  const invalid = foundationReviewError(review, contextKey);
  if (invalid) return invalid;
  if (review.side !== draft.side || review.inputAmount !== draft.amount || review.chainId !== chainId
    || review.transactions.length === 0 || review.transactions.some(step => step.chainId !== chainId)) {
    return "The quote changed. Try again for a fresh price.";
  }
  return null;
}

export function foundationTradeQuoteExpiresAt(review: FoundationTradeReview, receivedAt: number) {
  return Math.min(review.expiresAt * 1_000 - 5_000, receivedAt + 30_000);
}

export function ModuleFoundationMarket(props: ModuleFoundationMarketProps) {
  const { availability, contextKey, coin, quote, tradeAsset = quote, maximumBuyAmount, pool, positions = [], walletAction, submissionBlocked, onPrepareTrade, onConfirmTrade, onRefreshResult, moduleActions, feeLedger } = props;
  const [draft, setDraft] = useState<FoundationTradeDraft>({ side: "buy", amount: "", slippageBps: 300 });
  const [result, setResult] = useState<FoundationTransactionResult | null>(null);
  const [busy, setBusy] = useState<"connect" | "prepare" | "confirm" | "refresh" | null>(null);
  const [error, setError] = useState("");
  const [amountError, setAmountError] = useState("");
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [quotation, setQuotation] = useState<{ key: string; review?: FoundationTradeReview; error?: string; receivedAt: number } | null>(null);
  const lock = useRef(false);
  const active = useRef(true);
  const current = useRef({ contextKey, submissionBlocked, ready: availability.status === "ready" && quote.supported });
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const prepareRef = useRef(onPrepareTrade);
  useEffect(() => { prepareRef.current = onPrepareTrade; }, [onPrepareTrade]);
  useLayoutEffect(() => { current.current = { contextKey, submissionBlocked, ready: availability.status === "ready" && quote.supported }; }, [contextKey, submissionBlocked, availability.status, quote.supported]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  const inputAsset = draft.side === "buy" ? tradeAsset : coin;
  const maximumAmount = draft.side === "buy" ? maximumBuyAmount : coin.balance;
  const waitingForConfirmation = result?.status === "submitted" || result?.status === "unconfirmed";
  const unavailable = availability.status !== "ready" || !quote.supported;
  const blocked = Boolean(busy || walletAction?.busy || submissionBlocked || (!walletAction && unavailable) || waitingForConfirmation);
  const imageURI = coin.imageURI && foundationPublicUrl(coin.imageURI) && failedImage !== coin.imageURI ? coin.imageURI : FOUNDATION_DEFAULT_IMAGE.url;
  const socialLinks = coin.socialLinks?.filter(link => link.label.trim() && foundationPublicUrl(link.url)) ?? [];
  const valuation = coinValuation(props.market);
  const outputAsset = draft.side === "buy" ? coin : tradeAsset;
  const inputProblem = foundationDecimalError(draft.amount, inputAsset.decimals, false);
  const insufficient = !inputProblem && inputAsset.balance !== undefined && !foundationDecimalError(inputAsset.balance, inputAsset.decimals)
    && parseUnits(draft.amount, inputAsset.decimals) > parseUnits(inputAsset.balance, inputAsset.decimals);
  const quoteKey = `${contextKey}:${coin.address}:${draft.side}:${draft.amount}:${draft.slippageBps}:${quoteRevision}`;
  const currentQuote = quotation?.key === quoteKey ? quotation : null;
  const quoteReady = !walletAction && !unavailable && !submissionBlocked && !waitingForConfirmation && !inputProblem && !insufficient;
  const review = quoteReady ? currentQuote?.review : undefined;
  const quoteError = quoteReady ? currentQuote?.error : undefined;
  const quoting = quoteReady && !review && !quoteError;

  useEffect(() => {
    if (!quoteReady || busy) return;
    let active = true;
    const requested = { ...draft };
    const timer = setTimeout(() => {
      void prepareRef.current(requested).then(value => {
        if (!active) return;
        const invalid = value ? foundationInlineTradeError(value, requested, contextKey, availability.chainId)
          || foundationDecimalError(value.outputAmount, outputAsset.decimals, false)
          || foundationDecimalError(value.minimumOutput, outputAsset.decimals, false)
          || foundationDecimalError(value.platformFeeAmount, quote.decimals)
          || foundationDecimalError(value.creatorFeeAmount, quote.decimals)
          : "A quote is unavailable. Try again.";
        if (invalid) throw new Error(invalid);
        setQuotation({ key: quoteKey, review: value!, receivedAt: Date.now() });
      }).catch(caught => { if (active) setQuotation({ key: quoteKey, error: humanError(caught), receivedAt: Date.now() }); });
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [quoteReady, quoteKey, contextKey, availability.chainId, draft, busy, outputAsset.decimals, quote.decimals]);

  useEffect(() => {
    if (!review || !currentQuote || busy) return;
    // The transaction deadline can outlive a useful displayed price. Refresh the
    // observation every 30 seconds, and always before its executable expiry.
    const until = foundationTradeQuoteExpiresAt(review, currentQuote.receivedAt);
    const timer = setTimeout(() => setQuoteRevision(value => value + 1), Math.max(0, until - Date.now()));
    const visible = () => { if (document.visibilityState !== "hidden" && Date.now() >= until) setQuoteRevision(value => value + 1); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [review, currentQuote, busy]);

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (lock.current || blocked) return;
    if (walletAction) {
      lock.current = true; setBusy("connect");
      try { await walletAction.onClick(); }
      catch (caught) { if (active.current) setError(humanError(caught)); }
      finally { lock.current = false; if (active.current) setBusy(null); }
      return;
    }
    const problem = foundationDecimalError(draft.amount, inputAsset.decimals, false);
    if (problem) { setAmountError(problem); input.current?.focus(); return; }
    if (inputAsset.balance !== undefined && !foundationDecimalError(inputAsset.balance, inputAsset.decimals)
      && parseUnits(draft.amount, inputAsset.decimals) > parseUnits(inputAsset.balance, inputAsset.decimals)) {
      setAmountError(`Not enough ${inputAsset.symbol}.`); input.current?.focus(); return;
    }
    const context = current.current.contextKey;
    const requested = { ...draft };
    if (!review || !currentQuote || Date.now() >= foundationTradeQuoteExpiresAt(review, currentQuote.receivedAt)) {
      setQuoteRevision(value => value + 1);
      setError("Wait for a current quote before trading.");
      return;
    }
    lock.current = true; setBusy("confirm"); setError(""); setAmountError(""); setResult(null);
    try {
      const prepared = review;
      if (!active.current) return;
      if (current.current.contextKey !== context) throw new Error("Your wallet changed. Try again with the current wallet.");
      if (current.current.submissionBlocked || !current.current.ready) throw new Error(current.current.submissionBlocked ?? "Trading is temporarily unavailable.");
      const invalid = foundationInlineTradeError(prepared, requested, context, availability.chainId);
      if (invalid) throw new Error(invalid);
      setBusy("confirm");
      const receipt = await onConfirmTrade(prepared);
      if (active.current) {
        setResult(receipt);
        if (receipt.status === "confirmed" && receipt.operationComplete) setDraft(value => ({ ...value, amount: "" }));
      }
    } catch (caught) { if (active.current) setError(humanError(caught)); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  }

  async function refresh() {
    if (!result || !onRefreshResult || lock.current) return;
    lock.current = true; setBusy("refresh");
    try {
      const receipt = await onRefreshResult(result);
      if (active.current) {
        setResult(receipt);
        if (receipt.status === "confirmed" && receipt.operationComplete) setDraft(value => ({ ...value, amount: "" }));
      }
    }
    catch (caught) { if (active.current) setError(humanError(caught)); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  }

  return <div className={`${styles.page} ${styles.marketPage}`}>
    <div className={styles.topline}><Link className={styles.backButton} href="/explore/robinhood"><ArrowLeftIcon size={16} aria-hidden="true" />Explore</Link><span className={styles.network}>{availability.chainName}</span></div>
    <header className={styles.pageHeading}><div className={styles.marketHeading}>{imageURI ? <Image src={imageURI} alt="" width={64} height={64} unoptimized referrerPolicy="no-referrer" onError={() => setFailedImage(imageURI)} /> : null}<div><h1>{coin.name}</h1><p>{coin.symbol} / {quote.symbol}</p></div></div>{socialLinks.length ? <nav className={styles.coinLinks} aria-label="Coin links">{socialLinks.map(link => <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${link.label} (opens in a new tab)`}>{link.label}<ArrowUpRightIcon size={16} aria-hidden="true" /></a>)}</nav> : null}</header>
    <div className={styles.coinAddress}><FoundationAddress value={coin.address} label="coin address" /><a className={styles.textButton} href={`https://robinhoodchain.blockscout.com/token/${coin.address}`} target="_blank" rel="noopener noreferrer">Explorer</a></div>
    <div className={styles.marketLayout}>
      <div className={styles.marketChart}>
        <dl className={styles.marketMetrics}><div><dt>Price</dt><dd>{props.marketLoading && !props.market ? "Loading…" : coinDollars(props.market?.priceUsd, true)}</dd></div><div><dt title={valuation.title}>{valuation.label}</dt><dd>{props.marketLoading && !props.market ? "Loading…" : coinDollars(valuation.value)}</dd></div></dl>
        {props.marketDelayed ? <p className={styles.help} role="status">{props.market ? "Price updates are delayed." : "Market data is temporarily unavailable."}</p> : null}
        <RobinhoodChart poolId={pool.poolId} name={coin.name} market={props.market} />
      </div>
      <div className={styles.mainColumn}><ResponsiveTradePanel symbol={coin.symbol}>
        <section className={styles.tradePanel} aria-label={`Trade ${coin.symbol}`}>
          <form noValidate onSubmit={event => void prepare(event)}>
            <div className={styles.sideButtons} role="group" aria-label="Trade direction">{(["buy", "sell"] as const).map(side => <button type="button" key={side} aria-pressed={draft.side === side} disabled={Boolean(busy) || waitingForConfirmation} onClick={() => { setDraft(value => ({ ...value, side, amount: "" })); setAmountError(""); setError(""); setResult(null); }}>{side === "buy" ? "Buy" : "Sell"}</button>)}</div>
            <div className={styles.field}>
              <div className={styles.tradeAmountLabel}><label htmlFor={`${fieldId}-amount`}>Amount</label><button type="button" className={styles.tradeMax} disabled={Boolean(busy) || waitingForConfirmation || !maximumAmount || Boolean(foundationDecimalError(maximumAmount, inputAsset.decimals, false))} onClick={() => { setDraft(value => ({ ...value, amount: maximumAmount! })); setAmountError(""); setError(""); }}>Max</button></div>
              <div className={styles.amountInput}><input ref={input} id={`${fieldId}-amount`} name="amount" inputMode="decimal" autoComplete="off" placeholder="0" value={draft.amount} disabled={Boolean(busy) || waitingForConfirmation} aria-invalid={Boolean(amountError) || undefined} aria-describedby={`${fieldId}-balance${amountError ? ` ${fieldId}-error` : ""}`} onChange={event => { setDraft(value => ({ ...value, amount: event.target.value })); setAmountError(""); setError(""); setResult(null); }} /><span>{inputAsset.symbol}</span></div>
              <p id={`${fieldId}-balance`} className={styles.tradeBalance}>{inputAsset.balance !== undefined ? `Balance: ${inputAsset.balance} ${inputAsset.symbol}` : ""}</p>
              {amountError ? <p id={`${fieldId}-error`} className={styles.error} role="alert">{amountError}</p> : null}
            </div>
            <div className={styles.tradeEstimate}>
              <span id={`${fieldId}-receive`}>You receive</span>
              <output aria-labelledby={`${fieldId}-receive`} aria-live="polite">
                {review ? `≈ ${displaySwapAmount(parseUnits(review.outputAmount, outputAsset.decimals), outputAsset.decimals)} ${outputAsset.symbol}`
                  : quoting ? "Getting quote…" : draft.amount && walletAction ? `${walletAction.label} for a quote` : "—"}
              </output>
            </div>
            {review ? <p className={styles.tradeMinimum}>Minimum {displaySwapAmount(parseUnits(review.minimumOutput, outputAsset.decimals), outputAsset.decimals)} {outputAsset.symbol}</p> : null}
            <details className={styles.tradeSettings}><summary>Slippage <span>{draft.slippageBps / 100}%</span></summary><div className={styles.tradeSlippage} aria-label="Slippage">{[100, 300, 500].map(value => <button type="button" key={value} aria-pressed={draft.slippageBps === value} disabled={Boolean(busy) || waitingForConfirmation} onClick={() => setDraft(current => ({ ...current, slippageBps: value }))}>{value / 100}%</button>)}</div></details>
            {review ? <details className={styles.tradeSettings}><summary>Quote details</summary><dl className={styles.rows}>
              <div><dt>Platform fee</dt><dd>{review.platformFeeAmount} {quote.symbol}</dd></div>
              {parseUnits(review.creatorFeeAmount, quote.decimals) > 0n ? <div><dt>Creator fee</dt><dd>{review.creatorFeeAmount} {quote.symbol}</dd></div> : null}
            </dl></details> : null}
            {quoteError ? <p className={styles.error} role="status">{quoteError} <button type="button" className={styles.textButton} onClick={() => setQuoteRevision(value => value + 1)}>Refresh quote</button></p> : null}
            {unavailable ? <p className={styles.error} role="status">{availability.reason ?? quote.reason ?? "Trading is temporarily unavailable. Try again shortly."}</p> : null}
            {error || submissionBlocked ? <p className={styles.error} role="alert">{error || submissionBlocked}</p> : null}
            <button type="submit" className={styles.primaryButton} disabled={blocked || walletAction?.busy || (quoteReady && !review)} aria-busy={Boolean(busy) || walletAction?.busy}>{busy === "confirm" || busy === "connect" ? "Check your wallet…" : waitingForConfirmation ? "Confirming…" : walletAction?.label ?? (quoting ? "Getting quote…" : draft.side === "buy" ? "Buy" : "Sell")}</button>
          </form>
          {result ? <div className={styles.tradeResult} role="status"><span>{result.status === "confirmed" ? result.operationComplete ? "Trade complete" : "Approval confirmed. Continue your trade." : result.status === "reverted" ? "Trade failed. Try again." : "Waiting for confirmation…"}</span>{foundationPublicUrl(result.explorerUrl) ? <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer" aria-label="View trade transaction"><ArrowUpRightIcon size={16} aria-hidden="true" /></a> : null}{waitingForConfirmation && onRefreshResult ? <button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={() => void refresh()}>{busy === "refresh" ? "Checking…" : "Check confirmation"}</button> : null}</div> : null}
        </section></ResponsiveTradePanel>
      </div>
      <div className={styles.marketAbout}>{coin.description ? <p>{coin.description}</p> : null}<FoundationPoolDetails pool={pool} positions={positions} />
        {feeLedger || moduleActions ? <details className={styles.details}><summary>Manage coin</summary><div className={styles.detailsBody}>
        {feeLedger ? <section className={styles.feeLedger}><h2>Fees in {quote.symbol}</h2><dl className={styles.rows}><div><dt>Platform credited</dt><dd>{feeLedger.platformCredited} {quote.symbol}</dd></div><div><dt>Platform paid out</dt><dd>{feeLedger.platformPaid} {quote.symbol}</dd></div><div><dt>Creator credited</dt><dd>{feeLedger.creatorCredited} {quote.symbol}</dd></div><div><dt>Creator paid out</dt><dd>{feeLedger.creatorPaid} {quote.symbol}</dd></div></dl><p className={styles.help}>Read at block {feeLedger.asOfBlock}. A fee credit is not a completed payout.</p></section> : null}
        {moduleActions}
        </div></details> : null}
      </div>
    </div>
  </div>;
}
