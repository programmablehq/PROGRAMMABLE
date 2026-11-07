"use client";
import {useState} from "react";
import {Download,File,Save,Undo2} from "lucide-react";
import type {PlatformAPI,ProjectRevision,RevisionItem} from "./types";
import {textHash} from "./api";
import styles from "./workspace.module.css";

type Edit={path:string;text:string;original:string;revision:string};
export function ProjectFiles({project,api,onProject,onDirty}:{project:ProjectRevision;api:PlatformAPI;onProject:(project:ProjectRevision)=>void;onDirty:(dirty:boolean)=>void}){
  const [edit,setEdit]=useState<Edit>(),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [newPath,setNewPath]=useState(""),[history,setHistory]=useState<RevisionItem[]>([]),[compared,setCompared]=useState<ProjectRevision>();
  const dirty=Boolean(edit&&(edit.text!==edit.original||!Object.hasOwn(project.document.files,edit.path)));
  function change(next:Edit|undefined){setEdit(next);onDirty(Boolean(next&&(next.text!==next.original||!Object.hasOwn(project.document.files,next.path))));}
  function open(path:string){if(dirty){setError("Save or discard this edit before opening another file.");return;}const file=project.document.files[path];if(typeof file!=="string"){download(path,file.content,file.mediaType,true);return;}change({path,text:file,original:file,revision:project.revisionId});setError("");}
  async function save(remove=false){
    if(!edit||busy)return;setBusy(true);setError("");
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
  return <div className={styles.stack}>
    <div className={styles.row}><h2>Project files</h2><small>Version {project.ordinal}</small><button type="button" disabled={busy} onClick={()=>void task(async()=>{const bundle=await api("/export?"+new URLSearchParams({projectId:project.projectId,revisionId:project.revisionId}));download(`${project.document.title}.json`,JSON.stringify(bundle,null,2),"application/json");})}><Download size={16} aria-hidden="true"/>Export project</button></div>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.fileList} aria-label="Project files">{Object.entries(project.document.files).sort(([a],[b])=>a.localeCompare(b)).map(([path,file])=><button type="button" key={path} aria-current={edit?.path===path} onClick={()=>open(path)} disabled={busy}><File size={15} aria-hidden="true"/>{path}{typeof file!=="string"?" · download":""}</button>)}</div>
    {!Object.keys(project.document.files).length&&<p className={styles.muted}>Describe your project in the chat to create its first files.</p>}
    <form className={styles.row} onSubmit={event=>{event.preventDefault();if(dirty){setError("Save or discard this edit first.");return;}if(Object.hasOwn(project.document.files,newPath)){open(newPath);return;}change({path:newPath,text:"",original:"",revision:project.revisionId});setNewPath("");}}><label>New file path<input value={newPath} onChange={event=>setNewPath(event.target.value)} required maxLength={512} placeholder="src/example.js"/></label><button type="submit" disabled={busy}>Add file</button></form>
    {edit&&<div className={styles.stack}><label>{edit.path}<textarea className={styles.source} value={edit.text} spellCheck={false} onChange={event=>change({...edit,text:event.target.value})}/></label><div className={styles.row}><button type="button" className={styles.primary} disabled={busy||!dirty} onClick={()=>void save()}><Save size={16} aria-hidden="true"/>Save file</button><button type="button" disabled={busy} onClick={()=>change(undefined)}>Discard edit</button>{Object.hasOwn(project.document.files,edit.path)&&<button type="button" disabled={busy||dirty} onClick={()=>void save(true)}>Delete file</button>}{dirty&&<small>Unsaved edit · project switching is paused.</small>}</div></div>}
    <details onToggle={event=>{if(event.currentTarget.open&&!history.length)void task(async()=>{setHistory((await api<{revisions:RevisionItem[]}>(`/projects?projectId=${project.projectId}&history=true`)).revisions);});}}><summary>History and changes</summary><div className={styles.stack}>{history.map(revision=><div className={styles.row} key={revision.revisionId}><span>Version {revision.ordinal} · {new Date(revision.createdAt).toLocaleString()}</span><button type="button" disabled={busy} onClick={()=>void task(async()=>{setCompared((await api<{project:ProjectRevision}>(`/projects?projectId=${project.projectId}&revisionId=${encodeURIComponent(revision.revisionId)}`)).project);})}>Compare</button>{revision.revisionId!==project.revisionId&&<button type="button" disabled={busy||dirty} onClick={()=>void task(async()=>{const result=await api<{project:ProjectRevision}>("/restore",{body:{projectId:project.projectId,revisionId:revision.revisionId,expectedRevisionId:project.revisionId,idempotencyKey:crypto.randomUUID()}});onProject(result.project);change(undefined);setHistory([]);})}><Undo2 size={14} aria-hidden="true"/>Restore as new version</button>}</div>)}</div></details>
    {compared&&<section className={styles.stack} aria-label="Version comparison"><h3>Version {compared.ordinal} → {project.ordinal}</h3>{[...new Set([...Object.keys(compared.document.files),...Object.keys(project.document.files)])].filter(path=>JSON.stringify(compared.document.files[path])!==JSON.stringify(project.document.files[path])).map(path=><details key={path}><summary>{path} · {!Object.hasOwn(compared.document.files,path)?"added":!Object.hasOwn(project.document.files,path)?"deleted":"changed"}</summary><div className={styles.diff}><pre aria-label={`${path} before`}>{typeof compared.document.files[path]==="string"?compared.document.files[path]:"Binary or absent"}</pre><pre aria-label={`${path} after`}>{typeof project.document.files[path]==="string"?project.document.files[path]:"Binary or absent"}</pre></div></details>)}</section>}
  </div>;
}
