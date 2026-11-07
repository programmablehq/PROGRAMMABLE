"use client";
import {useEffect,useRef,useState} from "react";
import type {Connection,ConnectionManifest,PlatformAPI,ProjectRevision} from "./types";
import type {RepositoryDeliveryInput} from "@/lib/custom-ai/platform/repository-delivery.server";
import styles from "./workspace.module.css";
type Delivery={id:string;repository:string;branch:string;state:string;url:string|null;request:RepositoryDeliveryInput|null};
export function ProjectRepository({project,api,onProject}:{project:ProjectRevision;api:PlatformAPI;onProject:(project:ProjectRevision)=>void}){
  const [repository,setRepository]=useState(""),[ref,setRef]=useState(""),[secret,setSecret]=useState(""),[write,setWrite]=useState(false);
  const [connections,setConnections]=useState<Connection[]>([]),[connectionId,setConnectionId]=useState(""),[deliveries,setDeliveries]=useState<Delivery[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const pending=useRef<RepositoryDeliveryInput|undefined>(undefined);
  const importKey=useRef<string|undefined>(undefined);
  const projectId=project.projectId;
  async function load(signal?:AbortSignal){const [connections,deliveries]=await Promise.all([api<{connections:Connection[]}>(`/connections?projectId=${projectId}`,{signal}),api<{deliveries:Delivery[]}>(`/repositories?projectId=${projectId}`,{signal})]);setConnections(connections.connections.filter(connection=>connection.state==="active"&&connection.manifest.baseUrl==="https://api.github.com"));setDeliveries(deliveries.deliveries);}
  useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>load(controller.signal)).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});return()=>controller.abort();},[api,projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function task(work:()=>Promise<void>){if(busy)return;setBusy(true);setError("");try{await work();}catch(cause){setError(cause instanceof Error?cause.message:"The repository request could not finish.");}finally{setBusy(false);}}
  async function connect(){
    const {manifest}=await api<{manifest:ConnectionManifest}>("/repositories",{body:{projectId,action:"connection-template",request:{repository}}});
    const {connection}=await api<{connection:Connection}>("/connections",{body:{action:"save",projectId,connectionId:crypto.randomUUID(),manifest,secret:{apiKey:secret},allowedActions:manifest.actions.filter(action=>write||action.effect==="read").map(action=>action.id)}});
    setConnectionId(connection.id);setSecret("");await load();setNotice("GitHub connected to this project.");
  }
  const selected=connections.find(connection=>connection.id===connectionId);
  async function importRepository(){importKey.current??=crypto.randomUUID();const result=await api<{project:ProjectRevision}>("/repositories",{body:{action:"import-github",projectId,request:{repository,...(ref?{ref}:{}),idempotencyKey:importKey.current,...(selected?{connectionId:selected.id,connectionVersion:selected.version}:{})}}});onProject(result.project);importKey.current=undefined;setNotice("Repository imported at its verified commit.");}
  async function deliver(request?:RepositoryDeliveryInput){
    if(!request){if(!selected)throw Error("Connect GitHub and select a connection with write permission first.");pending.current??={repository,revisionId:project.revisionId,idempotencyKey:crypto.randomUUID(),connectionId:selected.id,connectionVersion:selected.version,pullRequest:true,...(ref?{baseRef:ref}:{})};request=pending.current;}
    const result=await api<{delivery:Delivery}>("/repositories",{body:{action:"deliver",projectId,request}});if(result.delivery.state==="complete")pending.current=undefined;await load();setNotice(result.delivery.state==="complete"?"Draft pull request created.":"The export is saved. Use Resume to check its result.");
  }
  return <div className={styles.stack}><h2>Import & export</h2><p className={styles.muted}>Import into an empty project. Export creates a separate branch and draft pull request.</p><p role="status" className={styles.notice}>{notice}</p>{error&&<p className={styles.error} role="alert">{error}</p>}
    <label>GitHub repository<input placeholder="owner/repository" value={repository} onChange={event=>{setRepository(event.target.value);pending.current=undefined;importKey.current=undefined;}} required/></label><label>Branch or commit (optional)<input placeholder="Default branch" value={ref} onChange={event=>{setRef(event.target.value);pending.current=undefined;importKey.current=undefined;}}/></label>
    <label>GitHub connection<select value={connectionId} onChange={event=>{setConnectionId(event.target.value);pending.current=undefined;}}><option value="">Public read without an account</option>{connections.map(connection=><option key={connection.id} value={connection.id}>{connection.manifest.name}</option>)}</select></label>
    <details><summary>Connect a private repository</summary><form className={styles.stack} onSubmit={event=>{event.preventDefault();void task(connect);}}><label>Private GitHub access token<input type="password" value={secret} onChange={event=>setSecret(event.target.value)} autoComplete="new-password" required/></label><label><input type="checkbox" checked={write} onChange={event=>setWrite(event.target.checked)}/>Allow creating a new branch and draft pull request in this repository</label><button type="submit" disabled={busy||!repository}>Save GitHub connection</button></form></details>
    <div className={styles.row}><button type="button" disabled={busy||!repository||Boolean(Object.keys(project.document.files).length)} onClick={()=>void task(importRepository)}>Import repository</button><button type="button" disabled={busy||!repository||!Object.keys(project.document.files).length} onClick={()=>void task(()=>deliver())}>Create draft pull request</button></div>
    <label>Import a project export (.json)<input type="file" accept=".json,application/json" disabled={busy||Boolean(Object.keys(project.document.files).length)} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;void task(async()=>{if(file.size>4_100_000)throw Error("Choose a project export under 4 MB.");const result=await api<{project:ProjectRevision}>("/repositories",{body:{action:"import-bundle",projectId,bundle:JSON.parse(await file.text()),idempotencyKey:crypto.randomUUID()}});onProject(result.project);setNotice("Project imported. Run its checks before publishing.");});}}/></label>
    {deliveries.map(delivery=><article className={styles.card} key={delivery.id}><h3>{delivery.repository}</h3><p>{delivery.branch}</p><p>{delivery.state}</p>{delivery.url&&/^https:\/\/github\.com\//.test(delivery.url)&&<a href={delivery.url} target="_blank" rel="noreferrer">Open draft pull request</a>}{delivery.state!=="complete"&&delivery.request&&<button type="button" disabled={busy} onClick={()=>void task(()=>deliver(delivery.request!))}>Resume saved export</button>}</article>)}
  </div>;
}
