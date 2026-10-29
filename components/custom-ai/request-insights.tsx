"use client";
import { useEffect,useRef,useState } from "react";
import { aiRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { RequestMetricsSummary } from "@/lib/custom-ai/request-metrics";
import styles from "./workspace.module.css";

export function RequestInsights({headers}:{headers:AISessionHeaders}){
  const [metrics,setMetrics]=useState<RequestMetricsSummary|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function load(){
    pending.current?.abort();const controller=new AbortController();pending.current=controller;setLoading(true);setError("");
    try{const result=await aiRequest<RequestMetricsSummary>("/metrics",headers,undefined,controller.signal);if(!controller.signal.aborted)setMetrics(result);}
    catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Request details could not load.");}
    finally{if(!controller.signal.aborted)setLoading(false);}
  }
  return <details className={styles.usage} onToggle={event=>{if(event.currentTarget.open)void load();else pending.current?.abort();}}>
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
