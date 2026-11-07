"use client";
import {useEffect,useState} from "react";
import {Link2,Unplug} from "lucide-react";
import type {Connection,ConnectionManifest,PlatformAPI} from "./types";
import styles from "./workspace.module.css";

export function ProjectConnections({projectId,api}:{projectId:string;api:PlatformAPI}){
  const [connections,setConnections]=useState<Connection[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [kind,setKind]=useState("http"),[name,setName]=useState(""),[url,setURL]=useState(""),[path,setPath]=useState("/"),[method,setMethod]=useState("GET");
  const [auth,setAuth]=useState("none"),[secret,setSecret]=useState(""),[header,setHeader]=useState("Authorization"),[clientId,setClientId]=useState(""),[authorizeURL,setAuthorizeURL]=useState(""),[tokenURL,setTokenURL]=useState(""),[scopes,setScopes]=useState("");
  const [schema,setSchema]=useState(""),[review,setReview]=useState<ConnectionManifest>(),[allowed,setAllowed]=useState<string[]>([]),[id,setId]=useState<string>(),[version,setVersion]=useState<string>();
  const [notice,setNotice]=useState("");
  async function load(signal?:AbortSignal){setConnections((await api<{connections:Connection[]}>(`/connections?projectId=${projectId}`,{signal})).connections);}
  useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>load(controller.signal)).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});return()=>controller.abort();},[api,projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function task(work:()=>Promise<void>){if(busy)return;setBusy(true);setError("");try{await work();}catch(cause){setError(cause instanceof Error?cause.message:"The connection could not be updated.");}finally{setBusy(false);}}
  async function prepare(){
    const authentication:ConnectionManifest["auth"]=auth==="oauth2"?{kind:"oauth2",authorizeUrl:authorizeURL,tokenUrl:tokenURL,clientId,scopes:scopes.split(/[ ,]+/).filter(Boolean)}:auth==="api-key"?{kind:"api-key",header,...(header.toLowerCase()==="authorization"?{prefix:"Bearer "}:{})}:{kind:"none"};
    let manifest:ConnectionManifest;
    if(kind==="openapi")manifest=await api<ConnectionManifest>("/connections",{body:{action:"openapi",name,server:url||undefined,auth:authentication,document:JSON.parse(schema)}});
    else manifest={name,kind:kind==="mcp"?"mcp":"http",baseUrl:url,auth:authentication,...(kind==="mcp"?{protocol:"2026-07-28" as const}:{}),actions:kind==="mcp"?[]:[{id:"request",description:`${method} ${path}`,method:method as "GET"|"POST",path,effect:method==="GET"?"read":"write",inputSchema:{type:"object"},outputSchema:{},...(method!=="GET"?{idempotencyHeader:"Idempotency-Key"}:{})}]};
    setReview(manifest);setAllowed(manifest.actions.filter(action=>action.effect==="read").map(action=>action.id));setId(crypto.randomUUID());setVersion(undefined);
  }
  async function save(){
    if(!review||!id)return;
    const result=await api<{connection:Connection}>("/connections",{body:{action:"save",projectId,connectionId:id,manifest:review,allowedActions:allowed,...(version?{expectedVersion:version}:{}),...(secret?{secret:auth==="oauth2"?{clientSecret:secret}:{apiKey:secret}}:{})}});
    setSecret("");setVersion(result.connection.version);await load();setNotice("Connection saved. Only the selected actions are available to this project.");
    if(review.auth.kind==="oauth2"){
      const oauth=await api<{url:string;authorizationUrl?:string}>("/connections",{body:{action:"oauth-start",projectId,connectionId:id}});
      const target=oauth.authorizationUrl??oauth.url,parsed=new URL(target);if(parsed.protocol!=="https:")throw Error("The authorization link must use HTTPS.");window.location.assign(parsed.href);
    }else {setReview(undefined);setId(undefined);}
  }
  return <div className={styles.stack}><h2>Connections</h2><p className={styles.muted}>Connect a service to this project and choose what it can do. Keep API keys in the private field below.</p>
    <p className={styles.notice} role="status">{notice}</p>{error&&<p role="alert" className={styles.error}>{error}</p>}
    {connections.map(connection=><article className={styles.card} key={connection.id}><div className={styles.row}><Link2 size={16} aria-hidden="true"/><h3>{connection.manifest.name}</h3><small>{connection.state}</small></div><p>{connection.manifest.baseUrl}</p><p>{connection.allowedActions.length} allowed actions</p><div className={styles.row}>
      <button type="button" disabled={busy||connection.state!=="active"} onClick={()=>{setReview(connection.manifest);setAllowed(connection.allowedActions);setId(connection.id);setVersion(connection.version);setAuth(connection.manifest.auth.kind);}}>Review permissions</button>
      {connection.manifest.kind==="mcp"&&<button type="button" disabled={busy||connection.state!=="active"} onClick={()=>void task(async()=>{const result=await api<{connection:Connection}>("/connections",{body:{action:"mcp-discover",projectId,connectionId:connection.id}});setReview(result.connection.manifest);setAllowed([]);setId(connection.id);setVersion(result.connection.version);await load();})}>Discover tools</button>}
      <button type="button" disabled={busy||connection.state!=="active"} onClick={()=>void task(async()=>{await api(`/connections?projectId=${projectId}&connectionId=${connection.id}`,{method:"DELETE"});await load();setNotice("Connection revoked.");})}><Unplug size={15} aria-hidden="true"/>Revoke</button></div></article>)}
    {review?<form className={styles.card} onSubmit={event=>{event.preventDefault();void task(save);}}><h3>Review {review.name}</h3><p>{review.baseUrl}</p><p>Select each action this project may use. Write actions can change data in the connected service.</p>{review.actions.map(action=><label key={action.id}><input type="checkbox" checked={allowed.includes(action.id)} onChange={event=>setAllowed(current=>event.target.checked?[...current,action.id]:current.filter(id=>id!==action.id))}/><span>{action.description||action.id} · {action.effect}</span></label>)}{!review.actions.length&&<p>Save this MCP connection, then discover and review its tools.</p>}<div className={styles.row}><button type="submit" className={styles.primary} disabled={busy}>Save connection</button><button type="button" onClick={()=>{setReview(undefined);setSecret("");}}>Cancel</button></div></form>:
    <details><summary>Add a connection</summary><form className={styles.stack} onSubmit={event=>{event.preventDefault();void task(prepare);}}>
      <label>Connection name<input required value={name} onChange={event=>setName(event.target.value)} maxLength={100} autoComplete="off"/></label>
      <label>Connection type<select aria-label="Connection type" value={kind} onChange={event=>setKind(event.target.value)}><option value="http">HTTP API</option><option value="openapi">OpenAPI document</option><option value="mcp">MCP tools</option></select></label>
      <label>{kind==="mcp"?"MCP endpoint":"API base URL"}<input type="url" required={kind!=="openapi"} placeholder="https://api.example.com" value={url} onChange={event=>setURL(event.target.value)} autoComplete="off"/></label>
      {kind==="http"&&<><label>Action path<input value={path} onChange={event=>setPath(event.target.value)} required/></label><label>Action<select aria-label="Action" value={method} onChange={event=>setMethod(event.target.value)}><option value="GET">Read · GET</option><option value="POST">Write · POST</option></select></label></>}
      {kind==="openapi"&&<label>OpenAPI JSON<textarea required rows={8} spellCheck={false} value={schema} onChange={event=>setSchema(event.target.value)}/></label>}
      <label>Authentication<select aria-label="Authentication" value={auth} onChange={event=>setAuth(event.target.value)}><option value="none">Public API</option><option value="api-key">API key</option><option value="oauth2">OAuth 2</option></select></label>
      {auth==="api-key"&&<label>API key header<input required value={header} onChange={event=>setHeader(event.target.value)}/></label>}
      {auth==="oauth2"&&<><label>Authorize URL<input type="url" required value={authorizeURL} onChange={event=>setAuthorizeURL(event.target.value)}/></label><label>Token URL<input type="url" required value={tokenURL} onChange={event=>setTokenURL(event.target.value)}/></label><label>Client ID<input required value={clientId} onChange={event=>setClientId(event.target.value)}/></label><label>Scopes<input value={scopes} onChange={event=>setScopes(event.target.value)} placeholder="read write"/></label></>}
      {auth!=="none"&&<label>{auth==="api-key"?"Private API key":"Private client secret (if required)"}<input type="password" aria-label={auth==="api-key"?"Private API key":"Private client secret"} required={auth==="api-key"} value={secret} onChange={event=>setSecret(event.target.value)} autoComplete="new-password"/><small>Stored encrypted for this project. It is not sent to the chat model.</small></label>}
      <button type="submit" disabled={busy}>Review connection</button>
    </form></details>}
  </div>;
}
