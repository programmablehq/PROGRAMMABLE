import {randomBytes} from "node:crypto";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {privateKeyToAccount} from "viem/accounts";
import {keccak256,stringToHex} from "viem";
vi.mock("server-only",()=>({}));
import {createGameEventStore,gameBindingId} from "../lib/custom-ai/platform/event-store.server";
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {gameEventTypedData,walletLinkTypedData,type GameBinding} from "../lib/custom-ai/platform/game-events";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import {createGameEventService} from "../lib/custom-ai/platform/event-chain.server";
import {createGameEventRoutes} from "../lib/custom-ai/platform/event-http.server";
import eventCode from "../lib/custom-ai/platform/game-events-code.json";
import type {CustomAIChain} from "../lib/custom-ai/chain.server";
import type {LaunchStep} from "../lib/custom-ai/launch-session";
import type {AIPool} from "../lib/custom-ai/store.server";
let db:PGlite,pool:AIPool,projects:ReturnType<typeof createPlatformStore>,events:ReturnType<typeof createGameEventStore>,binding:GameBinding,now:number;
const owner={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"},issuer=privateKeyToAccount(`0x${"11".repeat(32)}`),player=privateKeyToAccount(`0x${"22".repeat(32)}`),playerIdHash=keccak256(stringToHex("player-1"));
beforeEach(async()=>{now=1800000000;db=new PGlite();await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();pool={connect:async()=>{const old=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});await old;return {query:(s,v)=>db.query<Record<string,unknown>>(s,v),release}}};projects=createPlatformStore(pool);const first=await projects.createProject(owner);const config={revisionId:first.revisionId,gameId:"game",chainId:4663 as const,target:`0x${"55".repeat(20)}` as const,runtimeHash:`0x${"66".repeat(32)}` as const,issuer:issuer.address,maxAge:300,maximumScore:"1000"};binding={...config,id:gameBindingId(owner,config)};events=createGameEventStore(pool,projects,()=>now);await events.saveBinding(owner,binding);});
afterEach(async()=>{await db.close()});
async function link(){const proof={player:player.address,playerIdHash,nonce:keccak256(randomBytes(32)),validUntil:now+120};await events.link(owner,binding.id,{...proof,signature:await player.signTypedData(walletLinkTypedData(binding,proof)),issuerSignature:await issuer.signTypedData(walletLinkTypedData(binding,proof))});}
async function signed(){const event={player:player.address,playerIdHash,eventId:keccak256(stringToHex("match-1")),score:"10",sequence:"1",observedAt:now,validUntil:now+120};return {...event,signature:await issuer.signTypedData(gameEventTypedData(binding,event))};}
it("deduplicates an authenticated event and requires the exact wallet agreement",async()=>{const input=await signed();await expect(events.ingest(owner,binding.id,input)).rejects.toMatchObject({code:"game-wallet"});await link();const first=await events.ingest(owner,binding.id,input),again=await events.ingest(owner,binding.id,input);expect(again.id).toBe(first.id);expect((await events.list(owner)).events).toHaveLength(1);});
it("takes event ownership from authenticated HTTP authority and rejects an injected owner",async()=>{
 await link();const authorize=vi.fn<Parameters<typeof createGameEventRoutes>[0]["authorize"]>(async()=>({ownerId:owner.ownerId,wallets:[player.address]}));const routes=createGameEventRoutes({enabled:()=>true,authorize,consume:async()=>{},events:()=>events,projects:()=>projects,service:()=>({} as never)});
 const body={action:"record",projectId:owner.projectId,bindingId:binding.id,event:await signed()};
 const request=(value:unknown)=>new Request("https://programmable.market/api/custom-ai/platform/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)});
 expect((await routes.POST(request({...body,ownerId:"bob"}))).status).toBe(400);
 const result=await routes.POST(request(body));expect(result.status).toBe(200);expect(await result.json()).toMatchObject({state:"received"});expect(authorize.mock.calls.every(call=>call[1]===true)).toBe(true);
});
it("rejects foreign owners, conflicting duplicate events and stale revision bindings",async()=>{await link();const input=await signed();await events.ingest(owner,binding.id,input);await expect(events.ingest({...owner,ownerId:"bob"},binding.id,input)).rejects.toMatchObject({code:"game-binding"});const changed={...input,score:"12"};changed.signature=await issuer.signTypedData(gameEventTypedData(binding,changed));await expect(events.ingest(owner,binding.id,changed)).rejects.toMatchObject({code:"game-replay"});await projects.applyProjectPatch({...owner,expectedRevisionId:binding.revisionId,idempotencyKey:"edit",patch:{title:"changed"}});await expect(events.ingest(owner,binding.id,input)).rejects.toMatchObject({code:"game-revision"});});
it.each(["ProjectGameEventsV1","ProjectPlayerGameEventsV1"] as const)("preserves unknown transaction results and confirms only observed onchain consumption (%s)",async(receiver)=>{
 const runtime=eventCode.artifacts[receiver].runtimeTemplate as `0x${string}`;binding={...binding,runtimeHash:keccak256(runtime)};await events.saveBinding(owner,binding);await link();const input=await signed();await events.ingest(owner,binding.id,input);
 let consumed=false,confirmed=false;
 const chain={chainId:4663,block:{timestamp:String(now),number:"100"},code:async()=>runtime,finish:async()=>{},call:async(_address:string,fn:string)=>fn.includes("bindingId")?binding.id:fn.includes("issuer")?binding.issuer:fn.includes("maxAge")?300n:fn.includes("maximumScore")?1000n:fn.includes("walletForPlayer")?player.address:fn.includes("consumed")?consumed:fn.includes("sequence")?0n:0n} as unknown as CustomAIChain;
 const step:LaunchStep={id:"step-one",kind:"program-action",state:"prepared",expiresAt:now+120,preparedBlock:"100",transaction:{from:player.address,to:binding.target,data:"0x1234",value:"0x0",chainId:4663,nonce:"0x1",gas:"0x100000"}};
 const make=vi.fn(async()=>step),verify=vi.fn(async()=>confirmed?{state:"confirmed" as const,receipt:{hash:`0x${"ab".repeat(32)}` as const,blockHash:`0x${"cd".repeat(32)}` as const,block:"90",status:"1",logs:[]}}:{state:"pending" as const,receipt:null});
 const service=createGameEventService(events,async()=>chain,{makeStep:make,verifiedStepReceipt:verify});
 await expect(service.prepare(owner,binding.id,input.eventId,issuer.address,[player.address])).rejects.toMatchObject({code:"game-wallet"});expect(make).not.toHaveBeenCalled();
 await service.prepare(owner,binding.id,input.eventId,player.address,[player.address]);await service.recordSubmitted(owner,binding.id,input.eventId,`0x${"ab".repeat(32)}`,player.address,[player.address]);
 expect((await service.reconcile(owner,binding.id,input.eventId)).state).toBe("submitted");confirmed=true;
 await expect(service.reconcile(owner,binding.id,input.eventId)).rejects.toMatchObject({code:"game-observation"});
 await projects.applyProjectPatch({...owner,expectedRevisionId:binding.revisionId,idempotencyKey:"edit-after-submission",patch:{title:"Later source"}});
 consumed=true;expect((await service.reconcile(owner,binding.id,input.eventId)).state).toBe("confirmed");
 expect((await service.recordSubmitted(owner,binding.id,input.eventId,`0x${"ab".repeat(32)}`,player.address,[player.address])).state).toBe("confirmed");
 confirmed=false;expect((await service.reconcile(owner,binding.id,input.eventId)).state).toBe("submitted");
});
