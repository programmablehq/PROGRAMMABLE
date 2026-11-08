import {useState} from "react";
import {createRoot} from "react-dom/client";
import {ProjectEvents} from "../../components/custom-ai/platform/events";
import type {PlatformAPI} from "../../components/custom-ai/platform/types";
import styles from "../../components/custom-ai/platform/workspace.module.css";
import type {GameWalletAdapter} from "../../lib/custom-ai/platform/game-wallet-client";
const revision=`sha256:${"44".repeat(32)}`,id=`0x${"33".repeat(32)}`;
const initial={id,revisionId:revision,gameId:"maze",chainId:4663,target:`0x${"55".repeat(20)}`,runtimeHash:`0x${"66".repeat(32)}`,issuer:`0x${"11".repeat(20)}`,maxAge:300,maximumScore:"1"};
declare global {interface Window{__gameFixture:{calls:Record<string,unknown>[];delay:number;fail:boolean;links:Record<string,unknown>[];transactions:Record<string,unknown>[];events:Record<string,unknown>[];walletDelay:number;walletError:boolean}}}
window.__gameFixture={calls:[],delay:0,fail:false,links:[],transactions:[],events:[],walletDelay:0,walletError:false};
function Fixture(){
 const [current,setCurrent]=useState(revision),[prompt,setPrompt]=useState("");
 const api:PlatformAPI=async<T,>(path:string,options?:Parameters<PlatformAPI>[1])=>{
  const body=options?.body as Record<string,unknown>|undefined;window.__gameFixture.calls.push(body??{read:path});
  if(window.__gameFixture.delay)await new Promise(r=>setTimeout(r,window.__gameFixture.delay));
  if(window.__gameFixture.fail)throw Error("The deployed receiver does not match its reviewed code.");
  if(!body)return {bindings:[{definition:initial,version:"version-one",active:true},{definition:{...initial,id:`0x${"aa".repeat(32)}`,gameId:"other-game"},version:"version-two",active:true}],wallets:window.__gameFixture.links,walletTransactions:window.__gameFixture.transactions,events:window.__gameFixture.events} as T;
  if(body.action==="inspect")return {binding:{...initial,...body.binding as object,revisionId:current},verified:true,registered:false} as T;
  if(body.action==="bind")return {binding:body.binding,version:"saved"} as T;
  if(body.action==="record")return {id:(body.event as Record<string,unknown>).eventId,state:"received"} as T;
  if(body.action==="link-wallet"){const proof=body.proof as Record<string,unknown>;window.__gameFixture.links=[{bindingId:id,version:"version-one",player:proof.player,playerIdHash:proof.playerIdHash}];return {state:"signed"} as T;}
  if(body.action==="prepare-wallet"){
   const step={id:"wallet-step",kind:"program-action",state:"prepared",preparedBlock:"100",expiresAt:Math.floor(Date.now()/1000)+120,transaction:{from:`0x${"22".repeat(20)}`,to:initial.target,chainId:4663,value:"0x0",nonce:"0x1",gas:"0x100000",data:"0x1234"}};
   window.__gameFixture.transactions=[{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",bindingId:id,bindingVersion:"version-one",playerIdHash:body.playerIdHash,player:`0x${"22".repeat(20)}`,state:"prepared",step,transactionHash:null}];
   return {state:"ready_for_wallet",requestId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",step} as T;
  }
  if(body.action==="reconcile-wallet"){const state=window.__gameFixture.walletError?"dispatching":"confirmed";window.__gameFixture.transactions=window.__gameFixture.transactions.map(row=>({...row,state}));return {state} as T;}
  if(body.action==="reconcile")return {id:body.eventId,state:"confirmed"} as T;
  return {state:"signed"} as T;
 };
 const wallet:GameWalletAdapter={ownerId:"alice",account:`0x${"22".repeat(20)}`,perform:async request=>{window.__gameFixture.calls.push({walletKind:request.kind});if(window.__gameFixture.walletDelay)await new Promise(r=>setTimeout(r,window.__gameFixture.walletDelay));if(request.kind==="sign-link")return {kind:"signed-link",proof:{...request.invitation,signature:`0x${"cc".repeat(65)}`}};if(window.__gameFixture.walletError){window.__gameFixture.transactions=window.__gameFixture.transactions.map(row=>({...row,state:"dispatching"}));throw Object.assign(Error("The wallet result is still uncertain."),{code:"game-wallet-pending"});}if(request.kind==="cancel"){window.__gameFixture.transactions=window.__gameFixture.transactions.map(row=>({...row,state:"rejected"}));return {kind:"cancelled"};}return {kind:"submitted",hash:`0x${"dd".repeat(32)}`,storedLocally:true,acknowledged:true};}};
 return <main className={styles.workspace} style={{maxWidth:760,margin:"auto"}}><button onClick={()=>setCurrent(`sha256:${"77".repeat(32)}`)}>Change project revision</button><ProjectEvents key={current} projectId="11111111-1111-4111-8111-111111111111" revisionId={current} api={api} onPrompt={setPrompt} wallet={wallet} onWalletBusy={busy=>window.__gameFixture.calls.push({walletBusy:busy})}/><p role="status">{prompt}</p></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
