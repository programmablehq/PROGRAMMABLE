import {decodeFunctionData,keccak256,parseAbi,serializeTypedData,stringToHex,type Address,type Hex} from "viem";
import {assertGameBinding,verifyGameEvent,verifyWalletInvitation,verifyWalletLink,walletLinkTypedData,type GameBinding,type WalletLinkInvitation,type SignedWalletLink} from "./game-events";
import type {LaunchStep} from "../launch-session";
import {errorIsExplicitWalletRejection,WalletRequestNotSubmittedError} from "@/lib/wallet-request-lock";

export const GAME_WALLET_ABI=parseAbi([
 "function bindPlayer(address player,bytes32 playerIdHash,bytes32 nonce,uint64 validUntil,bytes signature,bytes issuerSignature)",
 "function submitEvent((bytes32 bindingId,bytes32 eventId,bytes32 playerIdHash,address player,uint64 sequence,uint256 score,uint64 observedAt,uint64 validUntil) eventData,bytes signature)",
]);
const gameDomainType=[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}] as const;
export const serializeGameWalletTypedData=(data:ReturnType<typeof walletLinkTypedData>)=>serializeTypedData({...data,domain:{...data.domain,chainId:BigInt(data.domain.chainId)},types:{EIP712Domain:gameDomainType,...data.types}});
type API=(body:Record<string,unknown>)=>Promise<unknown>;
type Scope={ownerId:string;projectId:string;revisionId:string;binding:GameBinding;api:API;readState?:()=>Promise<unknown>;assertCurrent:()=>void};
export type GameWalletAction={kind:"wallet-link";requestId:string;player:Address;playerIdHash:Hex}|{kind:"event";eventId:Hex;player:Address};
export type GameWalletRequest=Scope&({kind:"sign-link";invitation:WalletLinkInvitation}|{kind:"send";action:GameWalletAction;step:LaunchStep}|{kind:"cancel";action:GameWalletAction;step:LaunchStep});
export type GameWalletResult={kind:"signed-link";proof:SignedWalletLink}|{kind:"submitted";hash:Hex;acknowledged:boolean;storedLocally:boolean}|{kind:"cancelled"};
export type GameWalletAdapter={ownerId:string;account:Address;perform:(request:GameWalletRequest)=>Promise<GameWalletResult>};
export type GameWalletRuntime={
 ownerId:string;account:Address;now:()=>number;randomId:()=>string;
 storage:Pick<Storage,"getItem"|"setItem"|"removeItem">;
 assertCurrent:()=>void;assertAuthority:()=>Promise<void>;
 run:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;
 sign:(data:ReturnType<typeof walletLinkTypedData>)=>Promise<unknown>;
 send:(transaction:LaunchStep["transaction"])=>Promise<unknown>;
};
type Journal={version:1;scope:Hex;dispatchId:string;state:"preparing"|"dispatching"|"submitted"|"rejected";step:LaunchStep;hash?:Hex};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const transactionHash=(value:unknown):value is Hex=>typeof value==="string"&&/^0x(?!0{64}$)[a-f0-9]{64}$/i.test(value);
export class GameWalletPendingError extends Error {readonly code="game-wallet-pending";constructor(){super("The wallet result is still uncertain. Check this saved request before sending again.");}}
const bindingIdentity=(binding:GameBinding)=>JSON.stringify([binding.id.toLowerCase(),binding.revisionId,binding.gameId,binding.chainId,binding.target.toLowerCase(),binding.runtimeHash.toLowerCase(),binding.issuer.toLowerCase(),binding.maxAge,binding.maximumScore]);
const invitationIdentity=(invitation:WalletLinkInvitation)=>JSON.stringify([invitation.player.toLowerCase(),invitation.playerIdHash.toLowerCase(),invitation.nonce.toLowerCase(),invitation.validUntil,invitation.issuerSignature.toLowerCase()]);
function sameStep(a:LaunchStep,b:LaunchStep){
 return a.id===b.id&&a.kind===b.kind&&a.preparedBlock===b.preparedBlock&&a.expiresAt===b.expiresAt
  &&JSON.stringify([a.transaction.from.toLowerCase(),a.transaction.to?.toLowerCase(),a.transaction.data.toLowerCase(),a.transaction.value.toLowerCase(),a.transaction.chainId,a.transaction.nonce.toLowerCase(),a.transaction.gas.toLowerCase()])
   ===JSON.stringify([b.transaction.from.toLowerCase(),b.transaction.to?.toLowerCase(),b.transaction.data.toLowerCase(),b.transaction.value.toLowerCase(),b.transaction.chainId,b.transaction.nonce.toLowerCase(),b.transaction.gas.toLowerCase()]);
}
function readJournal(runtime:GameWalletRuntime,key:string,scope:Hex):Journal|null{
 const raw=runtime.storage.getItem(key);if(raw===null)return null;if(raw.length>100000)throw new GameWalletPendingError();
 try{const value=JSON.parse(raw) as Journal;if(value.version!==1||value.scope!==scope||!uuid.test(value.dispatchId)||!["preparing","dispatching","submitted","rejected"].includes(value.state)||!value.step?.transaction||value.state==="submitted"&&!transactionHash(value.hash))throw Error();return value;}
 catch{throw new GameWalletPendingError();}
}
function writeJournal(runtime:GameWalletRuntime,key:string,value:Journal){const encoded=JSON.stringify(value);runtime.storage.setItem(key,encoded);if(runtime.storage.getItem(key)!==encoded)throw Error("The wallet recovery record could not be saved.");}
function actionBody(action:GameWalletAction){return action.kind==="wallet-link"?{walletRequestId:action.requestId}:{eventId:action.eventId};}
async function validateTransaction(binding:GameBinding,action:GameWalletAction,step:LaunchStep,account:Address,now:number){
 const tx=step.transaction;
 if(step.kind!=="program-action"||tx.from.toLowerCase()!==account.toLowerCase()||tx.to?.toLowerCase()!==binding.target.toLowerCase()||tx.chainId!==binding.chainId||BigInt(tx.value)!==0n||!/^0x[a-f0-9]+$/i.test(tx.nonce)||BigInt(tx.nonce)>BigInt(Number.MAX_SAFE_INTEGER)||!/^0x[a-f0-9]+$/i.test(tx.gas)||BigInt(tx.gas)<=0n||!Number.isSafeInteger(step.expiresAt)||step.expiresAt<=now+3)throw Error("The reviewed game transaction changed or expired.");
 const decoded=decodeFunctionData({abi:GAME_WALLET_ABI,data:tx.data});
 if(action.kind==="wallet-link"){
  if(!uuid.test(action.requestId)||decoded.functionName!=="bindPlayer")throw Error("This is not the reviewed game wallet link.");
  const [player,playerIdHash,nonce,validUntil,signature,issuerSignature]=decoded.args;
  if(player.toLowerCase()!==action.player.toLowerCase()||playerIdHash.toLowerCase()!==action.playerIdHash.toLowerCase()||step.expiresAt>Number(validUntil))throw Error("The game player changed.");
  await verifyWalletLink(binding,{player,playerIdHash,nonce,validUntil:Number(validUntil),signature,issuerSignature},now);
 }else{
  if(decoded.functionName!=="submitEvent")throw Error("This is not the reviewed game result.");const [event,signature]=decoded.args;
  if(event.bindingId.toLowerCase()!==binding.id.toLowerCase()||event.eventId.toLowerCase()!==action.eventId.toLowerCase()||event.player.toLowerCase()!==action.player.toLowerCase()||step.expiresAt>Number(event.validUntil))throw Error("The signed game result changed.");
  await verifyGameEvent(binding,{eventId:event.eventId,playerIdHash:event.playerIdHash,player:event.player,sequence:String(event.sequence),score:String(event.score),observedAt:Number(event.observedAt),validUntil:Number(event.validUntil),signature},now);
 }
}

