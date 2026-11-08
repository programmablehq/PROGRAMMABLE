import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {privateKeyToAccount} from "viem/accounts";
import {keccak256,type Hex} from "viem";
vi.mock("server-only",()=>({}));
import {createGameEventStore,gameBindingId} from "../lib/custom-ai/platform/event-store.server";
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {walletLinkTypedData,gameEventTypedData,type GameBinding} from "../lib/custom-ai/platform/game-events";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import type {AIPool} from "../lib/custom-ai/store.server";
import type {LaunchStep} from "../lib/custom-ai/launch-session";
import {createGameEventService} from "../lib/custom-ai/platform/event-chain.server";
import code from "../lib/custom-ai/platform/game-events-code.json";
import type {CustomAIChain} from "../lib/custom-ai/chain.server";
const owner={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"},issuer=privateKeyToAccount(`0x${"11".repeat(32)}`),player=privateKeyToAccount(`0x${"22".repeat(32)}`);
const playerIdHash=`0x${"77".repeat(32)}` as Hex,hash=`0x${"88".repeat(32)}` as Hex,now=1800000000;
let db:PGlite,store:ReturnType<typeof createGameEventStore>,projects:ReturnType<typeof createPlatformStore>,binding:GameBinding,step:LaunchStep;
let beforeConnection:(()=>Promise<void>)|undefined;
beforeEach(async()=>{
 beforeConnection=undefined;db=new PGlite();await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const interleave=beforeConnection;beforeConnection=undefined;await interleave?.();const prior=tail;let release!:()=>void;tail=new Promise<void>(done=>{release=done});await prior;return {query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};}};
 projects=createPlatformStore(pool);const current=await projects.createProject(owner);const config={revisionId:current.revisionId,gameId:"maze",chainId:4663 as const,issuer:issuer.address,target:`0x${"55".repeat(20)}` as Hex,runtimeHash:keccak256(code.artifacts.ProjectPlayerGameEventsV1.runtimeTemplate as Hex),maxAge:300,maximumScore:"1"};
 binding={...config,id:gameBindingId(owner,config)};store=createGameEventStore(pool,projects,()=>now);await store.saveBinding(owner,binding);
 const proof={player:player.address,playerIdHash,nonce:`0x${"99".repeat(32)}` as Hex,validUntil:now+120};await store.link(owner,binding.id,{...proof,signature:await player.signTypedData(walletLinkTypedData(binding,proof)),issuerSignature:await issuer.signTypedData(walletLinkTypedData(binding,proof))});
 step={id:"step-one",kind:"program-action",state:"prepared",preparedBlock:"100",expiresAt:now+120,transaction:{from:player.address,to:binding.target,data:"0x1234",chainId:4663,value:"0x0",gas:"0x100000",nonce:"0x1"}};
});
afterEach(async()=>{await db.close()});
it("reserves one durable wallet-link request across concurrent preparations",async()=>{
 const [a,b]=await Promise.all([store.prepareWalletTransaction(owner,binding.id,playerIdHash,step),store.prepareWalletTransaction(owner,binding.id,playerIdHash,{...step,id:"second-proposal"})]);
 expect(a.id).toBe(b.id);expect(b.step.id).toBe("step-one");expect((await store.list(owner)).walletTransactions).toHaveLength(1);
});
it("retains a dispatched unknown request instead of replacing its nonce",async()=>{
 const first=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step);
 const dispatched=await store.dispatchWalletTransaction(owner,first.id,player.address);expect(dispatched.state).toBe("dispatching");
 await expect(store.dispatchWalletTransaction(owner,first.id,player.address)).rejects.toMatchObject({code:"game-state"});
 const repeat=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,{...step,id:"replacement",transaction:{...step.transaction,nonce:"0x2"}});
 expect(repeat.id).toBe(first.id);expect(repeat.step.transaction.nonce).toBe("0x1");expect(repeat.state).toBe("dispatching");
});
it("can recover a lost dispatch acknowledgement only with the same stored client attempt",async()=>{
 const first=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step),attempt="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const sent=await store.dispatchWalletTransaction(owner,first.id,player.address,attempt);
 expect(sent.dispatchId).toBe(attempt);
 expect((await store.dispatchWalletTransaction(owner,first.id,player.address,attempt)).step).toEqual(sent.step);
 await expect(store.dispatchWalletTransaction(owner,first.id,player.address,"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).rejects.toMatchObject({code:"game-state"});
});
it("allows a new reviewed request only after an explicit rejection",async()=>{
 const first=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step);const dispatch=await store.dispatchWalletTransaction(owner,first.id,player.address);
 expect((await store.rejectedWalletTransaction(owner,first.id,player.address,dispatch.dispatchId!)).state).toBe("rejected");
 const next=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,{...step,id:"new-review"});expect(next.id).not.toBe(first.id);
 await store.submittedWalletTransaction(owner,next.id,player.address,hash);
 await expect(store.rejectedWalletTransaction(owner,next.id,player.address)).rejects.toMatchObject({code:"game-state"});
});
it("cancels an unsent review but requires the exact dispatch identity after it starts",async()=>{
 const first=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step);
 expect((await store.rejectedWalletTransaction(owner,first.id,player.address)).state).toBe("rejected");
 const next=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step);await store.dispatchWalletTransaction(owner,next.id,player.address);
 await expect(store.rejectedWalletTransaction(owner,next.id,player.address)).rejects.toMatchObject({code:"game-state"});
});
it("does not cancel a wallet dispatch that wins a concurrent unsent cancellation",async()=>{
 const first=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step);
 const results=await Promise.allSettled([store.rejectedWalletTransaction(owner,first.id,player.address),store.dispatchWalletTransaction(owner,first.id,player.address)]);
 expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
});
it("does not cancel an event dispatch that wins a concurrent unsent cancellation",async()=>{
 const event={eventId:`0x${"ac".repeat(32)}` as Hex,playerIdHash,player:player.address,sequence:"1",score:"1",observedAt:now,validUntil:now+120};
 await store.ingest(owner,binding.id,{...event,signature:await issuer.signTypedData(gameEventTypedData(binding,event))});await store.prepared(owner,binding.id,event.eventId,JSON.parse(JSON.stringify(step)));
 const results=await Promise.allSettled([store.rejectedEvent(owner,binding.id,event.eventId,step.id,player.address),store.dispatchEvent(owner,binding.id,event.eventId,step.id,player.address)]);
 expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
});
it("rechecks an event dispatch committed after the cancellation's initial read",async()=>{
 const event={eventId:`0x${"ad".repeat(32)}` as Hex,playerIdHash,player:player.address,sequence:"1",score:"1",observedAt:now,validUntil:now+120};
 await store.ingest(owner,binding.id,{...event,signature:await issuer.signTypedData(gameEventTypedData(binding,event))});await store.prepared(owner,binding.id,event.eventId,JSON.parse(JSON.stringify(step)));
 beforeConnection=async()=>{beforeConnection=async()=>{await store.dispatchEvent(owner,binding.id,event.eventId,step.id,player.address)}};
 await expect(store.rejectedEvent(owner,binding.id,event.eventId,step.id,player.address)).rejects.toMatchObject({code:"game-state"});
 expect((await store.readEvent(owner,binding.id,event.eventId,true)).receipt.walletPending).toBe(true);
});
it("stores observed results only for the original transaction hash and can reopen after a reorg",async()=>{
 const first=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step);await store.submittedWalletTransaction(owner,first.id,player.address,hash);
 await expect(store.observedWalletTransaction(owner,first.id,`0x${"ab".repeat(32)}`,true,{block:"100"})).rejects.toMatchObject({code:"game-state"});
 expect((await store.observedWalletTransaction(owner,first.id,hash,true,{block:"100"})).state).toBe("confirmed");
 expect((await store.pendingWalletTransaction(owner,first.id,hash)).state).toBe("submitted");
});
it("keeps submitted-hash acknowledgement idempotent after a project edit",async()=>{
 const first=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step);await store.dispatchWalletTransaction(owner,first.id,player.address);
 await projects.applyProjectPatch({...owner,expectedRevisionId:binding.revisionId,idempotencyKey:"later",patch:{title:"Later source"}});
 await expect(store.dispatchWalletTransaction(owner,first.id,player.address)).rejects.toMatchObject({code:"game-revision"});
 expect((await store.submittedWalletTransaction(owner,first.id,player.address,hash)).state).toBe("submitted");
 expect((await store.submittedWalletTransaction(owner,first.id,player.address,hash)).transactionHash).toBe(hash);
 await expect(store.submittedWalletTransaction(owner,first.id,player.address,`0x${"aa".repeat(32)}`)).rejects.toMatchObject({code:"game-state"});
 const saved=await store.readWalletTransaction(owner,first.id);expect(saved.binding.revisionId).toBe(binding.revisionId);expect(saved.step.transaction.nonce).toBe("0x1");
});
it("denies another owner and another signing account",async()=>{
 const first=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step);
 await expect(store.readWalletTransaction({...owner,ownerId:"bob"},first.id)).rejects.toMatchObject({code:"game-wallet-transaction"});
 await expect(store.dispatchWalletTransaction(owner,first.id,issuer.address)).rejects.toMatchObject({code:"game-wallet"});
});
it("retains wallet attempts through schema reapplication and enforces database row isolation",async()=>{
 const first=await store.prepareWalletTransaction(owner,binding.id,playerIdHash,step);await db.exec(PROJECT_PLATFORM_SCHEMA);
 expect((await store.readWalletTransaction(owner,first.id)).step.id).toBe(step.id);
 await db.exec("CREATE ROLE game_wallet_reader NOLOGIN; GRANT USAGE ON SCHEMA programmable_projects_v1 TO game_wallet_reader; GRANT SELECT ON programmable_projects_v1.game_wallet_transactions TO game_wallet_reader;");
 await db.query("SELECT set_config('programmable.project_owner','bob',false)");await db.exec("SET ROLE game_wallet_reader");
 try{expect((await db.query("SELECT id FROM programmable_projects_v1.game_wallet_transactions")).rows).toHaveLength(0);}
 finally{await db.exec("RESET ROLE");}
});
it("freezes the prepared event transaction once dispatch begins",async()=>{
 const event={eventId:`0x${"aa".repeat(32)}` as Hex,playerIdHash,player:player.address,sequence:"1",score:"1",observedAt:now,validUntil:now+120};
 await store.ingest(owner,binding.id,{...event,signature:await issuer.signTypedData(gameEventTypedData(binding,event))});await store.prepared(owner,binding.id,event.eventId,JSON.parse(JSON.stringify(step)));
 await store.dispatchEvent(owner,binding.id,event.eventId,step.id,player.address);
 await expect(store.prepared(owner,binding.id,event.eventId,JSON.parse(JSON.stringify({...step,id:"later"})))).rejects.toMatchObject({code:"game-state"});
});
function serviceFixture(){
 let linked=false,confirmed=false,recovered:Hex|undefined=hash;
 const chain={chainId:4663,block:{timestamp:String(now),number:"100"},code:async()=>code.artifacts.ProjectPlayerGameEventsV1.runtimeTemplate,finish:async()=>{},call:async(_address:string,fn:string)=>fn.includes("bindingId")?binding.id:fn.includes("issuer")?issuer.address:fn.includes("maxAge")?300n:fn.includes("maximumScore")?1n:fn.includes("walletForPlayer")?linked?player.address:`0x${"00".repeat(20)}`:fn.includes("consumed")?confirmed:0n} as unknown as CustomAIChain;
 const make=vi.fn(async()=>step),recover=vi.fn<(chain:CustomAIChain,step:LaunchStep)=>Promise<Hex|undefined>>(async()=>recovered),verify=vi.fn(async()=>confirmed?{state:"confirmed" as const,receipt:{hash,blockHash:`0x${"dd".repeat(32)}` as Hex,block:"100",status:"1",logs:[]}}:{state:"pending" as const,receipt:null});
 return {service:createGameEventService(store,async()=>chain,{makeStep:make,verifiedStepReceipt:verify,recoverStepHash:recover}),make,recover,linked:()=>{linked=true},confirmed:()=>{confirmed=true},unknown:()=>{recovered=undefined}};
}
it("recovers the original dispatched wallet link after a source edit",async()=>{
 const f=serviceFixture(),prepared=await f.service.prepareWallet(owner,binding.id,playerIdHash,player.address,[player.address]);
 expect(prepared).toHaveProperty("requestId");const id=prepared.requestId!;
 await f.service.dispatchWallet(owner,binding.id,id,player.address,[player.address]);
 await projects.applyProjectPatch({...owner,expectedRevisionId:binding.revisionId,idempotencyKey:"new-source",patch:{title:"New source"}});
 f.confirmed();f.linked();expect((await f.service.reconcileWallet(owner,binding.id,id)).state).toBe("confirmed");
 expect(f.recover.mock.calls[0][1].transaction.nonce).toBe("0x1");expect(f.make).toHaveBeenCalledOnce();
});
it("does not confirm a receipt without the expected player binding",async()=>{
 const f=serviceFixture(),prepared=await f.service.prepareWallet(owner,binding.id,playerIdHash,player.address,[player.address]);
 await f.service.dispatchWallet(owner,binding.id,prepared.requestId!,player.address,[player.address]);f.confirmed();
 await expect(f.service.reconcileWallet(owner,binding.id,prepared.requestId!)).rejects.toMatchObject({code:"game-observation"});
});
it("retains an unknown wallet result and refuses a second dispatch",async()=>{
 const f=serviceFixture(),prepared=await f.service.prepareWallet(owner,binding.id,playerIdHash,player.address,[player.address]);
 await f.service.dispatchWallet(owner,binding.id,prepared.requestId!,player.address,[player.address]);f.unknown();
 expect((await f.service.reconcileWallet(owner,binding.id,prepared.requestId!)).state).toBe("dispatching");
 await expect(f.service.dispatchWallet(owner,binding.id,prepared.requestId!,player.address,[player.address])).rejects.toMatchObject({code:"game-state"});
 expect(f.make).toHaveBeenCalledOnce();
});
