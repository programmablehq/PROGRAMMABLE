import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {completeCanonicalContractReference,completeCanonicalContractInterfaces,assertCanonicalReferenceChanges} from "../lib/custom-ai/platform/contract-plan.server";
import {canonicalInterfaceContext} from "../lib/custom-ai/canonical-dependencies.server";
import type {JsonValue} from "../lib/custom-ai/platform/types";
import {PGlite} from "@electric-sql/pglite";
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {createRunStore} from "../lib/custom-ai/platform/runs.server";
import {createProjectChecks} from "../lib/custom-ai/platform/builds.server";
import {createProjectTools} from "../lib/custom-ai/platform/tools.server";
import {CUSTOM_AI_SCHEMA,type AIPool} from "../lib/custom-ai/store.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import {platformContractDocument} from "./fixtures/custom-ai-platform-contract";

const reference=canonicalInterfaceContext(4663).contracts.find(item=>item.contract==="ProtectedNative30HookV1")!;
const input=()=>({
  contracts:[{id:"hook",source:"CustomHook.sol",contract:"CustomHook",role:"hook",arguments:["keep constructor"],functions:[reference.functions[0],"function customValue() view returns (uint256)"],allowReceive:false,surfaceRequirements:["fixed-fee"]},
    {id:"other",source:"Other.sol",contract:"Other",functions:["function unchanged()"]}],
  steps:[{id:"fee",arguments:["10000"],requirementIds:["fixed-fee"],expect:{status:"success",returns:["30"]}}],
  allowedCalls:[{target:"unchanged"}],world:{kind:"unchanged"},deployment:{name:"unchanged"},
});
const from={source:reference.source,contract:reference.contract};

