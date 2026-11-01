import {beforeAll,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
vi.mock("server-only",()=>({}));
import {generalPackFixture} from "./fixtures/custom-ai-general-pack";
import {packGeneralGraph} from "../lib/custom-ai/general-pack.server";
import {packGeneralRobinhoodPlan} from "../lib/custom-ai/general-plan-pack.server";
import {createAutomaticSourceReceipt,generalReviewSubjectHash} from "../lib/custom-ai/automatic-source.server";
import {canonicalBrowserSha256V2} from "../lib/custom-launch/browser-authority-v2";
import {auditGeneralSource} from "../lib/custom-ai/source-audit.server";

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("private automatic source receipt",()=>{
 const fixtures=new Map<number,Awaited<ReturnType<typeof generalPackFixture>>>();
 const requests=new Map<number,string>();
 const now=Date.now(),sourceGeneratedAt=now-90_000;
 const id="20000000-0000-4000-8000-000000000001",digest=`sha256:${"1".repeat(64)}`;
 beforeAll(async()=>{
  for(const chain of [1,4663] as const){
   const f=await generalPackFixture(chain);
   f.source.sourceAudit=await auditGeneralSource(f.source.project,undefined,{call:async()=>({text:JSON.stringify({reviewedRequirementIds:f.source.project.intent.requirements.map(r=>r.id),findings:[]}),inputTokens:1,outputTokens:1})});
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
