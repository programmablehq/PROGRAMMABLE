"use client";
import { useState, type ReactNode } from "react";
import type { CoinSetup, CoinSetupPatch } from "@/lib/custom-ai/coin-setup";
import type { GeneralProjectView } from "@/lib/custom-ai/project-view";
import { overviewFromView } from "@/lib/custom-ai/project-overview";
import type { LaunchIntent } from "@/lib/custom-ai/launch-intent";
import type { ImageReceipt } from "@/lib/custom-ai/studio";
import type { AISessionHeaders } from "@/lib/custom-ai/client";
import { CoinDetails, type CoinEditorImage } from "./coin-details";
import { ProjectSource } from "./project-source";
import styles from "./workspace.module.css";

export function GeneralProjectPreview({project,intent,draftId,account,conversationId,headers,disabled,settings,onChange,chatRevision,localPreview,cacheKey,imageReceipt,onImageReceipt,onEditRule,children}:{
  project?:GeneralProjectView;intent?:LaunchIntent;draftId?:string;account:string;conversationId?:string;headers:AISessionHeaders;
  disabled:boolean;settings:CoinSetup;onChange:(patch:CoinSetupPatch)=>void;chatRevision:number;localPreview:boolean;cacheKey:string;
  imageReceipt?:ImageReceipt;onImageReceipt:(receipt:ImageReceipt|undefined)=>void;onEditRule:(id:string)=>void;children?:ReactNode;
}) {
  const [,setImage]=useState<CoinEditorImage>();
  const matches=project?.chainId===settings.chainId&&project?.intentRevision===intent?.revision;
  return <aside className={styles.coinPanel} aria-label="Coin preview and details">
    <CoinDetails settings={settings} onChange={onChange} chatRevision={chatRevision} disabled={disabled} headers={headers}
      localPreview={localPreview} cacheKey={cacheKey} imageReceipt={imageReceipt} onImageReceipt={onImageReceipt} onImage={setImage}
      stage={!project?"Contract design":project.compiled?"Source compiled":"Source needs changes"} description={project?.summary} feeCore={false}/>
    {intent&&<section className={styles.ruleReview} aria-label="Requested contract rules"><h3>Rules for this coin</h3>
      <ul className={styles.ruleEditList}>{intent.requirements.map(rule=><li key={rule.id}><span>{rule.text}</span>
        {rule.open&&<p>Open: {rule.open}</p>}<button type="button" className={styles.textButton} disabled={disabled||!matches} aria-label={`Edit rule: ${rule.text}`} onClick={()=>onEditRule(rule.id)}>Edit</button>
      </li>)}</ul>
      {intent.unresolved.filter(question=>!intent.requirements.some(rule=>rule.open===question)).map(question=><p key={question}>Open: {question}</p>)}
    </section>}
    <p className={`${styles.note} ${styles.preparationStatus}`} role="status">{!project?"Describe your contract in the chat to build its source on this network.":!matches?"The design or network changed. Ask the chat to update the saved source.":project.compiled?"Source compiled. Contract checks and launch preparation are still pending.":"The source has build diagnostics. Ask the chat to fix this source."}</p>
    {project&&draftId&&<ProjectSource key={draftId} source={overviewFromView(draftId,project)} chainId={settings.chainId} account={account} conversationId={conversationId} headers={headers} disabled={disabled} onCompile={()=>undefined}/>}
    {children}
  </aside>;
}
