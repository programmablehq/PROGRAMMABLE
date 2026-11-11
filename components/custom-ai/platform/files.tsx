"use client";
import {useState} from "react";
import {Download,File,Save,Undo2} from "lucide-react";
import type {PlatformAPI,ProjectRevision,RevisionItem} from "./types";
import {textHash} from "./api";
import styles from "./workspace.module.css";

type Edit={path:string;text:string;original:string;revision:string};
export function ProjectFiles({project,api,onProject,onDirty,disabled=false}:{project:ProjectRevision;api:PlatformAPI;onProject:(project:ProjectRevision)=>void;onDirty:(dirty:boolean)=>void;disabled?:boolean}){
  const [edit,setEdit]=useState<Edit>(),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [query,setQuery]=useState("");
  const [newPath,setNewPath]=useState(""),[history,setHistory]=useState<RevisionItem[]>([]),[compared,setCompared]=useState<ProjectRevision>();
  const dirty=Boolean(edit&&(edit.text!==edit.original||!Object.hasOwn(project.document.files,edit.path)));
  function change(next:Edit|undefined){setEdit(next);onDirty(Boolean(next&&(next.text!==next.original||!Object.hasOwn(project.document.files,next.path))));}
  function open(path:string){if(dirty){setError("Save or discard this edit before opening another file.");return;}const file=project.document.files[path];if(typeof file!=="string"){download(path,file.content,file.mediaType,true);return;}change({path,text:file,original:file,revision:project.revisionId});setError("");}
  async function save(remove=false){
    if(!edit||busy||disabled)return;setBusy(true);setError("");
    try{const exists=Object.hasOwn(project.document.files,edit.path),beforeHash=exists?await textHash(edit.original):null;
      const result=await api<{project:ProjectRevision}>("/projects",{method:"PATCH",body:{projectId:project.projectId,expectedRevisionId:edit.revision,idempotencyKey:crypto.randomUUID(),patch:{fileChanges:[remove?{operation:"delete",path:edit.path,beforeHash}:{operation:"write",path:edit.path,beforeHash,content:edit.text}]}}});
      onProject(result.project);change(remove?undefined:{...edit,original:edit.text,revision:result.project.revisionId});
    }catch(cause){setError(cause instanceof Error?cause.message:"The file could not be saved.");}finally{setBusy(false);}
  }
  async function task(work:()=>Promise<void>){setBusy(true);setError("");try{await work();}catch(cause){setError(cause instanceof Error?cause.message:"The source could not be loaded.");}finally{setBusy(false);}}
  function download(name:string,value:string,mediaType="text/plain",base64=false){
    const data=base64?Uint8Array.from(atob(value),c=>c.charCodeAt(0)):value,url=URL.createObjectURL(new Blob([data],{type:mediaType}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download=name.split("/").pop()??"project";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const architecture=project.document.architecture as {contractChecks?:{contracts?:{source?:string}[];constructorChildren?:{source?:string}[]}}|null;
  const declarations=[architecture?.contractChecks?.contracts,architecture?.contractChecks?.constructorChildren].flatMap(items=>Array.isArray(items)?items:[]);
  const entrypoints=new Set(declarations.flatMap(item=>typeof item?.source==="string"?[item.source]:[]));
  const entries=Object.entries(project.document.files).filter(([path])=>!query.trim()||path.toLowerCase().includes(query.trim().toLowerCase())).sort(([a],[b])=>a.localeCompare(b));
  const primary=entries.filter(([path])=>entrypoints.has(path)),other=entries.filter(([path])=>!entrypoints.has(path));
  const fileButtons=(items:typeof entries)=><div className={styles.fileList} aria-label="Project files">{items.map(([path,file])=><button type="button" key={path} aria-current={edit?.path===path} onClick={()=>open(path)} disabled={busy}><File size={15} aria-hidden="true"/>{path}{typeof file!=="string"?" · download":""}</button>)}</div>;
  return <div className={styles.stack}>
    <div className={styles.row}><h2>Project files</h2><small>Version {project.ordinal}</small><button type="button" disabled={busy} onClick={()=>void task(async()=>{const bundle=await api("/export?"+new URLSearchParams({projectId:project.projectId,revisionId:project.revisionId}));download(`${project.document.title}.json`,JSON.stringify(bundle,null,2),"application/json");})}><Download size={16} aria-hidden="true"/>Export project</button></div>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {Object.keys(project.document.files).length>0&&<label>Find a file<input type="search" value={query} maxLength={160} onChange={event=>setQuery(event.target.value)} placeholder="Search file paths"/></label>}
    {primary.length>0&&!query.trim()?<><h3>Source entry points</h3>{fileButtons(primary)}{other.length>0&&<details><summary>Other files ({other.length})</summary>{fileButtons(other)}</details>}</>:fileButtons(entries)}
    {query.trim()&&!entries.length&&<p className={styles.muted}>No matching files</p>}
    {!Object.keys(project.document.files).length&&<p className={styles.muted}>Describe your project in the chat to create its first files.</p>}
    <form className={styles.row} onSubmit={event=>{event.preventDefault();if(dirty){setError("Save or discard this edit first.");return;}if(Object.hasOwn(project.document.files,newPath)){open(newPath);return;}change({path:newPath,text:"",original:"",revision:project.revisionId});setNewPath("");}}><label>New file path<input value={newPath} onChange={event=>setNewPath(event.target.value)} required maxLength={512} placeholder="src/example.js"/></label><button type="submit" disabled={busy}>Add file</button></form>
    {edit&&<div className={styles.stack}><label>{edit.path}<textarea className={styles.source} value={edit.text} readOnly={disabled} spellCheck={false} onChange={event=>change({...edit,text:event.target.value})}/></label><div className={styles.row}><button type="button" className={styles.primary} disabled={busy||disabled||!dirty} onClick={()=>void save()}><Save size={16} aria-hidden="true"/>Save file</button><button type="button" disabled={busy} onClick={()=>change(undefined)}>Discard edit</button>{Object.hasOwn(project.document.files,edit.path)&&<button type="button" disabled={busy||disabled||dirty} onClick={()=>void save(true)}>Delete file</button>}{dirty&&<small>Unsaved edit · project switching is paused.</small>}</div></div>}
    <details onToggle={event=>{if(event.currentTarget.open&&!history.length)void task(async()=>{setHistory((await api<{revisions:RevisionItem[]}>(`/projects?projectId=${project.projectId}&history=true`)).revisions);});}}><summary>History and changes</summary><div className={styles.stack}>{history.map(revision=><div className={styles.row} key={revision.revisionId}><span>Version {revision.ordinal} · {new Date(revision.createdAt).toLocaleString()}</span><button type="button" disabled={busy} onClick={()=>void task(async()=>{setCompared((await api<{project:ProjectRevision}>(`/projects?projectId=${project.projectId}&revisionId=${encodeURIComponent(revision.revisionId)}`)).project);})}>Compare</button>{revision.revisionId!==project.revisionId&&<button type="button" disabled={busy||disabled||dirty} onClick={()=>void task(async()=>{const result=await api<{project:ProjectRevision}>("/restore",{body:{projectId:project.projectId,revisionId:revision.revisionId,expectedRevisionId:project.revisionId,idempotencyKey:crypto.randomUUID()}});onProject(result.project);change(undefined);setHistory([]);})}><Undo2 size={14} aria-hidden="true"/>Restore as new version</button>}</div>)}</div></details>
    {compared&&<section className={styles.stack} aria-label="Version comparison"><h3>Version {compared.ordinal} → {project.ordinal}</h3>{[...new Set([...Object.keys(compared.document.files),...Object.keys(project.document.files)])].filter(path=>JSON.stringify(compared.document.files[path])!==JSON.stringify(project.document.files[path])).map(path=><details key={path}><summary>{path} · {!Object.hasOwn(compared.document.files,path)?"added":!Object.hasOwn(project.document.files,path)?"deleted":"changed"}</summary><div className={styles.diff}><pre aria-label={`${path} before`}>{typeof compared.document.files[path]==="string"?compared.document.files[path]:"Binary or absent"}</pre><pre aria-label={`${path} after`}>{typeof project.document.files[path]==="string"?project.document.files[path]:"Binary or absent"}</pre></div></details>)}</section>}
  </div>;
}
