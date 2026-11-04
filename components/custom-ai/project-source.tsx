"use client";
import { useEffect, useRef, useState } from "react";
import { aiRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { ProjectOverview } from "@/lib/custom-ai/project-overview";
import type { ProjectCheckpoint } from "@/lib/custom-ai/project-store.server";
import { builderChain, type BuilderChainId } from "@/lib/custom-ai/execution-routing";
import { ExecutionPreview } from "./execution-preview";
import styles from "./workspace.module.css";

export function ProjectSource({source,chainId,account,conversationId,headers,disabled,recovery=false,onCompile,onEdit}:{
  source:ProjectOverview;account:string;conversationId?:string;headers:AISessionHeaders;disabled:boolean;recovery?:boolean;
  chainId?:BuilderChainId;
  onCompile:(source:ProjectOverview)=>void;onEdit?:(source:ProjectOverview)=>void;
}) {
  const [saved,setSaved]=useState<ProjectCheckpoint>(),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const controller=useRef<AbortController|null>(null);
  const matchesNetwork=chainId===undefined||chainId===source.chainId;
  const checksPending=source.compilation==="compiled"&&Boolean(source.blueprintId)&&!source.scenarios;
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
  return <><ExecutionPreview trace={source.scenarios?.execution}/><section className={styles.ruleReview} aria-label={recovery?"Saved source recovery":"Contract source"}>
    <h3>{recovery?"Your new source is saved":"Contract source"}</h3>
    {recovery&&<p>Your previous draft is kept. {source.compilation==="pending"?"The compiler did not finish. Retry this saved source without another AI request.":checksPending?"Continue the saved contract checks without another AI request or compiler run.":"This source needs an edit before another build."}</p>}
    <details onToggle={event=>{if(event.currentTarget.open)void open();}}>
      <summary>View saved source</summary>
      <p>{builderChain(source.chainId).name} · {source.sourceFiles} {source.sourceFiles===1?"file":"files"} · {Math.ceil(source.sourceBytes/1024)} KB · Solidity {source.compiler.version.split("+")[0]}</p>
      {loading&&<p role="status">Opening your saved source…</p>}
      {saved&&<>
        <button type="button" className={styles.textButton} onClick={download}>Download source project</button>
        {Object.entries(saved.project.sources).map(([path,file])=><details key={path}><summary>{path}</summary><pre className={styles.sourceCode} tabIndex={0}>{file.content}</pre></details>)}
      </>}
      {error&&<><p role="alert">{error}</p><button type="button" className={styles.textButton} disabled={loading} onClick={()=>void open()}>Try opening source again</button></>}
    </details>
    {source.diagnostics.length>0&&<details><summary>Build diagnostics</summary><ul>{source.diagnostics.map((item,index)=><li key={index}>{item.message}</li>)}</ul></details>}
    {source.scenarios&&<details><summary>{source.scenarios.passed?`${source.scenarios.cases} declared checks passed`:"A declared contract check failed"}</summary>
      <p>These isolated examples check the saved design. Launch review and preparation are separate.</p>
      {source.scenarios.failures.length>0&&<ul>{source.scenarios.failures.map((item,index)=><li key={index}>{item.message}</li>)}</ul>}
    </details>}
    {!matchesNetwork&&<p>This source belongs to {builderChain(source.chainId).name}. Select its network before retrying or editing it.</p>}
    {recovery&&source.compilation==="pending"&&<button type="button" className={styles.textButton} disabled={disabled||!conversationId||!matchesNetwork} onClick={()=>onCompile(source)}>Retry saved build</button>}
    {recovery&&checksPending&&<button type="button" className={styles.textButton} disabled={disabled||!conversationId||!matchesNetwork} onClick={()=>onCompile(source)}>Resume contract checks</button>}
    {recovery&&(source.compilation==="diagnostics"||source.scenarios?.passed===false)&&onEdit&&<button type="button" className={styles.textButton} disabled={disabled||!conversationId||!matchesNetwork} onClick={()=>onEdit(source)}>Edit this source</button>}
  </section></>;
}
