import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({authenticate:vi.fn()}));
vi.mock("../lib/server/creator-article/wallet-principal.server",()=>({createPrivyWalletPrincipalAuthenticatorV1:()=>({authenticate:mock.authenticate}),WalletPrincipalAuthenticationErrorV1:class extends Error{}}));
import {authorizeCustomAI,type AIAuthority} from "../lib/custom-ai/auth.server";
import {createGeneralLaunchStatusReader} from "../lib/custom-ai/general-launch-status.server";
import {readGeneralLaunchStatus,type GeneralLaunchStatus} from "../lib/custom-ai/general-preparation";
import type {GeneralPreparation} from "../lib/custom-ai/general-preparation-store.server";

const wallet=`0x${"11".repeat(20)}` as const,other=`0x${"22".repeat(20)}` as const,hash=`sha256:${"a".repeat(64)}` as const,raw=`sha256:${"b".repeat(64)}` as const;
const resourceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",start=Date.parse("2026-10-31T18:00:00.000Z");let clock=start;
function record(chainId:GeneralPreparation["chainId"]=1):GeneralPreparation{return{version:1,id:"status-preparation-0001",account:wallet,chainId,
 selection:{id:"status-source-job-0001",account:wallet,chainId,conversation:resourceId,studioRevision:2,projectHash:hash,artifactHash:raw,intentRevision:"c".repeat(64)},
 bindingHash:hash,productionId:hash,inputHash:hash,identity:{nonce:`0x${"1".repeat(64)}`,sourceLineageNonce:"1",validAfter:String(start/1000-30),deadline:String(start/1000+1800),checkedAt:new Date(start).toISOString()},
 idempotencyKey:"private-not-exposed",createdAt:start,updatedAt:start,packState:"complete",packLease:{token:"private-not-exposed",until:0,slot:0},requestHash:hash,requestSha256:raw,
 submission:{state:"completed",lease:"private-not-exposed",until:0,attempts:1,resourceId,backendState:"pending_review"}};}
function wire(saved=record()):GeneralLaunchStatus{return{schemaVersion:"programmable.wallet-launch-status.v1",kind:saved.chainId===4663?"plan-v1":"graph-v3",chainId:String(saved.chainId) as GeneralLaunchStatus["chainId"],
 resourceId,controller:wallet,requestHash:hash,rawRequestSha256:saved.chainId===4663?raw:null,status:"pending_review",errorCode:null,createdAt:new Date(start).toISOString(),updatedAt:new Date(start).toISOString(),
 checkedAt:new Date(clock).toISOString(),deadline:saved.identity.deadline,launchReady:false};}