describe("canonical interface metadata repair",()=>{
  it("adds only the source-verified interface without changing behavior or source bindings",()=>{
    const before=input(),saved=structuredClone(before);
    const result=completeCanonicalContractReference(before as JsonValue,4663,"hook",from) as ReturnType<typeof input>;
    expect(result.contracts[0].functions).toEqual([...saved.contracts[0].functions,...reference.functions.slice(1)]);
    expect({...result,contracts:[{...result.contracts[0],functions:saved.contracts[0].functions},result.contracts[1]]}).toEqual(saved);
    expect(before).toEqual(saved);
    expect(completeCanonicalContractReference(result as JsonValue,4663,"hook",from)).toEqual(result);
  });
  it("does not trust an arbitrary source or an ambiguous target",()=>{
    expect(()=>completeCanonicalContractReference(input() as JsonValue,4663,"hook",{...from,source:"Untrusted.sol"})).toThrow();
    expect(()=>completeCanonicalContractReference(input() as JsonValue,4663,"missing",from)).toThrow();
    const duplicate=input();duplicate.contracts.push({...duplicate.contracts[0]});
    expect(()=>completeCanonicalContractReference(duplicate as JsonValue,4663,"hook",from)).toThrow();
  });
  it("refuses to replace the mutability or return shape of a saved function",()=>{
    const existing=reference.functions.find(item=>item.includes(" view "))!;
    const before=input();before.contracts[0].functions=[existing.replace(" view "," pure ")];
    const snapshot=structuredClone(before);
    expect(()=>completeCanonicalContractReference(before as JsonValue,4663,"hook",from)).toThrow(/conflicts with its canonical interface/);
    expect(before).toEqual(snapshot);
  });
  it("keeps equivalent named outputs idempotent and rejects additions to exact canonical pairs",()=>{
    const before=input();before.contracts[0].functions=["function token() view returns (address preservedName)"];
    const completed=completeCanonicalContractReference(before as JsonValue,4663,"hook",from) as ReturnType<typeof input>;
    expect(completed.contracts[0].functions[0]).toBe(before.contracts[0].functions[0]);
    expect(completeCanonicalContractReference(completed as JsonValue,4663,"hook",from)).toEqual(completed);
    const exact={contracts:[{...from,functions:["function arbitraryMint()"]}]};
    expect(completeCanonicalContractInterfaces(exact as JsonValue,4663)).toEqual({contracts:[{...from,functions:reference.functions}]});
  });
  it("requires changes to requirements already linked to the affected contract",()=>{
    const rules=[{id:"zero",text:"Zero",kind:"behavior" as const,open:null,origin:{kind:"legacy" as const}},{id:"other",text:"Unrelated",kind:"behavior" as const,open:null,origin:{kind:"legacy" as const}}];
    const prior={document:{...platformContractDocument,requirements:rules,architecture:{...platformContractDocument.architecture,canonicalInterfaces:[{entryId:"main",...from}]}}};
    const next={...prior.document.architecture,canonicalInterfaces:[{entryId:"main",source:"Different.sol",contract:"Different"}]};
    expect(()=>assertCanonicalReferenceChanges(prior,rules.map(rule=>rule.id==="other"?{...rule,text:"Changed unrelated"}:rule),next)).toThrow(/linked requirements/);
    expect(()=>assertCanonicalReferenceChanges(prior,rules.map(rule=>rule.id==="zero"?{...rule,text:"Changed linked behavior"}:rule),next)).not.toThrow();
    const relinked={...next,contractChecks:{...next.contractChecks,contracts:next.contractChecks.contracts.map(entry=>({...entry,surfaceRequirements:["other"]}))}};
    expect(()=>assertCanonicalReferenceChanges(prior,rules.map(rule=>rule.id==="other"?{...rule,text:"Changed unrelated"}:rule),relinked)).toThrow(/linked requirements/);
  });
  it("binds the canonical reference in the leased plan and refuses unrelated later changes",async()=>{
    const db=new PGlite();
    try{
      await db.exec(CUSTOM_AI_SCHEMA);await db.exec(PROJECT_PLATFORM_SCHEMA);
      let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const before=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await before;return {query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};}};
      const projects=createPlatformStore(pool),scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"};
      const revision=await projects.createProject(scope);
      const runs=createRunStore(pool,{allowance:{hourlyUnits:25,dailyUnits:100,globalDailyUnits:100,concurrent:1},leaseMs:60000,capabilities:{}});
      const run=await runs.startRun({...scope,revisionId:revision.revisionId,operation:"build",prompt:"Build counter",idempotencyKey:"start",budgetUnits:5});
      const lease=(await runs.claimRun(scope,run.runId,"worker"))!;
      const sandbox={execute:async()=>{throw Error("No execution in interface planning");}};
      const checks=createProjectChecks(pool,projects,sandbox);
      const tool=createProjectTools(projects,sandbox as never,checks).find(item=>item.id==="project.plan")!;
      const context={...scope,runId:run.runId,leaseToken:lease.token,stepId:`${run.runId}:plan`,revision,prompt:"Build counter",signal:AbortSignal.timeout(10000)};
      const args={title:"Counter",requirements:[{id:"zero",text:"The value starts at zero",kind:"behavior",open:null,instruction:"counter"}],edits:[],architecture:{...platformContractDocument.architecture,canonicalInterfaces:[{entryId:"main",...from}]}};
      await expect(tool.execute(context,{...args,architecture:{...args.architecture,kind:"application"}})).rejects.toMatchObject({code:"contract-interface"});
      await expect(tool.execute({...context,leaseToken:"expired-worker"},args)).rejects.toMatchObject({code:"run-lease"});
      await tool.execute(context,args);
      const saved=await projects.readProject(scope);
      expect(saved.document.files).toEqual(revision.document.files);
      const architecture=saved.document.architecture as typeof args.architecture;
      expect(architecture.contractChecks.steps).toEqual(platformContractDocument.architecture.contractChecks.steps);
      expect(architecture.contractChecks.allowedCalls).toEqual(platformContractDocument.architecture.contractChecks.allowedCalls);
      expect(architecture.contractChecks.contracts[0].functions).toContain(reference.functions[0]);
      expect(architecture.contractChecks.contracts[0].functions).toContain("function value() view returns (uint256)");
      expect((await checks.assess({...scope,revisionId:saved.revisionId})).verified).toBe(false);
      const other=canonicalInterfaceContext(1).contracts.find(item=>item.contract!==reference.contract)!;
      const changed={...args,architecture:{...args.architecture,canonicalInterfaces:[{entryId:"main",source:other.source,contract:other.contract}]}};
      await expect(tool.execute({...context,revision:saved,stepId:"replace-reference"},changed)).rejects.toMatchObject({code:"contract-interface"});
      expect((await projects.readProject(scope)).revisionId).toBe(saved.revisionId);
      await tool.reconcile!(context,args);
      expect((await projects.readProject(scope)).revisionId).toBe(saved.revisionId);
    }finally{await db.close();}
  });
});
