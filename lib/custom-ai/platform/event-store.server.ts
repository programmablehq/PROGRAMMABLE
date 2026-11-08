import "server-only";
import {randomUUID} from "node:crypto";
import {keccak256,stringToHex,type Hex} from "viem";
import type {AIPool} from "../store.server";
import type {createPlatformStore} from "./project-store.server";
import {projectTransaction} from "./transaction.server";
import {canonicalProjectJSON,projectHash} from "./document";
import {assertGameBinding,verifyGameEvent,verifyWalletLink,type GameBinding,type GameConfiguration,type SignedGameEvent,type SignedWalletLink} from "./game-events";
import {ProjectError,type ProjectScope,type JsonValue} from "./types";
import type {LaunchStep} from "../launch-session";

export function gameBindingId(scope:ProjectScope,input:GameConfiguration):Hex{
 return keccak256(stringToHex(canonicalProjectJSON({version:1,ownerId:scope.ownerId,projectId:scope.projectId,gameId:input.gameId,chainId:input.chainId,issuer:input.issuer.toLowerCase(),maxAge:input.maxAge,maximumScore:input.maximumScore})));
}
const currentError=()=>new ProjectError("game-revision","Review the game binding against the current project revision.",409);
type Row=Record<string,unknown>;
type DispatchedStep=LaunchStep&{dispatchId?:string};
const view=(row:Row)=>{
 const event=row.payload as SignedGameEvent;
 return {id:String(row.event_id),bindingId:String(row.binding_id),state:String(row.state),transactionHash:row.transaction_hash?String(row.transaction_hash):null,observed:row.observation as JsonValue??null,createdAt:String(row.created_at),player:event?.player,playerIdHash:event?.playerIdHash,sequence:event?.sequence,score:event?.score,validUntil:event?.validUntil,walletPending:Boolean((row.prepared_transaction as LaunchStep|null)?.dispatchedAt),step:row.prepared_transaction as LaunchStep|null};
};
const walletView=(row:Row)=>({id:String(row.id),bindingId:String(row.binding_id),bindingVersion:String(row.binding_version),playerIdHash:String(row.player_id_hash),player:String(row.player),state:String(row.state),step:row.prepared_transaction as LaunchStep,dispatchId:(row.prepared_transaction as DispatchedStep)?.dispatchId??null,transactionHash:row.transaction_hash?String(row.transaction_hash):null,observed:row.observation as JsonValue??null,createdAt:String(row.created_at)});
function walletRequestId(id:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new ProjectError("game-input","Choose a saved wallet request.");}

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
 async function prepareWalletTransaction(scope:ProjectScope,id:string,playerIdHash:string,step:LaunchStep){
  const saved=await currentBinding(scope,id),proof=await readWallet(scope,id,playerIdHash),proofHash=projectHash(proof);
  if(step.kind!=="program-action"||step.transaction.to?.toLowerCase()!==saved.binding.target.toLowerCase()||step.transaction.chainId!==saved.binding.chainId||BigInt(step.transaction.value)!==0n)throw new ProjectError("game-wallet","The wallet request does not match this receiver.",409);
  return projectTransaction(pool,scope,async db=>{
   const project=(await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR UPDATE",[scope.ownerId,scope.projectId])).rows[0];if(project?.current_revision!==saved.binding.revisionId)throw currentError();
   const active=(await db.query("SELECT version FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2 AND id=$3 AND active FOR SHARE",[scope.ownerId,scope.projectId,id])).rows[0];if(active?.version!==saved.version)throw currentError();
   const latest=(await db.query("SELECT proof FROM programmable_projects_v1.game_wallets WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND version=$4 AND player_id_hash=$5 FOR SHARE",[scope.ownerId,scope.projectId,id,saved.version,playerIdHash])).rows[0];if(!latest||projectHash(latest.proof)!==proofHash)throw new ProjectError("game-wallet","The signed wallet agreement changed.",409);
   const pending=(await db.query("SELECT * FROM programmable_projects_v1.game_wallet_transactions WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND (player_id_hash=$4 OR player=$5) AND state IN ('prepared','dispatching','submitted') FOR UPDATE",[scope.ownerId,scope.projectId,id,playerIdHash,proof.player.toLowerCase()])).rows[0];
   if(pending){if(pending.proof_hash!==proofHash||pending.binding_version!==saved.version)throw new ProjectError("game-state","Reconcile the previous wallet request before changing the agreement.",409);return walletView(pending);}
   const count=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.game_wallet_transactions WHERE owner=$1 AND project_id=$2",[scope.ownerId,scope.projectId])).rows[0];if(Number(count.count)>=5000)throw new ProjectError("game-quota","This project's wallet request allowance is full.",429);
   const row=(await db.query("INSERT INTO programmable_projects_v1.game_wallet_transactions(owner,project_id,id,binding_id,binding_version,binding_definition,player_id_hash,player,proof,proof_hash,prepared_transaction,state,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11::jsonb,'prepared',$12) RETURNING *",[scope.ownerId,scope.projectId,randomUUID(),id,saved.version,JSON.stringify(saved.binding),playerIdHash,proof.player.toLowerCase(),JSON.stringify(proof),proofHash,JSON.stringify(step),new Date(now()*1000).toISOString()])).rows[0];return walletView(row);
  });
 }
 async function readWalletTransaction(scope:ProjectScope,id:string){
  walletRequestId(id);return projectTransaction(pool,scope,async db=>{const row=(await db.query("SELECT * FROM programmable_projects_v1.game_wallet_transactions WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id])).rows[0];if(!row)throw new ProjectError("game-wallet-transaction","This wallet request is not available.",404);return {binding:row.binding_definition as GameBinding,proof:row.proof as SignedWalletLink,step:row.prepared_transaction as LaunchStep,receipt:walletView(row)};});
 }
 async function dispatchWalletTransaction(scope:ProjectScope,id:string,account:string,dispatchId?:string){
  walletRequestId(id);if(dispatchId!==undefined)walletRequestId(dispatchId);const attemptId=dispatchId??randomUUID();return projectTransaction(pool,scope,async db=>{
   const project=(await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR SHARE",[scope.ownerId,scope.projectId])).rows[0];
   const row=(await db.query("SELECT * FROM programmable_projects_v1.game_wallet_transactions WHERE owner=$1 AND project_id=$2 AND id=$3 FOR UPDATE",[scope.ownerId,scope.projectId,id])).rows[0];if(!row)throw new ProjectError("game-wallet-transaction","This wallet request is not available.",404);
   const binding=row.binding_definition as GameBinding,step=row.prepared_transaction as DispatchedStep;
   if(project?.current_revision!==binding.revisionId)throw currentError();
   const active=(await db.query("SELECT version FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2 AND id=$3 AND active FOR SHARE",[scope.ownerId,scope.projectId,row.binding_id])).rows[0];if(active?.version!==row.binding_version)throw currentError();
   if(step.transaction.from.toLowerCase()!==account.toLowerCase())throw new ProjectError("game-wallet","This wallet request belongs to another account.",403);
   if(!['prepared','dispatching'].includes(String(row.state))||row.transaction_hash)throw new ProjectError("game-state","Reconcile the previous wallet request first.",409);
   if(step.expiresAt<=now())throw new ProjectError("game-expired","This wallet request expired. Keep it for recovery.",409);
   if(row.state==='dispatching'){if(dispatchId!==undefined&&step.dispatchId===dispatchId)return walletView(row);throw new ProjectError("game-state","This wallet request has already started. Reconcile it before another send.",409);}
   const prepared={...step,state:"dispatching",dispatchedAt:now(),dispatchId:attemptId};const updated=(await db.query("UPDATE programmable_projects_v1.game_wallet_transactions SET state='dispatching',prepared_transaction=$4::jsonb WHERE owner=$1 AND project_id=$2 AND id=$3 RETURNING *",[scope.ownerId,scope.projectId,id,JSON.stringify(prepared)])).rows[0];return walletView(updated);
  });
 }
 async function submittedWalletTransaction(scope:ProjectScope,id:string,account:string,hash:Hex){
  if(!/^0x[a-f0-9]{64}$/i.test(hash))throw new ProjectError("game-transaction","Use a transaction hash.");
  const saved=await readWalletTransaction(scope,id);if(saved.step.transaction.from.toLowerCase()!==account.toLowerCase())throw new ProjectError("game-wallet","This wallet request belongs to another account.",403);
  return projectTransaction(pool,scope,async db=>{const row=(await db.query("UPDATE programmable_projects_v1.game_wallet_transactions SET transaction_hash=$4,state=CASE WHEN state IN ('prepared','dispatching') THEN 'submitted' ELSE state END WHERE owner=$1 AND project_id=$2 AND id=$3 AND ((state IN ('prepared','dispatching') AND transaction_hash IS NULL) OR (state IN ('submitted','confirmed','failed') AND transaction_hash=$4)) RETURNING *",[scope.ownerId,scope.projectId,id,hash])).rows[0];if(!row)throw new ProjectError("game-state","Reconcile the saved wallet transaction before submitting another.",409);return walletView(row);});
 }
 async function observedWalletTransaction(scope:ProjectScope,id:string,hash:Hex,success:boolean,evidence:JsonValue){
  await readWalletTransaction(scope,id);return projectTransaction(pool,scope,async db=>{const row=(await db.query("UPDATE programmable_projects_v1.game_wallet_transactions SET state=$5,observation=$6::jsonb WHERE owner=$1 AND project_id=$2 AND id=$3 AND transaction_hash=$4 AND state IN ('submitted','confirmed','failed') RETURNING *",[scope.ownerId,scope.projectId,id,hash,success?"confirmed":"failed",JSON.stringify(evidence)])).rows[0];if(!row)throw new ProjectError("game-state","The observation does not match this wallet transaction.",409);return walletView(row);});
 }
 async function pendingWalletTransaction(scope:ProjectScope,id:string,hash:Hex){
  await readWalletTransaction(scope,id);return projectTransaction(pool,scope,async db=>{const row=(await db.query("UPDATE programmable_projects_v1.game_wallet_transactions SET state='submitted',observation=jsonb_build_object('state','pending','previous',observation) WHERE owner=$1 AND project_id=$2 AND id=$3 AND transaction_hash=$4 AND state IN ('submitted','confirmed','failed') RETURNING *",[scope.ownerId,scope.projectId,id,hash])).rows[0];if(!row)throw new ProjectError("game-state","The saved wallet transaction does not match.",409);return walletView(row);});
 }
 async function rejectedWalletTransaction(scope:ProjectScope,id:string,account:string,dispatchId?:string){
  const saved=await readWalletTransaction(scope,id);if(saved.step.transaction.from.toLowerCase()!==account.toLowerCase())throw new ProjectError("game-wallet","This wallet request belongs to another account.",403);
  if(saved.step.dispatchedAt!==undefined&&(dispatchId===undefined||saved.receipt.dispatchId!==dispatchId))throw new ProjectError("game-state","The wallet dispatch identity changed.",409);
  if(saved.receipt.state==="rejected")return saved.receipt;
  return projectTransaction(pool,scope,async db=>{const row=(await db.query("UPDATE programmable_projects_v1.game_wallet_transactions SET state='rejected' WHERE owner=$1 AND project_id=$2 AND id=$3 AND state IN ('prepared','dispatching') AND transaction_hash IS NULL AND prepared_transaction=$4::jsonb AND state=$5 RETURNING *",[scope.ownerId,scope.projectId,id,JSON.stringify(saved.step),saved.receipt.state])).rows[0];if(!row)throw new ProjectError("game-state","The wallet request changed or was submitted. Check its saved state.",409);return walletView(row);});
 }
 async function ingest(scope:ProjectScope,id:string,input:SignedGameEvent){
  const saved=await currentBinding(scope,id),event=await verifyGameEvent(saved.binding,input,now()),hash=projectHash(event);
  return projectTransaction(pool,scope,async db=>{
   const project=(await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR SHARE",[scope.ownerId,scope.projectId])).rows[0];if(project?.current_revision!==saved.binding.revisionId)throw currentError();
   const latest=(await db.query("SELECT version FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2 AND id=$3 AND active FOR SHARE",[scope.ownerId,scope.projectId,id])).rows[0];if(latest?.version!==saved.version)throw currentError();
   const wallet=(await db.query("SELECT player FROM programmable_projects_v1.game_wallets WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND version=$4 AND player_id_hash=$5",[scope.ownerId,scope.projectId,id,saved.version,event.playerIdHash])).rows[0];if(String(wallet?.player).toLowerCase()!==event.player.toLowerCase())throw new ProjectError("game-wallet","The event does not match a signed player wallet.",409);
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`game-events:${scope.ownerId}`]);
   const prior=(await db.query("SELECT * FROM programmable_projects_v1.game_events WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4",[scope.ownerId,scope.projectId,id,event.eventId])).rows[0];
   if(prior){if(prior.payload_hash!==hash||prior.binding_version!==saved.version)throw new ProjectError("game-replay","This event identity already has a different payload or revision.",409);return view(prior);}
   const hourly=(await db.query("SELECT count(*) AS count FROM programmable_projects_v1.game_events WHERE owner=$1 AND created_at>=$2",[scope.ownerId,new Date(Math.floor(now()/3600)*3600000).toISOString()])).rows[0];
   if(Number(hourly.count)>=120)throw new ProjectError("game-rate","This account's hourly game-event allowance is full.",429);
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
   const row=(await db.query("UPDATE programmable_projects_v1.game_events SET prepared_transaction=$5::jsonb,state='prepared' WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4 AND state IN ('received','prepared') AND binding_version=$6 AND COALESCE(prepared_transaction->>'dispatchedAt','')='' RETURNING *",[scope.ownerId,scope.projectId,id,eventId,JSON.stringify(transaction),saved.version])).rows[0];if(!row)throw new ProjectError("game-state","Reconcile this event's previous wallet request first.",409);return view(row);
  });
 }
 async function dispatchEvent(scope:ProjectScope,id:string,eventId:string,stepId:string,account:string,dispatchId?:string){
  if(dispatchId!==undefined)walletRequestId(dispatchId);const attemptId=dispatchId??randomUUID();
  const saved=await readEvent(scope,id,eventId);return projectTransaction(pool,scope,async db=>{
   const current=(await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR SHARE",[scope.ownerId,scope.projectId])).rows[0];if(current?.current_revision!==saved.binding.revisionId)throw currentError();
   const active=(await db.query("SELECT version FROM programmable_projects_v1.game_bindings WHERE owner=$1 AND project_id=$2 AND id=$3 AND active FOR SHARE",[scope.ownerId,scope.projectId,id])).rows[0];if(active?.version!==saved.version)throw currentError();
   const row=(await db.query("SELECT * FROM programmable_projects_v1.game_events WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4 FOR UPDATE",[scope.ownerId,scope.projectId,id,eventId])).rows[0],step=row?.prepared_transaction as DispatchedStep|undefined;
   if(row?.state!=="prepared"||!step||step.id!==stepId)throw new ProjectError("game-state","Review the current event transaction before signing.",409);
   if(step.transaction.from.toLowerCase()!==account.toLowerCase())throw new ProjectError("game-wallet","This event was prepared for another wallet.",403);
   if(step.expiresAt<=now())throw new ProjectError("game-expired","This event request expired. Keep it for recovery.",409);
   if(step.walletRejected)throw new ProjectError("game-state","Prepare a new review after a wallet rejection.",409);
   if(step.dispatchedAt!==undefined){if(dispatchId!==undefined&&step.dispatchId===dispatchId)return {...view(row),step,dispatchId};throw new ProjectError("game-state","This event request has already started. Reconcile it first.",409);}
   const prepared={...step,state:"dispatching" as const,dispatchedAt:now(),dispatchId:attemptId};await db.query("UPDATE programmable_projects_v1.game_events SET prepared_transaction=$5::jsonb WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4",[scope.ownerId,scope.projectId,id,eventId,JSON.stringify(prepared)]);return {...view(row),step:prepared,dispatchId:attemptId};
  });
 }
 async function rejectedEvent(scope:ProjectScope,id:string,eventId:string,stepId:string,account:string,dispatchId?:string){
  const saved=await readEvent(scope,id,eventId,true),step=saved.transaction as unknown as DispatchedStep;
  if(!step?.transaction||step.id!==stepId||step.transaction.from.toLowerCase()!==account.toLowerCase())throw new ProjectError("game-wallet","This event was prepared for another wallet request.",403);
  if(step.dispatchedAt!==undefined&&(dispatchId===undefined||step.dispatchId!==dispatchId))throw new ProjectError("game-state","The event dispatch identity changed.",409);
  return projectTransaction(pool,scope,async db=>{const row=(await db.query("UPDATE programmable_projects_v1.game_events SET prepared_transaction=(prepared_transaction-'dispatchedAt')||jsonb_build_object('state','rejected','walletRejected',true) WHERE owner=$1 AND project_id=$2 AND binding_id=$3 AND event_id=$4 AND state='prepared' AND transaction_hash IS NULL AND prepared_transaction->>'id'=$5 AND prepared_transaction=$6::jsonb RETURNING *",[scope.ownerId,scope.projectId,id,eventId,stepId,JSON.stringify(step)])).rows[0];if(!row)throw new ProjectError("game-state","The event request changed or was submitted. Check its saved state.",409);return view(row);});
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
  walletTransactions:(await db.query("SELECT * FROM programmable_projects_v1.game_wallet_transactions WHERE owner=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100",[scope.ownerId,scope.projectId])).rows.map(walletView),
 }));
 const revoke=(scope:ProjectScope,id:string)=>projectTransaction(pool,scope,db=>db.query("UPDATE programmable_projects_v1.game_bindings SET active=false WHERE owner=$1 AND project_id=$2 AND id=$3",[scope.ownerId,scope.projectId,id]));
 return {saveBinding,readBinding,currentBinding,link,readWallet,prepareWalletTransaction,readWalletTransaction,dispatchWalletTransaction,submittedWalletTransaction,observedWalletTransaction,pendingWalletTransaction,rejectedWalletTransaction,ingest,route,readEvent,prepared,dispatchEvent,rejectedEvent,submitted,observed,pendingAgain,list,revoke};
}