/** Only the supplied wallet runtime can sign or send. The model has no path here. */
export async function performGameWalletRequest(request:GameWalletRequest,runtime:GameWalletRuntime):Promise<GameWalletResult>{
 const ownerId=request.ownerId,account=runtime.account,binding=structuredClone(request.binding),projectId=request.projectId,revisionId=request.revisionId;
 assertGameBinding(binding);
 const assertCurrent=()=>{runtime.assertCurrent();request.assertCurrent();if(runtime.ownerId!==ownerId||runtime.account.toLowerCase()!==account.toLowerCase()||binding.revisionId!==revisionId)throw Error("The wallet or project session changed.");};
 assertCurrent();
 const base={projectId,bindingId:binding.id,account};
 if(request.kind==="sign-link"){
  const invitation=structuredClone(request.invitation);if(invitation.player.toLowerCase()!==account.toLowerCase())throw Error("This invitation belongs to another wallet.");
  const key=JSON.stringify(["game-wallet-link-signature",ownerId,projectId,revisionId,bindingIdentity(binding),invitation.nonce]);
  return runtime.run(key,async()=>{
   assertCurrent();await verifyWalletInvitation(binding,invitation,runtime.now());assertCurrent();await runtime.assertAuthority();assertCurrent();
   const fresh=await request.api({...base,action:"review-link",proof:invitation}) as {binding:GameBinding;invitation:WalletLinkInvitation};assertCurrent();
   assertGameBinding(fresh.binding);await verifyWalletInvitation(fresh.binding,fresh.invitation,runtime.now());
   if(bindingIdentity(fresh.binding)!==bindingIdentity(binding)||invitationIdentity(fresh.invitation)!==invitationIdentity(invitation))throw Error("The game invitation changed. Review it again.");
   await runtime.assertAuthority();assertCurrent();const signature=await runtime.sign(walletLinkTypedData(binding,invitation));assertCurrent();await runtime.assertAuthority();assertCurrent();
   if(typeof signature!=="string"||!/^0x[a-f0-9]{130}$/i.test(signature))throw Error("The wallet returned an invalid signature.");
   const proof=await verifyWalletLink(binding,{...invitation,signature:signature as Hex},runtime.now());assertCurrent();return {kind:"signed-link",proof};
  });
 }
 const action=structuredClone(request.action),step=structuredClone(request.step);
 const actionIdentity=action.kind==="wallet-link"?[action.kind,action.requestId.toLowerCase(),action.player.toLowerCase(),action.playerIdHash.toLowerCase()]:[action.kind,action.eventId.toLowerCase(),action.player.toLowerCase()];
 const scope=keccak256(stringToHex(JSON.stringify(["game-wallet-v1",ownerId,account.toLowerCase(),projectId,revisionId,bindingIdentity(binding),actionIdentity]))),key="programmable:game-wallet:v1:"+scope;
 const payload={...base,...actionBody(action)};
 const submitted=async(hash:Hex)=>{try{assertCurrent();await request.api({...payload,action:action.kind==="wallet-link"?"wallet-submitted":"submitted",hash});assertCurrent();return true;}catch{return false;}};
 return runtime.run(key,async()=>{
  assertCurrent();let journal=readJournal(runtime,key,scope);
  if(journal&&journal.state!=="rejected"){
   let same=false;try{same=sameStep(journal.step,step);}catch{/* An invalid journal remains pending. */}
   if(!same){
    if(journal.state!=="preparing"||!request.readState)throw new GameWalletPendingError();
    const state=await request.readState() as {events?:Record<string,unknown>[];walletTransactions?:Record<string,unknown>[]};assertCurrent();
    const rows=action.kind==="event"?state?.events:state?.walletTransactions;
    const saved=Array.isArray(rows)?rows.find(row=>row.id===(action.kind==="event"?action.eventId:action.requestId)&&row.bindingId===binding.id):undefined;
    if(!saved||saved.state!=="prepared"||saved.transactionHash||saved.walletPending||!saved.step||!sameStep(saved.step as LaunchStep,step)||(saved.step as LaunchStep).dispatchedAt!==undefined)throw new GameWalletPendingError();
    journal=null;
   }
  }
  if(request.kind==="cancel"){
   if(journal&&!["preparing","rejected"].includes(journal.state))throw new GameWalletPendingError();
   await request.api({...payload,action:action.kind==="wallet-link"?"wallet-rejected":"rejected",stepId:step.id,...(journal?{dispatchId:journal.dispatchId}:{})});assertCurrent();
   runtime.storage.removeItem(key);return {kind:"cancelled"};
  }
  if(journal?.state==="dispatching")throw new GameWalletPendingError();
  if(journal?.state==="submitted")return {kind:"submitted",hash:journal.hash!,acknowledged:await submitted(journal.hash!),storedLocally:true};
  try{
   await validateTransaction(binding,action,step,account,runtime.now());assertCurrent();await runtime.assertAuthority();assertCurrent();
   if(journal?.state==="preparing"&&!sameStep(journal.step,step))throw new GameWalletPendingError();
   if(!journal||journal.state==="rejected")journal={version:1,scope,dispatchId:runtime.randomId(),state:"preparing",step};
   if(!uuid.test(journal.dispatchId))throw Error("The wallet dispatch identity is invalid.");writeJournal(runtime,key,journal);
   const dispatched=await request.api({...payload,action:action.kind==="wallet-link"?"dispatch-wallet":"dispatch",stepId:step.id,dispatchId:journal.dispatchId}) as {step:LaunchStep;dispatchId:string};assertCurrent();
   if(dispatched.dispatchId!==journal.dispatchId||!sameStep(step,dispatched.step))throw Error("The server wallet request changed. Check the saved request.");
   await runtime.assertAuthority();assertCurrent();await validateTransaction(binding,action,step,account,runtime.now());assertCurrent();
   journal={...journal,state:"dispatching"};writeJournal(runtime,key,journal);
  }catch(error){if(error instanceof GameWalletPendingError)throw error;throw new WalletRequestNotSubmittedError(error instanceof Error?error.message:"The wallet request could not be prepared.");}
  let hash:Hex;
  try{assertCurrent();const value=await runtime.send(step.transaction);if(!transactionHash(value))throw new GameWalletPendingError();hash=value.toLowerCase() as Hex;}
  catch(error){
   if(errorIsExplicitWalletRejection(error)){
    try{writeJournal(runtime,key,{...journal,state:"rejected"});}catch{/* The server keeps the original dispatch until rejection is confirmed. */}
    try{assertCurrent();await request.api({...payload,action:action.kind==="wallet-link"?"wallet-rejected":"rejected",stepId:step.id,dispatchId:journal.dispatchId});}catch{/* Keep the local proof of a known wallet rejection for recovery. */}
    throw error;
   }
   throw new GameWalletPendingError();
  }
  let storedLocally=true;try{writeJournal(runtime,key,{...journal,state:"submitted",hash});}catch{storedLocally=false;}
  return {kind:"submitted",hash,storedLocally,acknowledged:await submitted(hash)};
 });
}
