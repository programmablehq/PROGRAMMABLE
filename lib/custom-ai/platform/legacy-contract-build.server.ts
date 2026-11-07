import "server-only";
import { createContractProject, type ContractProject } from "../contract-project";
import { compileContractProject, type CompiledProject } from "../contract-project.server";
import { createGeneralCheckPlan } from "../behavior-checks";
import { checkGeneralScenarios } from "../behavior-checks.server";
import { canonicalGeneralSourceCatalog } from "../canonical-dependencies.server";
import { createProjectCompiler } from "../compiler-profile";
import type { createArtifactStore } from "./artifacts.server";
import type { createProjectChecks } from "./builds.server";
import { projectHash } from "./document";
import { ProjectError, type ProjectRevision, type JsonValue } from "./types";
import type { ProjectTool } from "./agent.server";

function contract(project: ProjectRevision) {
  const architecture = project.document.architecture;
  if (!architecture || typeof architecture !== "object" || Array.isArray(architecture) || ![1,4663].includes(Number(architecture.chainId))) throw new ProjectError("contract-plan", "Choose the contract chain and entrypoints in the saved project plan.", 409);
  const requirements = project.document.requirements;
  if (!requirements.length || requirements.some(rule => rule.open)) throw new ProjectError("contract-plan", "Resolve the complete requirements before compiling.", 409);
  const intent = { version: 1 as const, id: project.projectId, revision: project.requirementsHash.slice(7), requirements, unresolved: [], changes: [] };
  try {
    return createContractProject({ compiler: architecture.compiler ?? createProjectCompiler("standard-v1", "cancun"),
      entrypoints: architecture.entrypoints, sources: Object.fromEntries(Object.entries(project.document.files).filter(([name]) => name.endsWith(".sol")).map(([name, content]) => {
        if (typeof content !== "string") throw new TypeError();
        return [name, { content }];
      })) }, intent, Number(architecture.chainId) as 1|4663);
  } catch { throw new ProjectError("contract-source", "Keep a complete Solidity package with the approved compiler and declared entrypoints.", 409); }
}

export function contractProjectTools(artifacts: ReturnType<typeof createArtifactStore>, checks: ReturnType<typeof createProjectChecks>): ProjectTool[] {
  return [
    { id: "contract.library", version: "1", description: "Read available pinned contract library source files. Empty paths lists names; selected paths return source for project.patch. Set chainId to 1 or 4663.",
      schema: { type: "object", additionalProperties: false, properties: { chainId: { enum: [1,4663] }, paths: { type: "array", maxItems: 20, items: { type: "string" } } }, required: ["chainId","paths"] },
      execute: async (_context, input) => {
        const data = input as {chainId:1|4663;paths:string[]}, catalog = canonicalGeneralSourceCatalog(undefined,data.chainId);
        let size=0;const files:Record<string,JsonValue>={};
        for(const path of data.paths){if(!Object.hasOwn(catalog,path))throw new ProjectError("contract-library","Choose a listed contract library.");size+=catalog[path].content.length;
          if(size>120000)throw new ProjectError("contract-library","Read fewer libraries at a time.",413);files[path]=catalog[path].content;}
        return {available:Object.keys(catalog),files};
      } },
    { id: "contract.compile", version: "1", description: "Compile the exact saved Solidity package with Programmable's pinned compiler. Save chainId, compiler, entrypoints and complete source dependencies in the plan. Compilation alone is not verification or launch approval.",
      schema: { type: "object", additionalProperties: false, properties: {} }, execute: async context => {
        const project = contract(context.revision), compilation = await compileContractProject(project, context.signal);
        const stored = await artifacts.saveArtifact(context, { bytes: Buffer.from(JSON.stringify({ kind: "programmable-contract-build-v1", revisionId: context.revision.revisionId, project, compilation })), mediaType: "application/json" });
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
        const architecture=context.revision.document.architecture as Record<string,JsonValue>;
        const plan=createGeneralCheckPlan(architecture.contractChecks,current);
        const report=await checkGeneralScenarios(current,build.compilation,plan,context.signal);
        const evidence=await checks.record({...context,revisionId:context.revision.revisionId},{requirementIds:report.requirementIds,passed:report.passed,
          commandHash:plan.id,result:JSON.parse(JSON.stringify(report)) as JsonValue});
        return JSON.parse(JSON.stringify({revisionId:context.revision.revisionId,evidence,passed:report.passed,cases:report.cases,failures:report.failures,launchReady:false})) as JsonValue;
      } },
  ];
}
