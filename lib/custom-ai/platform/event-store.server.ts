import "server-only";
import {keccak256,stringToHex,type Hex} from "viem";
import type {AIPool} from "../store.server";
import type {createPlatformStore} from "./project-store.server";
import {projectTransaction} from "./transaction.server";
import {canonicalProjectJSON,projectHash} from "./document";
import {assertGameBinding,verifyGameEvent,verifyWalletLink,type GameBinding,type GameConfiguration,type SignedGameEvent,type SignedWalletLink} from "./game-events";
import {ProjectError,type ProjectScope,type JsonValue} from "./types";

export function gameBindingId(scope:ProjectScope,input:GameConfiguration):Hex{
 return keccak256(stringToHex(canonicalProjectJSON({version:1,ownerId:scope.ownerId,projectId:scope.projectId,gameId:input.gameId,chainId:input.chainId,issuer:input.issuer.toLowerCase(),maxAge:input.maxAge,maximumScore:input.maximumScore})));
}
const currentError=()=>new ProjectError("game-revision","Review the game binding against the current project revision.",409);
type Row=Record<string,unknown>;
const view=(row:Row)=>{
 const event=row.payload as SignedGameEvent;
 return {id:String(row.event_id),bindingId:String(row.binding_id),state:String(row.state),transactionHash:row.transaction_hash?String(row.transaction_hash):null,observed:row.observation as JsonValue??null,createdAt:String(row.created_at),player:event?.player,playerIdHash:event?.playerIdHash,sequence:event?.sequence,score:event?.score,validUntil:event?.validUntil};
};

