"use client";
import {useState} from "react";
import type {PlatformAPI} from "./types";
import styles from "./workspace.module.css";
/** Signatures come from the game/player. This panel never creates an issuer key. */
export function ProjectEvents({projectId,api}:{projectId:string;api:PlatformAPI}){
  const [value,setValue]=useState(""),[action,setAction]=useState("plan"),[result,setResult]=useState<unknown>(),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function request(read=false){setBusy(true);setError("");try{setResult(await api(`/events${read?`?projectId=${projectId}`:""}`,read?{}:{body:{...JSON.parse(value),action,projectId}}));}catch(cause){setError(cause instanceof Error?cause.message:"The game action could not finish.");}finally{setBusy(false);}}
  return <details><summary>Game events and wallet binding</summary><div className={styles.stack}><p className={styles.muted}>Review signed game events, register a deployed receiver, and check submitted transactions. Wallet signing stays in the wallet.</p><button type="button" disabled={busy} onClick={()=>void request(true)}>Load game events</button>
    <form className={styles.stack} onSubmit={event=>{event.preventDefault();void request();}}><label>Game action<select value={action} onChange={event=>setAction(event.target.value)}><option value="plan">Preview receiver binding</option><option value="bind">Register verified receiver</option><option value="link-wallet">Save signed wallet link</option><option value="record">Record signed game event</option><option value="prepare-wallet">Prepare wallet link transaction</option><option value="prepare">Prepare event transaction</option><option value="submitted">Record submitted transaction</option><option value="reconcile">Check transaction result</option><option value="revoke">Revoke binding</option></select></label><label>Signed payload or receiver configuration (JSON)<textarea value={value} onChange={event=>setValue(event.target.value)} rows={6} spellCheck={false} required/></label><button type="submit" disabled={busy}>Review game action</button></form>
    {error&&<p role="alert" className={styles.error}>{error}</p>}{result!==undefined&&<pre>{JSON.stringify(result,null,2)}</pre>}</div></details>;
}
