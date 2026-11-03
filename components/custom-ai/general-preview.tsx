"use client";
import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import type { CoinSetup, CoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import type { GeneralProjectView } from "@/lib/custom-ai/project-view";
import { overviewFromView } from "@/lib/custom-ai/project-overview";
import type { LaunchIntent } from "@/lib/custom-ai/launch-intent";
import type { ImageReceipt } from "@/lib/custom-ai/studio";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { CoinDetails, type CoinDetailsControls } from "./coin-details";
import { GeneralLaunchControls } from "./general-launch-controls";
import { ProjectSource } from "./project-source";
import { RequestedRules } from "./requested-rules";
import styles from "./workspace.module.css";

export function GeneralProjectPreview({project,intent,draftId,account,conversationId,headers,disabled,settings,onChange,chatRevision,localPreview,cacheKey,imageReceipt,onImageReceipt,onEditRule,generalLaunchEnabled=false,pendingChange,flush,onLaunchLocked,children,launchCommand,editorControls,onImageBusy}:{
  project?:GeneralProjectView;intent?:LaunchIntent;draftId?:string;account:string;conversationId?:string;headers:AISessionHeaders;
  disabled:boolean;settings:CoinSetup;onChange:(patch:CoinSetupPatch)=>void;chatRevision:number;localPreview:boolean;cacheKey:string;
  imageReceipt?:ImageReceipt;onImageReceipt:(receipt:ImageReceipt|undefined)=>void;onEditRule:(id:string)=>void;children?:ReactNode;
  generalLaunchEnabled?:boolean;pendingChange?:string;flush?:()=>Promise<{revision:number}|undefined>;onLaunchLocked?:(locked:boolean)=>void;
  launchCommand?:{id:string;sourceId:string};
  editorControls?:RefObject<CoinDetailsControls|null>;onImageBusy?:(busy:boolean)=>void;
}) {
  const ownEditor=useRef<CoinDetailsControls>(null),editor=editorControls??ownEditor;
  const [imageBusy,setImageBusy]=useState(false),[launchBusy,setLaunchBusy]=useState(false);
  const imageStatus=useCallback((busy:boolean)=>{setImageBusy(busy);onImageBusy?.(busy);},[onImageBusy]);
  const enabled=generalLaunchEnabled&&!localPreview&&/^0x[a-f0-9]{40}$/iu.test(account);
  const lock=useCallback((locked:boolean)=>{setLaunchBusy(locked);onLaunchLocked?.(locked);},[onLaunchLocked]);
  const matches=project?.chainId===settings.chainId&&project?.intentRevision===intent?.revision;
  return <aside className={styles.coinPanel} aria-label="Coin preview and details">
    <CoinDetails settings={settings} onChange={onChange} chatRevision={chatRevision} disabled={disabled||launchBusy} headers={headers}
      localPreview={localPreview} cacheKey={cacheKey} imageReceipt={imageReceipt} onImageReceipt={onImageReceipt} onImage={()=>undefined} controlsRef={editor} onImageBusy={imageStatus}
      stage={!project?"Contract design":project.sourceReview==="changes_required"?"Source needs changes":project.scenarios?.passed===false?"Contract checks failed":project.compiled?"Source compiled":"Source needs changes"} description={project?.summary} feeCore={false}/>
    {!enabled&&<section className={styles.generalLaunch} aria-label="Launch your coin">
      <button type="button" className={styles.createButton} disabled aria-describedby="general-launch-not-ready">Launch coin</button>
      <p id="general-launch-not-ready" className={styles.note} role="status">{!project?intent?.requirements.length?"Your design is saved. Ask the chat to build its source.":"Describe your coin in the chat to get started.":!matches?"Your design changed. Ask the chat to update the source.":project.sourceReview==="changes_required"?"Ask the chat to fix the source review findings.":project.scenarios?.passed?"The declared checks passed. Launch preparation is not available yet.":project.scenarios?.passed===false?"Ask the chat to fix the remaining contract check.":project.compiled?"Ask the chat to finish checking this source.":"Ask the chat to fix the source before launching."}</p>
    </section>}
    <GeneralLaunchControls enabled={enabled} account={account} conversationId={conversationId} scope={cacheKey} headers={headers}
      project={project} intent={intent} draftId={draftId} settings={settings} imageId={imageReceipt?.id} disabled={disabled||imageBusy}
      pendingChange={pendingChange} editor={editor} flush={flush??(async()=>undefined)} onLaunchLocked={lock} launchCommand={launchCommand}/>
    {intent&&<details className={`${styles.ruleReview} ${styles.coinRules}`}>
      <summary>Coin rules<span>{intent.requirements.length}</span></summary>
      <section aria-label="Requested contract rules">
        <RequestedRules rules={intent.requirements} changes={intent.parentRevision?intent.changes:[]} disabled={disabled||launchBusy||!matches} onEditRule={onEditRule}/>
        {intent.unresolved.filter(question=>!intent.requirements.some(rule=>rule.open===question)).map(question=><p key={question}>{question}</p>)}
      </section>
    </details>}
    {project&&draftId&&<ProjectSource key={draftId} source={overviewFromView(draftId,project)} chainId={settings.chainId} account={account} conversationId={conversationId} headers={headers} disabled={disabled} onCompile={()=>undefined}/>}
    {children}
  </aside>;
}
