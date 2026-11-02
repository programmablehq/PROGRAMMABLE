import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { createAIStore, CUSTOM_AI_SCHEMA, type AIStore } from "../lib/custom-ai/store.server";
import { createContractProject, GENERAL_PROJECT_COMPILER, type ContractProject } from "../lib/custom-ai/contract-project";
import type { CompiledProject } from "../lib/custom-ai/contract-project.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import { generalProjectView } from "../lib/custom-ai/project-view";
import { selectExecutionRoute } from "../lib/custom-ai/execution-routing";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { bindGeneralCheckBlueprint, createGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import type { GeneralScenarioReport } from "../lib/custom-ai/behavior-checks.server";
import {auditGeneralSource} from "../lib/custom-ai/source-audit.server";
import {checkContextHash,type CheckDiagnostic} from "../lib/custom-ai/check-diagnostic";

let database: PGlite, store: AIStore;
const id = "00000000-0000-4000-8000-000000000001";
function project(comment = "") {
  return createContractProject({ compiler: { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: "paris" },
    sources: { "Hook.sol": { content: `pragma solidity 0.8.26; contract Hook {} // ${comment}` } },
    entrypoints: [{ source: "Hook.sol", contract: "Hook", role: "hook" }] }, {
    version: 1, id: "design", revision: "a".repeat(64), changes: [], unresolved: [], requirements: [
      { id: "no-mint", text: "No minting", kind: "constraint", open: null, origin: { kind: "legacy" } },
    ],
  }, 999);
}
function compilation(input: ContractProject): CompiledProject {
  const body = { version: 1 as const, projectHash: input.hash, compiler: GENERAL_PROJECT_COMPILER,
    compiled: false, diagnostics: [{ severity: "error" as const, message: "A deliberately unavailable dependency" }], contracts: [],
    verification: "not-run" as const, launchReady: false as const };
  return { ...body, artifactHash: canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", body) };
}
const reserve = () => store.reserve("alice", { id, intent: "build", messages: [{ role: "user", content: "Build a general hook" }] });
function blueprint(source=project()){
  return createGeneralCheckBlueprint({contracts:[{id:"hook",source:"Hook.sol",contract:"Hook",role:"hook",arguments:[],
    functions:["function marker() pure returns (uint256)"],allowReceive:false,allowFallback:false,surfaceRequirements:["no-mint"]}],allowedCalls:[],steps:[
    {id:"marker",contract:"hook",signature:"marker()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:[],expect:{status:"success",returns:["1"]}},
  ]},source.intent,source.chainId,source.compiler.evmVersion);
}
function compiledReceipt(source:ContractProject):CompiledProject{
  const {artifactHash:discarded,...base}=compilation(source);void discarded;
  const body={...base,compiled:true,diagnostics:[],contracts:[{...source.entrypoints[0],abi:[],creationBytecode:"0x00" as const,runtimeBytecode:"0x00" as const,immutableReferences:{},storageLayout:{}}]};
  return {...body,artifactHash:canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1",body)};
}
function scenarioReceipt(source:ContractProject):GeneralScenarioReport{
  const plan=bindGeneralCheckBlueprint(blueprint(source),source),compiled=compiledReceipt(source);
  const body={version:1 as const,scope:"isolated-declared-scenarios-v1" as const,projectHash:source.hash,artifactHash:compiled.artifactHash,planHash:plan.id,
    passed:true,cases:3,gasUsed:"1",failures:[],requirementIds:["no-mint"],launchReady:false as const};
  return {...body,hash:canonicalBrowserSha256V2("programmable.general-scenario-report.v1",body)};
}
beforeEach(async () => {
  database = new PGlite(); await database.exec(CUSTOM_AI_SCHEMA);
  let queue = Promise.resolve();
  store = createAIStore({ connect: async () => {
    const previous = queue; let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; }); await previous;
    return { query: (sql, values) => database.query<Record<string, unknown>>(sql, values), release };
  } }, { hourlyUnits: 10, dailyUnits: 15, globalDailyUnits: 20, concurrent: 1 });
});
afterEach(async () => { await database.close(); });

describe("owned general contract checkpoints", () => {
  it("keeps rejected declarations private and bound to the active owner, lease and job payload",async()=>{
    const attempt=await reserve(),p=project();
    const diagnostic:CheckDiagnostic={version:1,contextHash:checkContextHash({...p,evmVersion:"paris"}),
      failures:[{stage:"scenarios",message:"missing-requirements:no-mint",declaration:'{"contracts":[]}'}]};
    await expect(store.projects.saveCheckDiagnostic("alice",id,"wrong-lease",diagnostic)).rejects.toBeDefined();
    await store.projects.saveCheckDiagnostic("alice",id,attempt.lease!,diagnostic);
    expect(await store.projects.readCheckDiagnostic("alice",id)).toEqual(diagnostic);
    expect(await store.projects.readCheckDiagnostic("bob",id)).toBeUndefined();
    expect(JSON.stringify(await store.read("alice",id))).not.toContain("missing-requirements");
    await database.query("UPDATE programmable_custom_ai_v1.jobs SET payload_hash='changed' WHERE owner='alice' AND id=$1",[id]);
    expect(await store.projects.readCheckDiagnostic("alice",id)).toBeUndefined();
  });
  it("a compile retry inherits the original source time instead of creating a fresh speed claim",async()=>{
    const first=await reserve(),p=project();const saved=await store.projects.save("alice",id,first.lease!,p);
    await store.cancel("alice",id);
    const retryId="00000000-0000-4000-8000-000000000002";
    const retry=await store.reserve("alice",{id:retryId,intent:"build",messages:[{role:"user",content:"Retry the saved compiler"}]});
    const copied=await store.projects.save("alice",retryId,retry.lease!,p,id);
    expect(copied.sourceGeneratedAt).toBe(saved.sourceGeneratedAt);
    await expect(store.projects.save("bob",retryId,retry.lease!,p,id)).rejects.toBeDefined();
  });
  it("stores and reuses one source-bound audit without changing the code or claiming a launch",async()=>{
    const attempt=await reserve(),p=project();await store.projects.save("alice",id,attempt.lease!,p);
    const audit=await auditGeneralSource(p,undefined,{call:async()=>({text:JSON.stringify({reviewedRequirementIds:["no-mint"],findings:[]}),inputTokens:1,outputTokens:1})});
    const first=await store.projects.saveSourceAudit("alice",id,attempt.lease!,audit);
    expect(first.sourceAudit?.status).toBe("passed");expect(first.sourceAudit?.launchReady).toBe(false);
    expect((await store.projects.saveSourceAudit("alice",id,attempt.lease!,audit)).sourceAudit).toEqual(audit);
    await expect(store.projects.saveSourceAudit("alice",id,attempt.lease!,{...audit,projectHash:`sha256:${"f".repeat(64)}`})).rejects.toBeDefined();
    await store.projects.complete("alice",id,attempt.lease!,compilation(p));
    expect((await store.projects.read("alice",id))?.sourceAudit).toEqual(audit);
  });
  it("keeps the original server source time across later compilation and rejects another owner or source",async()=>{
    const attempt=await reserve(),source=project();
    const first=await store.projects.save("alice",id,attempt.lease!,source);
    const created=first.sourceGeneratedAt!;
    expect(created).toBeGreaterThan(0);
    expect(await store.projects.readSourceCreatedAt("alice",id,source.hash)).toBe(created);
    expect(await store.projects.readSourceCreatedAt("bob",id,source.hash)).toBeNull();
    expect(await store.projects.readSourceCreatedAt("alice",id,`sha256:${"f".repeat(64)}`)).toBeNull();
    await store.projects.complete("alice",id,attempt.lease!,compilation(source));
    expect(await store.projects.readSourceCreatedAt("alice",id,source.hash)).toBe(created);
    await database.query("UPDATE programmable_custom_ai_v1.objects SET value=value-'sourceGeneratedAt' WHERE owner='alice' AND kind='contract-project' AND id=$1",[id]);
    expect(await store.projects.readSourceCreatedAt("alice",id,source.hash)).toBeNull();
  });
  it("saves the complete design and immutable oracle before source, bound to the running job",async()=>{
    const attempt=await reserve(),source=project(),declared=blueprint(source);
    await store.projects.saveBlueprint("alice",id,attempt.lease!,{intent:source.intent,blueprint:declared});
    await store.projects.saveBlueprint("alice",id,attempt.lease!,{intent:source.intent,blueprint:declared});
    expect(await store.projects.read("alice",id)).toBeNull();expect(await store.projects.readBlueprint("bob",id)).toBeNull();
    expect(await store.projects.readBlueprint("alice",id)).toMatchObject({requestId:id,intent:source.intent,blueprint:declared});
    await store.projects.save("alice",id,attempt.lease!,source);
    expect(await store.projects.read("alice",id)).toMatchObject({blueprintId:declared.id});
    const other=createGeneralCheckBlueprint({...declared.scenarios,contracts:declared.scenarios.contracts.map(item=>({...item,role:"auxiliary"}))},source.intent,999,"paris");
    await expect(store.projects.saveBlueprint("alice",id,attempt.lease!,{intent:source.intent,blueprint:other})).rejects.toMatchObject({code:"project-conflict"});
  });
  it("refuses to create an independent-plan receipt after source was already saved",async()=>{
    const attempt=await reserve(),source=project();await store.projects.save("alice",id,attempt.lease!,source);
    await expect(store.projects.saveBlueprint("alice",id,attempt.lease!,{intent:source.intent,blueprint:blueprint(source)})).rejects.toMatchObject({code:"project-conflict"});
    expect(await store.projects.readBlueprint("alice",id)).toBeNull();
  });
  it("cannot attach source with a different planned target or role",async()=>{
    const attempt=await reserve(),source=project();await store.projects.saveBlueprint("alice",id,attempt.lease!,{intent:source.intent,blueprint:blueprint(source)});
    const other=createContractProject({compiler:source.compiler,sources:source.sources,entrypoints:[{...source.entrypoints[0],role:"auxiliary"}]},source.intent,999);
    await expect(store.projects.save("alice",id,attempt.lease!,other)).rejects.toMatchObject({code:"project-conflict"});
    expect(await store.projects.read("alice",id)).toBeNull();
  });
  it("enforces owner, lease, expiry and cancellation for pre-generation plans",async()=>{
    const attempt=await reserve(),source=project(),input={intent:source.intent,blueprint:blueprint(source)};
    for(const [owner,lease] of [["bob",attempt.lease!],["alice","old-lease"]])await expect(store.projects.saveBlueprint(owner,id,lease,input)).rejects.toMatchObject({code:"interrupted"});
    await store.projects.saveBlueprint("alice",id,attempt.lease!,input);await store.cancel("alice",id);
    await expect(store.projects.saveBlueprint("alice",id,attempt.lease!,input)).rejects.toMatchObject({code:"interrupted"});
    expect(await store.projects.readBlueprint("alice",id)).toMatchObject(input);
  });
  it("binds a synthetic report receipt to the original plan and exact saved artifacts without granting readiness",async()=>{
    const attempt=await reserve(),source=project(),report=scenarioReceipt(source),input={intent:source.intent,blueprint:blueprint(source)};
    await store.projects.saveBlueprint("alice",id,attempt.lease!,input);await store.projects.save("alice",id,attempt.lease!,source);
    await expect(store.projects.saveScenarios("alice",id,attempt.lease!,report)).rejects.toMatchObject({code:"project-conflict"});
    await store.projects.complete("alice",id,attempt.lease!,compiledReceipt(source));
    for(const patch of [{projectHash:`sha256:${"f".repeat(64)}`},{planHash:`sha256:${"f".repeat(64)}`},{artifactHash:`sha256:${"f".repeat(64)}`},{cases:1},{requirementIds:[]},{launchReady:true}]){
      const {hash:discarded,...body}={...report,...patch};void discarded;
      await expect(store.projects.saveScenarios("alice",id,attempt.lease!,{...body,hash:canonicalBrowserSha256V2("programmable.general-scenario-report.v1",body)} as GeneralScenarioReport)).rejects.toMatchObject({code:"project-conflict"});
    }
    await store.projects.saveScenarios("alice",id,attempt.lease!,report);await store.projects.saveScenarios("alice",id,attempt.lease!,report);
    expect(await store.projects.read("alice",id)).toMatchObject({scenarios:{hash:report.hash,launchReady:false}});
    const {hash:discarded,...body}={...report,gasUsed:"2"};void discarded;
    await expect(store.projects.saveScenarios("alice",id,attempt.lease!,{...body,hash:canonicalBrowserSha256V2("programmable.general-scenario-report.v1",body)})).rejects.toMatchObject({code:"project-conflict"});
    await store.cancel("alice",id);await expect(store.projects.saveScenarios("alice",id,attempt.lease!,report)).rejects.toMatchObject({code:"interrupted"});
  });
  it("keeps general source versions independently of fee drafts and without source blobs", async () => {
    const attempt=await reserve(),source=project(),selection=selectExecutionRoute(source.intent,source.chainId);
    const view=generalProjectView({version:1,reply:"Source diagnostics",summary:"A saved source proposal",project:source,
      compilation:compilation(source),selection,requirementCoverage:"proposed",launchReady:false});
    await store.finish("alice",id,attempt.lease!,{reply:"Source diagnostics",generalProject:view});
    const studioId="b".repeat(64),state={draftId:id,settings:EMPTY_COIN_SETUP,messages:[]};
    await store.saveObject("alice","studio",studioId,state,0);
    await store.saveObject("alice","studio",studioId,state,1);
    const versions=await store.draftVersions("alice",studioId);
    expect(versions).toHaveLength(1);expect(versions[0].value).toMatchObject({sourceHash:source.hash,summary:"A saved source proposal",state});
    expect(JSON.stringify(versions)).not.toContain("Hook.sol");expect(await store.draftVersions("bob",studioId)).toHaveLength(0);
  });
  it("keeps complete source after the worker fails without exposing it to another owner", async () => {
    const attempt = await reserve(), source = project();
    const saved = await store.projects.save("alice", id, attempt.lease!, source);
    expect(saved.payloadHash).toBe((await store.read("alice", id))?.payloadHash);
    await store.finish("alice", id, attempt.lease!, undefined, "project-compiler");
    expect((await store.projects.read("alice", id))?.project).toEqual(source);
    expect(await store.projects.read("bob", id)).toBeNull();
    const overview = await store.projects.overview("alice", id);
    expect(overview).toMatchObject({ requestId: id, projectHash: source.hash, chainId: 999, compilation: "pending", sourceFiles: 1 });
    expect(overview).not.toHaveProperty("artifactHash");
    expect(overview).not.toHaveProperty("sources");
    expect(await store.projects.overview("bob", id)).toBeNull();
    expect((await store.read("alice", id, false))?.result).toBeUndefined();
    expect((await store.usage("alice")).hourly.used).toBe(5);
  });
  it("requires the current owner, request and live lease before writing source", async () => {
    const attempt = await reserve();
    for (const [owner, requestId, lease] of [["bob", id, attempt.lease!], ["alice", id, "wrong"], ["alice", id + "2", attempt.lease!]]) {
      await expect(store.projects.save(owner, requestId, lease, project())).rejects.toMatchObject({ code: "interrupted" });
    }
    expect(await store.projects.read("alice", id)).toBeNull();
  });
  it("cannot write or finish a project after cancellation", async () => {
    const attempt = await reserve(), source = project();
    await store.projects.save("alice", id, attempt.lease!, source);
    await store.cancel("alice", id);
    await expect(store.projects.save("alice", id, attempt.lease!, source)).rejects.toMatchObject({ code: "interrupted" });
    await expect(store.projects.complete("alice", id, attempt.lease!, compilation(source))).rejects.toMatchObject({ code: "interrupted" });
    expect((await store.projects.read("alice", id))?.compilation).toBeUndefined();
  });
  it("does not let an expired worker commit even before status polling marks it failed", async () => {
    const attempt = await reserve();
    await database.query("UPDATE programmable_custom_ai_v1.jobs SET created_at=now()-interval '11 minutes' WHERE owner=$1 AND id=$2", ["alice", id]);
    await expect(store.projects.save("alice", id, attempt.lease!, project())).rejects.toMatchObject({ code: "interrupted" });
    expect(await store.projects.read("alice", id)).toBeNull();
  });
  it("makes identical source saves idempotent and refuses another revision in the same job", async () => {
    const attempt = await reserve(), source = project();
    await store.projects.save("alice", id, attempt.lease!, source);
    await store.projects.save("alice", id, attempt.lease!, source);
    await expect(store.projects.save("alice", id, attempt.lease!, project("changed"))).rejects.toMatchObject({ code: "project-conflict" });
    const row = await database.query<{ revision: number }>("SELECT revision FROM programmable_custom_ai_v1.objects WHERE kind='contract-project'");
    expect(row.rows[0].revision).toBe(1);
    const tampered = structuredClone(source); tampered.sources["Hook.sol"].content += " changed";
    await expect(store.projects.save("alice", id, attempt.lease!, tampered)).rejects.toThrow("changed");
  });
  it("binds compiler diagnostics to exact saved source and never grants verification", async () => {
    const attempt = await reserve(), source = project(), result = compilation(source);
    await expect(store.projects.complete("alice", id, attempt.lease!, result)).rejects.toMatchObject({ code: "project-conflict" });
    await store.projects.save("alice", id, attempt.lease!, source);
    await expect(store.projects.complete("alice", id, attempt.lease!, compilation(project("other")))).rejects.toMatchObject({ code: "project-conflict" });
    await expect(store.projects.complete("alice", id, attempt.lease!, { ...result, launchReady: true } as unknown as CompiledProject)).rejects.toMatchObject({ code: "project-conflict" });
    await store.projects.complete("alice", id, attempt.lease!, result);
    await store.projects.complete("alice", id, attempt.lease!, result);
    expect((await store.projects.read("alice", id))?.compilation).toEqual(result);
    expect(await store.projects.overview("alice", id)).toMatchObject({ projectHash: source.hash, artifactHash: result.artifactHash,
      compilation: "diagnostics", diagnostics: result.diagnostics });
    const changed = compilation(source); changed.diagnostics[0].message = "Changed after hashing";
    await expect(store.projects.complete("alice", id, attempt.lease!, changed)).rejects.toMatchObject({ code: "project-conflict" });
  });
  it("saves a complete larger project while leaving ordinary object limits intact", async () => {
    const attempt = await reserve(), original = project();
    const sources = { ...original.sources, ...Object.fromEntries([1, 2, 3].map(n => [`Dependency${n}.sol`, { content: "//" + "x".repeat(90_000) }])) };
    const source = createContractProject({ compiler: original.compiler, entrypoints: original.entrypoints, sources }, original.intent, 999);
    expect(Buffer.byteLength(JSON.stringify(source))).toBeGreaterThan(256_000);
    await expect(store.saveObject("alice", "studio", id, source, 0)).rejects.toMatchObject({ code: "input" });
    await store.projects.save("alice", id, attempt.lease!, source);
    expect((await store.projects.read("alice", id))?.project.sources).toEqual(source.sources);
  });
});
