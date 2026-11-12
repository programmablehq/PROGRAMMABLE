"use client";
import {lazy,Suspense,useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {ArrowUp,Check,CheckCheck,Files,History,Link2,Menu,Plus,RefreshCw,Search,Square,Workflow,X} from "lucide-react";
import {AIRequestError,aiRequest,type AISessionHeaders} from "@/lib/custom-ai/client";
import type {AIUsage} from "@/lib/custom-ai/types";
import type {ConversationItem,ConversationPage} from "@/lib/custom-ai/conversation";
import {readDraftCache,writeDraftCache} from "@/lib/custom-ai/draft-cache";
import {containsInlineCredential} from "@/lib/custom-ai/platform/secret-input";
import {MessageContent} from "../message-content";
import {platformAPI,isActiveRun} from "./api";
import type {PlatformAPI,ProjectItem,ProjectRevision,ProjectRun,ProjectRunState} from "./types";
import {ProjectFiles} from "./files";
import {ProjectStart} from "./project-start";
import {ProjectOverview} from "./project-overview";
import {completedWork,readMessageIntent,resultTab,sendWorkspaceMessage,workExplanation,workStatus,type MessageIntent,type ResultIntent,type WorkProgress} from "./workspace-state";
import styles from "./workspace.module.css";

const tabs=[{id:"project",label:"Project",icon:Check},{id:"files",label:"Files",icon:Files},{id:"connections",label:"Connections",icon:Link2},{id:"runtime",label:"Preview & run",icon:Workflow},{id:"repository",label:"Import & export",icon:History}] as const;
type Tab=typeof tabs[number]["id"];
type Props={account:string;headers:AISessionHeaders;onLegacy:(id?:string)=>void;onProject?:()=>void;beforeLeaveLegacy?:()=>Promise<void>;
  legacyId?:string;legacyContent?:ReactNode;incomingProjectId?:string;onProjectOpened?:()=>void;onAccessDenied?:()=>void;
  initialPrompt?:{id:string;content:string};onPromptAccepted?:(id:string)=>void;generalLaunchEnabled?:boolean};
type Drafts={selected?:string;drafts:Record<string,string>;operation?:ProjectRun["operation"];preview?:boolean;result?:ResultIntent};
type Progress=WorkProgress&{run:ProjectRunState};
const ProjectConnections=lazy(()=>import("./connections").then(module=>({default:module.ProjectConnections})));
const ProjectRuntime=lazy(()=>import("./runtime").then(module=>({default:module.ProjectRuntime})));
const ProjectRepository=lazy(()=>import("./repository").then(module=>({default:module.ProjectRepository})));
const revisionTools=new Set(["project.plan","project.patch","project.dependencies","contract.dependencies","repository.import"]);
const newDraft="new";
const failures:Record<string,string>={"run-budget":"This work unit reached its limit. Your files and completed checks are saved. Continue from this version when your allowance is available.","incomplete":"The AI response was interrupted or did not fit the required format. Your saved source is kept. Continue from this version.","agent-provider":"The AI connection could not finish this step. Your saved work is kept.","unverified-completion-claim":"The result could not be confirmed from the saved checks. Open the results before continuing."};
const summaryText=(run:ProjectRun)=>run.status==="failed"?failures[run.summary??""]??run.summary??"This step could not finish. Your saved work is kept.":run.summary??"";

export default function ProjectWorkspace({account,headers,onLegacy,onProject,beforeLeaveLegacy,legacyId,legacyContent,incomingProjectId,onProjectOpened,onAccessDenied,initialPrompt,onPromptAccepted,generalLaunchEnabled=false}:Props){
  const credentials=useRef(headers);useEffect(()=>{credentials.current=headers;},[headers]);
  const [scope,setScope]=useState<string>(),[projects,setProjects]=useState<ProjectItem[]>([]),[selected,setSelected]=useState<string>();
  const [project,setProject]=useState<ProjectRevision>(),[runs,setRuns]=useState<ProjectRun[]>([]),[input,setInput]=useState("");
  const [tab,setTab]=useState<Tab>("project"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [ready,setReady]=useState(false),[dirty,setDirty]=useState(false),[launchLocked,setLaunchLocked]=useState(false);
  const [operation,setOperation]=useState<ProjectRun["operation"]>("build"),[previewAfterBuild,setPreviewAfterBuild]=useState(true);
  const [historyOpen,setHistoryOpen]=useState(false),[historyQuery,setHistoryQuery]=useState("");
  const [conversations,setConversations]=useState<ConversationItem[]>([]),[historyCursor,setHistoryCursor]=useState<string>();
  const [historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState("");
  const [progress,setProgress]=useState<Record<string,WorkProgress>>({}),[resultIntent,setResultIntent]=useState<ResultIntent>();
  const [resultsReady,setResultsReady]=useState<ReadonlySet<string>>(()=>new Set());
  const [syncingRun,setSyncingRun]=useState<string>();
  const [mobilePane,setMobilePane]=useState<"chat"|"result">("chat"),[hasPending,setHasPending]=useState(false);
  const drafts=useRef(new Map<string,string>()),generation=useRef(0),pendingCreate=useRef<string>(undefined),pendingMessage=useRef<MessageIntent>(undefined);
  const root=useRef<HTMLDivElement>(null),transcript=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null),main=useRef<HTMLDivElement>(null),follow=useRef(true);
  const cacheLoaded=useRef(false),seenResults=useRef(new Set<string>()),historyGeneration=useRef(0),historyAbort=useRef<AbortController>(undefined);
  const cacheVersion=useRef(0),cacheWrites=useRef<Promise<void>>(Promise.resolve());
  const entry=useRef(initialPrompt),accepted=useRef(onPromptAccepted);useEffect(()=>{accepted.current=onPromptAccepted;},[onPromptAccepted]);
  const locked=dirty||launchLocked,legacyOpen=Boolean(legacyContent);
  const cacheKey=scope?`programmable.project-workspace.v1:${scope}:${account}`:undefined;
  const persistWorkspace=useCallback((snapshot:Drafts)=>{
    if(!cacheKey)return Promise.resolve();
    const write=cacheWrites.current.catch(()=>undefined).then(()=>writeDraftCache(cacheKey,snapshot));cacheWrites.current=write;return write;
  },[cacheKey]);
  const scopedHeaders=useCallback(async()=>({...await credentials.current(),...(scope?{"X-Custom-AI-Cache-Scope":scope}:{})}),[scope]);
  const api:PlatformAPI=useCallback((path,options)=>platformAPI(scopedHeaders)(path,options),[scopedHeaders]);
  useEffect(()=>{
    const viewport=window.visualViewport,element=root.current;if(!viewport||!element)return;let frame=0;
    const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>element.style.setProperty("--custom-ai-viewport",`${viewport.height}px`));};
    resize();viewport.addEventListener("resize",resize);return()=>{viewport.removeEventListener("resize",resize);cancelAnimationFrame(frame);element.style.removeProperty("--custom-ai-viewport");};
  },[]);
  const bootstrap=useCallback(async()=>{
    setError("");try{const result=await aiRequest<{cacheScope:string}>("/conversations",()=>credentials.current(),{account,action:"bootstrap"});setScope(result.cacheScope);}catch(cause){setError(cause instanceof Error?cause.message:"Reconnect to open your projects.");}
  },[account]);
  useEffect(()=>{void Promise.resolve().then(bootstrap);},[bootstrap]);
  useEffect(()=>{
    if(!scope||!cacheKey)return;const controller=new AbortController();
    void (async()=>{try{
      const [result,cached,pending]=await Promise.all([api<{projects:ProjectItem[]}>("/projects?limit=100",{signal:controller.signal}),
        readDraftCache<Drafts>(cacheKey).catch(()=>undefined),readDraftCache<unknown>(cacheKey+":pending").catch(()=>undefined)]);
      if(controller.signal.aborted)return;
      setProjects(result.projects);
      for(const [id,text] of Object.entries(cached?.drafts??{}).slice(0,101))if(typeof text==="string"&&text.length<=24000&&!containsInlineCredential(text))drafts.current.set(id,text);
      const savedIntent=readMessageIntent(pending);pendingMessage.current=savedIntent;setHasPending(Boolean(savedIntent));
      const choice=entry.current?undefined:savedIntent?result.projects.find(p=>p.projectId===savedIntent.projectId)?.projectId:
        cached?.selected&&result.projects.some(p=>p.projectId===cached.selected)?cached.selected:result.projects[0]?.projectId;
      setSelected(choice);setInput(savedIntent?.prompt??entry.current?.content??drafts.current.get(choice??newDraft)??"");
      if(savedIntent)setOperation(savedIntent.operation);else if(cached?.operation&&["build","plan","test","deploy"].includes(cached.operation))setOperation(cached.operation);
      if(typeof cached?.preview==="boolean")setPreviewAfterBuild(cached.preview);
      if(cached?.result&&result.projects.some(p=>p.projectId===cached.result?.projectId))setResultIntent(cached.result);
      cacheLoaded.current=true;setReady(true);
    }catch(cause){if(!controller.signal.aborted){
      if(cause instanceof AIRequestError&&cause.status===403&&cause.code==="platform-pilot"&&onAccessDenied){onAccessDenied();return;}
      setError(cause instanceof Error?cause.message:"Projects could not load.");
    }}})();return()=>controller.abort();
  },[scope,cacheKey,api,onAccessDenied]);
  useEffect(()=>{
    if(!cacheKey||!ready||!cacheLoaded.current)return;
    if(containsInlineCredential(input))drafts.current.delete(selected??newDraft);else drafts.current.set(selected??newDraft,input);
    const snapshot:Drafts={selected,drafts:Object.fromEntries(drafts.current),operation,preview:previewAfterBuild,result:resultIntent};
    const version=cacheVersion.current;
    const save=()=>{if(version===cacheVersion.current)void persistWorkspace(snapshot).catch(()=>undefined);};
    const timer=setTimeout(save,250);window.addEventListener("pagehide",save);
    return()=>{clearTimeout(timer);window.removeEventListener("pagehide",save);};
  },[cacheKey,ready,selected,input,operation,previewAfterBuild,resultIntent,persistWorkspace]);
  const loadHistory=useCallback(async(cursor?:string)=>{
    if(!scope)return;const seq=++historyGeneration.current;historyAbort.current?.abort();const controller=new AbortController();historyAbort.current=controller;
    setHistoryLoading(true);setHistoryError("");
    try{
      const page=await aiRequest<ConversationPage>(`/conversations?account=${encodeURIComponent(account)}&q=${encodeURIComponent(historyQuery)}&archived=false${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,scopedHeaders,undefined,controller.signal);
      if(seq!==historyGeneration.current)return;
      setConversations(current=>cursor?[...current,...(page.conversations??[])].filter((chat,index,all)=>all.findIndex(item=>item.id===chat.id)===index):page.conversations??[]);
      setHistoryCursor(page.cursor);
    }catch(cause){if(!controller.signal.aborted)setHistoryError(cause instanceof Error?cause.message:"Your coin chats could not load.");}
    finally{if(seq===historyGeneration.current)setHistoryLoading(false);}
  },[account,historyQuery,scope,scopedHeaders]);
  useEffect(()=>{const timer=setTimeout(()=>{void loadHistory();},250);return()=>{clearTimeout(timer);historyAbort.current?.abort();};},[loadHistory,legacyId,legacyOpen]);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(!selected)return;const seq=generation.current;
    const [saved,history]=await Promise.all([api<{project:ProjectRevision}>(`/projects?projectId=${selected}`,{signal}),api<{runs:ProjectRun[]}>(`/runs?projectId=${selected}`,{signal})]);
    if(seq!==generation.current||signal?.aborted)return;
    setProject(saved.project);setRuns(history.runs);
    setResultsReady(current=>new Set([...current,...history.runs.filter(run=>!isActiveRun(run.status)).map(run=>run.runId)]));
    setProjects(current=>[{projectId:selected,revisionId:saved.project.revisionId,title:saved.project.document.title,updatedAt:saved.project.createdAt},...current.filter(p=>p.projectId!==selected)]);
  },[api,selected]);
  useEffect(()=>{
    if(!selected)return;const controller=new AbortController();void Promise.resolve().then(()=>refresh(controller.signal)).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Project could not load.");});return()=>controller.abort();
  },[selected,refresh]);
  const active=runs.find(run=>isActiveRun(run.status)),activeId=active?.runId??syncingRun;
  useEffect(()=>{
    if(!activeId||!selected)return;const controller=new AbortController(),seq=generation.current;let timer:ReturnType<typeof setTimeout>,cursor="0";
    const poll=async()=>{
      try{
        const update=await api<Progress>(`/runs?projectId=${selected}&runId=${activeId}&afterCursor=${cursor}`,{signal:controller.signal});
        if(seq!==generation.current||controller.signal.aborted)return;
        if(!isActiveRun(update.run.status))setSyncingRun(activeId);
        setProgress(current=>{const old=current[activeId]?.events??[];return {...current,[activeId]:{activeStep:update.activeStep,events:[...old,...update.events].filter((step,index,all)=>all.findIndex(item=>item.cursor===step.cursor)===index)}};});
        cursor=update.events.at(-1)?.cursor??cursor;setRuns(current=>current.map(run=>run.runId===activeId?{...run,...update.run}:run));
        if(update.events.some(event=>revisionTools.has(event.capabilityId))||!isActiveRun(update.run.status)){
          try{const saved=await api<{project:ProjectRevision}>(`/projects?projectId=${selected}`,{signal:controller.signal});
            if(seq!==generation.current||controller.signal.aborted)return;
            setProject(current=>current?.projectId===saved.project.projectId&&current.ordinal>saved.project.ordinal?current:saved.project);
            if(!isActiveRun(update.run.status))setResultsReady(current=>new Set(current).add(activeId));
            setProjects(current=>[{projectId:selected,revisionId:saved.project.revisionId,title:saved.project.document.title,updatedAt:saved.project.createdAt},...current.filter(p=>p.projectId!==selected)]);
          }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Saved files could not reload. Refresh saved state to try again.");}
        }
        if(!isActiveRun(update.run.status)){setSyncingRun(undefined);return;}
        if(seq!==generation.current||controller.signal.aborted)return;
      }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Progress could not load.");}
      if(!controller.signal.aborted)timer=setTimeout(poll,document.visibilityState==="hidden"?5000:1500);
    };void poll();return()=>{clearTimeout(timer);controller.abort();};
  },[activeId,api,selected]);
  useEffect(()=>{if(runs.length&&follow.current&&transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;},[runs,progress]);
  const runTask=useCallback(async(work:()=>Promise<void>)=>{setBusy(true);setError("");try{await work();}catch(cause){setError(cause instanceof Error?cause.message:"The request could not finish. Your saved work is kept.");}finally{setBusy(false);}},[]);
  const savePending=useCallback(async(intent:MessageIntent|undefined)=>{
    pendingMessage.current=intent;setHasPending(Boolean(intent));
    if(cacheKey)await writeDraftCache(cacheKey+":pending",intent).catch(()=>undefined);
  },[cacheKey]);
  function focusContent(){requestAnimationFrame(()=>main.current?.focus());}
  function rememberDraft(){if(containsInlineCredential(input))drafts.current.delete(selected??newDraft);else drafts.current.set(selected??newDraft,input);}
  async function saveSelection(id?:string){
    cacheVersion.current++;await persistWorkspace({selected:id,drafts:Object.fromEntries(drafts.current),operation,preview:previewAfterBuild,result:resultIntent}).catch(()=>undefined);
  }
  async function activate(id?:string,loaded?:ProjectRevision){
    rememberDraft();generation.current++;await saveSelection(id);
    if(loaded)setProjects(current=>[{projectId:loaded.projectId,revisionId:loaded.revisionId,title:loaded.document.title,updatedAt:loaded.createdAt},...current.filter(p=>p.projectId!==id)]);
    setProject(loaded);setRuns([]);setSyncingRun(undefined);setInput(drafts.current.get(id??newDraft)??"");setError("");setSelected(id);setNotice("");setHistoryOpen(false);setMobilePane("chat");
    if(id&&id===selected&&!loaded)await refresh();
  }
  async function choose(id:string){if(locked||busy)return;await runTask(async()=>{if(legacyOpen)await beforeLeaveLegacy?.();await activate(id);onProject?.();focusContent();});}
  async function chooseLegacy(id?:string){if(locked||busy)return;await runTask(async()=>{if(legacyOpen)await beforeLeaveLegacy?.();rememberDraft();await saveSelection(selected);onLegacy(id);setHistoryOpen(false);focusContent();});}
  async function create(){
    if(busy||locked)return;
    await runTask(async()=>{if(pendingMessage.current)throw Error("Retry your saved message before starting another project.");if(legacyOpen)await beforeLeaveLegacy?.();
      pendingCreate.current??=crypto.randomUUID();const {project}=await api<{project:ProjectRevision}>("/projects",{body:{projectId:pendingCreate.current}});pendingCreate.current=undefined;await activate(project.projectId,project);setOperation("build");setPreviewAfterBuild(true);setTab("project");setResultIntent(undefined);onProject?.();requestAnimationFrame(()=>composer.current?.focus());});
  }
  async function submit(intent?:MessageIntent){
    if(active||syncingRun||busy||locked||!ready)return;
    const prompt=intent?.prompt??input.trim();if(!prompt)return;
    if(containsInlineCredential(prompt)){setError("This message appears to contain a private credential. Remove it and use the private Connections field.");return;}
    await runTask(async()=>{
      if(legacyOpen)await beforeLeaveLegacy?.();
      let saved=intent??pendingMessage.current;
      if(saved&&(saved.prompt!==prompt||saved.operation!==operation)&&!intent)throw Error("Your previous message may already be saved. Retry it before sending a different request.");
      saved??={version:1,id:crypto.randomUUID(),projectId:project?.projectId??crypto.randomUUID(),prompt,operation,preview:previewAfterBuild,
        revisionId:project?.revisionId,nameNeeded:!project||(runs.length===0&&project.document.title==="New project")};
      const run=await sendWorkspaceMessage(saved,api,()=>aiRequest<AIUsage>("/usage",scopedHeaders),value=>savePending(value));
      await savePending(undefined);drafts.current.delete(saved.projectId);drafts.current.delete(newDraft);
      setResultIntent({projectId:saved.projectId,runId:run.runId,preview:saved.preview&&saved.operation==="build"});
      onProject?.();
      if(selected!==saved.projectId){await activate(saved.projectId);setRuns([run]);}else await refresh();
      setInput("");follow.current=true;accepted.current?.(saved.projectId);
    });
  }
  useEffect(()=>{
    if(!ready||!entry.current)return;
    const incoming=entry.current;entry.current=undefined;
    if(pendingMessage.current&&pendingMessage.current.projectId!==incoming.id){setError("Retry your saved message before starting the new idea.");return;}
    const intent=pendingMessage.current??{version:1 as const,id:incoming.id,projectId:incoming.id,prompt:incoming.content,operation:"build" as const,preview:true,nameNeeded:true};
    void submit(intent);
  // The handoff is consumed once. Its stable IDs are retained in the pending journal on failure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ready]);
  useEffect(()=>{
    if(!incomingProjectId||!ready)return;let live=true;
    void Promise.resolve().then(async()=>{if(live){await activate(incomingProjectId);if(live){onProject?.();onProjectOpened?.();}}});
    return()=>{live=false;};
  // An explicit imported project takes precedence over the previous selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[incomingProjectId,ready]);
  useEffect(()=>{
    if(!resultIntent||resultIntent.projectId!==selected||!project||legacyOpen||locked||busy||error)return;
    const run=runs.find(item=>item.runId===resultIntent.runId);
    if(!run||isActiveRun(run.status)||!resultsReady.has(run.runId)||seenResults.current.has(run.runId))return;
    seenResults.current.add(run.runId);
    if(run.status==="succeeded"&&(run.operation!=="plan"||completedWork(progress[run.runId]).length)){const seq=generation.current;void Promise.resolve().then(()=>{if(seq===generation.current){setTab(resultTab(project,run.operation));setMobilePane("result");}});}
  },[resultIntent,selected,project,runs,progress,resultsReady,legacyOpen,locked,busy,error]);
  useEffect(()=>{
    if(!scope)return;const url=new URL(window.location.href),state=url.searchParams.get("oauth_state"),code=url.searchParams.get("oauth_code");
    if(!state&&!code&&!url.searchParams.has("oauth_error"))return;
    const failed=url.searchParams.has("oauth_error");for(const key of ["oauth_state","oauth_code","oauth_error"])url.searchParams.delete(key);window.history.replaceState(window.history.state,"",`${url.pathname}${url.search}${url.hash}`);
    if(failed||!state||!code){void Promise.resolve().then(()=>setError("Authorization was not completed. Open the connection and try again."));return;}
    void api<{projectId:string}>("/connections",{body:{action:"oauth-complete",state,code}}).then(async result=>{await activate(result.projectId);onProject?.();setTab("connections");setMobilePane("result");setNotice("Connection authorized.");}).catch(cause=>setError(cause instanceof Error?cause.message:"Authorization could not be completed."));
  // OAuth query parameters are consumed once for this account scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scope]);
  function update(saved:ProjectRevision){setProject(current=>current?.projectId===saved.projectId?saved:current);setNotice(`Version ${saved.ordinal} saved.`);}
  function openResult(run:ProjectRun){if(!project)return;setTab(resultTab(project,run.operation));setMobilePane("result");}
  const query=historyQuery.trim().toLocaleLowerCase();
  const history=[...projects.filter(item=>!query||item.title.toLocaleLowerCase().includes(query)).map(item=>({kind:"project" as const,id:item.projectId,title:item.title,date:item.updatedAt,active:!legacyOpen&&selected===item.projectId})),
    ...conversations.map(item=>({kind:"coin" as const,id:item.id,title:item.title,date:item.updatedAt,active:legacyOpen&&legacyId===item.id}))]
    .sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)||a.title.localeCompare(b.title));
  const latest=runs[0],currentStatus=active?workStatus(active,progress[active.runId]):latest?workStatus(latest,progress[latest.runId]):notice;

  return <div className={styles.workspace} ref={root}>
    <header className={styles.toolbar}>
      <button className={styles.historyToggle} type="button" aria-expanded={historyOpen} aria-controls="project-history" onClick={()=>setHistoryOpen(!historyOpen)}><Menu size={16} aria-hidden="true"/>Your work</button>
      <h2>{legacyOpen?conversations.find(item=>item.id===legacyId)?.title??"Coin chat":project?.document.title??"New project"}</h2>
      <label className={styles.srOnly} htmlFor="platform-project">Your projects</label><select className={styles.projectSelect} id="platform-project" value={selected??""} disabled={!ready||busy||locked} onChange={event=>void choose(event.target.value)}><option value="" disabled>Choose a project</option>{projects.map(item=><option key={item.projectId} value={item.projectId}>{item.title}</option>)}</select>
      <button className={styles.end} type="button" disabled={!ready||busy||locked} onClick={()=>void create()}><Plus size={16} aria-hidden="true"/>New project</button>
    </header>
    <div className={styles.workArea} data-history-open={historyOpen}>
      <aside id="project-history" className={styles.history} data-open={historyOpen} aria-label="Projects and coin chats">
        <div className={styles.historyHeading}><h2>Your work</h2><button className={styles.historyClose} type="button" aria-label="Close work history" onClick={()=>{setHistoryOpen(false);focusContent();}}><X size={16}/></button></div>
        <label className={styles.historySearch}><Search size={15} aria-hidden="true"/><span className={styles.srOnly}>Search projects and coin chats</span><input type="search" value={historyQuery} maxLength={80} placeholder="Search your work" onChange={event=>setHistoryQuery(event.target.value)}/></label>
        <nav aria-label="Work history" className={styles.historyList}>{history.map(item=><button type="button" key={`${item.kind}:${item.id}`} className={styles.historyItem} aria-current={item.active?"page":undefined} disabled={busy||locked} onClick={()=>void(item.kind==="project"?choose(item.id):chooseLegacy(item.id))}><span>{item.title}</span><small>{item.kind==="coin"?"Coin chat":"Project"} · {new Date(item.date).toLocaleDateString()}</small></button>)}</nav>
        {!history.length&&!historyLoading&&<p className={styles.muted}>{query?"No matching work.":"Your projects and coin chats will appear here."}</p>}
        {historyLoading&&<p role="status" className={styles.muted}>Loading saved work…</p>}
        {historyError&&<p role="alert" className={styles.historyError}>{historyError}<button type="button" onClick={()=>void loadHistory()}>Retry</button></p>}
        {historyCursor&&<button type="button" disabled={historyLoading} onClick={()=>void loadHistory(historyCursor)}>Load older coin chats</button>}
      </aside>
      <div ref={main} tabIndex={-1} className={styles.workContent}>
        {error&&<div role="alert" className={styles.error}>{error}<div className={styles.row}>{hasPending&&<button type="button" disabled={busy||Boolean(active)} onClick={()=>void submit(pendingMessage.current)}>Retry saved message</button>}<button type="button" onClick={()=>void(scope?runTask(()=>refresh()):bootstrap())}>Reload saved state</button></div></div>}
        {legacyOpen?<div className={styles.legacyWorkspace}>{legacyContent}</div>:<>
          <div className={styles.statusBar}><p className={styles.notice} role="status"><span className={styles.workDot} data-active={Boolean(active)} aria-hidden="true"/>{currentStatus||"Ready when you are"}</p>{active&&<WorkTimer startedAt={active.createdAt}/>}</div>
          {project&&<div className={styles.mobileSwitcher} aria-label="Project view"><button type="button" aria-pressed={mobilePane==="chat"} onClick={()=>setMobilePane("chat")}>Chat</button><button type="button" aria-pressed={mobilePane==="result"} onClick={()=>setMobilePane("result")}>Result</button></div>}
          <div className={styles.layout} data-empty={!selected}>
            <section className={styles.chat} data-active={mobilePane==="chat"} aria-label="Project chat">
              <div className={styles.transcript} ref={transcript} onScroll={event=>{const element=event.currentTarget;follow.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;}}>
                {!runs.length?<ProjectStart disabled={busy} onChoose={prompt=>{setInput(prompt);setOperation("build");composer.current?.focus();}}/>:
                runs.slice().reverse().map(run=><article className={styles.message} key={run.runId}><div className={styles.user}>{run.prompt}</div><div className={styles.reply}>{run.summary?<MessageContent content={summaryText(run)} assistant/>:<div className={styles.working}><span className={styles.workDot} data-active={isActiveRun(run.status)} aria-hidden="true"/><p>{workExplanation(progress[run.runId])??workStatus(run,progress[run.runId])}</p></div>}</div>
                  {completedWork(progress[run.runId]).length>0&&<ul className={styles.completedWork}>{completedWork(progress[run.runId]).map(text=><li key={text}><CheckCheck size={14} aria-hidden="true"/>{text}</li>)}</ul>}
                  <div className={styles.runMeta}><span>{workStatus(run,progress[run.runId])}</span>{isActiveRun(run.status)&&<button type="button" disabled={busy} onClick={()=>void runTask(async()=>{await api(`/runs?projectId=${selected}&runId=${run.runId}`,{method:"DELETE"});await refresh();})}><Square size={12} aria-hidden="true"/>Stop</button>}{run.status==="retryable"&&<button type="button" disabled={busy} onClick={()=>void runTask(async()=>{await api("/runs",{method:"PATCH",body:{projectId:selected,runId:run.runId,expectedCursor:run.cursor}});await refresh();})}>Resume saved work</button>}{run.status==="succeeded"&&(run.operation!=="plan"||completedWork(progress[run.runId]).length>0)&&<button type="button" onClick={()=>openResult(run)}>View result</button>}{["failed","waiting_user","cancelled"].includes(run.status)&&!active&&run===latest&&<button type="button" disabled={busy||locked} onClick={()=>{setOperation(run.operation);setInput("Continue from the saved project. Finish the original request, preserve all requirements and use the saved results to address the remaining step.");setMobilePane("chat");composer.current?.focus();}}>Continue from here</button>}</div>
                  <details className={styles.runDetails}><summary>Run details</summary><p>{run.usedUnits} of {run.reservedUnits} work units · {run.cursor} saved steps</p>{progress[run.runId]?.events.map(step=><p key={step.cursor}>{step.cursor}. {step.capabilityId}{step.ok===false?" · needs attention":""}{step.message?` · ${step.message}`:""}</p>)}</details>
                </article>)}
              </div>
              <form className={styles.composer} onSubmit={event=>{event.preventDefault();void submit();}}>
                <label htmlFor="platform-prompt">{selected?"Message your project":"Describe your idea"}</label><textarea ref={composer} id="platform-prompt" value={input} maxLength={24000} disabled={!ready||busy} aria-invalid={Boolean(error&&containsInlineCredential(input))} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}}} placeholder="Tell me what you want to build or change…"/>
                <footer><label><span className={styles.srOnly}>Work mode</span><select aria-label="Work mode" value={operation} disabled={busy||Boolean(active)||hasPending} onChange={event=>setOperation(event.target.value as ProjectRun["operation"])}><option value="build">Build</option><option value="plan">Discuss</option><option value="test">Check</option><option value="deploy">Publish</option></select></label><button type="submit" aria-label="Send" className={styles.primary} disabled={!ready||busy||Boolean(active)||Boolean(syncingRun)||locked||!input.trim()}><ArrowUp size={16} aria-hidden="true"/>{busy?"Sending…":"Send"}</button></footer>
                {operation==="build"&&<label className={styles.previewPreference}><input type="checkbox" checked={previewAfterBuild} disabled={busy||Boolean(active)||hasPending} onChange={event=>setPreviewAfterBuild(event.target.checked)}/>Preview apps after successful checks</label>}
                <small>{operation==="plan"?"Discussion keeps your source unchanged. ":operation==="deploy"?"Publishing uses the saved checks for this version. ":""}{dirty?"Save or discard your file edit to continue.":active?"Your progress is saved. You can leave and return later.":"Enter to send · Shift + Enter for a new line"}</small>
              </form>
            </section>
            {selected&&<section className={styles.inspector} data-active={mobilePane==="result"} aria-label="Project workspace"><div className={styles.tabs} role="tablist" aria-label="Project tools">{tabs.map((item,index)=><button key={item.id} id={`platform-tab-${item.id}`} role="tab" type="button" aria-selected={tab===item.id} aria-controls={`platform-panel-${item.id}`} tabIndex={tab===item.id?0:-1} onClick={()=>setTab(item.id)} onKeyDown={event=>{const delta=event.key==="ArrowRight"?1:event.key==="ArrowLeft"?-1:0;if(delta||event.key==="Home"||event.key==="End"){event.preventDefault();const next=tabs[event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+delta+tabs.length)%tabs.length];setTab(next.id);document.getElementById(`platform-tab-${next.id}`)?.focus();}}}><item.icon size={15} aria-hidden="true"/>{item.label}</button>)}</div>
              {!project?<p className={styles.panel} role="status">Opening your project…</p>:<>
                <div id="platform-panel-project" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-project" hidden={tab!=="project"}><ProjectOverview project={project} disabled={busy||Boolean(active)||locked} onFiles={()=>setTab("files")} onResult={()=>setTab("runtime")} onBuild={()=>{setOperation("build");setInput("Build the complete saved plan and run its relevant checks. Preserve every saved requirement.");setMobilePane("chat");requestAnimationFrame(()=>composer.current?.focus());}} onEdit={(id,text)=>{setOperation("build");setInput(`Change requirement ${id}: ${text}\n`);setMobilePane("chat");requestAnimationFrame(()=>composer.current?.focus());}}/><button className={styles.refreshState} type="button" disabled={busy} onClick={()=>void runTask(()=>refresh())}><RefreshCw size={14} aria-hidden="true"/>Refresh saved state</button></div>
                <div id="platform-panel-files" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-files" hidden={tab!=="files"}><ProjectFiles key={project.projectId} project={project} api={api} onProject={update} onDirty={setDirty} disabled={launchLocked}/></div>
                <div id="platform-panel-connections" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-connections" hidden={tab!=="connections"}>{tab==="connections"&&<Suspense fallback={<p role="status">Opening connections…</p>}><ProjectConnections key={project.projectId} projectId={project.projectId} api={api}/></Suspense>}</div>
                <div id="platform-panel-runtime" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-runtime" hidden={tab!=="runtime"}>{tab==="runtime"&&<Suspense fallback={<p role="status">Opening results…</p>}><ProjectRuntime key={project.projectId} project={project} api={api} onPrompt={text=>{setOperation("build");setInput(text);setMobilePane("chat");composer.current?.focus();}} account={account} headers={scopedHeaders} generalLaunchEnabled={generalLaunchEnabled} onLaunchLocked={setLaunchLocked} autoPreviewRunId={resultIntent?.projectId===project.projectId&&resultIntent.preview&&runs.some(run=>run.runId===resultIntent.runId&&run.status==="succeeded")?resultIntent.runId:undefined}/></Suspense>}</div>
                <div id="platform-panel-repository" className={styles.panel} role="tabpanel" aria-labelledby="platform-tab-repository" hidden={tab!=="repository"}>{tab==="repository"&&<Suspense fallback={<p role="status">Opening import and export…</p>}><ProjectRepository key={project.projectId} project={project} api={api} onProject={update}/></Suspense>}</div>
              </>}
            </section>}
          </div>
        </>}
      </div>
    </div>
  </div>;
}

function WorkTimer({startedAt}:{startedAt:string}){
  const [seconds,setSeconds]=useState(0);
  useEffect(()=>{const update=()=>setSeconds(Math.max(0,Math.floor((Date.now()-Date.parse(startedAt))/1000)));update();const timer=setInterval(update,1000);return()=>clearInterval(timer);},[startedAt]);
  return <span className={styles.elapsed} aria-hidden="true">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,"0")}</span>;
}
