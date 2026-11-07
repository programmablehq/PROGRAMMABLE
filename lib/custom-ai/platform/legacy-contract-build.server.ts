import "server-only";
import { type ContractProject } from "../contract-project";
import { compileContractProject, type CompiledProject } from "../contract-project.server";
import {bindGeneralCheckBlueprint,generalCheckLogicalRules} from "../check-blueprint";
import { checkGeneralScenarios } from "../behavior-checks.server";
import { canonicalGeneralSourceCatalog,canonicalInterfaceContext } from "../canonical-dependencies.server";
import {readLaunchBuildContext} from "../launch-production.server";
import {platformContract as contract,platformContractBlueprint} from "./contract-plan.server";
import type { createArtifactStore } from "./artifacts.server";
import type { createProjectChecks } from "./builds.server";
import { projectHash } from "./document";
import { ProjectError, type JsonValue } from "./types";
import type { ProjectTool } from "./agent.server";
import {auditGeneralSource} from "../source-audit.server";
import {sourceCorrectionFeedback} from "../source-feedback";
import type {createPlatformStore} from "./project-store.server";

export function contractProjectTools(artifacts: ReturnType<typeof createArtifactStore>, checks: ReturnType<typeof createProjectChecks>,projects:ReturnType<typeof createPlatformStore>): ProjectTool[] {
  const dependencies:ProjectTool={id:"contract.dependencies",version:"1",description:"Copy the complete pinned contract dependency catalog for the saved plan's chain. Use after project.plan, before writing custom source. This keeps exact source bytes without spending model output on libraries and never overwrites an existing file.",schema:{type:"object",additionalProperties:false,properties:{}},execute:async context=>{
    const plan=platformContractBlueprint(context.revision),catalog=canonicalGeneralSourceCatalog(undefined,plan.chainId);
    const fileChanges=Object.entries(catalog).filter(([path])=>!Object.hasOwn(context.revision.document.files,path)).map(([path,source])=>({operation:"write" as const,path,beforeHash:null,content:source.content}));
    if(!fileChanges.length)return {revisionId:context.revision.revisionId,added:0,files:[]};
    const revision=await projects.applyProjectPatch({...context,expectedRevisionId:context.revision.revisionId,idempotencyKey:context.stepId,execution:{runId:context.runId,leaseToken:context.leaseToken},patch:{fileChanges}});
    return {revisionId:revision.revisionId,added:fileChanges.length,files:fileChanges.map(file=>file.path)};
  }};
  dependencies.reconcile=async(context,input)=>{const receipt=await projects.readPatchReceipt(context,context.stepId);return receipt?{revisionId:receipt.revisionId}:dependencies.execute(context,input);};
  return [
    dependencies,
    {id:"contract.context",version:"1",description:"Read the current canonical coin-launch configuration and independent contract-check declaration format. In project.plan save kind:'contract', chainId, useCanonicalProduction:true and contractChecks before source. The server binds the actual production context; do not copy its opaque hashes. Auxiliary contracts may omit production and deployment.",schema:{type:"object",additionalProperties:false,properties:{chainId:{enum:[1,4663]}},required:["chainId"]},execute:async(context,input)=>{
      const production=await readLaunchBuildContext((input as {chainId:1|4663}).chainId,context.signal);
      return JSON.parse(JSON.stringify({production,interfaces:canonicalInterfaceContext((input as {chainId:1|4663}).chainId),contractChecksInstructions:generalCheckLogicalRules,
        declarationFormat:"For project.plan, architecture.contractChecks is the expanded logical JSON object with contracts, allowedCalls, steps, and optional world/deployment/constructorChildren/compilerProfile. Do not use compact-v1 encoding here. With useCanonicalProduction:true, contracts/constructorChildren matching an exact canonical source and contract receive the complete source-verified ABI from the server; send functions:[] for those known pairs. Custom contracts need the complete human-readable ABI (for example 'function value() view returns (uint256)'). surfaceRequirements accepts ONLY IDs whose requirement kind is constraint; behavior and decision IDs need observable steps. steps[].signature contains only the canonical selector signature (for example 'value()'), never the word function, parameter names, mutability or returns. Keep deployment input/target/binding references distinct from local fixture/account/contract references. Define observable expected outcomes before source."})) as JsonValue;
    }},
    { id: "contract.library", version: "1", description: "Read available pinned contract library source files. Empty paths lists names; selected paths return source for project.patch. Set chainId to 1 or 4663.",
      schema: { type: "object", additionalProperties: false, properties: { chainId: { enum: [1,4663] }, paths: { type: "array", maxItems: 20, items: { type: "string" } } }, required: ["chainId","paths"] },
      execute: async (_context, input) => {
        const data = input as {chainId:1|4663;paths:string[]}, catalog = canonicalGeneralSourceCatalog(undefined,data.chainId);
        let size=0;const files:Record<string,JsonValue>={};
        for(const path of data.paths){if(!Object.hasOwn(catalog,path))throw new ProjectError("contract-library","Choose a listed contract library.");size+=catalog[path].content.length;
          if(size>120000)throw new ProjectError("contract-library","Read fewer libraries at a time.",413);files[path]=catalog[path].content;}
        return {available:Object.keys(catalog),files};
      } },
    { id: "contract.compile", version: "1", description: "Compile the exact saved Solidity package with Programmable's pinned compiler and the predeclared contractChecks interface. Use contract.context before planning. Compilation alone is not verification or launch approval.",
      schema: { type: "object", additionalProperties: false, properties: {} }, execute: async context => {
        const blueprint=platformContractBlueprint(context.revision),project = contract(context.revision), compilation = await compileContractProject(project, context.signal);
        const stored = await artifacts.saveArtifact(context, { bytes: Buffer.from(JSON.stringify({ kind: "programmable-contract-build-v1", revisionId: context.revision.revisionId, blueprint, project, compilation })), mediaType: "application/json" });
        await checks.record({ ...context, revisionId: context.revision.revisionId }, { requirementIds: [], passed: compilation.compiled, commandHash: projectHash(project.compiler),
          result: { kind:"compile", artifactId:stored.id, compiled:compilation.compiled, verification:"not-run" } });
        return JSON.parse(JSON.stringify({ revisionId:context.revision.revisionId,artifactId:stored.id,compiled:compilation.compiled,diagnostics:compilation.diagnostics,verification:"not-run",launchReady:false })) as JsonValue;
      } },
    { id: "contract.check", version: "1", description: "Run the saved architecture.contractChecks against an exact compiled artifact. Uses the existing independent EVM scenario checker. No transaction is broadcast and no launch approval is granted.",
      schema:{type:"object",additionalProperties:false,properties:{artifactId:{type:"string"}},required:["artifactId"]}, execute:async(context,input)=>{
        const saved=await artifacts.readArtifact(context,(input as {artifactId:string}).artifactId);
        let build:{kind:string;revisionId:string;project:ContractProject;compilation:CompiledProject};
        try{build=JSON.parse(Buffer.from(saved.bytes).toString("utf8"));}catch{throw new ProjectError("contract-artifact","Choose a saved contract compilation.");}
        const current=contract(context.revision);
        if(build.kind!=="programmable-contract-build-v1"||build.revisionId!==context.revision.revisionId||build.project.hash!==current.hash)throw new ProjectError("contract-artifact","Compile this exact source revision before checking.",409);
        const blueprint=platformContractBlueprint(context.revision),plan=bindGeneralCheckBlueprint(blueprint,current);
        const report=await checkGeneralScenarios(current,build.compilation,plan,context.signal);
        const evidence=await checks.record({...context,revisionId:context.revision.revisionId},{requirementIds:report.requirementIds,passed:report.passed,
          commandHash:plan.id,result:JSON.parse(JSON.stringify({kind:"contract-scenarios",...report})) as JsonValue});
        const failures=sourceCorrectionFeedback(blueprint,build.compilation,report.failures,report.execution);
        return JSON.parse(JSON.stringify({revisionId:context.revision.revisionId,evidence,passed:report.passed,cases:report.cases,failures,launchReady:false})) as JsonValue;
      } },
    {id:"contract.audit",version:"1",description:"Independently review the exact saved Solidity source for missing requirements and mandatory launch protections. Required in addition to contract.check; this review never grants permission to sign or launch.",schema:{type:"object",additionalProperties:false,properties:{}},execute:async context=>{
      const project=contract(context.revision),ref={...context,revisionId:context.revision.revisionId};
      const previous=(await checks.assess(ref)).evidence.find(item=>item.result&&typeof item.result==="object"&&!Array.isArray(item.result)&&item.result.kind==="source-audit");
      if(previous)return previous.result;
      const audit=await auditGeneralSource(project,context.signal),result=JSON.parse(JSON.stringify({kind:"source-audit",...audit})) as JsonValue;
      await checks.record(ref,{requirementIds:[],passed:audit.status==="passed",commandHash:audit.hash,result});return result;
    }},
  ];
}
