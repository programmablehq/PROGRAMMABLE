import "server-only";
import {randomUUID} from "node:crypto";
import {encodeFunctionData,getAddress,keccak256,type Abi,type Address,type Hex} from "viem";
import {customAIChain,type CustomAIChain} from "../chain.server";
import {makeStep,verifiedStepReceipt} from "../transaction.server";
import {matchesRuntime} from "../runtime";
import type {LaunchStep} from "../launch-session";
import type {createGameEventStore} from "./event-store.server";
import {assertGameBinding,verifyGameEvent,verifyWalletLink,type GameBinding} from "./game-events";
import {ProjectError,type ProjectScope,type JsonValue} from "./types";
import code from "./game-events-code.json";

const artifact=code.artifacts.ProjectGameEventsV1;
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value));
function wallet(account:Address,linked:readonly string[]){
 if(!linked.some(value=>value.toLowerCase()===account.toLowerCase()))throw new ProjectError("game-wallet","Choose a wallet linked to your current account.",403);
 return getAddress(account);
}
export function createGameEventService(store:ReturnType<typeof createGameEventStore>,chainFor:(id:1|4663)=>Promise<CustomAIChain>=customAIChain,
 execution:{makeStep:typeof makeStep;verifiedStepReceipt:typeof verifiedStepReceipt}={makeStep,verifiedStepReceipt}){
 async function inspect(binding:GameBinding,chain:CustomAIChain){
  const runtime=await chain.code(binding.target);
  if(keccak256(runtime)!==binding.runtimeHash||!matchesRuntime(runtime,{runtimeTemplate:artifact.runtimeTemplate as Hex,immutableReferences:artifact.immutableReferences}))throw new ProjectError("game-code","The deployed game receiver does not match its reviewed code.",409);
  const [id,issuer,maxAge,maximum]=await Promise.all([
   chain.call(binding.target,"function bindingId() view returns(bytes32)"),chain.call(binding.target,"function issuer() view returns(address)"),
   chain.call(binding.target,"function maxAge() view returns(uint64)"),chain.call(binding.target,"function maximumScore() view returns(uint256)"),
  ]);
  if(id!==binding.id||String(issuer).toLowerCase()!==binding.issuer.toLowerCase()||Number(maxAge)!==binding.maxAge||String(maximum)!==binding.maximumScore)throw new ProjectError("game-binding","The deployed game configuration differs from the project binding.",409);
 }
 async function register(scope:ProjectScope,binding:GameBinding){assertGameBinding(binding);const chain=await chainFor(binding.chainId);await inspect(binding,chain);await chain.finish();return store.saveBinding(scope,binding);}
 async function prepareWallet(scope:ProjectScope,id:string,playerIdHash:string,account:Address,linked:readonly string[]){
  const sender=wallet(account,linked),saved=await store.currentBinding(scope,id),chain=await chainFor(saved.binding.chainId);
  await inspect(saved.binding,chain);
  const proof=await store.readWallet(scope,id,playerIdHash),present=await chain.call(saved.binding.target,"function walletForPlayer(bytes32) view returns(address)",[playerIdHash]);
  if(String(present).toLowerCase()===proof.player.toLowerCase()){await chain.finish();return {state:"linked",step:null};}
  await verifyWalletLink(saved.binding,proof,Number(chain.block.timestamp));
  const data=encodeFunctionData({abi:artifact.abi as Abi,functionName:"bindPlayer",args:[proof.player,proof.playerIdHash,proof.nonce,BigInt(proof.validUntil),proof.signature,proof.issuerSignature]});
  const step=await execution.makeStep(chain,{id:randomUUID(),account:sender,chainId:saved.binding.chainId,state:"preparing",steps:[]},"program-action",saved.binding.target,data,0n,proof.validUntil);
  return {state:"ready_for_wallet",step};
 }
 async function prepare(scope:ProjectScope,id:string,eventId:string,account:Address,linked:readonly string[]){
  const sender=wallet(account,linked),saved=await store.readEvent(scope,id,eventId);
  if(!["received","prepared"].includes(saved.receipt.state))throw new ProjectError("game-state","Reconcile the existing event transaction first.",409);
  const chain=await chainFor(saved.binding.chainId);await inspect(saved.binding,chain);
  await verifyGameEvent(saved.binding,saved.event,Number(chain.block.timestamp));
  const [player,sequence,consumed]=await Promise.all([
   chain.call(saved.binding.target,"function walletForPlayer(bytes32) view returns(address)",[saved.event.playerIdHash]),
   chain.call(saved.binding.target,"function sequence(bytes32) view returns(uint64)",[saved.event.playerIdHash]),
   chain.call(saved.binding.target,"function consumed(bytes32) view returns(bool)",[saved.event.eventId]),
  ]);
  if(String(player).toLowerCase()!==saved.event.player.toLowerCase())throw new ProjectError("game-wallet","Confirm this player's signed wallet link onchain first.",409);
  if(consumed||BigInt(String(sequence))+1n!==BigInt(saved.event.sequence))throw new ProjectError("game-replay","This event was already applied or is out of order.",409);
  const {event}=saved;
  const data=encodeFunctionData({abi:artifact.abi as Abi,functionName:"submitEvent",args:[{
   bindingId:id,eventId:event.eventId,playerIdHash:event.playerIdHash,player:event.player,sequence:BigInt(event.sequence),score:BigInt(event.score),observedAt:BigInt(event.observedAt),validUntil:BigInt(event.validUntil),
  },event.signature]});
  const step=await execution.makeStep(chain,{id:randomUUID(),account:sender,chainId:saved.binding.chainId,state:"preparing",steps:[]},"program-action",saved.binding.target,data,0n,Math.min(event.validUntil,Math.floor(Date.now()/1000)+120));
  const receipt=await store.prepared(scope,id,eventId,json(step));return {...receipt,step};
 }
 async function recordSubmitted(scope:ProjectScope,id:string,eventId:string,hash:Hex,account:Address,linked:readonly string[]){
  const sender=wallet(account,linked),saved=await store.readEvent(scope,id,eventId,true),step=saved.transaction as unknown as LaunchStep;
  if(!step?.transaction||step.transaction.from.toLowerCase()!==sender.toLowerCase())throw new ProjectError("game-wallet","This transaction was prepared for another wallet.",403);
  return store.submitted(scope,id,eventId,hash);
 }
 async function reconcile(scope:ProjectScope,id:string,eventId:string){
  const saved=await store.readEvent(scope,id,eventId,true),hash=saved.receipt.transactionHash;
  if(!hash)return saved.receipt;
  const step=saved.transaction as unknown as LaunchStep;
  if(!step?.transaction)throw new ProjectError("game-state","The original wallet request is missing.",409);
  const chain=await chainFor(saved.binding.chainId);await inspect(saved.binding,chain);
  const result=await execution.verifiedStepReceipt(chain,{...step,hash:hash as Hex});
  if(result.state==="pending"){await chain.finish();return saved.receipt.state==="confirmed"||saved.receipt.state==="failed"?store.pendingAgain(scope,id,eventId,hash as Hex):saved.receipt;}
  if(result.state==="confirmed"&&!await chain.call(saved.binding.target,"function consumed(bytes32) view returns(bool)",[saved.event.eventId]))throw new ProjectError("game-observation","The transaction does not show the expected game event effect.",409);
  await chain.finish();return store.observed(scope,id,eventId,hash as Hex,result.state==="confirmed",json({state:result.state,receipt:result.receipt,bindingVersion:saved.version}));
 }
 return {register,prepareWallet,prepare,recordSubmitted,reconcile};
}
