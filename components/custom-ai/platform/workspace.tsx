"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowUp,Check,Files,History,Link2,Plus,RefreshCw,Square,Workflow} from "lucide-react";
import {aiRequest,type AISessionHeaders} from "@/lib/custom-ai/client";
import {MessageContent} from "../message-content";
import {platformAPI,isActiveRun} from "./api";
import type {PlatformAPI,ProjectItem,ProjectRevision,ProjectRun} from "./types";
import {ProjectFiles} from "./files";
import {ProjectConnections} from "./connections";
import {ProjectRuntime} from "./runtime";
import {ProjectRepository} from "./repository";
import styles from "./workspace.module.css";

const tabs=[{id:"project",label:"Project",icon:Check},{id:"files",label:"Files",icon:Files},{id:"connections",label:"Connections",icon:Link2},{id:"runtime",label:"Preview & run",icon:Workflow},{id:"repository",label:"Import & export",icon:History}] as const;
type Tab=typeof tabs[number]["id"];
const runStatus:Record<string,string>={queued:"Queued",running:"Working",waiting_user:"Needs your input",retryable:"Interrupted · can resume",failed:"Stopped with an error",cancelled:"Stopped",succeeded:"Finished"};
const examples=["Build a shared counter with a backend and persistent data.","Create a coin with a fee that changes after a community game reaches its target.","Help me plan an app and connect it to an external API."];

