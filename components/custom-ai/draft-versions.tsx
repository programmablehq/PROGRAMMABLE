"use client";
import { useRef, useState } from "react";
import { aiRequest, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { DraftVersion, StoredStudio } from "@/lib/custom-ai/studio";
import styles from "./workspace.module.css";

export function DraftVersions({account,headers,disabled,currentDraftId,onRestore}:{account:string;headers:AISessionHeaders;disabled:boolean;currentDraftId?:string;onRestore:(version:Pick<StoredStudio,"state"|"draft">)=>Promise<void>}){
  const [versions,setVersions]=useState<DraftVersion[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const request=useRef(0);
  async function load(){const current=++request.current;setLoading(true);setError("");try{
    const result=await aiRequest<{versions:DraftVersion[]}>(`/versions?account=${encodeURIComponent(account)}`,headers);
    if(current===request.current)setVersions(result.versions);
  }catch(cause){if(current===request.current)setError(cause instanceof Error?cause.message:"Saved versions could not load.");}finally{if(current===request.current)setLoading(false);}}
  async function restore(id:string){setLoading(true);setError("");try{
    const result=await aiRequest<Pick<StoredStudio,"state"|"draft">>(`/versions?account=${encodeURIComponent(account)}&id=${id}`,headers);
    await onRestore(result);
  }catch(cause){setError(cause instanceof Error?cause.message:"The version could not be restored.");}finally{setLoading(false);}}
  return <details className={styles.usage} onToggle={event=>{if(event.currentTarget.open)void load();else request.current++;}}>
    <summary>Versions</summary><div className={styles.versionList}>
      <p role="status">{loading?"Loading saved versions…":versions.length?"Your recent checked drafts":"No checked versions saved yet."}</p>
      {versions.map(v=><article key={v.id}><strong>{v.name||"Untitled coin"}</strong><p>{v.summary}</p><small>{new Date(v.createdAt).toLocaleString()}</small>
        <button type="button" disabled={disabled||loading||v.draftId===currentDraftId} onClick={()=>void restore(v.id)}>{v.draftId===currentDraftId?"Current rules":"Restore these rules"}</button>
      </article>)}
      {error&&<p role="alert">{error}</p>}
    </div>
  </details>;
}