export function createGameEventStore(pool:AIPool,projects:ReturnType<typeof createPlatformStore>,now=()=>Math.floor(Date.now()/1000)){
 async function readBinding(scope:ProjectScope,id:string){
  return projectTransaction(pool,scope,async db=>{
   const row=(await db.query("SELECT * FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2 AND id=$3 AND active",[scope.ownerId,scope.projectId,id])).rows[0];
   if(!row)throw new ProjectError("game-binding","This game binding is not available.",404);
   return {binding:row.definition as GameBinding,version:String(row.version)};
  });
 }
 async function currentBinding(scope:ProjectScope,id:string){
  const saved=await readBinding(scope,id);if((await projects.readProject(scope)).revisionId!==saved.binding.revisionId)throw currentError();return saved;
 }
 /** Call only after the service has independently checked the onchain code and immutable configuration. */
 async function saveBinding(scope:ProjectScope,input:GameBinding){
  assertGameBinding(input);if(input.id!==gameBindingId(scope,input))throw new ProjectError("game-binding","The binding does not belong to this project configuration.",409);
  const binding:GameBinding={id:input.id,revisionId:input.revisionId,gameId:input.gameId,chainId:input.chainId,target:input.target,runtimeHash:input.runtimeHash,issuer:input.issuer,maxAge:input.maxAge,maximumScore:input.maximumScore};
  const version=projectHash(binding);
  return projectTransaction(pool,scope,async db=>{
   const project=(await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR UPDATE",[scope.ownerId,scope.projectId])).rows[0];if(project?.current_revision!==binding.revisionId)throw currentError();
   const total=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0];
   const existing=(await db.query("SELECT id FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,binding.id])).rows[0];
   if(!existing&&Number(total.count)>=8)throw new ProjectError("game-quota","This project already has eight game bindings.",429);
   await db.query("INSERT INTO programmable_projects_v1.game_bindings(owner,project_id,id,version,definition,active) VALUES($1,$2,$3,$4,$5::jsonb,true) ON CONFLICT(owner,project_id,id) DO UPDATE SET version=$4,definition=$5::jsonb,active=true",[scope.ownerId,scope.projectId,binding.id,version,JSON.stringify(binding)]);
   await db.query("INSERT INTO programmable_projects_v1.game_event_routes(binding_id,owner,project_id) VALUES($1,$2,$3) ON CONFLICT(binding_id) DO NOTHING",[binding.id,scope.ownerId,scope.projectId]);return {binding,version};
  });
 }
 async function link(scope:ProjectScope,id:string,input:SignedWalletLink){
  const saved=await currentBinding(scope,id),proof=await verifyWalletLink(saved.binding,input,now());
  return projectTransaction(pool,scope,async db=>{
   const latest=(await db.query("SELECT version FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2 AND id=$3 AND active FOR SHARE",[scope.ownerId,scope.projectId,id])).rows[0];if(latest?.version!==saved.version)throw currentError();
   const existing=(await db.query("SELECT player FROM programmable_projects_v1.game_wallets WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND version=$4 AND player_id_hash=$5 FOR UPDATE",[scope.ownerId,scope.projectId,id,saved.version,proof.playerIdHash])).rows[0];
   if(existing&&String(existing.player).toLowerCase()!==proof.player.toLowerCase())throw new ProjectError("game-wallet","This game account is already bound to another wallet.",409);
   if(!existing){
    await db.query("SELECT id FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR UPDATE",[scope.ownerId,scope.projectId]);
    const quota=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.game_wallets WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0];if(Number(quota.count)>=5000)throw new ProjectError("game-quota","This project's player binding allowance is full.",429);
   }
   await db.query("INSERT INTO programmable_projects_v1.game_wallets(owner,project_id,binding_id,version,player_id_hash,player,proof) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(owner,project_id,binding_id,version,player_id_hash) DO UPDATE SET proof=$7::jsonb",[scope.ownerId,scope.projectId,id,saved.version,proof.playerIdHash,proof.player,JSON.stringify(proof)]);
   return {player:proof.player,playerIdHash:proof.playerIdHash,state:"signed"};
  });
 }
 async function readWallet(scope:ProjectScope,id:string,playerIdHash:string){
  const saved=await currentBinding(scope,id);
  return projectTransaction(pool,scope,async db=>{const row=(await db.query("SELECT proof FROM programmable_projects_v1.game_wallets WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND version=$4 AND player_id_hash=$5",[scope.ownerId,scope.projectId,id,saved.version,playerIdHash])).rows[0];if(!row)throw new ProjectError("game-wallet","Link the game account and wallet first.",409);return row.proof as SignedWalletLink;});
 }
 async function ingest(scope:ProjectScope,id:string,input:SignedGameEvent){
  const saved=await currentBinding(scope,id),event=await verifyGameEvent(saved.binding,input,now()),hash=projectHash(event);
  return projectTransaction(pool,scope,async db=>{
   const project=(await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR SHARE",[scope.ownerId,scope.projectId])).rows[0];if(project?.current_revision!==saved.binding.revisionId)throw currentError();
   const latest=(await db.query("SELECT version FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2 AND id=$3 AND active FOR SHARE",[scope.ownerId,scope.projectId,id])).rows[0];if(latest?.version!==saved.version)throw currentError();
   const wallet=(await db.query("SELECT player FROM programmable_projects_v1.game_wallets WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND version=$4 AND player_id_hash=$5",[scope.ownerId,scope.projectId,id,saved.version,event.playerIdHash])).rows[0];if(String(wallet?.player).toLowerCase()!==event.player.toLowerCase())throw new ProjectError("game-wallet","The event does not match a signed player wallet.",409);
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`game-events:${scope.ownerId}:${scope.projectId}`]);
   const prior=(await db.query("SELECT * FROM programmable_projects_v1.game_events WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4",[scope.ownerId,scope.projectId,id,event.eventId])).rows[0];
   if(prior){if(prior.payload_hash!==hash||prior.binding_version!==saved.version)throw new ProjectError("game-replay","This event identity already has a different payload or revision.",409);return view(prior);}
   const count=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.game_events WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0];if(Number(count.count)>=5000)throw new ProjectError("game-quota","This project's event receipt allowance is full.",429);
   const row=(await db.query("INSERT INTO programmable_projects_v1.game_events(owner,project_id,binding_id,event_id,binding_version,payload_hash,payload,state,created_at,binding_definition) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'received',$8,$9::jsonb) RETURNING *",[scope.ownerId,scope.projectId,id,event.eventId,saved.version,hash,JSON.stringify(event),new Date(now()*1000).toISOString(),JSON.stringify(saved.binding)])).rows[0];return view(row);
  });
 }
 async function route(id:string){const db=await pool.connect();try{const row=(await db.query("SELECT owner,project_id FROM programmable_projects_v1.game_event_routes WHERE binding_id=$1",[id])).rows[0];if(!row)throw new ProjectError("game-binding","This game binding is not available.",404);return {ownerId:String(row.owner),projectId:String(row.project_id)};}finally{db.release();}}
 async function readEvent(scope:ProjectScope,id:string,eventId:string,historical=false){
  const saved=historical?null:await currentBinding(scope,id);return projectTransaction(pool,scope,async db=>{
   const row=(await db.query("SELECT * FROM programmable_projects_v1.game_events WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4",[scope.ownerId,scope.projectId,id,eventId])).rows[0];if(!row)throw new ProjectError("game-event","This game event was not found.",404);if(saved&&row.binding_version!==saved.version)throw currentError();return {binding:row.binding_definition as GameBinding,version:String(row.binding_version),event:row.payload as SignedGameEvent,receipt:view(row),transaction:row.prepared_transaction as JsonValue};
  });
 }
 async function prepared(scope:ProjectScope,id:string,eventId:string,transaction:JsonValue){
  const saved=await readEvent(scope,id,eventId);return projectTransaction(pool,scope,async db=>{
   const current=(await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR SHARE",[scope.ownerId,scope.projectId])).rows[0];if(current?.current_revision!==saved.binding.revisionId)throw currentError();
   const active=(await db.query("SELECT version FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2 AND id=$3 AND active FOR SHARE",[scope.ownerId,scope.projectId,id])).rows[0];if(active?.version!==saved.version)throw currentError();
   const row=(await db.query("UPDATE programmable_projects_v1.game_events SET prepared_transaction=$5::jsonb,state='prepared' WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4 AND state IN ('received','prepared') AND binding_version=$6 RETURNING *",[scope.ownerId,scope.projectId,id,eventId,JSON.stringify(transaction),saved.version])).rows[0];if(!row)throw new ProjectError("game-state","This event already has a submitted transaction.",409);return view(row);
  });
 }
 async function submitted(scope:ProjectScope,id:string,eventId:string,hash:Hex){
  if(!/^0x[a-f0-9]{64}$/i.test(hash))throw new ProjectError("game-transaction","Use a transaction hash.");
  await readEvent(scope,id,eventId,true);return projectTransaction(pool,scope,async db=>{
   const row=(await db.query("UPDATE programmable_projects_v1.game_events SET transaction_hash=$5,state=CASE WHEN state='prepared' THEN 'submitted' ELSE state END WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4 AND (state='prepared' OR state IN ('submitted','confirmed','failed') AND transaction_hash=$5) RETURNING *",[scope.ownerId,scope.projectId,id,eventId,hash])).rows[0];if(!row)throw new ProjectError("game-state","Reconcile the saved transaction before submitting another.",409);return view(row);
  });
 }
 async function observed(scope:ProjectScope,id:string,eventId:string,hash:Hex,success:boolean,evidence:JsonValue){
  return projectTransaction(pool,scope,async db=>{
   const row=(await db.query("UPDATE programmable_projects_v1.game_events SET state=$6,observation=$7::jsonb WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4 AND transaction_hash=$5 AND state IN ('submitted','confirmed','failed') RETURNING *",[scope.ownerId,scope.projectId,id,eventId,hash,success?"confirmed":"failed",JSON.stringify(evidence)])).rows[0];if(!row)throw new ProjectError("game-state","The observed transaction differs from this event.",409);return view(row);
  });
 }
 const pendingAgain=(scope:ProjectScope,id:string,eventId:string,hash:Hex)=>projectTransaction(pool,scope,async db=>{
  const row=(await db.query("UPDATE programmable_projects_v1.game_events SET state='submitted',observation=jsonb_build_object('state','pending','previous',observation) WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4 AND transaction_hash=$5 RETURNING *",[scope.ownerId,scope.projectId,id,eventId,hash])).rows[0];if(!row)throw new ProjectError("game-state","This event transaction was not found.",409);return view(row);
 });
 const list=(scope:ProjectScope)=>projectTransaction(pool,scope,async db=>({
  bindings:(await db.query("SELECT definition,version,active FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows,
  events:(await db.query("SELECT * FROM programmable_projects_v1.game_events WHERE owner=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100",[scope.ownerId,scope.projectId])).rows.map(view),
  wallets:(await db.query("SELECT binding_id,version,player_id_hash,player FROM programmable_projects_v1.game_wallets WHERE owner=$1 AND project_id=$2 LIMIT 5000",[scope.ownerId,scope.projectId])).rows.map(row=>({bindingId:String(row.binding_id),version:String(row.version),playerIdHash:String(row.player_id_hash),player:String(row.player)})),
 }));
 const revoke=(scope:ProjectScope,id:string)=>projectTransaction(pool,scope,db=>db.query("UPDATE programmable_projects_v1.game_bindings SET active=false WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id]));
 return {saveBinding,readBinding,currentBinding,link,readWallet,ingest,route,readEvent,prepared,submitted,observed,pendingAgain,list,revoke};
}
