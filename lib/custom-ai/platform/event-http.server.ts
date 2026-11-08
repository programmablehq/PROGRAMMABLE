import "server-only";
import type {Address,Hex} from "viem";
import {readPreviewBody} from "../access.server";
import {aiError,aiHeaders} from "../http.server";
import {CustomAIError} from "../types";
import type {createGameEventStore} from "./event-store.server";
import {gameBindingId} from "./event-store.server";
import type {createGameEventService} from "./event-chain.server";
import type {createPlatformStore} from "./project-store.server";
import {assertGameBinding,type GameBinding,type SignedGameEvent,type SignedWalletLink,type WalletLinkInvitation} from "./game-events";
import {ProjectError} from "./types";
type Dependencies={enabled:()=>boolean;authorize:(request:Request,write:boolean)=>Promise<{ownerId:string;wallets:readonly string[]}>;consume:(ownerId:string,operation:"read"|"write")=>Promise<unknown>;events:()=>ReturnType<typeof createGameEventStore>;service:()=>ReturnType<typeof createGameEventService>;projects:()=>ReturnType<typeof createPlatformStore>};
const failed=(error:unknown)=>aiError(error instanceof ProjectError?new CustomAIError(error.code,error.message,error.status):error);
export function createGameEventRoutes(deps:Dependencies){
 const GET=async(request:Request)=>{
  try{if(!deps.enabled())return new Response(null,{status:404});const auth=await deps.authorize(request,false);await deps.consume(auth.ownerId,"read");const query=new URL(request.url).searchParams,projectId=query.get("projectId");if(!projectId||[...query.keys()].some(key=>key!=="projectId"))throw new ProjectError("game-input","Choose a project.");return Response.json(await deps.events().list({ownerId:auth.ownerId,projectId}),{headers:aiHeaders});}catch(error){return failed(error);}
 };
 const POST=async(request:Request)=>{
  try{
   if(!deps.enabled())return new Response(null,{status:404});const auth=await deps.authorize(request,true);await deps.consume(auth.ownerId,"write");
   const body=await readPreviewBody(request,20000) as Record<string,unknown>;
   if(!body||typeof body.projectId!=="string"||Object.keys(body).some(key=>!["action","projectId","binding","bindingId","proof","event","eventId","playerIdHash","account","hash"].includes(key)))throw new ProjectError("game-input","Choose a project game action.");
   const scope={ownerId:auth.ownerId,projectId:body.projectId},store=deps.events();let result:unknown;
   if(body.action==="plan"||body.action==="inspect"){
    if(!body.binding||typeof body.binding!=="object"||Array.isArray(body.binding))throw new ProjectError("game-input","Choose a game configuration.");
    const source=body.binding as Omit<GameBinding,"id">,revision=await deps.projects().readProject(scope),binding={...source,...(body.action==="inspect"?{runtimeHash:`0x${"01".repeat(32)}` as Hex}:{}),revisionId:revision.revisionId,id:`0x${"01".repeat(32)}` as Hex};assertGameBinding(binding);binding.id=gameBindingId(scope,binding);result=body.action==="inspect"?await deps.service().previewBinding(binding):{binding,verified:false,registered:false};
   }else if(body.action==="bind")result=await deps.service().register(scope,body.binding as GameBinding);
   else{
    if(typeof body.bindingId!=="string")throw new ProjectError("game-input","Choose a saved game binding.");const id=body.bindingId;
    if(body.action==="review-link"&&typeof body.account==="string")result=await deps.service().reviewWalletLink(scope,id,body.proof as WalletLinkInvitation,body.account as Address,auth.wallets);
    else if(body.action==="link-wallet")result=await store.link(scope,id,body.proof as SignedWalletLink);
    else if(body.action==="record")result=await store.ingest(scope,id,body.event as SignedGameEvent);
    else if(body.action==="revoke"){await store.revoke(scope,id);result={revoked:true};}
    else if(body.action==="prepare-wallet"){
     if(typeof body.playerIdHash!=="string"||typeof body.account!=="string")throw new ProjectError("game-input","Choose a linked wallet and game player ID hash.");
     result=await deps.service().prepareWallet(scope,id,body.playerIdHash,body.account as Address,auth.wallets);
    }else{
     if(typeof body.eventId!=="string")throw new ProjectError("game-input","Choose a recorded event.");
     if(body.action==="prepare"&&typeof body.account==="string")result=await deps.service().prepare(scope,id,body.eventId,body.account as Address,auth.wallets);
     else if(body.action==="submitted"&&typeof body.account==="string"&&typeof body.hash==="string")result=await deps.service().recordSubmitted(scope,id,body.eventId,body.hash as Hex,body.account as Address,auth.wallets);
     else if(body.action==="reconcile")result=await deps.service().reconcile(scope,id,body.eventId);
     else throw new ProjectError("game-input","Choose a supported game action.");
    }
   }
   return Response.json(result,{headers:aiHeaders});
  }catch(error){return failed(error);}
 };
 return {GET,POST};
}
