import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const {call}=vi.hoisted(()=>({call:vi.fn()}));
vi.mock("../lib/custom-ai/model-provider.server",()=>({callModel:call}));
vi.mock("../lib/custom-ai/provider-config.server",()=>({configuredProvider:()=>({models:{chat:"chat",build:"build",escalation:"audit"}})}));
import {chooseProjectAction} from "../lib/custom-ai/platform/model.server";
import {emptyProjectDocument} from "../lib/custom-ai/platform/document";
import {projectModelObservations,projectModelFiles} from "../lib/custom-ai/platform/model-context.server";
import type {AgentContext} from "../lib/custom-ai/platform/agent.server";
it("uses the project action contract and preserves complete library observations",async()=>{
 call.mockResolvedValue({text:JSON.stringify({kind:"reply",tool:null,input:null,message:"Ready",claim:"discussed"})});
 const source="x".repeat(25000),context={project:{ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111",revisionId:`sha256:${"a".repeat(64)}`,parentRevisionId:null,ordinal:1,requirementsHash:`sha256:${"b".repeat(64)}`,fileTreeHash:`sha256:${"c".repeat(64)}`,architectureHash:`sha256:${"d".repeat(64)}`,dependencyLockHash:`sha256:${"e".repeat(64)}`,createdAt:new Date().toISOString(),document:emptyProjectDocument()},prompt:`Build a coin for 0x${"a".repeat(40)}. Invalid 0x123.`,operation:"build",tools:[],steps:[{id:"source",cursor:0,capability_id:"contract.library",input:{},state:"completed",result:{source}}],history:[]};
 await chooseProjectAction(context,AbortSignal.timeout(1000));
 const input=call.mock.calls[0][0];expect(input.task).toBe("project-action");expect(input.responseProfile).toBe("contract");expect(input.effort).toBe("low");
 expect(input.schema.properties.input).toEqual({type:["object","null"]});expect(input.schema.properties).not.toHaveProperty("inputJson");
 expect(JSON.parse(input.messages[0].content).observations[0].result.source).toBe(source);
 expect(JSON.parse(input.messages[0].content).requestFacts.evmAddresses).toEqual([{value:`0x${"a".repeat(40)}`,valid:true},{value:"0x123",valid:false}]);
 context.steps[0].capability_id="model.plan";context.steps[0].result={kind:"model-retry"} as never;
 await chooseProjectAction(context,AbortSignal.timeout(1000));expect(call.mock.calls.at(-1)?.[0].model).toBe("audit");
 context.steps[0].result={kind:"model-retry",failure:"output-limit"} as never;
 context.project.document.architecture={kind:"contract",useCanonicalProduction:true,canonicalInterfaces:[{entryId:"hook",source:"canonical.sol",contract:"CanonicalHook"}]};
 await chooseProjectAction(context,AbortSignal.timeout(1000));
 const recovery=JSON.parse(call.mock.calls.at(-1)?.[0].messages[0].content).responseRecovery;
 expect(recovery).toMatchObject({reason:"output-limit",preserveAllRequirements:true,preserveAllExpectedResults:true,maximumOutputTokens:16000});
 expect(recovery.omitOnlyRegeneratedFields).toEqual(["architecture.production","inherited canonical functions"]);
 expect(recovery.preferArchitectureUpdates).toBe(true);
 expect(call.mock.calls.at(-1)?.[0].system).toContain("architectureUpdates");
 expect(call.mock.calls.at(-1)?.[0].maxTokens).toBe(16000);
 context.project.document.architecture=null;
 await chooseProjectAction(context,AbortSignal.timeout(1000));
 expect(JSON.parse(call.mock.calls.at(-1)?.[0].messages[0].content).responseRecovery.omitOnlyRegeneratedFields).toEqual([]);
 expect(JSON.parse(call.mock.calls.at(-1)?.[0].messages[0].content).responseRecovery.preferArchitectureUpdates).toBe(false);
});

it("keeps the canonical context and exact custom file bytes without replaying source-write decisions",()=>{
 const file="contract Hook { function value() external pure returns(uint) { return 1; } }";
 const steps=[{id:"context",cursor:0,capability_id:"contract.context",input:{chainId:8453},state:"completed",result:{ok:true,value:{profile:"current"}}},
  ...Array.from({length:10},(_,i)=>({id:`model-${i}`,cursor:i*2+1,capability_id:"model.plan",input:{},state:"completed",result:{kind:"tool",tool:"project.patch",input:{fileChanges:[{path:"Hook.sol",content:file}]},message:"Saving source",claim:"planned"}})),
  {id:"patch",cursor:22,capability_id:"project.patch",input:{fileChanges:[{path:"Hook.sol",content:file}]},state:"completed",result:{ok:true,value:{revisionId:"saved"}}}];
 const observations=projectModelObservations(steps as AgentContext["steps"]);
 expect(observations.map(step=>step.tool)).toEqual(["contract.context","project.patch"]);
 expect(JSON.stringify(observations)).not.toContain('"kind":"tool"');
 const context={steps,project:{document:{files:{"Hook.sol":file,"package-lock.json":"x".repeat(40000)}}}} as unknown as AgentContext;
 const files=projectModelFiles(context);
 expect(files[0]).toMatchObject({path:"Hook.sol",content:file});expect(files[0].hash).toMatch(/^sha256:[a-f0-9]{64}$/);
 expect(files[1]).not.toHaveProperty("content");
});

it("does not repeat the opaque production binding after the complete plan is saved",()=>{
 const project={document:{architecture:{production:{digest:"saved-exact-binding"},contractChecks:{steps:[]}}}} as unknown as AgentContext["project"];
 const steps=[{id:"context",cursor:0,capability_id:"contract.context",input:{chainId:8453},state:"completed",result:{ok:true,value:{production:{chainId:8453,profileVersion:"current",opaque:"x".repeat(30000)},interfaces:{id:"pinned-source",contracts:[{source:"Hook.sol",contract:"Hook",sourceSha256:"source-hash",functions:["function value() view returns (uint256)"]}]},contractChecksInstructions:"x".repeat(20000)}}}];
 const observed=projectModelObservations(steps as AgentContext["steps"],project);
 expect(JSON.stringify(observed)).not.toContain('"opaque"');
 expect(observed[0].result).toMatchObject({ok:true,value:{chainId:8453,interfaceContextId:"pinned-source",contracts:[{source:"Hook.sol",contract:"Hook",sourceSha256:"source-hash"}]}});
 expect(JSON.stringify(observed).length).toBeLessThan(1000);
});
