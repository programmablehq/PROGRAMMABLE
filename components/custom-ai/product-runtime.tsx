"use client";
import {useEffect,useRef,useState} from "react";
import {Disclosure} from "@/components/disclosure";
import {aiRequest,type AISessionHeaders} from "@/lib/custom-ai/client";
import {builderChain} from "@/lib/custom-ai/execution-routing";
import {readProductRuntime,type ProductRuntime} from "@/lib/custom-ai/product/runtime";
import {readProductValue,type ProductValue} from "@/lib/custom-ai/product/action-value";
import styles from "./workspace.module.css";

export default function ProductRuntimePanel({preparationId,sourceId,chainId,headers}:{preparationId:string;sourceId:string;chainId:number;headers:AISessionHeaders}){
  const [snapshot,setSnapshot]=useState<ProductRuntime>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [values,setValues]=useState<Record<string,ProductValue>>({}),[reading,setReading]=useState("");
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>{pending.current?.abort();},[]);
  const check=async()=>{
    if(pending.current)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError("");
    try{
      const reply=await aiRequest<{runtime:unknown}>(`/product-runtime?id=${encodeURIComponent(preparationId)}`,headers,undefined,controller.signal);
      if(!controller.signal.aborted){setSnapshot(readProductRuntime(reply.runtime,{preparationId,sourceId,chainId}));setValues({});}
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"The contracts could not be checked. Try again shortly.");}
    finally{if(!controller.signal.aborted){pending.current=null;setBusy(false);}}
  };
  const readValue=async(actionId:string)=>{
    if(pending.current)return;
    const controller=new AbortController();pending.current=controller;setReading(actionId);setError("");
    try{
      const reply=await aiRequest<{runtime:unknown;value:unknown}>(`/product-value?id=${encodeURIComponent(preparationId)}&action=${encodeURIComponent(actionId)}`,headers,undefined,controller.signal);
      const runtime=readProductRuntime(reply.runtime,{preparationId,sourceId,chainId}),value=readProductValue(reply.value,runtime,actionId);
      if(!controller.signal.aborted){setSnapshot(runtime);setValues(previous=>({...previous,[actionId]:value}));}
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"This contract value could not be read.");}
    finally{if(!controller.signal.aborted){pending.current=null;setReading("");}}
  };
  const readable=snapshot?.actions.filter(action=>action.readInput);
  const title=(signature:string)=>signature.slice(0,signature.indexOf("(")).replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/_/g," ");
  return <Disclosure className={styles.ruleReview}>
    <summary>Deployed contracts</summary>
    {snapshot?<>
      <p className={styles.note}>Contracts confirmed on {builderChain(chainId).name}. Checked <time dateTime={snapshot.checkedAt}>{new Date(snapshot.checkedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time>.</p>
      <ul>{snapshot.components.map(component=><li key={component.id}><strong>{component.name}</strong><br/><code style={{overflowWrap:"anywhere"}}>{component.address}</code></li>)}</ul>
      <p className={styles.note}>This confirms the deployed code. Wallet actions need their own current-state check.</p>
      {Boolean(readable?.length)&&<Disclosure>
        <summary>Contract values</summary>
        <p className={styles.note}>Read a value when you need it. Values are from a finalized block and may lag current activity.</p>
        {readable?.map(action=><div key={action.id}>
          <button type="button" className={styles.textButton} disabled={busy||Boolean(reading)} onClick={()=>{void readValue(action.id);}}>
            {reading===action.id?"Reading…":`Read ${title(action.signature)}${action.readInput==="wallet"?" for your wallet":""}`}
          </button>
          {values[action.id]&&<div role="status">
            <dl>{values[action.id].outputs.map((output,index)=><div key={index}>
              <dt>{output.name}</dt><dd style={{marginInlineStart:0,overflowWrap:"anywhere"}}>{typeof output.value==="string"||typeof output.value==="boolean"?String(output.value):JSON.stringify(output.value)}{output.type.startsWith("uint")||output.type.startsWith("int")?" (contract units)":""}</dd>
            </div>)}</dl>
            <p className={styles.note}>Block {values[action.id].block.number}. Read <time dateTime={values[action.id].observedAt}>{new Date(values[action.id].observedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time>.</p>
          </div>}
        </div>)}
      </Disclosure>}
    </>:<p className={styles.note}>Find the deployed contracts for this saved product.</p>}
    <button type="button" className={styles.textButton} onClick={()=>{void check();}} disabled={busy||Boolean(reading)}>{busy?"Checking contracts…":snapshot?"Refresh contracts":"Check contracts"}</button>
    {busy&&<p className={styles.note} role="status">Reading the launch receipt and deployed code.</p>}
    {reading&&<p className={styles.note} role="status">Reading this value from your deployed contract.</p>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
  </Disclosure>;
}
