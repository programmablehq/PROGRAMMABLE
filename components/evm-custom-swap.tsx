"use client";
import { useEffect, useId, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { EvmCustomFees } from "./evm-custom-fees";
import { useWallet } from "./wallet-provider";
import { validateEvmCustomSwapDescriptor, validateEvmCustomSwapPreparation, type EvmCustomSwapDescriptor, type EvmCustomSwapPreparation } from "@/lib/swap/evm-custom";
import styles from "./swap-panel.module.css";
export function EvmCustomSwap({ token, symbol }: {
  token: `0x${string}`;
  symbol: string;
}) {
  const wallet = useWallet(), id = useId(), busyRef = useRef(false);
  const [descriptor, setDescriptor] = useState<EvmCustomSwapDescriptor | null>(null), [buy, setBuy] = useState(true), [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(100), [savedQuote, setQuote] = useState<EvmCustomSwapPreparation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [hash, setHash] = useState<`0x${string}` | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/swap/evm/prepare?token=${token}`, { signal: abort.signal }).then(async (response) => { const body = await response.json(); if (!response.ok)
      throw new Error(body.error); validateEvmCustomSwapDescriptor(body); if (body.chainId !== 999 || body.token.toLowerCase() !== token.toLowerCase())
      throw new Error("Trading route changed"); setDescriptor(body); }).catch(e => { if (!abort.signal.aborted)
      setError(e instanceof Error ? e.message : "Trading information is unavailable."); });
    return () => abort.abort();
  }, [token]);
  const quote = savedQuote?.request.owner.toLowerCase() === wallet.wallet?.account.toLowerCase() ? savedQuote : null;
  async function prepare() {
    if (busyRef.current)
      return;
    if (!wallet.wallet) {
      wallet.openWallet();
      return;
    }
    if (!descriptor)
      return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setHash(null);
    try {
      if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount))
        throw new Error("Enter a valid amount.");
      if ((amount.split(".")[1]?.length ?? 0) > (buy ? descriptor.quoteDecimals : descriptor.tokenDecimals))
        throw new Error("This amount has too many decimal places.");
      const request = { chainId: 999 as const, token, owner: wallet.wallet.account, buy, amountIn: parseUnits(amount, buy ? descriptor.quoteDecimals : descriptor.tokenDecimals).toString(), slippageBps: slippage, deadline: String(Math.floor(Date.now() / 1000) + 1200) };
      const response = await fetch("/api/swap/evm/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error);
      const checked = validateEvmCustomSwapPreparation(body, request);
      setQuote(checked);
    }
    catch (e) {
      setQuote(null);
      setError(e instanceof Error ? e.message : "Unable to check this trade.");
    }
    finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  async function submit() {
    if (!quote || !wallet.wallet || busyRef.current)
      return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      setHash(await wallet.sendEvmCustomSwapWalletAction(quote));
      setQuote(null);
    }
    catch (e) {
      setError(e instanceof Error ? e.message : "Unable to send this trade.");
      setQuote(null);
    }
    finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  const inputSymbol = buy ? (descriptor?.quoteSymbol ?? "HYPE") : symbol;
  return <section aria-label={`Trade ${symbol}`} className={styles.card}>
 <h2>Trade {symbol}</h2>
 <div role="group" aria-label="Trade direction" className={styles.sides}>
 <button type="button" aria-pressed={buy} disabled={busy} onClick={() => { setBuy(true); setQuote(null); }}>Buy</button>
 <button type="button" aria-pressed={!buy} disabled={busy} onClick={() => { setBuy(false); setQuote(null); }}>Sell</button>
 </div>
 <div className={styles.amountBox}><label htmlFor={`${id}-amount`}>Amount ({inputSymbol})</label>
 <input id={`${id}-amount`} className={styles.amountInput} inputMode="decimal" placeholder="0.0" autoComplete="off" value={amount} disabled={busy} onChange={e => { setAmount(e.target.value); setQuote(null); }} style={{ width: "100%", padding: 12, margin: "8px 0 16px" }}/>
 </div><div className={styles.network} style={{ marginTop: 16 }}><label htmlFor={`${id}-slippage`}>Max. slippage</label>
 <select id={`${id}-slippage`} value={slippage} disabled={busy} onChange={e => { setSlippage(Number(e.target.value)); setQuote(null); }} style={{ marginLeft: 12 }}><option value={50}>0.5%</option><option value={100}>1%</option><option value={300}>3%</option><option value={500}>5%</option></select></div>
 {quote && descriptor ? <p aria-live="polite">Estimated output: {formatUnits(BigInt(quote.quote.amountOut), buy ? descriptor.tokenDecimals : descriptor.quoteDecimals)} {buy ? symbol : descriptor.quoteSymbol}<br />Minimum received: {formatUnits(BigInt(quote.quote.minimumOut), buy ? descriptor.tokenDecimals : descriptor.quoteDecimals)}<br />{quote.status === "approval-required" ? "Approve the exact amount, then refresh the quote." : "Network fees are shown in your wallet."}</p> : null}
 <div style={{ marginTop: 20 }}>{quote ? <button className={styles.primary} type="button" disabled={busy} onClick={submit}>{busy ? "Waiting for wallet…" : quote.status === "approval-required" ? "Approve amount" : "Confirm swap"}</button> : <button className={styles.primary} type="button" disabled={busy || (!descriptor && !!wallet.wallet)} onClick={prepare}>{!wallet.wallet ? "Connect wallet" : busy ? "Checking trade…" : "Get quote"}</button>}</div>
 {hash ? <p role="status">Transaction submitted. <a href={`https://hyperevmscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View transaction</a>. Refresh the quote after confirmation.</p> : null}
 {error ? <p role="alert">{error}</p> : null}
<EvmCustomFees token={token}/>
</section>;
}
