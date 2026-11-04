"use client";
import {useEffect,useRef,useState} from "react";
import {Disclosure} from "@/components/disclosure";
import {aiRequest,type AISessionHeaders} from "@/lib/custom-ai/client";
import {builderChain} from "@/lib/custom-ai/execution-routing";
import {readProductRuntime,type ProductRuntime} from "@/lib/custom-ai/product/runtime";
import styles from "./workspace.module.css";

export default function ProductRuntimePanel({preparationId,sourceId,chainId,headers}:{preparationId:string;sourceId:string;chainId:number;headers:AISessionHeaders}){
  const [snapshot,setSnapshot]=useState<ProductRuntime>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>{pending.current?.abort();},[]);
  const check=async()=>{
    if(pending.current)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError("");
    try{
      const reply=await aiRequest<{runtime:unknown}>(`/product-runtime?id=${encodeURIComponent(preparationId)}`,headers,undefined,controller.signal);
      if(!controller.signal.aborted)setSnapshot(readProductRuntime(reply.runtime,{preparationId,sourceId,chainId}));
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"The contracts could not be checked. Try again shortly.");}
    finally{if(!controller.signal.aborted){pending.current=null;setBusy(false);}}
  };
  return <Disclosure className={styles.ruleReview}>
    <summary>Deployed contracts</summary>
    {snapshot?<>
      <p className={styles.note}>Contracts confirmed on {builderChain(chainId).name}. Checked <time dateTime={snapshot.checkedAt}>{new Date(snapshot.checkedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time>.</p>
      <ul>{snapshot.components.map(component=><li key={component.id}><strong>{component.name}</strong><br/><code style={{overflowWrap:"anywhere"}}>{component.address}</code></li>)}</ul>
      <p className={styles.note}>This confirms the deployed code. Current balances and available actions are checked separately.</p>
    </>:<p className={styles.note}>Find the deployed contracts for this saved product.</p>}
    <button type="button" className={styles.textButton} onClick={()=>{void check();}} disabled={busy}>{busy?"Checking contracts…":snapshot?"Refresh contracts":"Check contracts"}</button>
    {busy&&<p className={styles.note} role="status">Reading the launch receipt and deployed code.</p>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
  </Disclosure>;
}
