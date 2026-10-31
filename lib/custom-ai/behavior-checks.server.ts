import "server-only";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput, type ContractProject } from "./contract-project";
import type { CompiledProject } from "./contract-project.server";
import { createGeneralCheckPlan, type GeneralCheckPlan } from "./behavior-checks";
import { CustomAIError } from "./types";

export type GeneralScenarioReport = {
  version:1;scope:"isolated-declared-scenarios-v1";projectHash:ContractProject["hash"];artifactHash:CompiledProject["artifactHash"];
  planHash:GeneralCheckPlan["id"];passed:boolean;cases:number;gasUsed:string;
  failures:{caseId:string;code:string;message:string}[];requirementIds:string[];
  /** Passing declared cases is not a complete semantic proof, live test or review. */
  launchReady:false;hash:`sha256:${string}`;
};

export async function checkGeneralScenarios(project:ContractProject,compilation:CompiledProject,plan:GeneralCheckPlan,signal?:AbortSignal):Promise<GeneralScenarioReport> {
  signal?.throwIfAborted();projectCompilerInput(project);
  const {artifactHash,...artifacts}=compilation,{id:planHash,...declared}=plan;
  const reconstructed=createGeneralCheckPlan({contracts:plan.contracts,allowedCalls:plan.allowedCalls,steps:plan.steps,...(plan.world?{world:plan.world}:{})},project);
  const compilerBuilds=[project.compiler.version,`${project.compiler.version}.Emscripten.clang`];
  if(!compilation.compiled||compilation.projectHash!==project.hash||!compilerBuilds.includes(compilation.compiler)||compilation.verification!=="not-run"||compilation.launchReady!==false||!compilation.contracts.length
    ||artifactHash!==canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1",artifacts)
    ||planHash!==canonicalBrowserSha256V2("programmable.general-declared-checks.v1",declared)||reconstructed.id!==planHash) {
    throw new CustomAIError("behavior-context","Choose the exact saved source, artifacts and declared checks before testing.",409);
  }
  let toolchain:string;
  try{toolchain=await realpath(/* turbopackIgnore: true */ process.env.CUSTOM_AI_COMPILER_DIR??join(process.cwd(),"scripts/custom-ai/toolchain"));}
  catch{throw new CustomAIError("behavior-worker","The isolated contract checks are temporarily unavailable. Your saved source and artifacts are kept.",503);}
  const worker=join(process.cwd(),"scripts/custom-ai/general-behavior-worker.mjs");
  const worldModule=join(process.cwd(),"scripts/custom-ai/general-v4-world.mjs");
  const worldFiles=plan.world?[join(process.cwd(),"scripts/custom-ai/general-v4-fixture.json"),join(process.cwd(),"scripts/custom-ai/core-bundle.json")]:[];
  const output=await new Promise<string>((resolve,reject)=>{
    const child=execFile(process.execPath,["--permission",...[toolchain,worker,worldModule,...worldFiles].map(path=>`--allow-fs-read=${path}`),"--max-old-space-size=384",worker,toolchain],
      {cwd:toolchain,env:{NODE_ENV:"production"},encoding:"utf8",timeout:30_000,maxBuffer:512_000,signal},(error,stdout)=>error
        ?reject(new CustomAIError("behavior-worker","The isolated contract checks did not finish. Your saved source and artifacts are kept.",503)):resolve(stdout));
    child.stdin?.on("error",()=>undefined);child.stdin?.end(JSON.stringify({chainId:project.chainId,evmVersion:project.compiler.evmVersion,contracts:compilation.contracts,plan}));
  });
  const result=JSON.parse(output) as Pick<GeneralScenarioReport,"passed"|"cases"|"gasUsed"|"failures">;
  if(Object.keys(result).sort().join()!=="cases,failures,gasUsed,passed"||typeof result.passed!=="boolean"||!Number.isInteger(result.cases)||result.cases<0||result.cases>300
    ||typeof result.gasUsed!=="string"||!/^\d{1,20}$/.test(result.gasUsed)||!Array.isArray(result.failures)||result.failures.length>32
    ||result.passed!==(result.failures.length===0)||result.passed&&result.cases!==plan.contracts.length*2+plan.steps.length
    ||result.failures.some(item=>!item||typeof item.caseId!=="string"||typeof item.code!=="string"||typeof item.message!=="string"||item.message.length>500)) {
    throw new CustomAIError("behavior-worker","The isolated checks returned an incomplete result. Your source is kept.",503);
  }
  // An unavailable execution fixture or malformed example is a limitation of
  // this checking path. It does not establish incorrect contract behavior and
  // must not turn into a request to rewrite an otherwise untested contract.
  if(result.failures.some(item=>item.code==="fixture-execution"))throw new CustomAIError("behavior-fixture",
    "These contract examples need a supported execution fixture before they can finish. The saved source, artifacts and original examples are kept.",503);
  const body={version:1 as const,scope:"isolated-declared-scenarios-v1" as const,projectHash:project.hash,artifactHash,planHash,...result,
    requirementIds:project.intent.requirements.map(rule=>rule.id).sort(),launchReady:false as const};
  return {...body,hash:canonicalBrowserSha256V2("programmable.general-scenario-report.v1",body)};
}
