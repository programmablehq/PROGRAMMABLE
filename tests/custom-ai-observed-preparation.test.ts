import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { keccak256, toHex, type Hex } from "viem";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";
import { generalPackFixture } from "./fixtures/custom-ai-general-pack";
import { projectLaunchProductionContext } from "../lib/custom-ai/launch-production.server";
import { createLaunchProductionContext } from "../lib/custom-ai/launch-production";
import { replayNativeFeedConstructorRead } from "../lib/custom-ai/dependency-witness.server";
import type { LaunchDependencyObservation } from "../lib/custom-ai/dependency-observations.server";
import { createAIStore, CUSTOM_AI_SCHEMA, type AIStore } from "../lib/custom-ai/store.server";
import { conversationStorageId } from "../lib/custom-ai/conversation.server";
import { generalProjectView } from "../lib/custom-ai/project-view";
import { selectExecutionRoute } from "../lib/custom-ai/execution-routing";
import { packGeneralGraph } from "../lib/custom-ai/general-pack.server";
import { packGeneralRobinhoodPlan } from "../lib/custom-ai/general-plan-pack.server";
import { createGeneralPublicSource, generalSourcePublicUri } from "../lib/custom-ai/public-launch-source.server";
import { generalPreparationView, type GeneralPackedLaunch, type GeneralPreparation } from "../lib/custom-ai/general-preparation-store.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import { deriveObservedOpeningInputs } from "../lib/custom-ai/opening-inputs.server";

