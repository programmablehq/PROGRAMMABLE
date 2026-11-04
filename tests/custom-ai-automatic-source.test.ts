import {beforeAll,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
import {generalPackFixture} from "./fixtures/custom-ai-general-pack";
import {packGeneralGraph} from "../lib/custom-ai/general-pack.server";
import {packGeneralRobinhoodPlan} from "../lib/custom-ai/general-plan-pack.server";
import {createAutomaticSourceReceipt,generalReviewSubjectHash} from "../lib/custom-ai/automatic-source.server";
import {canonicalBrowserJsonV2,canonicalBrowserSha256V2} from "../lib/custom-launch/browser-authority-v2";
import {auditGeneralSource} from "../lib/custom-ai/source-audit.server";
import {sourceAuditModelReply} from "./fixtures/custom-ai-source-audit";
import {createContractProject,GENERAL_PROJECT_COMPILER,projectCompilerInput} from "../lib/custom-ai/contract-project";
import {projectLaunchProductionContext} from "../lib/custom-ai/launch-production.server";
import type {OwnedGeneralLaunchSource} from "../lib/custom-ai/public-launch-source.server";
import {SOURCE_AUDIT_REVIEWED_POLICY_IDS} from "../lib/custom-ai/source-audit-policy";
import captured from "./fixtures/custom-ai-launch-discovery.json";
import protection from "./fixtures/custom-ai-launch-protection.json";

// The receipt consumes an already-owned source. These unit fixtures exercise
// only its audit/input boundary; they do not assert compilation or deployment.
describe("automatic source audit binding",()=>{
 const now=1_800_000_000_000,controller=`0x${"11".repeat(20)}`;
 const digest=`sha256:${"1".repeat(64)}` as const;
 const reviewId="20000000-0000-4000-8000-000000000001";
 const fixture=async(chain:1|4663=1)=>{
  const production=projectLaunchProductionContext(captured.chains[String(chain) as keyof typeof captured.chains],chain,protection);
  const project=createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"paris"},
   sources:{"Hook.sol":{content:"pragma solidity 0.8.26; contract Hook {}"}},entrypoints:[{source:"Hook.sol",contract:"Hook",role:"hook"}]},
   {version:1,id:"binding-test",revision:"a".repeat(64),requirements:[{id:"surface",kind:"constraint",text:"Check the declared interface",open:null,origin:{kind:"legacy"}}],unresolved:[],changes:[]},chain,production);
  const audit=await auditGeneralSource(project,undefined,{call:async()=>sourceAuditModelReply(project)});
  const source={project,sourceAudit:audit,binding:{account:controller},compilation:{artifactHash:digest}} as OwnedGeneralLaunchSource;
  const request={schemaVersion:chain===4663?"programmable.custom-launch-plan.v1":"programmable.custom-launch-create-request.v3",chainId:String(chain),
   ...(chain===4663?{controller:{address:controller},budgets:{}}:{launchWallet:controller}),
   verificationBundle:{compilationUnits:[unit("project",canonicalBrowserJsonV2(projectCompilerInput(project))+"\n")]}};
  return input(source,request,chain);
 };
 const unit=(id:string,json:string)=>{
  const bytes=Buffer.from(json);
  return {compilationUnitId:id,compilerVersion:GENERAL_PROJECT_COMPILER,standardJsonInputBase64:bytes.toString("base64"),
   standardJsonInputSha256:`sha256:${createHash("sha256").update(bytes).digest("hex")}`};
 };
 const input=(source:OwnedGeneralLaunchSource,request:Record<string,unknown>,chain:1|4663)=>({source,sourceGeneratedAt:now-90_000,requestBody:JSON.stringify(request),
  review:{reviewId,subjectHash:generalReviewSubjectHash(chain,request),chainId:String(chain),controller},verifierRevision:digest});
 const replaceRequest=(i:Awaited<ReturnType<typeof fixture>>,request:Record<string,unknown>)=>input(i.source,request,Number(i.review.chainId) as 1|4663);
 const replaceAudit=(i:Awaited<ReturnType<typeof fixture>>,patch:Record<string,unknown>)=>{
  const {hash,...rest}={...i.source.sourceAudit!,...patch};void hash;
  const body=JSON.parse(JSON.stringify(rest));
  return {...i,source:{...i.source,sourceAudit:{...body,hash:canonicalBrowserSha256V2("programmable.custom-ai-source-audit.v1",body)}}};
 };
 it.each([1,4663] as const)("binds canonical compiler JSON on chain %s while preserving raw-file checksums",async chain=>{
  const i=await fixture(chain),request=JSON.parse(i.requestBody),canonical=canonicalBrowserJsonV2(projectCompilerInput(i.source.project));
  request.verificationBundle.compilationUnits.push(unit("pretty-input",JSON.stringify(JSON.parse(canonical),null,2)));
  const receipt=createAutomaticSourceReceipt(replaceRequest(i,request),now);
  expect(receipt.sourceAudit).toEqual(i.source.sourceAudit);
  expect(receipt.sourceAudit.compilerInputHash).toBe(`sha256:${createHash("sha256").update(canonical).digest("hex")}`);
  expect(receipt.compilationUnits.map(u=>u.inputHash)).toEqual(request.verificationBundle.compilationUnits.map((u:{standardJsonInputSha256:string})=>u.standardJsonInputSha256));
  expect(receipt.sourceAudit.compilerInputHash).not.toBe(receipt.compilationUnits[0].inputHash);
  expect(receipt.sourceGeneratedAt).toBe(now-90_000);expect(receipt.sourceAudit.launchReady).toBe(false);
 });
 it("refuses old audits and every missing required protection without mutating the saved record",async()=>{
  const i=await fixture();
  for(const patch of [
   {compilerInputHash:undefined,policyId:undefined,reviewedPolicyIds:undefined},
   ...SOURCE_AUDIT_REVIEWED_POLICY_IDS.map(id=>({reviewedPolicyIds:SOURCE_AUDIT_REVIEWED_POLICY_IDS.filter(value=>value!==id)})),
   {policyId:"programmable.protected-source-audit.v1"},{compilerInputHash:digest},
  ]){
   const changed=replaceAudit(i,patch),before=JSON.stringify(changed.source.sourceAudit);
   expect(()=>createAutomaticSourceReceipt(changed,now)).toThrow(expect.objectContaining({code:"source-audit-incomplete",status:422}));
   expect(JSON.stringify(changed.source.sourceAudit)).toBe(before);
  }
  expect(()=>createAutomaticSourceReceipt({...i,source:{...i.source,sourceAudit:undefined}},now)).toThrow(expect.objectContaining({code:"automatic-source-audit",status:422}));
 });
 it("refuses an audit of another source despite a fresh audit checksum",async()=>{
  const i=await fixture(),project=i.source.project;
  const other=createContractProject({compiler:project.compiler,entrypoints:project.entrypoints,sources:{"Hook.sol":{content:"pragma solidity 0.8.26; contract Hook { uint x; }"}}},project.intent,project.chainId,project.production);
  const otherAudit=await auditGeneralSource(other,undefined,{call:async()=>sourceAuditModelReply(other)});
  const changed=replaceAudit(i,{...otherAudit,projectHash:project.hash});
  expect(()=>createAutomaticSourceReceipt(changed,now)).toThrow(expect.objectContaining({code:"source-audit-incomplete"}));
 });
 it.each([1,4663] as const)("checks every input against the audited source even with a freshly bound subject on %s",async chain=>{
  const i=await fixture(chain),request=JSON.parse(i.requestBody),other=structuredClone(projectCompilerInput(i.source.project));
  other.sources["Hook.sol"].content+="\ncontract Other {}";
  request.verificationBundle.compilationUnits.push(unit("other-project",canonicalBrowserJsonV2(other)));
  expect(()=>createAutomaticSourceReceipt(replaceRequest(i,request),now)).toThrow(expect.objectContaining({code:"automatic-source-binding"}));
 });
 it("retains subject, owner, timestamp, raw checksum and failing-audit checks",async()=>{
  const i=await fixture();
  for(const patch of [{sourceGeneratedAt:now+1},{review:{...i.review,subjectHash:digest}},{review:{...i.review,controller:`0x${"2".repeat(40)}`}}])
   expect(()=>createAutomaticSourceReceipt({...i,...patch},now)).toThrow(expect.objectContaining({code:"automatic-source-binding"}));
  const request=JSON.parse(i.requestBody);request.verificationBundle.compilationUnits[0].standardJsonInputSha256=digest;
  expect(()=>createAutomaticSourceReceipt(replaceRequest(i,request),now)).toThrow(expect.objectContaining({code:"automatic-source-binding"}));
  expect(()=>createAutomaticSourceReceipt(replaceAudit(i,{status:"changes_required",findings:[{code:"MISSING_GUARD",requirementId:null,message:"Authenticate the callback."}]}),now))
   .toThrow(expect.objectContaining({code:"automatic-source-audit",status:422}));
 });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("private automatic source receipt",()=>{
 const fixtures=new Map<number,Awaited<ReturnType<typeof generalPackFixture>>>();
 const requests=new Map<number,string>();
 const now=Date.now(),sourceGeneratedAt=now-90_000;
 const id="20000000-0000-4000-8000-000000000001",digest=`sha256:${"1".repeat(64)}`;
 beforeAll(async()=>{
  for(const chain of [1,4663] as const){
   const f=await generalPackFixture(chain);
   f.source.sourceAudit=await auditGeneralSource(f.source.project,undefined,{call:async()=>sourceAuditModelReply(f.source.project)});
   fixtures.set(chain,f);
   const pack=chain===4663?await packGeneralRobinhoodPlan(f,{address:f.controller as `0x${string}`,kind:"eoa"}):await packGeneralGraph(f);
   requests.set(chain,pack.requestBody);
  }
 },120_000);
 const input=(chain:number=1)=>({source:fixtures.get(chain)!.source,sourceGeneratedAt,requestBody:requests.get(chain)!,
  review:{reviewId:id,subjectHash:generalReviewSubjectHash(chain,JSON.parse(requests.get(chain)!)),chainId:String(chain),controller:fixtures.get(chain)!.controller},verifierRevision:digest});
 it.each([1,4663])("binds the real packed compiler input on %s without resetting the source clock",chain=>{
  const i=input(chain),r=createAutomaticSourceReceipt(i,now);
  expect(r.sourceGeneratedAt).toBe(sourceGeneratedAt);
  expect(r.intentHash).toBe(canonicalBrowserSha256V2("programmable.general-check-intent.v1",i.source.project.intent));
  expect(r.artifactHash).toBe(i.source.compilation.artifactHash);expect(r.productionHash).toBe(i.source.project.production!.id);
  expect(r.compilationUnits.length).toBeGreaterThan(0);expect(r.chainId).toBe(String(chain));
  expect(r).not.toHaveProperty("approved");expect(r).not.toHaveProperty("source");expect(r).not.toHaveProperty("messages");
 });
 it("rejects another owner, chain, source digest and future source timestamp",()=>{
  const i=input();
  for(const patch of [{sourceGeneratedAt:now+1},{review:{...i.review,controller:`0x${"2".repeat(40)}`}},{review:{...i.review,chainId:"999"}},{verifierRevision:"current"}])
   expect(()=>createAutomaticSourceReceipt({...i,...patch},now)).toThrow();
  const request=JSON.parse(i.requestBody);request.verificationBundle.compilationUnits[0].standardJsonInputSha256=digest;
  expect(()=>createAutomaticSourceReceipt({...i,requestBody:JSON.stringify(request)},now)).toThrow();
 });
 it("rejects another compiler input even when its submitted checksum is valid",()=>{
  const i=input(),request=JSON.parse(i.requestBody),unit=request.verificationBundle.compilationUnits[0];
  const bytes=Buffer.from(JSON.stringify({language:"Solidity",sources:{"Other.sol":{content:"contract Other {}"}},settings:{}}));
  unit.standardJsonInputBase64=bytes.toString("base64");
  unit.standardJsonInputSha256=`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  expect(()=>createAutomaticSourceReceipt({...i,requestBody:JSON.stringify(request)},now)).toThrow();
 });
});
