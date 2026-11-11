"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import type {AISessionHeaders} from "@/lib/custom-ai/client";
import {EMPTY_COIN_SETUP,applyCoinSetupPatch,type CoinSetup} from "@/lib/custom-ai/coin-setup";
import type {ImageReceipt} from "@/lib/custom-ai/studio";
import type {LaunchIntent} from "@/lib/custom-ai/launch-intent";
import type {GeneralProjectView} from "@/lib/custom-ai/project-view";
import type {PlatformLaunchDraft} from "@/lib/custom-ai/platform/launch-draft.server";
import {GeneralProjectPreview} from "../general-preview";
import type {PlatformAPI,ProjectRevision} from "./types";
import styles from "./workspace.module.css";
import {builderChains} from "@/lib/custom-ai/execution-routing";
type Review={draft:PlatformLaunchDraft;sourceId:string;intent:LaunchIntent;project:GeneralProjectView};
export function ProjectContractLaunch({project,account,api,headers,enabled,onLaunchLocked,onPrompt}:{project:ProjectRevision;account:string;api:PlatformAPI;headers:AISessionHeaders;enabled:boolean;onLaunchLocked:(locked:boolean)=>void;onPrompt:(text:string)=>void}){
  const [settings,setSettings]=useState<CoinSetup>(()=>{const chain=builderChains.find(item=>item.id===Number((project.document.architecture as {chainId?:number}|null)?.chainId));return chain?applyCoinSetupPatch(EMPTY_COIN_SETUP,{chainId:chain.id}):EMPTY_COIN_SETUP;}),[image,setImage]=useState<ImageReceipt>(),[review,setReview]=useState<Review>();
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const current=useRef({settings,image}),base=useRef<PlatformLaunchDraft|null>(null);
  useLayoutEffect(()=>{current.current={settings,image};},[settings,image]);
  useEffect(()=>{const controller=new AbortController();void api<{draft:PlatformLaunchDraft}>(`/launch?${new URLSearchParams({projectId:project.projectId,account})}`,{signal:controller.signal}).then(({draft})=>{base.current=draft;setSettings(draft.settings);setImage(draft.image);setLoaded(true);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Launch details could not load.");});return()=>controller.abort();},[api,project.projectId,account]);
  const saveAndReview=useCallback(async()=>{
    if(!base.current)throw Error("Wait for your saved launch details to load.");
    const edited=current.current;
    const {draft}=await api<{draft:PlatformLaunchDraft}>("/launch",{body:{action:"save",projectId:project.projectId,account,expectedRevision:base.current.revision,sourceRevision:project.revisionId,settings:edited.settings,imageId:edited.image?.id??null}});
    base.current=draft;
    const result=await api<Review>("/launch",{body:{action:"freeze",projectId:project.projectId,account,sourceRevision:project.revisionId}});
    setReview(result);return {revision:result.draft.revision};
  },[api,project.projectId,project.revisionId,account]);
  async function inspect(){setBusy(true);setError("");try{await saveAndReview();}catch(cause){setError(cause instanceof Error?cause.message:"The contract review could not finish.");}finally{setBusy(false);}}
  const fresh=review?.draft.sourceRevision===project.revisionId?review:undefined;
  const architecture=project.document.architecture as {contractChecks?:{contracts?:{role:string}[]};entrypoints?:{role:string}[]}|null;
  const coin=(architecture?.contractChecks?.contracts??architecture?.entrypoints??[]).some(entry=>entry.role==="token"||entry.role==="hook");
  return <section className={styles.stack} aria-label="Contract review"><h2>{coin?"Launch your coin":"Contract review"}</h2><p className={styles.muted}>{coin?"Review this exact contract version, complete the coin details, then continue through the existing launch and wallet checks.":"Review the compiled source, its behavior checks and independent source review for this project version."}</p>{error&&<p role="alert" className={styles.error}>{error}</p>}
    <p className={styles.notice} role="status">{fresh?`Version ${project.ordinal}: source and behavior checks passed.`:""}</p>
    <button type="button" disabled={!loaded||busy} onClick={()=>void inspect()}>Review checked contract</button>
    {coin?<GeneralProjectPreview project={fresh?.project} intent={fresh?.intent} draftId={fresh?.sourceId} account={account} conversationId={project.projectId} headers={headers} disabled={!loaded||busy} settings={settings} onChange={patch=>setSettings(current=>applyCoinSetupPatch(current,patch))} chatRevision={project.ordinal} localPreview={false} cacheKey={`platform-launch:${project.ownerId}:${project.projectId}:${account}`} imageReceipt={image} onImageReceipt={setImage} onEditRule={id=>onPrompt(`Change contract requirement ${id}: `)} generalLaunchEnabled={enabled} flush={saveAndReview} onLaunchLocked={onLaunchLocked} showSource={false}/>:fresh&&<div className={styles.card}><h3>{project.document.title}</h3><p>Compilation passed · source review passed · declared behavior checks passed</p>{fresh.project.entrypoints.map(entry=><p key={`${entry.source}:${entry.contract}`}>{entry.source} · {entry.contract}</p>)}</div>}
  </section>;
}
