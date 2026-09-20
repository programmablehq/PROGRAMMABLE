"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import type { Address } from "viem";
import { foundationDecimalError, foundationPublicUrl, foundationReviewError, type FoundationAvailability, type FoundationPoolIdentity, type FoundationPositionIdentity, type FoundationQuoteAsset, type FoundationTradeDraft, type FoundationTradeReview, type FoundationTransactionResult, type FoundationWalletAction } from "@/lib/module-foundation/ui-types";
import { FoundationAddress, FoundationFeeDisclosure, FoundationPoolDetails, FoundationTransactionSteps, ModuleFoundationTransactionResult } from "./module-foundation-review";
import { RobinhoodChart } from "./robinhood-chart";
import { foundationCreatorFeeFields, foundationCreatorFeeRates, type FoundationCreatorFees } from "@/lib/module-foundation/creator-fees";
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
  pool: FoundationPoolIdentity;
  positions?: readonly FoundationPositionIdentity[];
  market?: RobinhoodCoinMarket | null;
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

export function ModuleFoundationMarket(props: ModuleFoundationMarketProps) {
  const { availability, contextKey, coin, quote, tradeAsset = quote, pool, positions = [], walletAction, submissionBlocked, onPrepareTrade, onConfirmTrade, onRefreshResult, moduleActions, feeLedger } = props;
  const fees = foundationCreatorFeeRates(props);
  const [draft, setDraft] = useState<FoundationTradeDraft>({ side: "buy", amount: "", slippageBps: 100 });
  const [review, setReview] = useState<FoundationTradeReview | null>(null);
  const [result, setResult] = useState<FoundationTransactionResult | null>(null);
  const [busy, setBusy] = useState<"prepare" | "confirm" | "refresh" | null>(null);
  const [error, setError] = useState("");
  const [amountError, setAmountError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const lock = useRef(false);
  const active = useRef(true);
  const currentContext = useRef(contextKey);
  const input = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { currentContext.current = contextKey; }, [contextKey]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!review) return;
    reviewHeading.current?.focus();
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [review]);

  const creatorFeeBps = (review?.side ?? draft.side) === "buy" ? fees.creatorBuyFeeBps : fees.creatorSellFeeBps;
  const inputAsset = draft.side === "buy" ? tradeAsset : coin;
  const outputSymbol = draft.side === "buy" ? coin.symbol : tradeAsset.symbol;
  const invalidReview = review ? foundationReviewError(review, contextKey, now) : null;
  const unavailable = availability.status !== "ready" || !quote.supported;
  const blocked = Boolean(busy || submissionBlocked || unavailable);
  const imageURI = coin.imageURI && foundationPublicUrl(coin.imageURI) && failedImage !== coin.imageURI ? coin.imageURI : FOUNDATION_DEFAULT_IMAGE.url;
  const socialLinks = coin.socialLinks?.filter(link => link.label.trim() && foundationPublicUrl(link.url)) ?? [];
  const valuation = coinValuation(props.market);

  function edit() { setReview(null); setError(""); requestAnimationFrame(() => input.current?.focus()); }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (lock.current || blocked) return;
    if (walletAction) { try { await walletAction.onClick(); } catch (caught) { setError(humanError(caught)); } return; }
    const problem = foundationDecimalError(draft.amount, inputAsset.decimals, false);
    if (problem) { setAmountError(problem); input.current?.focus(); return; }
    const context = currentContext.current;
    lock.current = true; setBusy("prepare"); setError(""); setAmountError("");
    try {
      const prepared = await onPrepareTrade(draft);
      if (!active.current) return;
      if (currentContext.current !== context) throw new Error("Your wallet or launch version changed. Review the trade again.");
      if (!prepared) return;
      const invalid = foundationReviewError(prepared, context);
      if (invalid) throw new Error(invalid);
      if (prepared.side !== draft.side || prepared.chainId !== availability.chainId || prepared.transactions.length === 0) throw new Error("The simulation differs from your trade. Review again.");
      setNow(Date.now()); setReview(prepared);
    } catch (caught) { if (active.current) setError(humanError(caught)); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  }

  async function confirm() {
    if (!review || lock.current || blocked) return;
    const invalid = foundationReviewError(review, currentContext.current);
    if (invalid) { setError(invalid); return; }
    lock.current = true; setBusy("confirm"); setError("");
    try { const receipt = await onConfirmTrade(review); if (active.current) setResult(receipt); }
    catch (caught) { if (active.current) setError(humanError(caught)); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  }

  async function refresh() {
    if (!result || !onRefreshResult || lock.current) return;
    lock.current = true; setBusy("refresh");
    try { const receipt = await onRefreshResult(result); if (active.current) setResult(receipt); }
    catch (caught) { if (active.current) setError(humanError(caught)); }
    finally { lock.current = false; if (active.current) setBusy(null); }
  }

  return <div className={styles.page}>
    <div className={styles.topline}><Link className={styles.backButton} href="/explore/robinhood"><ArrowLeftIcon size={16} aria-hidden="true" />Explore</Link><span className={styles.network}>{availability.chainName}</span></div>
    <header className={styles.pageHeading}><div className={styles.marketHeading}>{imageURI ? <Image src={imageURI} alt="" width={64} height={64} unoptimized referrerPolicy="no-referrer" onError={() => setFailedImage(imageURI)} /> : null}<div><h1>{coin.name}</h1><p>{coin.symbol} / {quote.symbol}</p></div></div>{socialLinks.length ? <nav className={styles.coinLinks} aria-label="Coin links">{socialLinks.map(link => <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${link.label} (opens in a new tab)`}>{link.label}<ArrowUpRightIcon size={16} aria-hidden="true" /></a>)}</nav> : null}</header>
    <div className={styles.coinAddress}><FoundationAddress value={coin.address} label="coin address" /></div>
    <div className={styles.marketLayout}>
      <div className={styles.marketChart}>
        <dl className={styles.marketMetrics}><div><dt>Price</dt><dd>{coinDollars(props.market?.priceUsd, true)}</dd></div><div><dt title={valuation.label === "FDV" ? "Fully diluted valuation" : undefined}>{valuation.label}</dt><dd>{coinDollars(valuation.value)}</dd></div></dl>
        <RobinhoodChart poolId={pool.poolId} name={coin.name} market={props.market} />
      </div>
      <div className={styles.mainColumn}>
        {result ? <><ModuleFoundationTransactionResult result={result} onRefresh={onRefreshResult ? () => void refresh() : undefined} refreshing={busy === "refresh"} />{result.status === "confirmed" || result.status === "reverted" ? <button type="button" className={styles.secondaryButton} onClick={() => { setResult(null); setDraft(current => ({ ...current, amount: "" })); edit(); }}>Return to trading</button> : null}</> : <section className={styles.tradePanel} aria-label={`Trade ${coin.symbol}`}>
          {review ? <div className={styles.tradeReview}><h2 tabIndex={-1} ref={reviewHeading}>Review {review.side}</h2><p className={styles.simulated}><CheckIcon size={16} aria-hidden="true" /> Simulated at block {review.simulationBlock}</p><dl className={styles.rows}><div><dt>You pay</dt><dd>{review.inputAmount} {inputAsset.symbol}</dd></div><div><dt>You receive</dt><dd>{review.outputAmount} {outputSymbol}</dd></div><div><dt>Minimum received</dt><dd>{review.minimumOutput} {outputSymbol}</dd></div><div><dt>Platform fee · 0.3%</dt><dd>{review.platformFeeAmount} {quote.symbol}</dd></div><div><dt>Creator fee · {creatorFeeBps / 100}%</dt><dd>{review.creatorFeeAmount} {quote.symbol}</dd></div>{review.lpFeeAmount !== undefined ? <div><dt>LP fee</dt><dd>{review.lpFeeAmount} {quote.symbol}</dd></div> : null}</dl><p className={styles.help}>The received amount includes all applicable fees. The minimum applies after fees and {(draft.slippageBps / 100)}% slippage.</p><details className={styles.transactionDetails}><summary>Official Universal Router</summary><FoundationAddress value={review.universalRouter} label="Universal Router" /></details><FoundationTransactionSteps transactions={review.transactions} /><p className={styles.help}>This quote expires at {new Date(review.expiresAt * 1_000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" })} UTC.</p><p className={styles.error} role="alert">{error || invalidReview || submissionBlocked || ""}</p><div className={styles.actions}><button type="button" className={styles.secondaryButton} disabled={Boolean(busy)} onClick={edit}>Edit trade</button><button type="button" className={styles.primaryButton} disabled={blocked || Boolean(invalidReview)} aria-busy={busy === "confirm"} onClick={() => void confirm()}>{busy === "confirm" ? "Waiting for wallet…" : "Continue in wallet"}<ArrowUpRightIcon size={16} aria-hidden="true" /></button></div></div> : <form noValidate onSubmit={event => void prepare(event)}>
            <div className={styles.sideButtons} aria-label="Trade direction">{(["buy", "sell"] as const).map(side => <button type="button" key={side} aria-pressed={draft.side === side} disabled={Boolean(busy)} onClick={() => { setDraft(current => ({ ...current, side, amount: "" })); setAmountError(""); setError(""); }}>{side === "buy" ? "Buy" : "Sell"}</button>)}</div>
            <div className={styles.field}><label htmlFor="foundation-trade-amount">{draft.side === "buy" ? "Buy with" : "Sell amount"}</label><div className={styles.amountInput}><input ref={input} id="foundation-trade-amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0" value={draft.amount} disabled={Boolean(busy)} aria-invalid={Boolean(amountError) || undefined} aria-describedby="foundation-trade-amount-help foundation-trade-amount-error" onChange={event => { setDraft(current => ({ ...current, amount: event.target.value })); setAmountError(""); setError(""); }} /><span>{inputAsset.symbol}</span></div><p id="foundation-trade-amount-help" className={styles.help}>{inputAsset.balance !== undefined ? `Balance: ${inputAsset.balance} ${inputAsset.symbol}` : `Enter the amount of ${inputAsset.symbol} to spend.`}</p><p id="foundation-trade-amount-error" className={styles.error}>{amountError}</p></div>
            <div className={styles.field}><label htmlFor="foundation-trade-slippage">Slippage limit</label><select id="foundation-trade-slippage" value={draft.slippageBps} disabled={Boolean(busy)} onChange={event => setDraft(current => ({ ...current, slippageBps: Number(event.target.value) }))}><option value={50}>0.5%</option><option value={100}>1%</option><option value={200}>2%</option></select></div>
            <FoundationFeeDisclosure {...foundationCreatorFeeFields(props)} side={draft.side} quoteSymbol={quote.symbol} />
            {unavailable ? <p className={styles.error} role="status">{availability.reason ?? quote.reason ?? "Trading is temporarily unavailable. Try again after the current route is verified."}</p> : null}
            <p className={styles.error} role="alert">{error || submissionBlocked || ""}</p>
            <button type="submit" className={styles.primaryButton} disabled={blocked || walletAction?.busy} aria-busy={busy === "prepare" || walletAction?.busy}>{busy === "prepare" ? "Simulating trade…" : walletAction?.label ?? `Review ${draft.side}`}</button><p className={styles.help}>Swap through Uniswap’s Universal Router. Network gas is separate.</p>
          </form>}
        </section>}
        {result && error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <div className={styles.marketAbout}>{coin.description ? <p>{coin.description}</p> : null}<FoundationPoolDetails pool={pool} positions={positions} />
        {feeLedger ? <section className={styles.feeLedger}><h2>Fees in {quote.symbol}</h2><dl className={styles.rows}><div><dt>Platform credited</dt><dd>{feeLedger.platformCredited} {quote.symbol}</dd></div><div><dt>Platform paid out</dt><dd>{feeLedger.platformPaid} {quote.symbol}</dd></div><div><dt>Creator credited</dt><dd>{feeLedger.creatorCredited} {quote.symbol}</dd></div><div><dt>Creator paid out</dt><dd>{feeLedger.creatorPaid} {quote.symbol}</dd></div></dl><p className={styles.help}>Read at block {feeLedger.asOfBlock}. A fee credit is not a completed payout.</p></section> : null}
        {moduleActions}
      </div>
    </div>
  </div>;
}
