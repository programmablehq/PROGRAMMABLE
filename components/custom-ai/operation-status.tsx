"use client";
import { useEffect,useState } from "react";
import type { CoinOperationStatus } from "@/ops/custom-ai-worker/runtime.server";
import styles from "./workspace.module.css";
export function OperationStatus({chainId,token}:{chainId:1|4663;token:string}){
  const [status,setStatus]=useState<CoinOperationStatus|null>(null);
  useEffect(()=>{const controller=new AbortController();
    const refresh=async()=>{if(document.hidden)return;try{
      const response=await fetch(`/api/custom-ai/operations?chain=${chainId}&token=${token}`,{signal:controller.signal});
      if(response.ok){const value=await response.json();setStatus(value.status??null);}
      else setStatus(previous=>previous?{...previous,state:"blocked",reason:"Waiting for the next service update."}:null);
    }catch{setStatus(previous=>previous?{...previous,state:"blocked",reason:"Waiting for the next service update."}:null);}};
    void refresh();const timer=setInterval(()=>void refresh(),60000);return()=>{controller.abort();clearInterval(timer);};
  },[chainId,token]);
  if(!status)return null;
  const label=({warming:"Collecting price history",ready:"Watching your rules",queued:"Reinvestment queued",blocked:"Automatic execution is waiting"} as const)[status.state];
  const explorer=chainId===1?"https://etherscan.io":"https://robinhoodchain.blockscout.com";
  return <section className={styles.operationStatus} aria-label="Coin automation"><h3>Automation</h3><p role="status">{label}</p>
    {status.reason&&<p>{status.reason}</p>}
    {status.liquidityRaw!==null&&<p>{BigInt(status.liquidityRaw)>0n?"Additional locked liquidity has been created.":"No additional liquidity recorded yet."}</p>}
    {status.lastTransactionHash&&<a href={`${explorer}/tx/${status.lastTransactionHash}`} target="_blank" rel="noopener noreferrer">Last completed reinvestment</a>}
    <small>Checked {new Date(status.checkedAt).toLocaleString()}</small>
  </section>;
}
