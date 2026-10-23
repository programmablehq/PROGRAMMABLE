"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { aiRequest } from "@/lib/custom-ai/client";
import { requestWalletAction, readLocalWalletAction, saveLocalWalletAction } from "@/lib/custom-ai/launch-client";
import { decodeLaunchValue } from "@/lib/custom-ai/wallet";
import { launchStepLabel } from "@/lib/custom-ai/launch-session";
import type { CustomAIPublicToken } from "@/lib/custom-ai/public-types";
import type { AITradeIntent, StoredAITrade } from "@/lib/custom-ai/trade-types";
import type { AIMarketBalances } from "@/lib/custom-ai/market.server";
import styles from "@/components/swap-panel.module.css";

const readable=(amount:string,decimals:number)=>Number(formatUnits(BigInt(amount),decimals)).toLocaleString("en-US",{maximumSignificantDigits:7});
export function CustomAITradePanel({token}:{token:CustomAIPublicToken}) {
  const wallet=useWallet();
  return <TradeSession key={`${token.chainId}:${token.tokenAddress}:${wallet.wallet?.account??"guest"}`} token={token}/>;
}
function TradeSession({token}:{token:CustomAIPublicToken}) {
  const wallet=useWallet(),account=wallet.wallet?.account;
  const [side,setSide]=useState<"buy"|"sell">("buy"),[amount,setAmount]=useState("");
  const [saved,setSaved]=useState<StoredAITrade|null>(null),[balances,setBalances]=useState<AIMarketBalances|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[ready,setReady]=useState(!account);
  const [slippage,setSlippage]=useState(100);
  const [programAmount,setProgramAmount]=useState("");
  const current=useRef(saved),working=useRef(false),request=useRef<{payload:string;id:string}|null>(null);
  const headers=useCallback(async ():Promise<Record<string,string>>=> {
    const access=await wallet.getAccessToken(),identity=await wallet.getIdentityToken();
    if (!access) throw Error("Connect your wallet to continue.");
    return {Authorization:`Bearer ${access}`,...(identity?{"X-Privy-Identity-Token":identity}:{})};
  },[wallet]);
  const headersRef=useRef(headers);
  useLayoutEffect(()=> {current.current=saved;headersRef.current=headers;},[saved,headers]);
  const remember=useCallback((value:StoredAITrade)=> {
    saveLocalWalletAction("trade",value);current.current=value;setSaved(value);
  },[]);
  const loadBalances=useCallback(async ()=> {
    if (!account) return;
    const value=await aiRequest<AIMarketBalances>(`/trade?balances=true&chain=${token.chainId}&token=${token.tokenAddress}&account=${account}`,()=>headersRef.current());
    setBalances(value);
  },[account,token.chainId,token.tokenAddress]);
  const refresh=useCallback(async (value:StoredAITrade)=> {
    const local=readLocalWalletAction("trade",value.session.account);
    const last=local?.session.id===value.session.id?local.session.steps.at(-1):null;
    if (last?.hash && last.state==="submitted") await requestWalletAction("trade",headersRef.current,{action:"submitted",id:value.session.id,stepId:last.id,hash:last.hash}).catch(()=>undefined);
    const updated=await requestWalletAction("trade",headersRef.current,{action:"next",id:value.session.id}) as StoredAITrade;
    remember(updated);
    if (updated.session.state==="confirmed") void loadBalances().catch(()=>undefined);
    return updated;
  },[remember,loadBalances]);
  useEffect(()=> {
    if (!account) return;
    let cancelled=false;
    void aiRequest(`/trade?account=${account}`,()=>headersRef.current()).then(raw=> {
      if (cancelled) return;
      const server=decodeLaunchValue(JSON.stringify(raw)) as StoredAITrade|null;
      const local=readLocalWalletAction("trade",account) as StoredAITrade|null;
      const restored=local?.session.id===server?.session.id && local?.session.steps.at(-1)?.hash?local:server;
      if (restored && restored.session.state!=="confirmed") {current.current=restored;setSaved(restored);}
      else if (restored?.session.state==="confirmed") localStorage.removeItem(`programmable.custom-ai.trade-request.v1:${account.toLowerCase()}`);
      setReady(true);
    }).catch(()=> {if (!cancelled) setError("Your saved transactions could not be checked. Refresh before starting another trade.");});
    void loadBalances().catch(()=>undefined);
    return ()=>{cancelled=true;};
  },[account,loadBalances]);
  useEffect(()=> {
    if (saved?.session.state!=="waiting") return;
    const timer=setInterval(()=> {
      if (working.current || document.hidden || !current.current) return;
      working.current=true;
      void refresh(current.current).catch(cause=>setError(cause instanceof Error?cause.message:"The transaction could not be checked."))
        .finally(()=>{working.current=false;});
    },15000);
    return ()=>clearInterval(timer);
  },[saved?.session.state,refresh]);
  const foreign=saved && (saved.session.token.toLowerCase()!==token.tokenAddress.toLowerCase() || saved.session.chainId!==token.chainId);
  const locked=!!saved && saved.session.state!=="confirmed";
  const quote=saved?.session.quote,step=saved?.session.steps.at(-1);
  const quoteName=balances?.wrappedNative?"WETH":`${token.quoteAsset.slice(0,6)}…${token.quoteAsset.slice(-4)}`;
  const programAction = saved?.session.intent.startsWith("program-") ?? false;
  const claiming = (saved?.session.intent.startsWith("claim") ?? false) || programAction;
  const activeSide=saved?.session.intent==="buy"||saved?.session.intent==="sell"?saved.session.intent:side;
  const outputName=activeSide==="buy"?token.symbol:quoteName;
  const label=busy?"Preparing…":!account?"Connect wallet":saved?.session.state==="confirmed"?"New trade":saved?.session.state==="failed"?"Try transaction again":
    saved?.session.state==="waiting"?"Check transaction":step?.state==="prepared"?step.kind==="approve"?`Approve ${activeSide==="buy"?quoteName:token.symbol}`:launchStepLabel(step.kind):`${side==="buy"?"Buy":"Sell"} ${token.symbol}`;
  async function proceed(intent:AITradeIntent=side) {
    if (working.current || foreign) return;
    if (!account) {wallet.openWallet();return;}
    if (saved?.session.state==="confirmed") {
      localStorage.removeItem(`programmable.custom-ai.trade-request.v1:${account.toLowerCase()}`);
      setSaved(null);current.current=null;request.current=null;setError("");return;
    }
    working.current=true;setBusy(true);setError("");
    try {
      let value=current.current;
      if (!value) {
        const payload={action:"create",account,token:token.tokenAddress,chainId:token.chainId,intent,amount:intent==="program-stake"||intent==="program-withdraw"?programAmount:["buy","sell"].includes(intent)?amount:"0",slippageBps:slippage};
        const encoded=JSON.stringify(payload),key=`programmable.custom-ai.trade-request.v1:${account.toLowerCase()}`;
        if (!request.current) {const raw=localStorage.getItem(key);if (raw) request.current=JSON.parse(raw);}
        if (request.current?.payload!==encoded) request.current={payload:encoded,id:crypto.randomUUID()};
        const pending=JSON.stringify(request.current);localStorage.setItem(key,pending);
        if (localStorage.getItem(key)!==pending) throw Error("This browser could not save the trade request.");
        value=await requestWalletAction("trade",headersRef.current,{...payload,id:request.current.id}) as StoredAITrade;
        remember(value);
        // Show the actual output/minimum before the first wallet prompt.
        return;
      }
      const previousStep=value.session.steps.at(-1);
      value=value.session.state==="failed"?await requestWalletAction("trade",headersRef.current,{action:"retry",id:value.session.id}) as StoredAITrade:await refresh(value);
      remember(value);
      const next=value.session.steps.at(-1);
      if (next?.id!==previousStep?.id) return;
      if (value.session.state==="ready" && next?.state==="prepared") {
        await wallet.sendCustomAIWalletStep(value.session.id,next,"trade");
        await refresh(value);
      }
    } catch(cause) {setError(cause instanceof Error?cause.message:"The trade could not continue. Your request is saved.");}
    finally {working.current=false;setBusy(false);}
  }
  if (foreign) return <div className={styles.card}><p className={styles.note}>Finish checking your saved transaction first.</p>
    <Link href={`/token/${saved.session.token}?chain=${saved.session.chainId}`}>Open saved trade</Link></div>;
  return <div className={styles.embedded}><section className={styles.card} aria-label={`Trade ${token.symbol}`}>
    {!claiming && <><div className={styles.sides} role="group" aria-label="Trade direction">{(["buy","sell"] as const).map(value=><button key={value} type="button" aria-pressed={activeSide===value}
      disabled={busy||locked} onClick={()=>setSide(value)}>{value==="buy"?"Buy":"Sell"}</button>)}</div>
    <div className={styles.amountBox}>
      <div className={styles.fieldTop}><label htmlFor="custom-ai-trade-amount">You pay</label>
        {balances?.balances && <span className={styles.balance}>Balance {readable(activeSide==="buy"?balances.balances.quote:balances.balances.token,activeSide==="buy"?token.quoteDecimals:18)}</span>}</div>
      <div className={styles.amountRow}><input id="custom-ai-trade-amount" className={styles.amountInput} inputMode="decimal" autoComplete="off" placeholder="0"
        value={saved?.session.amount??amount} disabled={busy||locked} onChange={event=>setAmount(event.target.value)}/>
        <span className={styles.asset}>{activeSide==="buy"?(balances?.wrappedNative?"ETH / WETH":quoteName):token.symbol}</span></div>
    </div>
    {quote && <><div className={styles.estimate}><span>You receive</span><output>{readable(quote.expected,quote.outputDecimals)} {outputName}</output></div>
      <p className={styles.minimum}>Minimum {readable(quote.minimum,quote.outputDecimals)} {outputName}</p></>}
    <fieldset className={styles.slippage} disabled={busy||locked}><legend>Slippage</legend>{[50,100,300].map(value=><button key={value} type="button" aria-pressed={slippage===value} onClick={()=>setSlippage(value)}>{value/100}%</button>)}</fieldset>
    <p className={styles.summary}>0.5% platform fee included · Total trading fee never exceeds 15%</p>
    </>}
    {claiming && <p className={styles.summary}>{programAction ? `Program: ${saved?.session.intent.replace("program-", "")} ${["program-stake", "program-withdraw"].includes(saved?.session.intent ?? "") ? saved?.session.amount + " " + token.symbol : ""}` : "Claim to the recipient fixed by this coin."}</p>}
    {balances?.quoteNotice && <p className={styles.note}>{balances.quoteNotice}</p>}
    <button type="button" className={styles.primary} disabled={busy||!!account&&!ready} onClick={()=>void proceed()}>{label}</button>
    {saved?.session.state==="waiting" && <p className={styles.note} role="status">Waiting for the transaction to confirm.</p>}
    {saved?.session.state==="confirmed" && <p className={styles.success} role="status">{saved.session.claimSettlement ? `${readable(saved.session.claimSettlement.amount,token.quoteDecimals)} ${quoteName} claimed.` : saved.session.settlement ? `Received ${readable(saved.session.settlement.received,quote?.outputDecimals??18)} ${outputName}.` : "Transaction confirmed."}</p>}
    {step?.hash && <p className={styles.note}><a href={`${token.chainId===1?"https://etherscan.io":"https://robinhoodchain.blockscout.com"}/tx/${step.hash}`} target="_blank" rel="noreferrer">View transaction</a></p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!saved && balances?.program && account && <section aria-label="Coin program">
      <h3>{balances.program.kind === "staking" ? "Staking rewards" : balances.program.kind === "buyback" ? "Buyback program" : "Fee distribution"}</h3>
      <p className={styles.note}>{balances.program.rewardShareBps / 100}% of additional fees fund this program. Execution is permissionless and uses collected funds only.</p>
      {balances.program.kind === "staking" && <>
        <p className={styles.note}>Staked: {readable(balances.program.staked, 18)} {token.symbol} · Rewards: {readable(balances.program.claimable, token.quoteDecimals)} {quoteName}</p>
        <label htmlFor="custom-ai-staking-amount">Stake or withdraw amount</label>
        <input id="custom-ai-staking-amount" className={styles.amountInput} inputMode="decimal" value={programAmount} onChange={event => setProgramAmount(event.target.value)} disabled={busy}/>
        <div className={styles.pendingActions}>
          <button type="button" disabled={busy || !programAmount} onClick={() => void proceed("program-stake")}>Stake {token.symbol}</button>
          <button type="button" disabled={busy || !programAmount} onClick={() => void proceed("program-withdraw")}>Withdraw stake</button>
          <button type="button" disabled={busy || BigInt(balances.program.claimable) === 0n} onClick={() => void proceed("program-claim")}>Claim staking rewards</button>
        </div>
      </>}
      {balances.program.kind === "buyback" && <p className={styles.note}>Up to {readable(balances.program.maximumBatch, token.quoteDecimals)} {quoteName} per execution, accepting at least {readable(balances.program.minimumTokensPerQuote, 18)} {token.symbol} per {quoteName}.</p>}
      <div className={styles.pendingActions}><button type="button" disabled={busy} onClick={() => void proceed("program-execute")}>{balances.program.kind === "staking" ? "Collect new rewards" : balances.program.kind === "buyback" ? "Execute buyback" : "Distribute collected fees"}</button></div>
    </section>}
    {!saved && balances && account && <div className={styles.pendingActions}>
      {balances.creatorRecipient.toLowerCase()===account.toLowerCase() && BigInt(balances.creatorAvailable)>0n && <button type="button" onClick={()=>void proceed("claim-creator")} disabled={busy}>Claim {readable(balances.creatorAvailable,token.quoteDecimals)} {quoteName}</button>}
      {BigInt(balances.balances?.reward??"0")>0n && <button type="button" onClick={()=>void proceed("claim-reward")} disabled={busy}>Claim rewards</button>}
      {account.toLowerCase()==="0xd88539d3c4c460136a733a3fd60cf6bf269079da" && BigInt(balances.platformAvailable)>0n && <button type="button" onClick={()=>void proceed("claim-platform")} disabled={busy}>Claim platform fees</button>}
    </div>}
  </section></div>;
}
