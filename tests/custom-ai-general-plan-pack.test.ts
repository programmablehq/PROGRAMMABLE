import {beforeAll,describe,expect,it,vi} from "vitest";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {concatHex,getCreate2Address,keccak256} from "viem";
vi.mock("server-only",()=>({}));
import {generalPackFixture} from "./fixtures/custom-ai-general-pack";
import {packGeneralRobinhoodPlan} from "../lib/custom-ai/general-plan-pack.server";
import {materializeGeneralRuntime} from "../lib/custom-ai/runtime-materialization.server";
import {ROBINHOOD_PLAN_DEPLOYER} from "../lib/custom-ai/plan-deployer";
import {canonicalBrowserJsonV2,canonicalBrowserSha256V2,fileSha256V2} from "../lib/custom-launch/browser-authority-v2";
import type {LaunchControllerV1} from "../lib/custom-launch/launch-plan-v1";

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("owned modern Robinhood Plan packing",{timeout:120_000},()=>{
  let fixture:Awaited<ReturnType<typeof generalPackFixture>>,packed:Awaited<ReturnType<typeof packGeneralRobinhoodPlan>>;
  beforeAll(async()=>{
    fixture=await generalPackFixture(4663);
    const input=structuredClone(fixture),controller:LaunchControllerV1={address:input.controller,kind:"eoa"};
    const pending=packGeneralRobinhoodPlan(input,controller);
    // Everything selected by this explicit action is snapped before the first
    // asynchronous address-search yield. Later browser edits cannot alter it.
    input.identity.nonce=`0x${"55".repeat(32)}`;input.source.binding.settings.name="Changed during pack";
    input.nativeFundingWei="1";(controller as {kind:string}).kind="smart_account";
    packed=await pending;
    if(process.env.CUSTOM_AI_PLAN_EVIDENCE_DIR){
      await writeFile(join(process.env.CUSTOM_AI_PLAN_EVIDENCE_DIR,"general-robinhood-plan-request.json"),packed.requestBody,{mode:0o600});
      await writeFile(join(process.env.CUSTOM_AI_PLAN_EVIDENCE_DIR,"general-robinhood-plan-pack.json"),JSON.stringify(packed,null,2)+"\n",{mode:0o600});
    }
  },120_000);
  it("builds the actual Plan schema and atomic route with the separate deterministic deployment dependency",()=>{
    const plan=JSON.parse(packed.requestBody);
    expect(plan.schemaVersion).toBe("programmable.custom-launch-plan.v1");expect(plan.chainId).toBe("4663");expect(plan.executor).toBe("atomic_execute_and_stamp_v2");
    expect(plan.manifestDigest).toBe(fixture.source.project.production!.manifestDigest);expect(plan.controller).toEqual({address:fixture.controller,kind:"eoa"});
    expect(plan.dependencies[0]).toMatchObject({dependencyId:"create2-factory",address:ROBINHOOD_PLAN_DEPLOYER.address,runtimeCodeHash:ROBINHOOD_PLAN_DEPLOYER.runtimeCodeHash});
    expect(plan.dependencies[0].address).not.toBe(fixture.source.project.production!.executor.address);
    expect(plan.publication.name).toBe("Pack Fixture");expect(packed.identity).toEqual(fixture.identity);expect(packed.launchReady).toBe(false);
    expect(packed.runtimeMaterialization.deployer).toBe(ROBINHOOD_PLAN_DEPLOYER.address);
    expect(packed.runtimeMaterialization.deployerRuntimeCodeHash).toBe(ROBINHOOD_PLAN_DEPLOYER.runtimeCodeHash);
  });
  it("uses exact canonical Plan bytes and hashes without borrowing the graph serialization",()=>{
    const plan=JSON.parse(packed.requestBody);
    expect(packed.requestBody).toBe(canonicalBrowserJsonV2(plan));expect(packed.requestBody.endsWith("\n")).toBe(false);
    expect(packed.requestSha256).toBe(fileSha256V2(Buffer.from(packed.requestBody)));
    expect(packed.planHash).toBe(canonicalBrowserSha256V2("programmable.custom-launch-plan.v1",plan));
    const {hash,...body}=packed;expect(hash).toBe(canonicalBrowserSha256V2("programmable.custom-ai-general-plan-pack.v1",body));
  });
  it("binds each original component, constructor, initializer, runtime and declared native amount once",()=>{
    const plan=JSON.parse(packed.requestBody);
    expect(plan.components).toHaveLength(fixture.source.project.entrypoints.length);
    for(const action of plan.actions.filter((action:{kind:string})=>action.kind==="deployCreate2")){
      const component=plan.components.find((c:{componentId:string})=>c.componentId===action.componentId);
      expect(getCreate2Address({from:ROBINHOOD_PLAN_DEPLOYER.address,salt:action.salt,bytecodeHash:keccak256(action.initCode)})).toBe(component.expectedAddress);
      expect(action.execution.data).toBe(concatHex([action.salt,action.initCode]));
      const runtime=packed.runtimeMaterialization.contracts.find(c=>c.id===action.componentId)!;
      expect(keccak256(runtime.runtimeCode)).toBe(component.runtimeCodeHash);
      expect(plan.verificationBundle.components.find((c:{targetId:string})=>c.targetId===action.componentId).runtimeMaterialization.deployedRuntimeCodeHash).toBe(component.runtimeCodeHash);
    }
    const hook=plan.components.find((c:{componentId:string})=>c.componentId==="hook");expect(Number(BigInt(hook.expectedAddress)&16383n)).toBe(8192);
    expect(plan.actions.filter((a:{kind:string})=>a.kind==="call")).toHaveLength(1);
    expect(plan.actions.reduce((sum:bigint,a:{execution?:{value:string}})=>sum+BigInt(a.execution?.value??"0"),0n).toString()).toBe(plan.budgets.maxTotalValue);
    expect(plan.budgets.maxTotalValue).toBe("10000000000000000");
  });
  it("cannot treat the execution contract as a deployment factory or invent another dependency",async()=>{
    const predictions=packed.reproducibleConfig.targets.map(t=>({targetId:t.targetId,predictedAddress:t.predictedAddress,effectiveSalt:t.effectiveSalt,resolvedConstructorArguments:t.resolvedConstructorArguments}));
    const selected={controller:fixture.controller,settings:fixture.source.binding.settings};
    await expect(materializeGeneralRuntime(fixture.source.project,fixture.source.compilation,selected,predictions)).rejects.toMatchObject({code:"runtime-context"});
    await expect(materializeGeneralRuntime(fixture.source.project,fixture.source.compilation,{...selected,planDeployer:{...ROBINHOOD_PLAN_DEPLOYER,address:fixture.source.project.production!.executor.address}},predictions)).rejects.toMatchObject({code:"runtime-context"});
  });
  it("keeps private chat and intent data out of the Plan verification bundle and makes no review or launch claim",()=>{
    const plan=JSON.parse(packed.requestBody),text=JSON.stringify(plan);
    for(const privateText of ["Private packing fixture request must not be public","pack-fixture-owner",fixture.source.project.intent.requirements[0].text])expect(text).not.toContain(privateText);
    expect(plan).not.toHaveProperty("approval");expect(plan).not.toHaveProperty("permit");expect(plan).not.toHaveProperty("launchReady");
    expect(packed.launchReady).toBe(false);expect(packed.runtimeMaterialization.scope).toBe("isolated-constructor-runtime-v1");
  });
  it("retains all sixteen source components without multiplying a fixed three-million gas allowance",async()=>{
    const large=await generalPackFixture(4663,false,13),actual=await packGeneralRobinhoodPlan(large,{address:large.controller,kind:"eoa"}),plan=JSON.parse(actual.requestBody);
    expect(plan.components).toHaveLength(16);expect(plan.actions).toHaveLength(17);expect(actual.runtimeMaterialization.constructionGas).toHaveLength(16);
    expect(plan.actions.reduce((sum:bigint,a:{execution:{gasLimit:string}})=>sum+BigInt(a.execution.gasLimit),0n)).toBeLessThan(BigInt(plan.budgets.maxTotalGas));
    expect(actual.launchReady).toBe(false);
  });
  it("uses the Plan's one-public-link rule without requiring an invented X profile or public description",async()=>{
    const input=structuredClone(fixture);delete input.source.binding.settings.x;delete input.source.binding.settings.description;
    input.source.bindingHash=canonicalBrowserSha256V2("programmable.custom-ai-launch-source.v1",input.source.binding);
    const actual=await packGeneralRobinhoodPlan(input,{address:input.controller,kind:"eoa"}),plan=JSON.parse(actual.requestBody);
    expect(plan.publication.links).toEqual([input.source.binding.settings.website]);expect(plan.publication).not.toHaveProperty("description");
    delete input.source.binding.settings.website;input.source.bindingHash=canonicalBrowserSha256V2("programmable.custom-ai-launch-source.v1",input.source.binding);
    await expect(packGeneralRobinhoodPlan(input,{address:input.controller,kind:"eoa"})).rejects.toThrow("public project or social link");
  });
  it("rejects an undeclared contract-wallet authority, changed source and an already stopped action",async()=>{
    await expect(packGeneralRobinhoodPlan(fixture,{address:fixture.controller,kind:"smart_account"})).rejects.toMatchObject({code:"launch-plan-pack"});
    const changed=structuredClone(fixture);changed.source.binding.settings.name="Changed source";
    await expect(packGeneralRobinhoodPlan(changed,{address:fixture.controller,kind:"eoa"})).rejects.toThrow();
    const stopped=new AbortController();stopped.abort(Error("stopped"));
    await expect(packGeneralRobinhoodPlan(fixture,{address:fixture.controller,kind:"eoa"},stopped.signal)).rejects.toThrow("stopped");
  });
  it("leaves unknown constructor environment unresolved rather than fabricating Plan runtime evidence",async()=>{
    const unstable=await generalPackFixture(4663,true);
    await expect(packGeneralRobinhoodPlan(unstable,{address:unstable.controller,kind:"eoa"})).rejects.toMatchObject({code:"runtime-dependency",status:422});
  });
});