const owner="pack-fixture-owner", ticket="observed-preparation-ticket-0001";
const tables=["jobs","objects","budgets"] as const, BASIC="0x600760005260206000f3" as Hex;
// These are synthetic dependency observations around real compiler, replay,
// constructor and pack workers. They do not establish a live market or RPC.
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR).each([
  {chain:999,opening:false,children:true},{chain:4663,opening:false,children:true},{chain:999,opening:true,children:true},
  {chain:4663,opening:true,children:true},{chain:999,opening:true,children:false},
] as const)("durable observed preparation $chain opening=$opening children=$children",({chain,opening,children})=>{
  let db:PGlite, store:AIStore, clock:number, completedAt:number, observation:LaunchDependencyObservation;
  let fixture:Awaited<ReturnType<typeof generalPackFixture>>, pack:GeneralPackedLaunch, record:GeneralPreparation;
  let snapshot:Record<string,Record<string,unknown>[]>;
  function makeStore(database:PGlite){
    let queue=Promise.resolve();
    return createAIStore({connect:async()=>{
      const prior=queue;let release!:()=>void;queue=new Promise<void>(resolve=>{release=resolve;});await prior;
      return {query:(sql,values)=>database.query<Record<string,unknown>>(sql,values),release};
    }},{hourlyUnits:100,dailyUnits:100,globalDailyUnits:100,concurrent:2},()=>clock);
  }
  function runtime(value:GeneralPackedLaunch){return value.route==="plan-v1"?value.runtimeMaterialization:value.constructorMaterialization!;}
  function rehash(value:GeneralPackedLaunch){
    const inner=runtime(value),{hash:oldInner,...innerBody}=inner;void oldInner;
    inner.hash=canonicalBrowserSha256V2(`programmable.custom-ai-runtime-materialization.v${inner.version}`,innerBody);
    if(value.route==="plan-v1")value.receipt.runtimeMaterializationHash=inner.hash;
    const {hash:oldOuter,...body}=value;void oldOuter;
    value.hash=canonicalBrowserSha256V2(`programmable.custom-ai-general-${value.route==="plan-v1"?"plan":"graph"}-pack.v${value.version}`,body);
  }
  beforeAll(async()=>{
    clock=Date.now();
    const original=projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains],chain,protection);
    original.poolManager.runtimeCodeHash=keccak256(BASIC);
    original.protectionBindings!.swapRouter.runtimeCodeHash=keccak256(BASIC);
    original.protectionBindings!.nativeUsdFeed.runtimeCodeHash=keccak256(BASIC);
    const {id:oldId,...productionBody}=original;void oldId;
    const production=createLaunchProductionContext(productionBody);
    fixture=await generalPackFixture(chain,false,0,children,production,
      opening?{supply:(10n**27n).toString(),targetFdvUsd:"15000"}:undefined);
    const database=new PGlite();await database.exec(CUSTOM_AI_SCHEMA);const seed=makeStore(database),source=fixture.source,binding=source.binding;
    await seed.conversations.create(owner,fixture.controller,binding.conversation);
    const key=conversationStorageId(fixture.controller,binding.conversation);
    let revision=await seed.saveObject(owner,"studio",key,{settings:binding.settings,image:binding.image,messages:[]},0);
    const reserved=await seed.reserve(owner,{id:binding.sourceId,intent:"build",messages:[{role:"user",content:"Private observed preparation"}],
      conversation:{account:fixture.controller,id:binding.conversation,revision}});
    await seed.projects.saveBlueprint(owner,binding.sourceId,reserved.lease!,{intent:source.project.intent,blueprint:source.blueprint});
    await seed.projects.save(owner,binding.sourceId,reserved.lease!,source.project);
    await seed.projects.complete(owner,binding.sourceId,reserved.lease!,source.compilation);
    await seed.projects.saveScenarios(owner,binding.sourceId,reserved.lease!,source.scenarios);
    const view=generalProjectView({version:1,reply:"Source checked",summary:"Observed inputs",project:source.project,compilation:source.compilation,scenarios:source.scenarios,
      blueprintId:source.blueprint.id,selection:selectExecutionRoute(source.project.intent,chain),requirementCoverage:"proposed",launchReady:false});
    await seed.finish(owner,binding.sourceId,reserved.lease!,{reply:"Source checked",generalProject:view,intent:source.project.intent,change:"applied"});
    revision=await seed.saveObject(owner,"studio",key,{settings:binding.settings,image:binding.image,messages:[],draftId:binding.sourceId,sourceId:binding.sourceId,contextId:binding.contextId},revision);
    const observedAt=Date.now()-1,pins=production.protectionBindings!,stamp=String(Math.floor(observedAt/1000));
    const body:Omit<LaunchDependencyObservation,"id">={version:1,productionId:production.id,chainId:chain,authority:"two-provider-observation",launchReady:false,
      block:{number:"100",hash:`0x${"12".repeat(32)}`,timestamp:stamp},observedAt,expiresAt:observedAt+10_000,
      poolManager:{...production.poolManager,runtimeCode:BASIC},swapRouter:{...pins.swapRouter,runtimeCode:BASIC},
      nativeUsdFeed:{...pins.nativeUsdFeed,runtimeCode:BASIC,decimals:7,roundId:"1",answer:"10000000",updatedAt:stamp,answeredInRound:"1"},sequencer:null,rpcReads:[9,9]};
    observation={...body,id:canonicalBrowserSha256V2("programmable.custom-ai-dependency-observation.v1",body)};
    if(opening)fixture.opening={observation,inputs:deriveObservedOpeningInputs(production,observation,
      {projectHash:source.project.hash,artifactHash:source.compilation.artifactHash,...source.project.deployment!.openingPrice!})};
    clock=Date.now();
    const selected={id:binding.sourceId,account:fixture.controller,conversation:binding.conversation,studioRevision:revision,chainId:chain,
      projectHash:source.project.hash,artifactHash:source.compilation.artifactHash,intentRevision:binding.intentRevision};
    const preparation=await seed.projects.preparations.reserve(owner,ticket,selected,undefined,chain===4663?"eoa":undefined);
    record=preparation.record;fixture.source=preparation.source!;fixture.exported=createGeneralPublicSource(fixture.source);fixture.url=generalSourcePublicUri(fixture.exported.id);
    const resolve=vi.fn(async(_production,caller,_signal,pinned)=>{
      if(opening)expect(pinned).toEqual(observation);
      const rpc=()=>async(method:string)=>method==="debug_traceCall"?{[pins.nativeUsdFeed.address]:{code:BASIC}}
        :{number:"0x64",hash:observation.block.hash,timestamp:toHex(BigInt(stamp))};
      const read=await replayNativeFeedConstructorRead(observation,caller,{rpcs:[rpc(),rpc()],now:Date.now});
      return {observation,read};
    });
    try {
      pack=chain===4663?await packGeneralRobinhoodPlan({...fixture,identity:record.identity},{address:fixture.controller,kind:"eoa"},undefined,resolve)
        :await packGeneralGraph({...fixture,identity:record.identity},undefined,resolve);
    } catch(error) {
      console.error("observed pack qualification",{chain,findings:(error as {findings?:unknown}).findings});
      throw error;
    }
    expect(resolve).toHaveBeenCalledTimes(1);expect(pack.version).toBe(3);
    if(opening)expect(runtime(pack).openingState).toMatchObject({supply:(10n**27n).toString(),decimals:18,passes:2,
      sqrtPriceX96:fixture.opening!.inputs.sqrtPriceX96});
    expect(observation.observedAt).toBeLessThan(record.createdAt);
    completedAt=Date.now();expect(completedAt).toBeLessThan(observation.expiresAt);
    snapshot={};for(const table of tables)snapshot[table]=(await database.query<Record<string,unknown>>(`SELECT * FROM programmable_custom_ai_v1.${table}`)).rows;
    await database.close();
  },120_000);
  beforeEach(async()=>{
    clock=completedAt;db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);
    for(const table of tables)await db.query(`INSERT INTO programmable_custom_ai_v1.${table} SELECT * FROM jsonb_populate_recordset(NULL::programmable_custom_ai_v1.${table},$1::jsonb)`,[JSON.stringify(snapshot[table])]);
    store=makeStore(db);
  });
  afterEach(async()=>{await db?.close();});
  it("accepts a still-fresh shared observation and preserves its exact request after expiry and reload",async()=>{
    const saved=await store.projects.preparations.completePack(owner,ticket,record.packLease.token,pack);
    expect(saved.packState).toBe("complete");expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toEqual(fixture.exported);
    const compact=JSON.stringify(generalPreparationView(saved,clock));
    for(const field of ["dependencyContext","requestBody","constructorMaterialization","runtimeMaterialization"])expect(compact).not.toContain(field);
    const first=await store.projects.preparations.claimExchange(owner,ticket,"create",record.productionId);expect(first.pack).toEqual(pack);
    await store.projects.preparations.finishExchange(owner,ticket,"create",first.lease!,{state:"unknown",summary:{code:"RESPONSE_UNCONFIRMED"}});
    clock+=3*60*60*1000;store=makeStore(db);
    const again=await store.projects.preparations.claimExchange(owner,ticket,"create",record.productionId);
    expect(again.pack).toEqual(pack);expect(again.record.idempotencyKey).toBe(record.idempotencyKey);
    expect(again.record.submission!.attempts).toBe(2);
  });
  it.each(["expired","before lease"])("refuses a new completion %s and publishes no source",async(reason)=>{
    clock=reason==="expired"?observation.expiresAt:record.packLease.startedAt!-1;
    await expect(store.projects.preparations.completePack(owner,ticket,record.packLease.token,pack)).rejects.toMatchObject({code:"launch-preparation-storage"});
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toBeNull();
  });
  it.each(["missing context","different initializer","wrong production"])("refuses %s even with recomputed private hashes",async(reason)=>{
    const altered=structuredClone(pack),inner=runtime(altered);
    if(reason==="missing context")delete inner.dependencyContext;
    else if(reason==="different initializer")inner.dependencyInitializerId="hook";
    else inner.dependencyProduction={...inner.dependencyProduction!,id:`sha256:${"33".repeat(32)}`};
    rehash(altered);
    await expect(store.projects.preparations.completePack(owner,ticket,record.packLease.token,altered)).rejects.toMatchObject({code:"launch-preparation-storage"});
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toBeNull();
  });
  it.skipIf(!opening).each(["wrong supply","wrong opening price","missing state","removed opening proof"])("refuses %s despite recomputed private hashes",async(reason)=>{
    const altered=structuredClone(pack),inner=runtime(altered);
    if(reason==="removed opening proof"){delete inner.openingState;delete inner.openingInputs;}
    else if(reason==="missing state")delete inner.openingState;
    else if(reason==="wrong supply")inner.openingState!.supply="1";
    else inner.openingState!.sqrtPriceX96="1";
    rehash(altered);
    await expect(store.projects.preparations.completePack(owner,ticket,record.packLease.token,altered)).rejects.toMatchObject({code:"launch-preparation-storage"});
    expect(await store.projects.readPublicSource(pack.publicSourceId.slice(7))).toBeNull();
  });
});
