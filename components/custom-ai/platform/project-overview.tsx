"use client";
import {ArrowRight,FileCode2} from "lucide-react";
import {builderChains} from "@/lib/custom-ai/execution-routing";
import type {ProjectRevision} from "./types";
import styles from "./workspace.module.css";

export function ProjectOverview({project,disabled,onBuild,onResult,onFiles,onEdit}:{project:ProjectRevision;disabled:boolean;onBuild:()=>void;onResult:()=>void;onFiles:()=>void;onEdit:(id:string,text:string)=>void}){
  const architecture=project.document.architecture;
  const plan=architecture&&typeof architecture==="object"&&!Array.isArray(architecture)?architecture:undefined;
  const chain=builderChains.find(item=>item.id===Number(plan?.chainId));
  const files=Object.keys(project.document.files),requirements=project.document.requirements,open=requirements.filter(rule=>rule.open);
  return <div className={styles.stack}>
    <div className={styles.projectSummary}><p className={styles.eyebrow}>{chain?`${chain.name} · Custom contract`:plan?.application?"Application":"Project overview"}</p><h2>{project.document.title}</h2><p className={styles.muted}>Version {project.ordinal} · saved {new Date(project.createdAt).toLocaleString()}</p></div>
    <div className={styles.projectFacts}><span><strong>{requirements.length}</strong> requirements</span><button type="button" onClick={onFiles}><FileCode2 size={14} aria-hidden="true"/><strong>{files.length}</strong> files</button></div>
    {!requirements.length?<div className={styles.nextStep}><h3>Start with what it should do</h3><p>Describe your idea in the chat. The plan, files and results appear here as the project takes shape.</p></div>:<div className={styles.nextStep}><h3>{open.length?"A detail is still open":files.length?"Your source is saved":"The plan is ready to build"}</h3><p>{open.length?"Answer the open question in the chat to continue.":files.length?"Open the results to inspect checks, previews and launch preparation for this version.":"Turn these requirements into working source and run the relevant checks."}</p>{!open.length&&<button type="button" disabled={disabled} onClick={files.length?onResult:onBuild}>{files.length?"Open results":"Build this plan"}<ArrowRight size={14} aria-hidden="true"/></button>}</div>}
    <div className={styles.stack}><h3>What it should do</h3>{requirements.map(rule=><div key={rule.id} className={styles.requirement}><p>{rule.text}</p>{rule.open&&<p className={styles.openQuestion}>{rule.open}</p>}<button type="button" disabled={disabled} onClick={()=>onEdit(rule.id,rule.text)}>Edit requirement</button></div>)}</div>
    <details><summary>Technical plan</summary><pre>{JSON.stringify(architecture,null,2)}</pre></details>
  </div>;
}