async function current(owner="current-owner",controller:AbortController=new AbortController()){
 mock.authenticate.mockResolvedValue({privyUserId:owner,privySessionId:"current",wallets:[wallet]});
 const request=new Request("https://site.test/api/custom-ai/general-launch?id=status-preparation-0001&view=status",{signal:controller.signal});
 return{request,authority:await authorizeCustomAI(request)};
}
function fixture(value:unknown=wire()){
 const status=vi.fn().mockResolvedValue({httpStatus:200,value,location:null});
 return{status,read:createGeneralLaunchStatusReader({bridge:()=>({status}),now:()=>clock})};
}
beforeEach(()=>{clock=start;vi.clearAllMocks();vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED","true");vi.spyOn(Date,"now").mockImplementation(()=>clock);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

describe("current status bound to the original owned submission",()=>{
 it.each([1,4663,8453,999] as const)("accepts only the selected original request on %s",async chainId=>{
  const saved=record(chainId),f=fixture(wire(saved)),c=await current();
  const value=await f.read(c.request,c.authority,saved);expect(value).toEqual(wire(saved));expect(value.launchReady).toBe(false);
  expect(f.status).toHaveBeenCalledExactlyOnceWith(c.request,c.authority,{chainId,account:wallet,resourceId});expect(mock.authenticate).toHaveBeenCalledOnce();
 });
 it("shares one in-flight read and a two-second immutable snapshot across fresh owner requests",async()=>{
  const f=fixture();let finish:(value:unknown)=>void=()=>{};
  f.status.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const a=await current(),b=await current(),one=f.read(a.request,a.authority,record()),two=f.read(b.request,b.authority,record());
  expect(f.status).toHaveBeenCalledOnce();finish({httpStatus:200,value:wire(),location:null});
  const [first,second]=await Promise.all([one,two]);first.status="changed-by-browser";expect(second.status).toBe("pending_review");
  const c=await current();expect((await f.read(c.request,c.authority,record())).status).toBe("pending_review");expect(f.status).toHaveBeenCalledOnce();
  clock+=2001;f.status.mockResolvedValueOnce({httpStatus:200,value:wire(),location:null});const d=await current();
  expect((await f.read(d.request,d.authority,record())).checkedAt).toBe(new Date(clock).toISOString());expect(f.status).toHaveBeenCalledTimes(2);
 });
 it("keeps owner namespaces independent even for equal supplied ticket bindings",async()=>{
  const f=fixture(),a=await current("owner-a");await f.read(a.request,a.authority,record());
  const b=await current("owner-b");await f.read(b.request,b.authority,record());expect(f.status).toHaveBeenCalledTimes(2);
 });
 it("rejects copied, transplanted, expired, cancelled or wrong-wallet authority before any backend read",async()=>{
  const f=fixture(),c=await current();
  await expect(f.read(c.request,{...c.authority} as AIAuthority,record())).rejects.toMatchObject({code:"session_changed"});
  const second=await current();await expect(f.read(second.request,c.authority,record())).rejects.toMatchObject({code:"session_changed"});
  await expect(f.read(c.request,c.authority,{...record(),account:other})).rejects.toMatchObject({status:403});
  const controller=new AbortController(),cancelled=await current("current-owner",controller);controller.abort();
  await expect(f.read(cancelled.request,cancelled.authority,record())).rejects.toMatchObject({code:"session_changed"});
  clock+=120000;await expect(f.read(c.request,c.authority,record())).rejects.toMatchObject({code:"session_changed"});expect(f.status).not.toHaveBeenCalled();
 });
 it("requires a completed original submission before reading current status",async()=>{
  const f=fixture(),c=await current();
  for(const saved of [{...record(),packState:"failed" as const},{...record(),submission:undefined},{...record(),requestHash:undefined},
   {...record(),submission:{...record().submission!,state:"unknown" as const}},{...record(4663),requestSha256:undefined}])
   await expect(f.read(c.request,c.authority,saved)).rejects.toMatchObject({status:409});
  expect(f.status).not.toHaveBeenCalled();
 });
 it("rejects wrong original bindings, unbounded fields, source exposure and stale replies without retry",async()=>{
  const c=await current();
  for(const patch of [{chainId:"999"},{resourceId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},{controller:other},{requestHash:raw},{deadline:"1"},
   {launchReady:true},{schemaVersion:"future"},{source:"PRIVATE"},{errorCode:"x".repeat(129)},{checkedAt:new Date(start-30001).toISOString()}]){
   const f=fixture({...wire(),...patch});await expect(f.read(c.request,c.authority,record())).rejects.toMatchObject({status:503});expect(f.status).toHaveBeenCalledOnce();
  }
  const saved=record(4663),f=fixture({...wire(saved),rawRequestSha256:hash});await expect(f.read(c.request,c.authority,saved)).rejects.toMatchObject({status:503});
 });
 it("does not retain errors or report a cached observation as newly checked",async()=>{
  const f=fixture({...wire(),requestHash:raw}),c=await current();
  await expect(f.read(c.request,c.authority,record())).rejects.toMatchObject({status:503});
  f.status.mockResolvedValueOnce({httpStatus:200,value:wire(),location:null});const good=await f.read(c.request,c.authority,record());
  clock+=1000;const next=await current();expect((await f.read(next.request,next.authority,record())).checkedAt).toBe(good.checkedAt);expect(f.status).toHaveBeenCalledTimes(2);
 });
 it("invalidates a cached observation when the wall clock moves outside its freshness window",async()=>{
  const f=fixture(),c=await current();await f.read(c.request,c.authority,record());clock-=31000;
  const later=await current();await expect(f.read(later.request,later.authority,record())).rejects.toMatchObject({code:"launch-status-binding"});
  f.status.mockResolvedValueOnce({httpStatus:200,value:wire(),location:null});expect((await f.read(later.request,later.authority,record())).checkedAt).toBe(new Date(clock).toISOString());
  expect(f.status).toHaveBeenCalledTimes(2);
 });
 it("cannot return a late result to an aborted request",async()=>{
  const controller=new AbortController(),c=await current("current-owner",controller),f=fixture();let finish:(value:unknown)=>void=()=>{};
  f.status.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=f.read(c.request,c.authority,record());controller.abort();finish({httpStatus:200,value:wire(),location:null});
  await expect(pending).rejects.toMatchObject({code:"session_changed"});
 });
 it("uses the same closed browser contract for current status",()=>{
  const saved=record(),binding={account:wallet,chainId:saved.chainId,resourceId,requestHash:hash,deadline:saved.identity.deadline};
  expect(readGeneralLaunchStatus({status:wire()},binding)).toEqual(wire());
  expect(()=>readGeneralLaunchStatus({status:{...wire(),wallet:{transaction:"forged"}}},binding)).toThrow("original submission");
 });
});

it.each([1,4663,8453,999] as const)("uses one atomic transport snapshot for automatically reviewed chain %s",async chainId=>{
 const saved=record(chainId);saved.reviewSubjectHash=hash;
 saved.submission={...saved.submission!,reviewId:resourceId,reviewSubjectHash:hash};
 const status={...wire(saved),requestHash:raw,deadline:String(start/1000+3600),status:"authorized"};
 const transport={schemaVersion:"programmable.automatic-launch-transport.v1" as const,reviewId:resourceId,resourceId,chainId:String(chainId) as "1"|"4663"|"8453"|"999",
  controller:wallet,subjectHash:hash,originalRequestHash:hash,requestHash:raw,rawRequestSha256:status.rawRequestSha256,deadline:status.deadline,checkedAt:status.checkedAt,currentStatus:status};
 const automatic=vi.fn().mockResolvedValue({schemaVersion:"programmable.automatic-launch-status.v1",reviewId:resourceId,state:"approved",manualReviewRequired:false,launchReady:false,
  findings:[],timing:{sourceGeneratedAt:start-1000,startedAt:start-900,finishedAt:start,sourceToDecisionMs:1000,decisionWithinTarget:true},transport});
 const backendStatus=vi.fn(),reader=createGeneralLaunchStatusReader({bridge:()=>({status:backendStatus}),automatic,now:()=>clock}),c=await current();
 const result=await reader(c.request,c.authority,saved);
 expect(result.requestHash).toBe(raw);expect(result.deadline).toBe(transport.deadline);expect(automatic).toHaveBeenCalledOnce();expect(backendStatus).not.toHaveBeenCalled();
 const binding={account:wallet,chainId,resourceId,requestHash:hash,deadline:saved.identity.deadline,reviewId:resourceId,reviewSubjectHash:hash};
 expect(()=>readGeneralLaunchStatus({status:{...result,automatic:{...result.automatic,transport:{...transport,subjectHash:raw}}}},binding)).toThrow();
 expect(()=>readGeneralLaunchStatus({status:{...result,automatic:{...result.automatic,transport:{...transport,originalRequestHash:raw}}}},binding)).toThrow();
 expect(()=>readGeneralLaunchStatus({status:{...result,automatic:undefined}},binding)).toThrow();
 expect(()=>readGeneralLaunchStatus({status:result},{...binding,reviewId:undefined})).toThrow();
});
