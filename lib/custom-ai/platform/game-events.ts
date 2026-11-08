import {getAddress,verifyTypedData,type Address,type Hex} from "viem";
import {ProjectError} from "./types";

export type GameBinding={id:Hex;revisionId:string;gameId:string;chainId:1|4663;target:Address;runtimeHash:Hex;issuer:Address;maxAge:number;maximumScore:string};
export type GameConfiguration=Pick<GameBinding,"gameId"|"chainId"|"issuer"|"maxAge"|"maximumScore">;
export type GameEvent={eventId:Hex;playerIdHash:Hex;player:Address;sequence:string;score:string;observedAt:number;validUntil:number};
export type SignedGameEvent=GameEvent&{signature:Hex};
export type WalletLink={player:Address;playerIdHash:Hex;nonce:Hex;validUntil:number};
export type WalletLinkInvitation=WalletLink&{issuerSignature:Hex};
export type SignedWalletLink=WalletLink&{signature:Hex;issuerSignature:Hex};
const bytes32=(value:unknown):value is Hex=>typeof value==="string"&&/^0x[a-f0-9]{64}$/i.test(value)&&!/^0x0{64}$/.test(value);
const address=(value:unknown):value is Address=>typeof value==="string"&&/^0x[a-f0-9]{40}$/i.test(value)&&!/^0x0{40}$/.test(value);
const decimal=(value:unknown):value is string=>typeof value==="string"&&/^(?:0|[1-9][0-9]{0,77})$/.test(value);
const invalid=()=>new ProjectError("game-event","The game event does not match its signed, current binding.",422);
export function assertGameConfiguration(configuration:GameConfiguration){
 if(!configuration||typeof configuration.gameId!=="string"||!/^[a-z0-9-]{1,80}$/.test(configuration.gameId)||![1,4663].includes(configuration.chainId)||!address(configuration.issuer)||!Number.isInteger(configuration.maxAge)||configuration.maxAge<1||configuration.maxAge>86400||!decimal(configuration.maximumScore)||BigInt(configuration.maximumScore)<1n||BigInt(configuration.maximumScore)>1000000000n)throw invalid();
}
export function assertGameBinding(binding:GameBinding){
 if(!binding||!bytes32(binding.id)||!/^sha256:[a-f0-9]{64}$/.test(binding.revisionId)||!address(binding.target)||!bytes32(binding.runtimeHash))throw invalid();
 assertGameConfiguration(binding);
}
const domain=(binding:GameBinding)=>({name:"Programmable Project Events",version:"1",chainId:binding.chainId,verifyingContract:getAddress(binding.target)} as const);
export const GAME_EVENT_FIELDS=[{name:"bindingId",type:"bytes32"},{name:"eventId",type:"bytes32"},{name:"playerIdHash",type:"bytes32"},{name:"player",type:"address"},{name:"sequence",type:"uint64"},{name:"score",type:"uint256"},{name:"observedAt",type:"uint64"},{name:"validUntil",type:"uint64"}] as const;
export function gameEventTypedData(binding:GameBinding,event:GameEvent){
 return {domain:domain(binding),primaryType:"GameEvent" as const,types:{GameEvent:GAME_EVENT_FIELDS},message:{bindingId:binding.id,eventId:event.eventId,playerIdHash:event.playerIdHash,player:getAddress(event.player),sequence:BigInt(event.sequence),score:BigInt(event.score),observedAt:BigInt(event.observedAt),validUntil:BigInt(event.validUntil)}};
}
export function walletLinkTypedData(binding:GameBinding,link:WalletLink){
 return {domain:domain(binding),primaryType:"WalletLink" as const,types:{WalletLink:[{name:"bindingId",type:"bytes32"},{name:"player",type:"address"},{name:"playerIdHash",type:"bytes32"},{name:"nonce",type:"bytes32"},{name:"validUntil",type:"uint64"}] as const},message:{bindingId:binding.id,player:getAddress(link.player),playerIdHash:link.playerIdHash,nonce:link.nonce,validUntil:BigInt(link.validUntil)}};
}
export async function verifyGameEvent(binding:GameBinding,input:SignedGameEvent,now:number):Promise<SignedGameEvent>{
 assertGameBinding(binding);
 try{
  if(!input||Object.keys(input).some(key=>!["eventId","playerIdHash","player","sequence","score","observedAt","validUntil","signature"].includes(key))||!bytes32(input.eventId)||!bytes32(input.playerIdHash)||!address(input.player)||!decimal(input.sequence)||BigInt(input.sequence)<1n||BigInt(input.sequence)>=(1n<<64n)||!decimal(input.score)||BigInt(input.score)>BigInt(binding.maximumScore)||!Number.isSafeInteger(input.observedAt)||!Number.isSafeInteger(input.validUntil)||input.observedAt<0||input.observedAt>now||now-input.observedAt>binding.maxAge||input.validUntil<now||input.validUntil>input.observedAt+binding.maxAge||!/^0x[a-f0-9]{130}$/i.test(input.signature))throw invalid();
  if(!await verifyTypedData({...gameEventTypedData(binding,input),signature:input.signature,address:getAddress(binding.issuer)}))throw invalid();
  return {...input,player:getAddress(input.player)};
 }catch{throw invalid();}
}
export async function verifyWalletInvitation(binding:GameBinding,input:WalletLinkInvitation,now:number):Promise<WalletLinkInvitation>{
 assertGameBinding(binding);
 try{
  if(!input||Object.keys(input).some(key=>!["player","playerIdHash","nonce","validUntil","issuerSignature"].includes(key))||!address(input.player)||!bytes32(input.playerIdHash)||!bytes32(input.nonce)||!Number.isSafeInteger(input.validUntil)||input.validUntil<now||input.validUntil>now+600||!/^0x[a-f0-9]{130}$/i.test(input.issuerSignature))throw invalid();
  if(!await verifyTypedData({...walletLinkTypedData(binding,input),signature:input.issuerSignature,address:getAddress(binding.issuer)}))throw invalid();
  return {...input,player:getAddress(input.player)};
 }catch{throw invalid();}
}
export async function verifyWalletLink(binding:GameBinding,input:SignedWalletLink,now:number){
 try{
  if(!input||!/^0x[a-f0-9]{130}$/i.test(input.signature))throw invalid();
  const {signature,...invitation}=input;
  const checked=await verifyWalletInvitation(binding,invitation,now);
  if(!await verifyTypedData({...walletLinkTypedData(binding,checked),signature,address:getAddress(checked.player)}))throw invalid();
  return {...checked,signature};
 }catch{throw invalid();}
}
