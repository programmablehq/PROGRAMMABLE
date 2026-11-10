import {beforeAll,beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({authenticate:vi.fn()}));
vi.mock("../lib/server/creator-article/wallet-principal.server",()=>({
  createPrivyWalletPrincipalAuthenticatorV1:()=>({authenticate:mock.authenticate}),WalletPrincipalAuthenticationErrorV1:class extends Error{},
}));
import {generalPackFixture} from "./fixtures/custom-ai-general-pack";
import {sourceAuditModelReply} from "./fixtures/custom-ai-source-audit";
import {auditGeneralSource} from "../lib/custom-ai/source-audit.server";
import {createGeneralPublicSource,generalSourcePublicUri} from "../lib/custom-ai/public-launch-source.server";
import {createAIStore,CUSTOM_AI_SCHEMA,type AIStore} from "../lib/custom-ai/store.server";
import {conversationStorageId} from "../lib/custom-ai/conversation.server";
import {generalProjectView} from "../lib/custom-ai/project-view";
import {selectExecutionRoute} from "../lib/custom-ai/execution-routing";
import {packGeneralRobinhoodPlan} from "../lib/custom-ai/general-plan-pack.server";
import {createGeneralPreparationService} from "../lib/custom-ai/general-preparation.server";
import {createCustomAIBackendLaunchBridge} from "../lib/custom-ai/backend-launch.server";
import {authorizeCustomAI} from "../lib/custom-ai/auth.server";
import {parseGeneralPreparationAction} from "../lib/custom-ai/general-preparation-input";
import {projectGeneralPlanReply} from "../lib/custom-ai/general-launch-response.server";
import type {GeneralPreparation} from "../lib/custom-ai/general-preparation-store.server";
import {canonicalBrowserSha256V2} from "../lib/custom-launch/browser-authority-v2";

const owner="pack-fixture-owner",id="owned-plan-preparation-0001",resourceId="40000000-0000-4000-8000-000000000001",requestId="50000000-0000-4000-8000-000000000001";
const time=Date.now(),tables=["jobs","objects","budgets"] as const;
let fixture:Awaited<ReturnType<typeof generalPackFixture>>,pack:Awaited<ReturnType<typeof packGeneralRobinhoodPlan>>,record:GeneralPreparation;
let database:PGlite,store:AIStore,clock:number,snapshot:Record<string,Record<string,unknown>[]>;
function makeStore(db:PGlite){let queue=Promise.resolve();return createAIStore({connect:async()=>{
  const prior=queue;let release!:()=>void;queue=new Promise<void>(resolve=>{release=resolve;});await prior;
  return {query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};
}},{hourlyUnits:100,dailyUnits:100,globalDailyUnits:100,concurrent:2},()=>clock);}
const selected=()=>({id:fixture.source.binding.sourceId,account:fixture.controller,conversation:fixture.source.binding.conversation,studioRevision:1,chainId:4663 as const,
  projectHash:fixture.source.project.hash,artifactHash:fixture.source.compilation.artifactHash,intentRevision:fixture.source.project.intent.revision});
const stage=()=>store.projects.preparations.completePack(owner,id,record.packLease.token,pack);
async function current(){const req=new Request("https://programmable.market/api/custom-ai/general-launch",{method:"POST",headers:{origin:"https://programmable.market"}});return{req,authority:await authorizeCustomAI(req)};}
function resource(){return {schemaVersion:"programmable.custom-launch-plan-resource.v1",planId:resourceId,requestId,principalId:"canonical-principal",
  planHash:record.requestHash??pack.planHash,rawRequestSha256:pack.requestSha256,manifestDigest:record.manifestDigest,plan:JSON.parse(pack.requestBody),status:"accepted"};}
function service(fetchBackend:typeof fetch){const production=vi.fn().mockResolvedValue(fixture.source.project.production!);
  return {production,instance:createGeneralPreparationService({store,image:vi.fn(),production,now:()=>clock,bridge:()=>createCustomAIBackendLaunchBridge({
    backendBaseUrl:"https://api.test/",websiteToken:"w".repeat(43),assertionKey:"k".repeat(43),fetchBackend,now:()=>new Date(clock),timeoutMs:1000})})};}
