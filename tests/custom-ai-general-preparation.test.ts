import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({authenticate:vi.fn()}));
vi.mock("../lib/server/creator-article/wallet-principal.server",()=>({
  createPrivyWalletPrincipalAuthenticatorV1:()=>({authenticate:mock.authenticate}),WalletPrincipalAuthenticationErrorV1:class extends Error{},
}));
import {createAIStore,CUSTOM_AI_SCHEMA,type AIStore} from "../lib/custom-ai/store.server";
import {generalPackFixture} from "./fixtures/custom-ai-general-pack";
import {packGeneralGraph} from "../lib/custom-ai/general-pack.server";
import {generalProjectView} from "../lib/custom-ai/project-view";
import {selectExecutionRoute} from "../lib/custom-ai/execution-routing";
import {conversationStorageId} from "../lib/custom-ai/conversation.server";
import {generalPreparationView,type GeneralPackedLaunch,type GeneralPreparation} from "../lib/custom-ai/general-preparation-store.server";
import {createGeneralPublicSource,generalSourcePublicUri} from "../lib/custom-ai/public-launch-source.server";
import {projectGeneralGraphReply} from "../lib/custom-ai/general-launch-response.server";
import {createGeneralPreparationService} from "../lib/custom-ai/general-preparation.server";
import {createCustomAIBackendLaunchBridge} from "../lib/custom-ai/backend-launch.server";
import {authorizeCustomAI} from "../lib/custom-ai/auth.server";
import {parseGeneralPreparationAction} from "../lib/custom-ai/general-preparation-input";
import {CustomAIError} from "../lib/custom-ai/types";

const owner="pack-fixture-owner", ticket="general-prepare-ticket-0001", nextTicket="general-prepare-ticket-0002";
const launchId="20000000-0000-4000-8000-000000000001",requestId="30000000-0000-4000-8000-000000000001";
const time=Date.now(), dataTables=["budgets","jobs","objects"] as const;
let database:PGlite,store:AIStore,clock:number,fixture:Awaited<ReturnType<typeof generalPackFixture>>,pack:GeneralPackedLaunch,record:GeneralPreparation;
let snapshot:Record<string,Record<string,unknown>[]>;
function makeStore(db:PGlite) {
  let queue=Promise.resolve();
  return createAIStore({connect:async()=>{
    const previous=queue;let release!:()=>void;queue=new Promise<void>(resolve=>{release=resolve;});await previous;
    return {query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};
  }},{hourlyUnits:100,dailyUnits:100,globalDailyUnits:100,concurrent:2},()=>clock);
}
function selected(){return {id:fixture.source.binding.sourceId,account:fixture.controller,conversation:fixture.source.binding.conversation,
  studioRevision:record.selection.studioRevision,chainId:1 as const,projectHash:fixture.source.project.hash,
  artifactHash:fixture.source.compilation.artifactHash,intentRevision:fixture.source.binding.intentRevision};}
async function stage(){return store.projects.preparations.completePack(owner,ticket,record.packLease.token,pack);}
const preflight=(r:GeneralPreparation,disposition="needs_evidence")=>({schemaVersion:"programmable.custom-launch-preflight.v1",requestHash:r.requestHash,
  profileRevision:3,serverTime:new Date(clock).toISOString(),disposition,launchEligibility:{deployable:false,routable:false,featured:false},
  hardBlockFindingCodes:[],needsEvidenceFindingCodes:["REVIEW_REQUIRED"],warningFindingCodes:[],quotaConsumed:false,nonceAllocated:false,persisted:false,
  walletSignatureRequiredLater:true,walletBroadcastByService:false});
const resource=(r:GeneralPreparation)=>({schemaVersion:"programmable.custom-launch.v3",requestHash:r.requestHash,launchId,requestId,
  ownerWallet:r.account,routeId:"custom-launch:create:v3",launchProfileVersion:"3.6.0",launchProfileHash:r.launchProfileHash,
  launchIntentHash:r.launchIntentHash,status:"pending_review"});
