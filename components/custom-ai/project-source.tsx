"use client";
import { useEffect, useRef, useState } from "react";
import { aiRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { ProjectOverview } from "@/lib/custom-ai/project-overview";
import type { ProjectCheckpoint } from "@/lib/custom-ai/project-store.server";
import styles from "./workspace.module.css";

export function ProjectSource({source,account,conversationId,headers,disabled,recovery=false,onCompile,onEdit}:{
  source:ProjectOverview;account:string;conversationId?:string;headers:AISessionHeaders;disabled:boolean;recovery?:boolean;
  onCompile:(source:ProjectOverview)=>void;onEdit?:(source:ProjectOverview)=>void;
}) {
  const [saved,setSaved]=useState<ProjectCheckpoint>(),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function open(){
    if(saved||loading||!conversationId)return;
    controller.current=new AbortController();setLoading(true);setError("");
    try{
      const value=await aiRequest<ProjectCheckpoint>(`/projects?${new URLSearchParams({account,conversation:conversationId,id:source.requestId})}`,headers,undefined,controller.current.signal);
      if(value.requestId!==source.requestId||value.project.hash!==source.projectHash)throw Error("The saved source changed. Reload this design before opening it.");
      setSaved(value);
    }catch(cause){if(!controller.current.signal.aborted)setError(cause instanceof Error?cause.message:"The saved source could not be opened.");}
    finally{if(!controller.current.signal.aborted)setLoading(false);}
  }
  function download(){
    if(!saved)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(saved.project,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=`programmable-source-${source.projectHash.slice(7,19)}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className={styles.ruleReview} aria-label={recovery?"Saved source recovery":"Contract source"}>
    <h3>{recovery?"Your new source is saved":"Contract source"}</h3>
    {recovery&&<p>Your previous draft is kept. {source.compilation==="pending"?"The compiler did not finish. Retry this saved source without another AI request.":"This source needs an edit before another build."}</p>}
    <details onToggle={event=>{if(event.currentTarget.open)void open();}}>
      <summary>View saved source</summary>
      <p>{source.sourceFiles} {source.sourceFiles===1?"file":"files"} · {Math.ceil(source.sourceBytes/1024)} KB · Solidity {source.compiler.version.split("+")[0]}</p>
      {loading&&<p role="status">Opening your saved source…</p>}
      {saved&&<>
        <button type="button" className={styles.textButton} onClick={download}>Download source project</button>
        {Object.entries(saved.project.sources).map(([path,file])=><details key={path}><summary>{path}</summary><pre className={styles.sourceCode} tabIndex={0}>{file.content}</pre></details>)}
      </>}
      {error&&<><p role="alert">{error}</p><button type="button" className={styles.textButton} disabled={loading} onClick={()=>void open()}>Try opening source again</button></>}
    </details>
    {source.diagnostics.length>0&&<details><summary>Build diagnostics</summary><ul>{source.diagnostics.map((item,index)=><li key={index}>{item.message}</li>)}</ul></details>}
    {recovery&&source.compilation==="pending"&&<button type="button" className={styles.textButton} disabled={disabled||!conversationId} onClick={()=>onCompile(source)}>Retry saved build</button>}
    {recovery&&source.compilation==="diagnostics"&&onEdit&&<button type="button" className={styles.textButton} disabled={disabled||!conversationId} onClick={()=>onEdit(source)}>Edit this source</button>}
  </section>;
}
