"use client";
import {useEffect,useRef,useState} from "react";
import {assertGameBinding,type GameBinding} from "@/lib/custom-ai/platform/game-events";
import type {PlatformAPI} from "./types";
import styles from "./workspace.module.css";

type EventReceipt={id:string;bindingId:string;state:string;player?:string;score?:string;sequence?:string;transactionHash:string|null};
type GameState={bindings:{definition:GameBinding;version:string;active:boolean}[];events:EventReceipt[];wallets?:{bindingId:string;playerIdHash:string;player:string}[]};
const initialFields={gameId:"my-game",chainId:"4663",issuer:"",target:"",maxAge:"300",maximumScore:"1"};
const labels:Record<string,string>={received:"Signed result received",prepared:"Ready for wallet",submitted:"Transaction submitted",confirmed:"Confirmed onchain",failed:"Transaction failed"};

/** The game signs its result; wallet authorization stays with the player. */
export function ProjectEvents({projectId,revisionId,api,onPrompt}:{projectId:string;revisionId:string;api:PlatformAPI;onPrompt:(text:string)=>void}){
 const [fields,setFields]=useState(initialFields),[preview,setPreview]=useState<GameBinding>(),[saved,setSaved]=useState<GameState>({bindings:[],events:[]});
 const [selected,setSelected]=useState(""),[payload,setPayload]=useState<Record<string,unknown>>(),[fileName,setFileName]=useState("");
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[raw,setRaw]=useState(""),[rawAction,setRawAction]=useState("plan");
 const generation=useRef(0),inFlight=useRef(false);
 useEffect(()=>{generation.current++;return()=>{generation.current++;};},[projectId,revisionId]);
 const binding=saved.bindings.find(row=>row.definition.id===selected&&row.active&&row.definition.revisionId===revisionId)?.definition;
 async function task(work:(assertCurrent:()=>void)=>Promise<void>){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setError("");setNotice("");const token=generation.current;
  const assertCurrent=()=>{if(token!==generation.current)throw Error("The project version changed. Review this action again.");};
  try{await work(assertCurrent);}catch(cause){if(token===generation.current)setError(cause instanceof Error?cause.message:"The game action could not finish.");}
  finally{if(token===generation.current){inFlight.current=false;setBusy(false);}}
 }
 async function load(assertCurrent:()=>void){
  const result=await api<GameState>(`/events?projectId=${projectId}`);assertCurrent();
  if(!result||!Array.isArray(result.bindings)||!Array.isArray(result.events))throw Error("The saved game state could not be read.");
  result.bindings.forEach(row=>assertGameBinding(row.definition));setSaved(result);
  setSelected(previous=>result.bindings.some(row=>row.definition.id===previous)?previous:result.bindings.find(row=>row.active&&row.definition.revisionId===revisionId)?.definition.id??"");
 }
 function field(name:keyof typeof initialFields,value:string){setFields(current=>({...current,[name]:value}));setPreview(undefined);setNotice("");}
 async function inspect(assertCurrent:()=>void){
  const result=await api<{binding:GameBinding;verified:boolean}>("/events",{body:{action:"inspect",projectId,binding:{...fields,chainId:Number(fields.chainId),maxAge:Number(fields.maxAge)}}});assertCurrent();
  assertGameBinding(result.binding);if(!result.verified||result.binding.revisionId!==revisionId)throw Error("The receiver review belongs to another project version.");
  setPreview(result.binding);setNotice("Receiver verified. Review and save this binding.");
 }
 async function importFile(file:File|undefined){
  if(!file)return;setError("");setPayload(undefined);setFileName("");const token=generation.current;
  try{
   if(file.size>20000)throw Error("Choose a signed game file smaller than 20 KB.");
   const value:unknown=JSON.parse(await file.text());if(token!==generation.current)return;
   if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Choose a signed game invitation or result file.");
   const data=value as Record<string,unknown>,content=data.event??data.proof??data;
   if(!content||typeof content!=="object"||Array.isArray(content))throw Error("The signed game file is incomplete.");
   if(data.bindingId&&data.bindingId!==selected)throw Error("This file belongs to another game binding.");
   setPayload(content as Record<string,unknown>);setFileName(file.name);
  }catch(cause){if(token===generation.current)setError(cause instanceof Error?cause.message:"The signed file could not be read.");}
 }
 async function record(assertCurrent:()=>void){
  if(!binding||!payload)throw Error("Choose a current saved binding and a signed game file.");
  const link=typeof payload.issuerSignature==="string";
  if(link&&typeof payload.signature!=="string")throw Error("This game invitation still needs your wallet signature.");
  const result=await api<{state:string}>("/events",{body:{action:link?"link-wallet":"record",projectId,bindingId:binding.id,...(link?{proof:payload}:{event:payload})}});assertCurrent();
  await load(assertCurrent);setNotice(link?"Signed wallet agreement saved. Onchain confirmation is still required.":result.state==="confirmed"?"This game result is already confirmed.":"Signed result recorded. Onchain confirmation is still required.");
 }
 return <details className={styles.game}><summary>Game integration</summary><div className={styles.stack}>
  <p className={styles.muted}>Connect a deployed game receiver, import signed results and follow their confirmation.</p>
  <p role="status" className={styles.notice}>{notice}</p>{error&&<p role="alert" className={styles.error}>{error}</p>}
  <section className={styles.card}><div className={styles.row}><h3>Saved game bindings</h3><button type="button" disabled={busy} onClick={()=>void task(load)}>Refresh game state</button></div>
   {saved.bindings.length?<><label>Selected game<select value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setPayload(undefined);setFileName("");}}><option value="">Choose a game</option>{saved.bindings.map(row=><option key={row.definition.id} value={row.definition.id}>{row.definition.gameId}{!row.active?" · revoked":row.definition.revisionId!==revisionId?" · earlier version":""}</option>)}</select></label>
    {binding?<><p>{binding.gameId} · {binding.chainId===1?"Ethereum":"Robinhood Chain"}</p><p>Receiver: <code>{binding.target}</code></p><p>Issuer: <code>{binding.issuer}</code></p><p>Results may be up to {binding.maxAge} seconds old; maximum score {binding.maximumScore}.</p></>:<p>Choose a binding verified for this project version. Earlier versions require a new receiver review.</p>}</>:<p>Refresh to load saved games, or connect a receiver below.</p>}
  </section>
  <details open><summary>Connect a game receiver</summary><form onSubmit={event=>{event.preventDefault();void task(inspect);}}><fieldset disabled={busy} className={styles.stack}>
   <label>Game name<input value={fields.gameId} onChange={event=>field("gameId",event.target.value)} pattern="[a-z0-9-]{1,80}" required autoComplete="off"/></label>
   <label>Game network<select value={fields.chainId} onChange={event=>field("chainId",event.target.value)}><option value="4663">Robinhood Chain</option><option value="1">Ethereum</option></select></label>
   <label>Game issuer address<input value={fields.issuer} onChange={event=>field("issuer",event.target.value)} pattern="0x[0-9a-fA-F]{40}" required autoComplete="off" spellCheck={false}/></label>
   <label>Deployed receiver address<input value={fields.target} onChange={event=>field("target",event.target.value)} pattern="0x[0-9a-fA-F]{40}" required autoComplete="off" spellCheck={false}/></label>
   <label>Maximum result age (seconds)<input type="number" min="1" max="86400" step="1" value={fields.maxAge} onChange={event=>field("maxAge",event.target.value)} required/></label>
   <label>Maximum score per result<input type="number" min="1" max="1000000000" step="1" value={fields.maximumScore} onChange={event=>field("maximumScore",event.target.value)} required/></label>
   <button type="submit" disabled={busy}>Check deployed receiver</button>
  </fieldset></form>{preview&&<div className={styles.card}><p>{preview.gameId} · {preview.chainId===1?"Ethereum":"Robinhood Chain"}</p><p>Verified receiver: <code>{preview.target}</code></p><p>Game binding: <code>{preview.id}</code></p><button type="button" disabled={busy} onClick={()=>void task(async current=>{await api("/events",{body:{action:"bind",projectId,binding:preview}});current();setPreview(undefined);await load(current);setNotice("Binding saved.");})}>Save verified binding</button></div>}
   <button type="button" onClick={()=>onPrompt("Help me connect a game to this project. Use the canonical signed event receiver, obtain this project's exact event.identity, and explain the required public issuer and receiver addresses. Keep the private issuer key in the game service.")}>Set up the game in chat</button>
  </details>
  <section className={styles.card}><h3>Signed game results</h3><p>Import the invitation or result file supplied by your game. Its signatures are checked before it is saved.</p>
   <label>Signed game file<input type="file" accept="application/json,.json" disabled={busy||!binding} onChange={event=>void importFile(event.target.files?.[0])}/></label>
   {payload&&<><p>{fileName} · {typeof payload.issuerSignature==="string"?"Wallet agreement":"Game result"}</p>{payload.score!==undefined&&<p>Score: {String(payload.score)} · sequence {String(payload.sequence)}</p>}<button type="button" disabled={busy||!binding} onClick={()=>void task(record)}>Record signed result</button></>}
   {saved.events.filter(event=>!selected||event.bindingId===selected).map(event=><article className={styles.card} key={event.id}><p>{labels[event.state]??event.state}{event.score!==undefined?` · score ${event.score}`:""}</p><p>Event: <code>{event.id}</code></p>{event.player&&<p>Player: <code>{event.player}</code></p>}{event.transactionHash&&<p>Transaction: <code>{event.transactionHash}</code></p>}{event.transactionHash&&<button type="button" disabled={busy} onClick={()=>void task(async current=>{await api("/events",{body:{action:"reconcile",projectId,bindingId:event.bindingId,eventId:event.id}});current();await load(current);setNotice("Transaction state refreshed from the network.");})}>Check transaction</button>}</article>)}
  </section>
  <details><summary>Advanced game requests</summary><form className={styles.stack} onSubmit={event=>{event.preventDefault();void task(async current=>{await api("/events",{body:{...JSON.parse(raw),action:rawAction,projectId}});current();await load(current);setNotice("Game request saved. Check its current state above.");});}}>
   <label>Game action<select value={rawAction} onChange={event=>setRawAction(event.target.value)}>{["plan","bind","link-wallet","record","prepare-wallet","prepare","submitted","reconcile","revoke"].map(action=><option key={action}>{action}</option>)}</select></label>
   <label>Request payload (JSON)<textarea rows={6} value={raw} onChange={event=>setRaw(event.target.value)} spellCheck={false} required/></label><button type="submit" disabled={busy}>Review advanced request</button>
  </form></details>
 </div></details>;
}
