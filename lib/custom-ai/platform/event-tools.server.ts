import "server-only";
import type {ProjectTool} from "./agent.server";
import {gameBindingId,type createGameEventStore} from "./event-store.server";
import {assertGameConfiguration,type GameConfiguration,type SignedGameEvent} from "./game-events";
import {ProjectError,type JsonValue} from "./types";
import code from "./game-events-code.json";
export function gameEventTools(events:ReturnType<typeof createGameEventStore>):ProjectTool[]{
 return [
  {id:"event.identity",version:"1",description:"Derive the canonical game binding ID for this authenticated owner/project before writing or deploying a receiver. Supply the public game policy and use the returned bindingId in the receiver constructor. Ordinary source edits preserve this ID; changing the owner, project or game policy changes it. This read-only action does not deploy or register a receiver, link a wallet, sign a message or record an event. Never invent the binding ID or request the internal owner ID.",schema:{type:"object",additionalProperties:false,properties:{gameId:{type:"string",pattern:"^[a-z0-9-]{1,80}$"},chainId:{enum:[1,4663]},issuer:{type:"string",pattern:"^0x[0-9a-fA-F]{40}$"},maxAge:{type:"integer",minimum:1,maximum:86400},maximumScore:{type:"string",pattern:"^[1-9][0-9]{0,9}$"}},required:["gameId","chainId","issuer","maxAge","maximumScore"]},execute:async(context,input)=>{
   const value=input as GameConfiguration;assertGameConfiguration(value);
   const configuration={gameId:value.gameId,chainId:value.chainId,issuer:value.issuer,maxAge:value.maxAge,maximumScore:value.maximumScore};
   return {bindingId:gameBindingId(context,configuration),revisionId:context.revision.revisionId,configuration,registered:false};
  }},
  {id:"event.library",version:"1",description:"Read pinned source for the project-owned signed community receiver, community-score fee module, and separate individual-player receiver and bonus module. The individual module requires ProjectPlayerGameEventsV1 with one game account per wallet. An individual bonus uses a selected code-pinned router's authenticated msgSender(), never the router address as a player. Verify that router against the project's intended deployment; unsupported identity paths retain regular fees. These contracts hold no platform keys or funds. Player-to-wallet links need both player and game issuer signatures. For isolated positive checks, contract.context documents fixed test signing actors and wallet-link/game-event signature argument references; use those genuine local signatures without requesting private keys. Keep the real service issuer in the deployment configuration. Include the complete selected source closure in the project; preserve existing user-edited source.",schema:{type:"object",additionalProperties:false,properties:{paths:{type:"array",maxItems:15,items:{type:"string"}}},required:["paths"]},execute:async(_context,input)=>{
   const {paths}=input as {paths:string[]},sources=code.sources as Record<string,{content:string;sha256:string}>;const files:Record<string,JsonValue>={};let size=0;
   for(const path of paths){if(!Object.hasOwn(sources,path))throw new ProjectError("game-library","Choose a listed game library.");size+=sources[path].content.length;if(size>120000)throw new ProjectError("game-library","Read fewer source files at a time.",413);files[path]=sources[path].content;}
   return {compiler:code.compiler,bundleHash:code.bundleHash,available:Object.keys(sources),files};
  }},
  {id:"event.status",version:"1",description:"Read this project's registered game bindings and observed event receipts. Received or submitted is not onchain confirmation.",schema:{type:"object",additionalProperties:false,properties:{}},execute:async context=>JSON.parse(JSON.stringify(await events.list(context))) as JsonValue},
  {id:"event.record",version:"1",description:"Record a result signed by an already configured game issuer. It must match the signed player wallet and current project binding. This tool only records the event; it never signs or broadcasts an onchain transaction.",schema:{type:"object",additionalProperties:false,properties:{bindingId:{type:"string"},event:{type:"object"}},required:["bindingId","event"]},execute:async(context,input)=>{
   const value=input as {bindingId:string;event:SignedGameEvent};return JSON.parse(JSON.stringify(await events.ingest(context,value.bindingId,value.event))) as JsonValue;
  },reconcile:async(context,input)=>{const value=input as {bindingId:string;event:SignedGameEvent};return JSON.parse(JSON.stringify((await events.readEvent(context,value.bindingId,value.event.eventId,true)).receipt)) as JsonValue;}},
 ];
}
