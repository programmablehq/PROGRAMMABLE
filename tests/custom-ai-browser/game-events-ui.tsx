import {useState} from "react";
import {createRoot} from "react-dom/client";
import {ProjectEvents} from "../../components/custom-ai/platform/events";
import type {PlatformAPI} from "../../components/custom-ai/platform/types";
import styles from "../../components/custom-ai/platform/workspace.module.css";
const revision=`sha256:${"44".repeat(32)}`,id=`0x${"33".repeat(32)}`;
const initial={id,revisionId:revision,gameId:"maze",chainId:4663,target:`0x${"55".repeat(20)}`,runtimeHash:`0x${"66".repeat(32)}`,issuer:`0x${"11".repeat(20)}`,maxAge:300,maximumScore:"1"};
declare global {interface Window{__gameFixture:{calls:Record<string,unknown>[];delay:number;fail:boolean}}}
window.__gameFixture={calls:[],delay:0,fail:false};
function Fixture(){
 const [current,setCurrent]=useState(revision),[prompt,setPrompt]=useState("");
 const api:PlatformAPI=async<T,>(path:string,options?:Parameters<PlatformAPI>[1])=>{
  const body=options?.body as Record<string,unknown>|undefined;window.__gameFixture.calls.push(body??{read:path});
  if(window.__gameFixture.delay)await new Promise(r=>setTimeout(r,window.__gameFixture.delay));
  if(window.__gameFixture.fail)throw Error("The deployed receiver does not match its reviewed code.");
  if(!body)return {bindings:[{definition:initial,version:"version-one",active:true},{definition:{...initial,id:`0x${"aa".repeat(32)}`,gameId:"other-game"},version:"version-two",active:true}],wallets:[],events:[]} as T;
  if(body.action==="inspect")return {binding:{...initial,...body.binding as object,revisionId:current},verified:true,registered:false} as T;
  if(body.action==="bind")return {binding:body.binding,version:"saved"} as T;
  if(body.action==="record")return {id:(body.event as Record<string,unknown>).eventId,state:"received"} as T;
  if(body.action==="reconcile")return {id:body.eventId,state:"confirmed"} as T;
  return {state:"signed"} as T;
 };
 return <main className={styles.workspace} style={{maxWidth:760,margin:"auto"}}><button onClick={()=>setCurrent(`sha256:${"77".repeat(32)}`)}>Change project revision</button><ProjectEvents key={current} projectId="11111111-1111-4111-8111-111111111111" revisionId={current} api={api} onPrompt={setPrompt}/><p role="status">{prompt}</p></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
