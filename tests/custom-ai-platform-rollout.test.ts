import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
const boundary=vi.hoisted(()=>({authorize:vi.fn(),fresh:vi.fn(),pool:undefined as unknown,store:undefined as unknown}));
vi.mock("../lib/custom-ai/auth.server",()=>({authorizeCustomAI:boundary.authorize,requireFreshCustomAIAuthority:boundary.fresh}));
vi.mock("../lib/custom-ai/store.server",async original=>({...await original<typeof import("../lib/custom-ai/store.server")>(),productionAIPool:()=>boundary.pool,productionAIStore:()=>boundary.store}));
import {CUSTOM_AI_SCHEMA,createAIStore,type AIPool} from "../lib/custom-ai/store.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import {productionAccountDependencies,productionProjectRoutes,productionPlatformStore} from "../lib/custom-ai/platform/production.server";
import {CustomAIError} from "../lib/custom-ai/types";
import {GET as readEvents} from "../app/api/custom-ai/platform/events/route";
import {GET as readLaunch} from "../app/api/custom-ai/platform/launch/route";
import {POST as importLegacy} from "../app/api/custom-ai/platform/import/route";

const alice="did:privy:rollout-alice",bob="did:privy:rollout-bob";
const aliceId="11111111-1111-4111-8111-111111111111",bobId="22222222-2222-4222-8222-222222222222";
let db:PGlite;
const request=(path="",body?:unknown)=>new Request("https://platform.example/api/custom-ai/platform/projects"+path,{method:body===undefined?"GET":"POST",...(body===undefined?{}:{headers:{"content-type":"application/json"},body:JSON.stringify(body)})});
function owner(id:string){boundary.authorize.mockResolvedValue({kind:"account",owner:id,principal:{privyUserId:id,privySessionId:"session",wallets:[`0x${"a".repeat(40)}`]}});}
beforeAll(async()=>{
 db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);await db.exec(PROJECT_PLATFORM_SCHEMA);
 let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const previous=tail;let release!:()=>void;tail=new Promise<void>(done=>{release=done;});await previous;return {query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};}};
 boundary.pool=pool;boundary.store=createAIStore(pool,{hourlyUnits:25,dailyUnits:100,globalDailyUnits:200,concurrent:1});
 for(const [ownerId,projectId] of [[alice,aliceId],[bob,bobId]])await productionPlatformStore().createProject({ownerId,projectId});
});
beforeEach(()=>{vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED","true");vi.stubEnv("CUSTOM_AI_PLATFORM_ENABLED","true");vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",undefined);boundary.fresh.mockImplementation((_request,authority)=>authority);owner(alice);});
afterEach(()=>vi.unstubAllEnvs());afterAll(async()=>db.close());

describe("project platform rollout admission",()=>{
 it("keeps both existing owners available when no pilot restriction is configured",async()=>{
  for(const [id,projectId] of [[alice,aliceId],[bob,bobId]]){owner(id);const response=await productionProjectRoutes().GET(request());expect(response.status).toBe(200);expect((await response.json()).projects.map((p:{projectId:string})=>p.projectId)).toEqual([projectId]);}
 });
 it("blocks an authenticated nonpilot from reading their own project until general release",async()=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",JSON.stringify([alice]));owner(bob);
  const response=await productionProjectRoutes().GET(request("?projectId="+bobId));expect(response.status).toBe(403);expect(await response.json()).toMatchObject({code:"platform-pilot"});
 });
 it("rejects nonpilot writes before they create a saved project",async()=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",JSON.stringify([alice]));owner(bob);
  const response=await productionProjectRoutes().POST(request("",{projectId:"33333333-3333-4333-8333-333333333333"}));expect(response.status).toBe(403);
  expect((await productionPlatformStore().listProjects(bob)).map(p=>p.projectId)).toEqual([bobId]);
 });
 it("admits the listed owner while preserving isolation from another owner's project",async()=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",JSON.stringify([alice]));
  expect((await productionProjectRoutes().GET(request("?projectId="+aliceId))).status).toBe(200);
  expect((await productionProjectRoutes().GET(request("?projectId="+bobId))).status).toBe(404);
 });
 it("uses the authenticated principal instead of request-supplied pilot identity",async()=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",JSON.stringify([alice]));owner(bob);
  expect((await productionProjectRoutes().GET(request("?ownerId="+encodeURIComponent(alice)))).status).toBe(403);
 });
 it("restores access to the same saved project when the pilot restriction is removed",async()=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",JSON.stringify([alice]));owner(bob);
  expect((await productionProjectRoutes().GET(request())).status).toBe(403);
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",undefined);
  const response=await productionProjectRoutes().GET(request("?projectId="+bobId));expect(response.status).toBe(200);expect((await response.json()).project.projectId).toBe(bobId);
 });
 it("does not let pilot membership enable a globally disabled platform",async()=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_ENABLED","false");vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",JSON.stringify([alice]));
  expect((await productionProjectRoutes().GET(request())).status).toBe(404);
 });
 it.each(["invalid-json",'{}','[1]','[""]','["did:privy: bad"]'])('fails closed for malformed pilot configuration %s',async value=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",value);expect(productionAccountDependencies().enabled()).toBe(false);expect((await productionProjectRoutes().GET(request())).status).toBe(404);
 });
 it("treats an explicit empty pilot roster as admitting nobody",async()=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS","[]");expect(productionAccountDependencies().enabled()).toBe(false);expect((await productionProjectRoutes().GET(request())).status).toBe(404);
 });
 it("preserves session authentication before checking pilot admission",async()=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",JSON.stringify([alice]));boundary.authorize.mockRejectedValue(new CustomAIError("auth","Sign in",401));
  expect((await productionProjectRoutes().GET(request())).status).toBe(401);
 });
 it.each(["events","launch","import"] as const)("protects the separate %s entrypoint with the same pilot authority",async name=>{
  vi.stubEnv("CUSTOM_AI_PLATFORM_PILOT_OWNERS",JSON.stringify([alice]));owner(bob);
  const url="https://platform.example/api/custom-ai/platform/"+name;
  const response=name==="events"?await readEvents(new Request(url+"?projectId="+bobId))
   :name==="launch"?await readLaunch(new Request(url+"?projectId="+bobId+"&account=0x"+"a".repeat(40)))
   :await importLegacy(new Request(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectId:bobId,requestId:"missing-saved-chat",account:`0x${"a".repeat(40)}`,conversationId:"legacy"})}));
  expect(response.status).toBe(403);expect(await response.json()).toMatchObject({code:"platform-pilot"});
 });
});
