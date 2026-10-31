"use client";
import { useEffect,useRef,useState } from "react";
import { aiRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { RequestMetricsSummary } from "@/lib/custom-ai/request-metrics";
import styles from "./workspace.module.css";

export function RequestInsights({headers,refreshKey=0}:{headers:AISessionHeaders;refreshKey?:number}){
  const [view,setView]=useState({open:false,epoch:0});
  const requestKey=`${view.epoch}:${refreshKey}`;
  const [result,setResult]=useState<{key:string;metrics?:RequestMetricsSummary;error?:string}>();
  const loading=view.open&&result?.key!==requestKey;
  const metrics=result?.metrics;
  const error=result?.key===requestKey?result.error:undefined;
  const headersRef=useRef(headers);
  useEffect(()=>{headersRef.current=headers;},[headers]);
  useEffect(()=>{
    if(!view.open)return;
    const controller=new AbortController();
    void aiRequest<RequestMetricsSummary>("/metrics",()=>headersRef.current(),undefined,controller.signal)
      .then(metrics=>{if(!controller.signal.aborted)setResult({key:requestKey,metrics});})
      .catch(cause=>{if(!controller.signal.aborted)setResult({key:requestKey,error:cause instanceof Error?cause.message:"Request details could not load."});});
    return ()=>controller.abort();
  },[view.open,requestKey]);
  return <details className={styles.toolSection} onToggle={event=>{
    const open=event.currentTarget.open;setView(previous=>({open,epoch:previous.epoch+(open?1:0)}));
  }}>
    <summary>Request details</summary><div>
      {loading&&<p role="status">Loading your request details…</p>}
      {metrics&&<>
        <p>{metrics.count} recent requests · {metrics.completed} completed · {metrics.failed} interrupted</p>
        {metrics.latest&&<p>Last request: {(metrics.latest.durationMs/1000).toFixed(1)} seconds · {metrics.latest.calls.length} model calls</p>}
        {metrics.medianDurationMs!==null&&<p>Typical completed request: {(metrics.medianDurationMs/1000).toFixed(1)} seconds</p>}
        <p>{(metrics.knownInputTokens+metrics.knownOutputTokens).toLocaleString()} reported tokens</p>
        {metrics.incompleteTokenRecords>0&&<p>Usage is incomplete for {metrics.incompleteTokenRecords} requests.</p>}
      </>}
      {error&&<p role="alert">{error}</p>}
    </div>
  </details>;
}
