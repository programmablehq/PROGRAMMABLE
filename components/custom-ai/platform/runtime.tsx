"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {ExternalLink,Play,Square} from "lucide-react";
import type {PlatformAPI,ProjectRevision,Release} from "./types";
import {publicAppURL} from "./api";
import {ProjectEvents} from "./events";
import styles from "./workspace.module.css";
import type {AISessionHeaders} from "@/lib/custom-ai/client";
import {ProjectContractLaunch} from "./contract-launch";
import {useWallet} from "@/components/wallet-provider";

type Jobs={jobs:{id:string;path:string;intervalSeconds:number;idempotent:boolean;enabled:boolean}[];runs:{id:string;jobId:string;state:string;attempts:number;createdAt:string}[]};
const checkLabel=(value:unknown)=>{const item=value&&typeof value==="object"?value as {kind?:string;checkId?:string}:{};return item.kind==="compile"?"Compilation":item.kind==="source-audit"?"Source review":item.kind==="contract-scenarios"?"Contract behavior":item.checkId??"Application check";};
type Assessment={level:string;verified:boolean;missingRequirementIds:string[];missingChecks?:string[];evidence:{id:string;passed:boolean;requirementIds:string[];result:unknown}[]};
export function ProjectRuntime({project,api,onPrompt,account,headers,generalLaunchEnabled,onLaunchLocked,autoPreviewRunId}:{project:ProjectRevision;api:PlatformAPI;onPrompt:(text:string)=>void;account:string;headers:AISessionHeaders;generalLaunchEnabled:boolean;onLaunchLocked:(locked:boolean)=>void;autoPreviewRunId?:string}){
  const wallet=useWallet();
  const [releases,setReleases]=useState<Release[]>([]),[jobs,setJobs]=useState<Jobs>({jobs:[],runs:[]}),[assessment,setAssessment]=useState<Assessment>();
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[preview,setPreview]=useState<{url:string;revisionId:string;explicit?:boolean}>(),[loadedRevision,setLoadedRevision]=useState<string>();
  const pending=useRef<{action:string;projectId:string;revisionId:string;mode:string;idempotencyKey:string}|undefined>(undefined);
  const autoStarted=useRef<string>(undefined),dismissed=useRef(new Set<string>()),autoOpened=useRef(new Set<string>()),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const refresh=useCallback(async(signal?:AbortSignal)=>{const [saved,schedules,checks]=await Promise.all([api<{releases:Release[]}>(`/releases?projectId=${project.projectId}`,{signal}),api<Jobs>(`/jobs?projectId=${project.projectId}`,{signal}),api<Assessment>(`/checks?projectId=${project.projectId}&revisionId=${encodeURIComponent(project.revisionId)}`,{signal})]);if(signal?.aborted)return;setReleases(saved.releases);setJobs(schedules);setAssessment(checks);setLoadedRevision(project.revisionId);},[api,project.projectId,project.revisionId]);
  useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>refresh(controller.signal)).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});return()=>controller.abort();},[refresh]);
  const queued=releases.some(release=>!["published","ready","stopped","failed"].includes(release.state));
  const pendingIds=releases.filter(release=>!["published","ready","stopped","failed"].includes(release.state)&&!(release.control?.state==="unknown"&&release.control.attempts>=3)).map(release=>release.id).sort().join(",");
  useEffect(()=>{
    if(!pendingIds)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{
      const progress=await Promise.all(pendingIds.split(",").map(id=>api<{release:Release}>(`/releases?projectId=${project.projectId}&releaseId=${id}`,{signal:controller.signal})));
      if(!controller.signal.aborted)setReleases(current=>current.map(release=>progress.find(item=>item.release.id===release.id)?.release??release));
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Progress could not load.");}
    if(!controller.signal.aborted)timer=setTimeout(poll,10000);};
    timer=setTimeout(poll,6000);return()=>{clearTimeout(timer);controller.abort();};
  },[pendingIds,api,project.projectId]);
  async function task(work:()=>Promise<void>){if(busy)return;setBusy(true);setError("");try{await work();}catch(cause){setError(cause instanceof Error?cause.message:"The app could not be updated.");}finally{setBusy(false);}}
  async function publish(){pending.current??={action:"queue",projectId:project.projectId,revisionId:project.revisionId,mode:"preview",idempotencyKey:crypto.randomUUID()};await api("/releases",{body:pending.current});pending.current=undefined;setNotice("Preview queued. You can leave this page while it is built.");await refresh();}
  const stateLabel=(release:Release)=>{
    const labels:Record<string,string>={queued:"Queued",building:"Building",ready:"Preview ready",published:"Live",stopped:"Paused",failed:"Could not build",reconcile:release.control?"Confirming change":"Checking deployment"};
    return labels[release.state]??"Checking state";
  };
  const app=(project.document.architecture as {application?:unknown}|null)?.application;
  const contract=["contract","legacy-contract"].includes(String((project.document.architecture as {kind?:string}|null)?.kind));
  useEffect(()=>{
    if(!autoPreviewRunId||!app||!assessment?.verified||loadedRevision!==project.revisionId||releases.some(release=>release.revisionId===project.revisionId&&release.state!=="failed"))return;
    const key=`preview:${autoPreviewRunId}`;if(autoStarted.current===key)return;autoStarted.current=key;
    void (async()=>{setBusy(true);setError("");setNotice("Building your checked app preview…");
      pending.current={action:"queue",projectId:project.projectId,revisionId:project.revisionId,mode:"preview",idempotencyKey:key};
      try{await api("/releases",{body:pending.current});pending.current=undefined;if(mounted.current){setNotice("Your preview is building. This version has not been published.");await refresh();}}
      catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:"The preview could not start. Your checked files are saved.");}
      finally{if(mounted.current)setBusy(false);}
    })();
  },[autoPreviewRunId,app,assessment?.verified,loadedRevision,project.projectId,project.revisionId,releases,api,refresh]);
  useEffect(()=>{
    const ready=releases.find(release=>release.revisionId===project.revisionId&&["ready","published"].includes(release.state)&&release.observedAt&&publicAppURL(release.url)&&!dismissed.current.has(release.id)&&!autoOpened.current.has(release.id));
    if(ready){autoOpened.current.add(ready.id);const url=publicAppURL(ready.url)!;setPreview({url,revisionId:ready.revisionId});setNotice(ready.state==="published"?"Your published app is ready.":"Your preview is ready. Publish this version when you choose.");}
  },[releases,project.revisionId]);
  const visiblePreview=preview?.revisionId===project.revisionId||preview?.explicit?preview:undefined;
  return <div className={styles.stack}><h2>Preview & run</h2><p role="status" className={styles.notice}>{notice}</p>{error&&<p role="alert" className={styles.error}>{error}</p>}
    {visiblePreview&&<div className={styles.previewResult}><div className={styles.row}><h3>{visiblePreview.revisionId===project.revisionId?"Your app":"Earlier app version"}</h3><a href={visiblePreview.url} target="_blank" rel="noreferrer">Open in a new tab <ExternalLink size={14} aria-hidden="true"/></a><button type="button" onClick={()=>{for(const release of releases)if(release.url===visiblePreview.url)dismissed.current.add(release.id);setPreview(undefined);}}>Close preview</button></div><iframe className={styles.frame} src={visiblePreview.url} title="Your app preview" sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer"/></div>}
    <section className={styles.card}><h3>Checks for version {project.ordinal}</h3><p>{assessment?.verified?"All declared requirements have passing checks.":assessment?assessment.level==="discussed"?"Save requirements before running checks.":assessment.evidence.some(item=>!item.passed)?"A saved check failed. Review the results below.":assessment.missingRequirementIds.length?`${assessment.missingRequirementIds.length} requirements still need passing checks.${assessment.missingChecks?.includes("source-audit")?" Source review is also required.":""}`:assessment.missingChecks?.includes("source-audit")?"Behavior checks passed. The independent source review is still needed.":"Finish the remaining checks for this version.":"Loading check results…"}</p><button type="button" onClick={()=>onPrompt("Run the checks for the current project, inspect failures and fix them without dropping any requirement.")}>Ask the chat to check this version</button>{assessment?.evidence.map(item=><details key={item.id}><summary>{item.passed?"Passed":"Failed"} · {checkLabel(item.result)}{item.requirementIds.length?` · ${item.requirementIds.length} requirements`:""}</summary><pre>{JSON.stringify(item.result,null,2)}</pre></details>)}</section>
    {contract&&<ProjectContractLaunch key={project.projectId} project={project} account={account} api={api} headers={headers} enabled={generalLaunchEnabled} onLaunchLocked={onLaunchLocked} onPrompt={onPrompt}/>}
    {app?<button type="button" className={styles.primary} disabled={busy||queued||!assessment?.verified} onClick={()=>void task(publish)}>Build preview for version {project.ordinal}</button>:<p className={styles.muted}>An application preview appears after the chat has saved its app plan. Contract projects use the launch review.</p>}
    {releases.map(release=>{const url=publicAppURL(release.url),current=release.revisionId===project.revisionId;return <article className={styles.card} key={release.id}><div className={styles.row}><h3>{release.mode==="production"?release.state==="published"?"Live app":"App":"App preview"}</h3><small>{stateLabel(release)}{!current?" · earlier version":" · current version"}</small></div>{release.control?<p role="status">{release.control.state==="unknown"&&release.control.attempts>=3?"The hosting change could not be confirmed. App data access is paused. You can retry this same action.":"Confirming the hosting change. App data access is paused until it is verified."}</p>:release.errorCode&&<p>{release.errorCode}</p>}{url&&<div className={styles.row}><a href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true"/> Open app</a><button type="button" onClick={()=>{dismissed.current.delete(release.id);setPreview({url,revisionId:release.revisionId,explicit:true});}}>Show preview</button></div>}<div className={styles.row}>{release.control?.state==="unknown"&&release.control.attempts>=3&&<button type="button" disabled={busy} onClick={()=>void task(async()=>{await api("/releases",{body:{action:"retry-control",projectId:project.projectId,releaseId:release.id}});await refresh();})}>Retry hosting action</button>}{release.state==="ready"&&current&&<button type="button" disabled={busy} onClick={()=>void task(async()=>{await api("/releases",{body:{action:"promote",projectId:project.projectId,releaseId:release.id}});setNotice("Publication checked. The saved state shows its result.");await refresh();})}>Publish this version</button>}{release.state==="published"&&<button type="button" disabled={busy} onClick={()=>void task(async()=>{await api("/releases",{body:{action:"stop",projectId:project.projectId,releaseId:release.id}});await refresh();})}><Square size={14} aria-hidden="true"/>Stop app</button>}{release.state==="stopped"&&<button type="button" disabled={busy} onClick={()=>void task(async()=>{await api("/releases",{body:{action:"resume",projectId:project.projectId,releaseId:release.id}});await refresh();})}><Play size={14} aria-hidden="true"/>Resume app</button>}</div></article>;})}
    {app&&<section className={styles.card}><h3>Scheduled tasks</h3>{jobs.jobs.map(job=><div key={job.id} className={styles.row}><p>{job.id} · {job.enabled?"Enabled":"Paused"} · every {job.intervalSeconds} seconds · {job.path}</p><button type="button" disabled={busy} onClick={()=>void task(async()=>{await api("/jobs",{method:"PATCH",body:{projectId:project.projectId,jobId:job.id,enabled:!job.enabled}});await refresh();})}>{job.enabled?"Pause task":"Resume task"}</button></div>)}{!jobs.jobs.length&&<p>No scheduled tasks yet.</p>}<button type="button" onClick={()=>onPrompt("Set up a scheduled task for this app. Explain its endpoint, frequency and how to stop it before activating it.")}>Set up a task in chat</button>{jobs.runs.slice(0,10).map(run=><p key={run.id}>{run.jobId}: {run.state} · {new Date(run.createdAt).toLocaleString()}</p>)}</section>}
    <ProjectEvents key={`${project.projectId}:${project.revisionId}`} projectId={project.projectId} revisionId={project.revisionId} api={api} onPrompt={onPrompt} onWalletBusy={onLaunchLocked} wallet={wallet.sessionOwner&&wallet.wallet?.account&&typeof wallet.performProjectGameWalletRequest==="function"?{ownerId:wallet.sessionOwner,account:wallet.wallet.account,perform:wallet.performProjectGameWalletRequest}:undefined}/>
  </div>;
}