beforeAll(async()=>{
  clock=time;fixture=await generalPackFixture(4663);const db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);const seed=makeStore(db),source=fixture.source,binding=source.binding;
  const sourceAudit=await auditGeneralSource(source.project,undefined,{call:async()=>sourceAuditModelReply(source.project)});
  const view=generalProjectView({version:1,reply:"Original checked source",summary:"Marker",project:source.project,compilation:source.compilation,scenarios:source.scenarios,sourceAudit,
    blueprintId:source.blueprint.id,selection:selectExecutionRoute(source.project.intent,4663),requirementCoverage:"proposed",launchReady:false});
  const request={id:binding.sourceId,intent:"build",conversation:{id:binding.conversation,account:fixture.controller,revision:1},coin:binding.settings,
    messages:[{role:"user",content:"Private Plan preparation fixture"}]};
  const result={reply:"Source saved",generalProject:view,intent:source.project.intent,change:"applied"};
  await db.query(`INSERT INTO programmable_custom_ai_v1.jobs(owner,id,payload_hash,request,result,state,lease,reserved,hour,day)
    VALUES($1,$2,$3,$4,$5,'completed','local-fixture',0,0,0)`,[owner,binding.sourceId,binding.payloadHash,JSON.stringify(request),JSON.stringify(result)]);
  const storageId=conversationStorageId(fixture.controller,binding.conversation),objects=[
    ["conversation",storageId,{id:binding.conversation,account:fixture.controller,archived:false,title:"Private Plan",createdAt:new Date(time).toISOString()}],
    ["studio",storageId,{settings:binding.settings,image:binding.image,messages:request.messages,draftId:binding.sourceId,sourceId:binding.sourceId,contextId:binding.contextId}],
    ["contract-project",binding.sourceId,{version:1,requestId:binding.sourceId,payloadHash:binding.payloadHash,project:source.project,compilation:source.compilation,scenarios:source.scenarios,sourceAudit,blueprintId:source.blueprint.id}],
    ["contract-check-blueprint",binding.sourceId,{version:1,requestId:binding.sourceId,payloadHash:binding.payloadHash,intent:source.project.intent,blueprint:source.blueprint}],
  ];
  for(const [kind,key,value]of objects)await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,$2,$3,$4)",[owner,kind,key,JSON.stringify(value)]);
  const reserved=await seed.projects.preparations.reserve(owner,id,selected(),undefined,"eoa");record=reserved.record;
  expect(reserved.source!.bindingHash).toBe(source.bindingHash);
  fixture.source=reserved.source!;fixture.exported=createGeneralPublicSource(fixture.source);fixture.url=generalSourcePublicUri(fixture.exported.id);
  pack=await packGeneralRobinhoodPlan({...fixture,identity:record.identity},{address:record.account,kind:"eoa"});
  snapshot={};for(const table of tables)snapshot[table]=(await db.query<Record<string,unknown>>(`SELECT * FROM programmable_custom_ai_v1.${table}`)).rows;
  await db.close();
},120_000);
beforeEach(async()=>{
  clock=time;database=new PGlite();await database.exec(CUSTOM_AI_SCHEMA);
  for(const table of tables)await database.query(`INSERT INTO programmable_custom_ai_v1.${table} SELECT * FROM jsonb_populate_recordset(NULL::programmable_custom_ai_v1.${table},$1::jsonb)`,[JSON.stringify(snapshot[table])]);
  store=makeStore(database);vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED","true");vi.spyOn(Date,"now").mockImplementation(()=>clock);
  mock.authenticate.mockResolvedValue({privyUserId:owner,privySessionId:"current",wallets:[fixture.controller]});
});
afterEach(async()=>{await database?.close();vi.restoreAllMocks();vi.unstubAllEnvs();vi.clearAllMocks();});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("durable modern Plan source submission",()=>{
  it("prepares the exact unsigned Plan with the configured public source origin",async()=>{
    await store.projects.preparations.failPack(owner,id,record.packLease.token,"interrupted");
    vi.stubEnv("PROJECT_PUBLIC_ORIGIN","https://programmable-project-platform-staging-v1-aficialais-projects.vercel.app");
    const bridge=vi.fn(),packPlan=vi.fn(packGeneralRobinhoodPlan);
    const s=createGeneralPreparationService({store,image:async()=>fixture.imageBytes,
      production:async()=>fixture.source.project.production!,packPlan,bridge,now:()=>clock}),action=await current();
    const view=await s.prepare(action.req,action.authority,{id,selection:selected(),controllerKind:"eoa"});
    expect(view).toMatchObject({packState:"complete",launchReady:false});
    expect(packPlan).toHaveBeenCalledTimes(1);
    expect(packPlan.mock.calls[0][0].url).toMatch(/^https:\/\/programmable-project-platform-staging-v1-aficialais-projects\.vercel\.app\/api\/custom-ai\/source\/[a-f0-9]{64}$/);
    expect(bridge).not.toHaveBeenCalled();
  },30_000);
  it("stores the exact Plan and submits once for canonical review without an extra preflight POST",async()=>{
    const saved=await stage();expect(saved).toMatchObject({chainId:4663,controllerKind:"eoa",manifestDigest:record.manifestDigest,packState:"complete"});
    expect(saved.requestHash).toBe(pack.planHash);expect(saved.launchProfileHash).toBeUndefined();
    const transport=vi.fn().mockResolvedValue(Response.json(resource(),{status:202,headers:{location:`/v4/chains/4663/wallet-admin/custom-launch-plans/${resourceId}`}}));
    const f=service(transport),action=await current(),view=await f.instance.exchange(action.req,action.authority,id,"create");
    expect(transport).toHaveBeenCalledTimes(1);const [url,init]=transport.mock.calls[0] as [URL,RequestInit];
    expect(url.pathname).toBe("/v4/chains/4663/wallet-admin/custom-launch-plans");expect(Buffer.from(init.body as Uint8Array).toString()).toBe(pack.requestBody);
    expect(new Headers(init.headers).get("programmable-launch-response-version")).toBe("1.2");expect(new Headers(init.headers).get("idempotency-key")).toBe(record.idempotencyKey);
    expect(view.submission).toMatchObject({state:"completed",resourceId,backendState:"accepted"});expect(view.launchReady).toBe(false);expect(view.preflight).toBeUndefined();
    const again=await current();await f.instance.exchange(again.req,again.authority,id,"create");expect(transport).toHaveBeenCalledTimes(1);expect(f.production).toHaveBeenCalledTimes(1);
  });
  it("selects the owned modern Plan packer during preparation and persists its original identity",async()=>{
    await store.projects.preparations.failPack(owner,id,record.packLease.token,"interrupted");
    const planOnce=vi.fn().mockResolvedValue(pack),graph=vi.fn(),bridge=vi.fn();
    const s=createGeneralPreparationService({store,image:vi.fn().mockResolvedValue(fixture.imageBytes),production:vi.fn().mockResolvedValue(fixture.source.project.production!),
      packPlan:planOnce,pack:graph,bridge,now:()=>clock}),action=await current();
    const view=await s.prepare(action.req,action.authority,{id,selection:selected(),controllerKind:"eoa"});
    expect(view.packState).toBe("complete");expect(planOnce).toHaveBeenCalledTimes(1);expect(planOnce.mock.calls[0][1]).toEqual({address:record.account,kind:"eoa"});
    expect(planOnce.mock.calls[0][0].identity).toEqual(record.identity);expect(graph).not.toHaveBeenCalled();expect(bridge).not.toHaveBeenCalled();
    expect((await store.projects.preparations.read(owner,id))!.requestHash).toBe(pack.planHash);expect(view.launchReady).toBe(false);
  });
  it("keeps Plan/hash/raw-body/manifest/controller mismatches unknown instead of accepting HTTP success",async()=>{
    const saved=await stage(),base=resource(),location=`/v4/chains/4663/wallet-admin/custom-launch-plans/${resourceId}`;
    for(const patch of [{rawRequestSha256:`sha256:${"f".repeat(64)}`},{planHash:`sha256:${"f".repeat(64)}`},{manifestDigest:`sha256:${"f".repeat(64)}`},
      {plan:{...base.plan,controller:{address:`0x${"44".repeat(20)}`,kind:"eoa"}}},{status:"live"}])
      expect(()=>projectGeneralPlanReply("create",{httpStatus:200,value:{...base,...patch},location},saved)).toThrow();
    const transport=vi.fn().mockResolvedValue(Response.json({...base,rawRequestSha256:`sha256:${"f".repeat(64)}`},{headers:{location}})),f=service(transport),action=await current();
    await expect(f.instance.exchange(action.req,action.authority,id,"create")).rejects.toMatchObject({code:"launch-response-binding"});
    expect((await store.projects.preparations.read(owner,id))!.submission?.state).toBe("unknown");expect(transport).toHaveBeenCalledTimes(1);
  });
  it("keeps optional Plan preflight semantics and response version separate from graph approval",async()=>{
    await stage();const preflight={schemaVersion:"programmable.custom-launch-plan-preflight.v1",requestId,planHash:pack.planHash,manifestDigest:record.manifestDigest,
      launchEligibility:{status:"analysis_pending",hardBlockers:[]},findings:[{code:"PLAN_REVIEW_PENDING"}],assurance:{level:"provenance_only",claims:[]}};
    const transport=vi.fn().mockResolvedValue(Response.json(preflight)),f=service(transport),action=await current();
    const view=await f.instance.exchange(action.req,action.authority,id,"preflight");expect(view.preflight).toMatchObject({state:"completed",disposition:"needs_evidence",findingCodes:["PLAN_REVIEW_PENDING"]});
    const [url,init]=transport.mock.calls[0] as [URL,RequestInit];expect(url.pathname).toBe("/v4/chains/4663/wallet-admin/custom-launch-plans:preflight");
    expect(new Headers(init.headers).get("idempotency-key")).toBeNull();expect(new Headers(init.headers).get("programmable-launch-response-version")).toBe("1.2");
    expect(view.submission).toBeUndefined();expect(view.launchReady).toBe(false);
  });
  it("recovers an unknown expired Plan with original bytes, nonce/window and idempotency",async()=>{
    await stage();const first=await store.projects.preparations.claimExchange(owner,id,"create",record.productionId);
    await store.projects.preparations.finishExchange(owner,id,"create",first.lease!,{state:"unknown",summary:{code:"RESPONSE_UNCONFIRMED"}});
    clock=Number(record.identity.deadline)*1000+1;
    const retried=await store.projects.preparations.claimExchange(owner,id,"create",record.productionId);
    expect(retried.pack!.requestBody).toBe(pack.requestBody);expect(retried.record.identity).toEqual(record.identity);expect(retried.record.idempotencyKey).toBe(record.idempotencyKey);
    await expect(store.projects.preparations.reserve(owner,"different-plan-ticket-0002",selected(),"1","eoa")).rejects.toMatchObject({code:"launch-preparation-changed"});
  });
  it("recovers the original request after later chat edits and archiving without adopting a new profile",async()=>{
    await stage();const first=await store.projects.preparations.claimExchange(owner,id,"create",record.productionId);
    await store.projects.preparations.finishExchange(owner,id,"create",first.lease!,{state:"unknown",summary:{code:"RESPONSE_UNCONFIRMED"}});
    const key=conversationStorageId(record.account,record.selection.conversation),state=await store.readObject<{settings:object}>(owner,"studio",key);
    await store.saveObject(owner,"studio",key,{...state!.value,settings:{...state!.value.settings,name:"A later private design"}},state!.revision);
    const chat=await store.conversations.read(owner,record.account,record.selection.conversation);
    await store.conversations.update(owner,record.account,record.selection.conversation,chat!.revision,{archived:true});
    const transport=vi.fn().mockResolvedValue(Response.json(resource(),{status:200,headers:{location:`/v4/chains/4663/wallet-admin/custom-launch-plans/${resourceId}`}}));
    const f=service(transport);f.production.mockRejectedValue(new Error("A retired configuration must not replace an original request"));
    const action=await current(),view=await f.instance.exchange(action.req,action.authority,id,"create");
    const init=transport.mock.calls[0][1] as RequestInit;expect(Buffer.from(init.body as Uint8Array).toString()).toBe(pack.requestBody);
    expect(new Headers(init.headers).get("idempotency-key")).toBe(record.idempotencyKey);expect(f.production).not.toHaveBeenCalled();
    expect(view.coin?.name).toBe("Pack Fixture");expect(view.submission?.state).toBe("completed");expect(view.launchReady).toBe(false);
  });
  it("requires a declared controller kind without using it as proof of live EOA authority",()=>{
    const input={action:"prepare",id,selection:selected(),controllerKind:"eoa"};expect(parseGeneralPreparationAction(input)).toEqual(input);
    for(const candidate of [{...input,controllerKind:undefined},{...input,controllerKind:"smart_account"},{...input,selection:{...input.selection,chainId:1}}])expect(()=>parseGeneralPreparationAction(candidate)).toThrow();
    expect(record.controllerKind).toBe("eoa");expect(record).not.toHaveProperty("controllerVerified");
  });
  it("rechecks the owned Plan source after async packing and rejects changed stored bytes",async()=>{
    const changed={...pack,requestBody:pack.requestBody+"\n"};const {hash:discarded,...body}=changed;void discarded;
    await expect(store.projects.preparations.completePack(owner,id,record.packLease.token,{...body,hash:canonicalBrowserSha256V2("programmable.custom-ai-general-plan-pack.v1",body)})).rejects.toMatchObject({code:"launch-preparation-storage"});
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toBeNull();
    const key=conversationStorageId(record.account,record.selection.conversation),studio=await store.readObject<{settings:object}>(owner,"studio",key);
    await store.saveObject(owner,"studio",key,{...studio!.value,settings:{...studio!.value.settings,name:"Changed Plan"}},studio!.revision);
    await expect(stage()).rejects.toMatchObject({code:"launch-source-changed"});
  });
});