export default function ProjectWorkspace({account,headers,onLegacy,initialPrompt,onPromptAccepted,generalLaunchEnabled=false}:{account:string;headers:AISessionHeaders;onLegacy:()=>void;initialPrompt?:{id:string;content:string};onPromptAccepted?:(id:string)=>void;generalLaunchEnabled?:boolean}){
  const credentials=useRef(headers);useEffect(()=>{credentials.current=headers;},[headers]);
  const [scope,setScope]=useState<string>(),[projects,setProjects]=useState<ProjectItem[]>([]),[selected,setSelected]=useState<string>();
  const [project,setProject]=useState<ProjectRevision>(),[runs,setRuns]=useState<ProjectRun[]>([]),[input,setInput]=useState("");
  const [tab,setTab]=useState<Tab>("project"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[ready,setReady]=useState(false),[dirty,setDirty]=useState(false);
  const [operation,setOperation]=useState("build"),[launchLocked,setLaunchLocked]=useState(false);
  const locked=dirty||launchLocked;
  const drafts=useRef(new Map<string,string>()),generation=useRef(0),pendingCreate=useRef<string|undefined>(undefined),pendingRun=useRef<Record<string,unknown>|undefined>(undefined),transcript=useRef<HTMLDivElement>(null),follow=useRef(true);
  const scopedHeaders=useCallback(async()=>({...await credentials.current(),...(scope?{"X-Custom-AI-Cache-Scope":scope}:{})}),[scope]);
  const api:PlatformAPI=useCallback((path,options)=>platformAPI(scopedHeaders)(path,options),[scopedHeaders]);
  const entry=useRef(initialPrompt),accepted=useRef(onPromptAccepted);useEffect(()=>{accepted.current=onPromptAccepted;},[onPromptAccepted]);
  const oauthStarted=useRef(false);
  const bootstrap=useCallback(async()=>{
    setError("");try{const result=await aiRequest<{cacheScope:string}>("/conversations",()=>credentials.current(),{account,action:"bootstrap"});setScope(result.cacheScope);}catch(cause){setError(cause instanceof Error?cause.message:"Reconnect to open your projects.");}
  },[account]);
  useEffect(()=>{void Promise.resolve().then(bootstrap);},[bootstrap]);
  useEffect(()=>{
    if(!scope)return;const controller=new AbortController();
    void (async()=>{try{
      const result=await api<{projects:ProjectItem[]}>("/projects?limit=100",{signal:controller.signal});setProjects(result.projects);
      if(entry.current){const first=await api<{project:ProjectRevision}>("/projects",{body:{projectId:entry.current.id},signal:controller.signal});setSelected(first.project.projectId);}
      else setSelected(current=>current??result.projects[0]?.projectId);
      setReady(true);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Projects could not load.");}})();return()=>controller.abort();
  },[scope,api]);
  useEffect(()=>{
    if(!scope||oauthStarted.current)return;
    const url=new URL(window.location.href),state=url.searchParams.get("oauth_state"),code=url.searchParams.get("oauth_code"),failed=url.searchParams.has("oauth_error");
    if(!state&&!code&&!failed)return;oauthStarted.current=true;
    for(const key of ["oauth_state","oauth_code","oauth_error"])url.searchParams.delete(key);
    window.history.replaceState(window.history.state,"",`${url.pathname}${url.search}${url.hash}`);
    if(failed||!state||!code){void Promise.resolve().then(()=>setError("Authorization was not completed. Open the connection and try again."));return;}
    void api<{projectId:string}>("/connections",{body:{action:"oauth-complete",state,code}}).then(result=>{generation.current++;setSelected(result.projectId);setTab("connections");setNotice("Connection authorized.");}).catch(cause=>setError(cause instanceof Error?cause.message:"Authorization could not be completed."));
  },[scope,api]);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(!selected)return;const seq=generation.current;
    const [saved,history]=await Promise.all([api<{project:ProjectRevision}>(`/projects?projectId=${selected}`,{signal}),api<{runs:ProjectRun[]}>(`/runs?projectId=${selected}`,{signal})]);
    if(seq!==generation.current||signal?.aborted)return;
    setProject(saved.project);setRuns(history.runs);
    setProjects(current=>{const item={projectId:selected,revisionId:saved.project.revisionId,title:saved.project.document.title,updatedAt:saved.project.createdAt};return [item,...current.filter(project=>project.projectId!==selected)];});
  },[api,selected]);
  useEffect(()=>{
    if(!selected)return;const controller=new AbortController();
    void Promise.resolve().then(()=>refresh(controller.signal)).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Project could not load.");});return()=>controller.abort();
  },[selected,refresh]);
  const active=runs.find(run=>isActiveRun(run.status));
  useEffect(()=>{
    if(!active)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{await refresh(controller.signal);}catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Progress could not load.");}if(!controller.signal.aborted)timer=setTimeout(poll,5000);};
    timer=setTimeout(poll,3000);return()=>{clearTimeout(timer);controller.abort();};
  },[active?.runId,refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(follow.current&&transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;},[runs]);
  const runTask=useCallback(async(work:()=>Promise<void>)=>{setBusy(true);setError("");try{await work();}catch(cause){setError(cause instanceof Error?cause.message:"The request could not finish. Your saved work is kept.");}finally{setBusy(false);}},[]);
  useEffect(()=>{
    const prompt=entry.current;if(!prompt||!project||project.projectId!==prompt.id||busy)return;
    entry.current=undefined;
    if(runs.length){accepted.current?.(prompt.id);return;}
    pendingRun.current={projectId:project.projectId,revisionId:project.revisionId,operation:"build",prompt:prompt.content,idempotencyKey:`prompt:${prompt.id}`,budgetUnits:20};
    setInput(prompt.content);void runTask(async()=>{await api("/runs",{body:pendingRun.current});pendingRun.current=undefined;setInput("");accepted.current?.(prompt.id);await refresh();});
  },[project,runs,busy,api,refresh,runTask]);
  function choose(id:string){if(locked||busy)return;if(selected)drafts.current.set(selected,input);generation.current++;pendingRun.current=undefined;setProject(undefined);setRuns([]);setInput(drafts.current.get(id)??"");setError("");setSelected(id);setNotice("");}
  async function create(){if(busy||locked)return;await runTask(async()=>{pendingCreate.current??=crypto.randomUUID();const {project}=await api<{project:ProjectRevision}>("/projects",{body:{projectId:pendingCreate.current}});pendingCreate.current=undefined;choose(project.projectId);setSelected(project.projectId);generation.current++;});}
  async function submit(){
    if(!project||active||locked)return;
    const prompt=input.trim();if(!prompt)return;
    if(!pendingRun.current||pendingRun.current.prompt!==prompt)pendingRun.current={projectId:project.projectId,revisionId:project.revisionId,operation,prompt,idempotencyKey:crypto.randomUUID(),budgetUnits:20};
    await runTask(async()=>{await api("/runs",{body:pendingRun.current});pendingRun.current=undefined;setInput("");drafts.current.delete(project.projectId);follow.current=true;await refresh();});
  }
  function update(saved:ProjectRevision){setProject(saved);setNotice(`Version ${saved.ordinal} saved.`);}
  function changeTab(next:Tab){setTab(next);}
  return <div className={styles.workspace}>
    <header className={styles.toolbar}><h1>AI Chat</h1><label className={styles.srOnly} htmlFor="platform-project">Your projects</label><select id="platform-project" value={selected??""} disabled={!ready||busy||locked} onChange={event=>choose(event.target.value)}><option value="" disabled>Choose a project</option>{projects.map(item=><option key={item.projectId} value={item.projectId}>{item.title}</option>)}</select><button type="button" disabled={!ready||busy||locked} onClick={()=>void create()}><Plus size={16} aria-hidden="true"/>New project</button><button className={styles.end} type="button" disabled={busy||locked} onClick={onLegacy}>Saved coin chats</button></header>
    {error&&<div role="alert" className={styles.error}>{error} <button type="button" onClick={()=>void (scope?runTask(()=>refresh()):bootstrap())}>Reload saved state</button></div>}
    <p className={styles.notice} role="status">{active?`Working · ${active.cursor} steps saved.`:notice}</p>
    {!ready?<div className={styles.card}>Opening your projects…</div>:!selected?<div className={styles.empty}><h2>What would you like to build?</h2><p>Create a project to build a hook, app or connected experience. Your files, changes and progress stay together.</p><button type="button" className={styles.primary} disabled={busy} onClick={()=>void create()}>Create your first project</button></div>:
    <div className={styles.layout}>
      <section className={styles.chat} aria-label="Project chat"><div className={styles.transcript} ref={transcript} onScroll={event=>{const element=event.currentTarget;follow.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;}}>
        {!runs.length?<div className={styles.empty}><h2>What are we building?</h2><p>Describe the idea in your own words. Add details, ask questions or change direction as we work.</p><div className={styles.examples}>{examples.map(example=><button type="button" key={example} onClick={()=>setInput(example)}>{example}</button>)}</div></div>:runs.slice().reverse().map(run=><article className={styles.message} key={run.runId}><div className={styles.user}>{run.prompt}</div><div className={styles.reply}>{run.summary?<MessageContent content={run.summary} assistant/>:<p>{runStatus[run.status]??run.status}</p>}</div><div className={styles.runMeta}><span>{runStatus[run.status]??run.status}</span><span>{run.usedUnits} / {run.reservedUnits} units</span>{isActiveRun(run.status)&&<button type="button" disabled={busy} onClick={()=>void runTask(async()=>{await api(`/runs?projectId=${selected}&runId=${run.runId}`,{method:"DELETE"});await refresh();})}><Square size={12} aria-hidden="true"/>Stop</button>}{run.status==="retryable"&&<button type="button" disabled={busy} onClick={()=>void runTask(async()=>{await api("/runs",{method:"PATCH",body:{projectId:selected,runId:run.runId,expectedCursor:run.cursor}});await refresh();})}>Resume saved work</button>}</div></article>)}
      </div><form className={styles.composer} onSubmit={event=>{event.preventDefault();void submit();}}><label htmlFor="platform-prompt">Message your project</label><textarea id="platform-prompt" value={input} maxLength={24000} disabled={!project||busy} onChange={event=>{setInput(event.target.value);pendingRun.current=undefined;}} placeholder="Tell me what you want to build or change…"/><footer><label><span className={styles.srOnly}>Work mode</span><select aria-label="Work mode" value={operation} disabled={busy||Boolean(active)} onChange={event=>{setOperation(event.target.value);pendingRun.current=undefined;}}><option value="build">Build & edit</option><option value="plan">Discuss & plan</option><option value="test">Run checks</option><option value="deploy">Publish & run</option></select></label><small>{dirty?"Save or discard your file edit to continue.":active?"Working in the background. You can return later.":"Work is saved as it runs."}</small><button type="submit" className={styles.primary} disabled={!project||busy||Boolean(active)||locked}><ArrowUp size={16} aria-hidden="true"/>Send</button></footer></form></section>
      <section className={styles.inspector} aria-label="Project workspace"><div className={styles.tabs} role="tablist" aria-label="Project tools">{tabs.map((item,index)=><button key={item.id} id={`platform-tab-${item.id}`} role="tab" type="button" aria-selected={tab===item.id} aria-controls={`platform-panel-${item.id}`} tabIndex={tab===item.id?0:-1} onClick={()=>changeTab(item.id)} onKeyDown={event=>{const delta=event.key==="ArrowRight"?1:event.key==="ArrowLeft"?-1:0;if(delta||event.key==="Home"||event.key==="End"){event.preventDefault();const next=tabs[event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+delta+tabs.length)%tabs.length];changeTab(next.id);document.getElementById(`platform-tab-${next.id}`)?.focus();}}}><item.icon size={15} aria-hidden="true"/>{item.label}</button>)}</div>
        {project&&<><div id="platform-panel-project" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-project" hidden={tab!=="project"}><div className={styles.stack}><h2>{project.document.title}</h2><p className={styles.muted}>Version {project.ordinal} · saved {new Date(project.createdAt).toLocaleString()}</p><h3>Requirements</h3>{project.document.requirements.map(rule=><div key={rule.id} className={styles.card}><p>{rule.text}</p>{rule.open&&<p>Open question: {rule.open}</p>}<button type="button" onClick={()=>setInput(`Change requirement ${rule.id}: ${rule.text}\n`)}>Change this requirement</button></div>)}{!project.document.requirements.length&&<p className={styles.muted}>Your requirements will appear here as you describe the project.</p>}<details><summary>Technical plan</summary><pre>{JSON.stringify(project.document.architecture,null,2)}</pre></details><button type="button" disabled={busy} onClick={()=>void runTask(()=>refresh())}><RefreshCw size={14} aria-hidden="true"/>Refresh saved state</button></div></div>
        <div id="platform-panel-files" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-files" hidden={tab!=="files"}><ProjectFiles key={project.projectId} project={project} api={api} onProject={update} onDirty={setDirty} disabled={launchLocked}/></div>
        <div id="platform-panel-connections" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-connections" hidden={tab!=="connections"}>{tab==="connections"&&<ProjectConnections key={project.projectId} projectId={project.projectId} api={api}/>}</div>
        <div id="platform-panel-runtime" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-runtime" hidden={tab!=="runtime"}>{tab==="runtime"&&<ProjectRuntime key={project.projectId} project={project} api={api} onPrompt={setInput} account={account} headers={scopedHeaders} generalLaunchEnabled={generalLaunchEnabled} onLaunchLocked={setLaunchLocked}/>}</div>
        <div id="platform-panel-repository" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-repository" hidden={tab!=="repository"}>{tab==="repository"&&<ProjectRepository key={project.projectId} project={project} api={api} onProject={update}/>}</div></>}
      </section>
    </div>}
  </div>;
}