async function markPreflight(){
  const claim=await store.projects.preparations.claimExchange(owner,ticket,"preflight",record.productionId);
  const reply=preflight(claim.record);
  return store.projects.preparations.finishExchange(owner,ticket,"preflight",claim.lease!,{state:"completed",reply,
    summary:projectGeneralGraphReply("preflight",{httpStatus:200,value:reply,location:null},claim.record)});
}
async function request(){
  const req=new Request("https://programmable.market/api/custom-ai/general-launch",{method:"POST",headers:{origin:"https://programmable.market"}});
  return {req,authority:await authorizeCustomAI(req)};
}
function service(fetchBackend:typeof fetch,production=vi.fn().mockImplementation(async()=>structuredClone(fixture.source.project.production!))) {
  const bridge=createCustomAIBackendLaunchBridge({backendBaseUrl:"https://api.test/",websiteToken:"w".repeat(43),assertionKey:"k".repeat(43),fetchBackend,
    now:()=>new Date(clock),timeoutMs:1000});
  return {production,instance:createGeneralPreparationService({store,image:vi.fn(),bridge:()=>bridge,production,now:()=>clock})};
}
beforeAll(async()=>{
  clock=time;fixture=await generalPackFixture(1);
  const db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);const seed=makeStore(db);
  const binding=fixture.source.binding, sourceId=binding.sourceId;
  await seed.conversations.create(owner,fixture.controller,binding.conversation);
  const storageId=conversationStorageId(fixture.controller,binding.conversation);
  let revision=await seed.saveObject(owner,"studio",storageId,{settings:binding.settings,messages:[],image:binding.image},0);
  const reserved=await seed.reserve(owner,{id:sourceId,intent:"build",messages:[{role:"user",content:"Private preparation conversation"}],
    conversation:{account:fixture.controller,id:binding.conversation,revision}});
  await seed.projects.saveBlueprint(owner,sourceId,reserved.lease!,{intent:fixture.source.project.intent,blueprint:fixture.source.blueprint});
  await seed.projects.save(owner,sourceId,reserved.lease!,fixture.source.project);
  await seed.projects.complete(owner,sourceId,reserved.lease!,fixture.source.compilation);
  await seed.projects.saveScenarios(owner,sourceId,reserved.lease!,fixture.source.scenarios);
  const view=generalProjectView({version:1,reply:"Source checked",summary:"Marker",project:fixture.source.project,compilation:fixture.source.compilation,
    scenarios:fixture.source.scenarios,blueprintId:fixture.source.blueprint.id,selection:selectExecutionRoute(fixture.source.project.intent,1),requirementCoverage:"proposed",launchReady:false});
  await seed.finish(owner,sourceId,reserved.lease!,{reply:"Source checked",generalProject:view,intent:fixture.source.project.intent,change:"applied"});
  revision=await seed.saveObject(owner,"studio",storageId,{settings:binding.settings,image:binding.image,messages:[],draftId:sourceId,sourceId,contextId:sourceId},revision);
  const selection={id:sourceId,account:fixture.controller,conversation:binding.conversation,studioRevision:revision,chainId:1 as const,
    projectHash:fixture.source.project.hash,artifactHash:fixture.source.compilation.artifactHash,intentRevision:binding.intentRevision};
  const preparation=await seed.projects.preparations.reserve(owner,ticket,selection);
  record=preparation.record;fixture.source=preparation.source!;fixture.exported=createGeneralPublicSource(fixture.source);fixture.url=generalSourcePublicUri(fixture.exported.id);
  // One actual local compiler/runtime/canonical pack is reused by restoring
  // this exact saved identity. No generated receipt substitutes for this pack.
  pack=await packGeneralGraph({...fixture,identity:record.identity});
  snapshot={};for(const name of dataTables)snapshot[name]=(await db.query<Record<string,unknown>>(`SELECT * FROM programmable_custom_ai_v1.${name}`)).rows;
  await db.close();
},120_000);
beforeEach(async()=>{
  clock=time;database=new PGlite();await database.exec(CUSTOM_AI_SCHEMA);
  for(const name of dataTables)await database.query(`INSERT INTO programmable_custom_ai_v1.${name}
    SELECT * FROM jsonb_populate_recordset(NULL::programmable_custom_ai_v1.${name},$1::jsonb)`,[JSON.stringify(snapshot[name])]);
  store=makeStore(database);
  vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED","true");vi.spyOn(Date,"now").mockImplementation(()=>clock);
  mock.authenticate.mockResolvedValue({privyUserId:owner,privySessionId:"current",wallets:[fixture.controller]});
});
afterEach(async()=>{await database?.close();vi.restoreAllMocks();vi.unstubAllEnvs();vi.clearAllMocks();});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("durable general launch preparation",()=>{
  it("deduplicates concurrent clicks and changed browser IDs without allocating another nonce or CPU budget",async()=>{
    const [a,b]=await Promise.all([store.projects.preparations.reserve(owner,ticket,selected()),store.projects.preparations.reserve(owner,nextTicket,selected())]);
    for(const result of [a,b]){expect(result.record.id).toBe(ticket);expect(result.record.identity).toEqual(record.identity);expect(result.lease).toBeNull();}
    expect((await database.query("SELECT id FROM programmable_custom_ai_v1.objects WHERE kind='general-prepare'")).rows).toHaveLength(1);
    expect((await database.query<{used:number}>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject=$1",[`operation:general-pack:${owner}`])).rows[0].used).toBe(1);
    await expect(store.projects.preparations.reserve(owner,ticket,selected(),"1")).rejects.toMatchObject({code:"launch-preparation-changed"});
  });
  it("publishes sanitized source and exact final bytes atomically, while normal status reads stay compact",async()=>{
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toBeNull();
    const saved=await stage();expect(saved.packState).toBe("complete");expect(saved.requestSha256).toBe(pack.requestSha256);
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toEqual(fixture.exported);
    const publicText=JSON.stringify(await store.projects.readPublicSource(pack.publicSourceId.slice(7)));
    expect(publicText).not.toContain("Private preparation conversation");expect(publicText).not.toContain(owner);
    const view=JSON.stringify(generalPreparationView(saved,clock));
    for(const privateField of ["requestBody","reproducibleConfig","idempotencyKey","sourceLineageNonce","lease","Private preparation"])expect(view).not.toContain(privateField);
    expect(JSON.parse(view).launchReady).toBe(false);expect(Buffer.byteLength(view)).toBeLessThan(2000);
    expect((await store.projects.preparations.completePack(owner,ticket,"old-lease",pack)).packHash).toBe(pack.hash);
    expect(await store.projects.preparations.read("another-owner",ticket)).toBeNull();
  });
  it("rejects edited coin details and source drift after packing without publishing a stale package",async()=>{
    const storageId=conversationStorageId(record.account,record.selection.conversation),saved=await store.readObject<{settings:Record<string,unknown>}>(owner,"studio",storageId);
    await store.saveObject(owner,"studio",storageId,{...saved!.value,settings:{...saved!.value.settings,name:"Changed coin"}},saved!.revision);
    await expect(stage()).rejects.toMatchObject({code:"launch-source-changed"});
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toBeNull();
  });
  it("recovers an expired compute lease with the same identity and rejects its old writer",async()=>{
    clock=record.packLease.until+1;
    const resumed=await store.projects.preparations.reserve(owner,ticket,selected());
    expect(resumed.lease).not.toBe(record.packLease.token);expect(resumed.record.identity).toEqual(record.identity);
    await expect(stage()).rejects.toMatchObject({code:"launch-preparation-changed"});
    expect((await store.projects.preparations.completePack(owner,ticket,resumed.lease!,pack)).packHash).toBe(pack.hash);
  });
  it("keeps an unsent text edit while revalidating the complete unchanged launch binding",async()=>{
    const storageId=conversationStorageId(record.account,record.selection.conversation),saved=await store.readObject<object>(owner,"studio",storageId);
    await store.saveObject(owner,"studio",storageId,{...saved!.value,input:"An unsent question for later"},saved!.revision);
    expect((await stage()).bindingHash).toBe(record.bindingHash);
    expect((await store.readObject<{input:string}>(owner,"studio",storageId))!.value.input).toBe("An unsent question for later");
  });
  it("enforces two shared compute leases and rolls back unused budget charges when capacity is occupied",async()=>{
    await store.projects.preparations.failPack(owner,ticket,record.packLease.token,"interrupted");
    for(const slot of [0,1])await database.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value)
      VALUES('system','general-pack-slot',$1,$2) ON CONFLICT(owner,kind,id) DO UPDATE SET value=$2`,
    [`custom-ai-pack-slot-${slot}`,JSON.stringify({token:`other-owner-${slot}`,until:clock+1000,slot})]);
    await expect(store.projects.preparations.reserve(owner,ticket,selected())).rejects.toMatchObject({code:"launch-preparation-busy",status:429});
    expect((await database.query<{used:number}>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject=$1",[`operation:general-pack:${owner}`])).rows[0].used).toBe(1);
    clock+=1001;expect((await store.projects.preparations.reserve(owner,ticket,selected())).lease).toBeTruthy();
  });
  it("does not let explicit compute retries exceed their shared hourly account budget",async()=>{
    await store.projects.preparations.failPack(owner,ticket,record.packLease.token,"interrupted");
    await database.query("UPDATE programmable_custom_ai_v1.budgets SET used=6 WHERE subject=$1",[`operation:general-pack:${owner}`]);
    await expect(store.projects.preparations.reserve(owner,ticket,selected())).rejects.toMatchObject({code:"launch-preparation-budget",status:429});
    expect((await store.projects.preparations.read(owner,ticket))!.packState).toBe("failed");
  });
  it("allows an explicitly new preparation after an unsent window expires, while the old ticket stays immutable",async()=>{
    await stage();clock=Number(record.identity.deadline)*1000+1;
    const fresh=await store.projects.preparations.reserve(owner,nextTicket,selected());
    expect(fresh.record.id).toBe(nextTicket);expect(fresh.record.identity.nonce).not.toBe(record.identity.nonce);
    expect((await store.projects.preparations.read(owner,ticket))!.identity).toEqual(record.identity);
    await expect(store.projects.preparations.claimExchange(owner,ticket,"preflight",record.productionId)).rejects.toMatchObject({code:"launch-preparation-changed"});
  });
  it("detects changed bytes, a different production binding and a corrupted stored pack before transport",async()=>{
    const altered={...pack,requestBody:pack.requestBody+" "};
    await expect(store.projects.preparations.completePack(owner,ticket,record.packLease.token,altered)).rejects.toMatchObject({code:"launch-preparation-storage"});
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toBeNull();
    await stage();await markPreflight();
    await expect(store.projects.preparations.claimExchange(owner,ticket,"create",`sha256:${"f".repeat(64)}`)).rejects.toMatchObject({code:"launch-preparation-changed"});
    await database.query("UPDATE programmable_custom_ai_v1.objects SET value=jsonb_set(value,'{requestBody}',to_jsonb('changed'::text)) WHERE owner=$1 AND kind='general-launch-pack'",[owner]);
    await expect(store.projects.preparations.claimExchange(owner,ticket,"create",record.productionId)).rejects.toMatchObject({code:"launch-preparation-storage"});
  });
  it("requires a matching non-blocked preflight and keeps review admission separate from deployability",async()=>{
    await stage();await expect(store.projects.preparations.claimExchange(owner,ticket,"create",record.productionId)).rejects.toMatchObject({code:"launch-preflight-required"});
    const checked=await markPreflight();expect(checked.preflight?.disposition).toBe("needs_evidence");
    const create=await store.projects.preparations.claimExchange(owner,ticket,"create",record.productionId);
    expect(create.lease).toBeTruthy();expect(create.pack!.requestBody).toBe(pack.requestBody);
    expect(generalPreparationView(create.record,clock).launchReady).toBe(false);
  });
  it("keeps one sending lease and one canonical request when two tabs submit together",async()=>{
    await stage();await markPreflight();
    const results=await Promise.all([store.projects.preparations.claimExchange(owner,ticket,"create",record.productionId),store.projects.preparations.claimExchange(owner,ticket,"create",record.productionId)]);
    expect(results.filter(result=>result.lease)).toHaveLength(1);expect(results.map(result=>result.record.idempotencyKey)).toEqual([record.idempotencyKey,record.idempotencyKey]);
    expect(generalPreparationView(results[1].record,clock).submission?.state).toBe("sending");
  });
  it("persists unknown sends and retries exact bytes and idempotency only after a fresh explicit action",async()=>{
    await stage();await markPreflight();
    const sent:RequestInit[]=[],transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      sent.push(init!);if(sent.length===1)throw new Error("simulated lost response after accepted POST");
      const current=(await store.projects.preparations.read(owner,ticket))!;
      return Response.json(resource(current),{status:200,headers:{location:`/v3/wallet-admin/custom-launches/${launchId}`}});
    });
    const f=service(transport),first=await request();
    await expect(f.instance.exchange(first.req,first.authority,ticket,"create")).rejects.toMatchObject({code:"launch-transport"});
    expect(transport).toHaveBeenCalledTimes(1);expect((await store.projects.preparations.read(owner,ticket))!.submission?.state).toBe("unknown");
    await expect(store.projects.preparations.reserve(owner,nextTicket,selected(),"1")).rejects.toMatchObject({code:"launch-preparation-changed"});
    const next=await request(),view=await f.instance.exchange(next.req,next.authority,ticket,"create");
    expect(transport).toHaveBeenCalledTimes(2);expect(Buffer.from(sent[0].body as Uint8Array)).toEqual(Buffer.from(sent[1].body as Uint8Array));
    expect(new Headers(sent[0].headers).get("idempotency-key")).toBe(record.idempotencyKey);
    expect(new Headers(sent[1].headers).get("idempotency-key")).toBe(record.idempotencyKey);
    expect(new Headers(sent[1].headers).get("x-programmable-bff-assertion-nonce")).not.toBe(new Headers(sent[0].headers).get("x-programmable-bff-assertion-nonce"));
    expect(view.submission).toMatchObject({state:"completed",resourceId:launchId,backendState:"pending_review"});expect(view.launchReady).toBe(false);
    const third=await request();await f.instance.exchange(third.req,third.authority,ticket,"create");
    expect(transport).toHaveBeenCalledTimes(2);expect(f.production).toHaveBeenCalledTimes(2);
  });
  it("recovers a process death after claiming a send without changing the original window",async()=>{
    await stage();await markPreflight();const first=await store.projects.preparations.claimExchange(owner,ticket,"create",record.productionId);
    clock=Number(record.identity.deadline)*1000+1000;
    const next=await store.projects.preparations.claimExchange(owner,ticket,"create",record.productionId);
    expect(next.lease).not.toBe(first.lease);expect(next.record.identity).toEqual(record.identity);expect(next.pack?.requestBody).toBe(pack.requestBody);
    await expect(store.projects.preparations.reserve(owner,nextTicket,selected(),"1")).rejects.toMatchObject({code:"launch-preparation-changed"});
    await expect(store.projects.preparations.finishExchange(owner,ticket,"create",first.lease!,{state:"unknown",summary:{}})).rejects.toMatchObject({code:"launch-preparation-changed"});
  });
  it("rejects a changed session, wallet, live profile or semantic source before an outbound call",async()=>{
    await stage();await markPreflight();const transport=vi.fn(),f=service(transport),current=await request();
    await expect(f.instance.exchange(new Request(current.req),current.authority,ticket,"create")).rejects.toMatchObject({code:"session_changed"});
    mock.authenticate.mockResolvedValue({privyUserId:owner,privySessionId:"new",wallets:[`0x${"44".repeat(20)}`]});
    const wrong=await request();await expect(f.instance.exchange(wrong.req,wrong.authority,ticket,"create")).rejects.toMatchObject({code:"wallet"});
    mock.authenticate.mockResolvedValue({privyUserId:owner,privySessionId:"current",wallets:[fixture.controller]});
    f.production.mockResolvedValue({...fixture.source.project.production!,id:`sha256:${"f".repeat(64)}`});
    const changed=await request();await expect(f.instance.exchange(changed.req,changed.authority,ticket,"create")).rejects.toMatchObject({code:"launch-context-changed"});
    expect(transport).not.toHaveBeenCalled();
  });
  it("prepares from one durable lease and the original compiler package without any outbound mutation",async()=>{
    await store.projects.preparations.failPack(owner,ticket,record.packLease.token,"interrupted");
    const image=vi.fn().mockResolvedValue(fixture.imageBytes),packOnce=vi.fn().mockResolvedValue(pack),bridge=vi.fn();
    const prepare=createGeneralPreparationService({store,image,pack:packOnce,bridge,
      production:vi.fn().mockResolvedValue(fixture.source.project.production!),now:()=>clock});
    const current=await request(),result=await prepare.prepare(current.req,current.authority,{id:ticket,selection:selected()});
    expect(result.packState).toBe("complete");expect(result.launchReady).toBe(false);expect(image).toHaveBeenCalledTimes(1);expect(packOnce).toHaveBeenCalledTimes(1);
    expect(packOnce.mock.calls[0][0]).toMatchObject({identity:record.identity,source:{bindingHash:record.bindingHash}});expect(bridge).not.toHaveBeenCalled();
    const again=await request();await prepare.prepare(again.req,again.authority,{id:nextTicket,selection:selected()});
    expect(packOnce).toHaveBeenCalledTimes(1);expect(image).toHaveBeenCalledTimes(1);
  });
  it("refuses an authority that expires during fresh discovery before claiming or sending",async()=>{
    await stage();await markPreflight();const transport=vi.fn(),production=vi.fn(async()=>{
      clock+=120_001;return structuredClone(fixture.source.project.production!);
    }),f=service(transport,production),current=await request();
    await expect(f.instance.exchange(current.req,current.authority,ticket,"create")).rejects.toMatchObject({code:"session_changed"});
    expect(transport).not.toHaveBeenCalled();expect((await store.projects.preparations.read(owner,ticket))!.submission).toBeUndefined();
  });
  it("keeps a malformed successful response unknown rather than permitting a new identity",async()=>{
    await stage();await markPreflight();const transport=vi.fn().mockResolvedValue(Response.json({status:"ok"})),f=service(transport),current=await request();
    await expect(f.instance.exchange(current.req,current.authority,ticket,"create")).rejects.toMatchObject({code:"launch-response-binding"});
    const saved=(await store.projects.preparations.read(owner,ticket))!;expect(saved.submission?.state).toBe("unknown");
    expect(saved.identity).toEqual(record.identity);expect(transport).toHaveBeenCalledTimes(1);
    await expect(store.projects.preparations.reserve(owner,nextTicket,selected(),"1")).rejects.toMatchObject({code:"launch-preparation-changed"});
  });
  it("does not accept an unrelated HTTP 200 as a preflight, resource or launch proof",async()=>{
    const saved=await stage();
    for(const patch of [{requestHash:`sha256:${"f".repeat(64)}`},{persisted:true},{nonceAllocated:true},{walletBroadcastByService:true},{schemaVersion:"unexpected"}])
      expect(()=>projectGeneralGraphReply("preflight",{httpStatus:200,value:{...preflight(saved),...patch},location:null},saved)).toThrow(CustomAIError);
    const hard=projectGeneralGraphReply("preflight",{httpStatus:200,value:{...preflight(saved),hardBlockFindingCodes:["SOURCE_INVALID"]},location:null},saved);
    expect(hard.disposition).toBe("unsupported");
    for(const patch of [{requestHash:`sha256:${"f".repeat(64)}`},{ownerWallet:`0x${"44".repeat(20)}`},{launchProfileHash:`sha256:${"f".repeat(64)}`},{status:"live"}])
      expect(()=>projectGeneralGraphReply("create",{httpStatus:200,value:{...resource(saved),...patch},location:`/v3/wallet-admin/custom-launches/${launchId}`},saved)).toThrow(CustomAIError);
  });
  it("refuses browser-supplied internal binding receipts, prepared source or silently substituted chains",()=>{
    const good={action:"prepare",id:ticket,selection:selected()};expect(parseGeneralPreparationAction(good)).toEqual(good);
    for(const bad of [{...good,requestBody:pack.requestBody},{...good,selection:{...good.selection,bindingHash:record.bindingHash}},
      {...good,selection:{...good.selection,chainId:"1"}},{action:"create",id:ticket,nonce:record.identity.nonce}])expect(()=>parseGeneralPreparationAction(bad)).toThrow(CustomAIError);
  });
});
