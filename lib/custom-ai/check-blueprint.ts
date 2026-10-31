import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { GENERAL_PROJECT_COMPILER, projectCompilerInput, projectSourcePath, type ContractProject, type ProjectEntrypoint } from "./contract-project";
import { builderChain, type BuilderChainId } from "./execution-routing";
import { intentHasOpenParts, type LaunchIntent } from "./launch-intent";
import { createGeneralCheckPlan, normalizeGeneralCheckScenarios, type GeneralCheckScenarios } from "./behavior-checks";

/** The interpreter declares this before code generation. It contains agreed
 * interfaces and scenarios, no implementation source or compiler artifacts. */
export type GeneralCheckBlueprint = {
  version: 1;
  id: `sha256:${string}`;
  intentId: string;
  intentRevision: string;
  intentHash: `sha256:${string}`;
  chainId: BuilderChainId;
  compiler: ContractProject["compiler"];
  entrypoints: ProjectEntrypoint[];
  scenarios: GeneralCheckScenarios;
};
const fail=():never=>{throw new TypeError("Declare complete contract scenarios before generating source.");};

export function createGeneralCheckBlueprint(value:unknown,intent:LaunchIntent,chainId:BuilderChainId,evmVersion:"paris"|"cancun"):GeneralCheckBlueprint {
  builderChain(chainId);
  if(!intent?.id||!/^[a-f0-9]{64}$/.test(intent.revision)||intentHasOpenParts(intent)||!intent.requirements.length||intent.requirements.length>64
    ||!["paris","cancun"].includes(evmVersion)||!value||typeof value!=="object"||Array.isArray(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value))||new TextEncoder().encode(JSON.stringify(value)).length>96_000)return fail();
  const raw=value as Record<string,unknown>;
  if(Object.keys(raw).sort().join()!=="allowedCalls,contracts,steps"||!Array.isArray(raw.contracts)||!raw.contracts.length||raw.contracts.length>16)return fail();
  const contracts:Record<string,unknown>[]=[],entries:ProjectEntrypoint[]=[];
  for(const item of raw.contracts){
    if(!item||typeof item!=="object"||Array.isArray(item)||![Object.prototype,null].includes(Object.getPrototypeOf(item)))return fail();
    const {role,...fixture}=item as Record<string,unknown>,source=projectSourcePath(fixture.source);
    if(!["token","hook","liquidity","auxiliary"].includes(String(role))||typeof fixture.contract!=="string"||!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(fixture.contract))return fail();
    entries.push({source,contract:fixture.contract,role:role as ProjectEntrypoint["role"]});contracts.push(fixture);
  }
  const entrypoints=entries.sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:a.contract<b.contract?-1:a.contract>b.contract?1:0);
  const scenarios=normalizeGeneralCheckScenarios({contracts,allowedCalls:raw.allowedCalls,steps:raw.steps},intent,entrypoints);
  const compiler:ContractProject["compiler"]={version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion};
  const body={version:1 as const,intentId:intent.id,intentRevision:intent.revision,intentHash:canonicalBrowserSha256V2("programmable.general-check-intent.v1",intent),chainId,
    compiler,entrypoints,scenarios};
  return structuredClone({...body,id:canonicalBrowserSha256V2("programmable.general-check-blueprint.v1",body)});
}

export function checkedGeneralCheckBlueprint(value:GeneralCheckBlueprint,intent:LaunchIntent):GeneralCheckBlueprint {
  if(!value||value.version!==1||!value.scenarios||!Array.isArray(value.entrypoints))return fail();
  const parsed=createGeneralCheckBlueprint({contracts:value.scenarios.contracts.map(fixture=>({...fixture,
    role:value.entrypoints.find(entry=>entry.source===fixture.source&&entry.contract===fixture.contract)?.role})),
    allowedCalls:value.scenarios.allowedCalls,steps:value.scenarios.steps},intent,value.chainId,value.compiler?.evmVersion);
  // Reconstruct all fields; extra or changed metadata cannot inherit an ID.
  const {id,...body}=value;
  if(id!==parsed.id||id!==canonicalBrowserSha256V2("programmable.general-check-blueprint.v1",body))return fail();
  return parsed;
}

export function bindGeneralCheckBlueprint(blueprint:GeneralCheckBlueprint,project:ContractProject){
  projectCompilerInput(project);
  const checked=checkedGeneralCheckBlueprint(blueprint,project.intent);
  if(checked.chainId!==project.chainId||checked.compiler.version!==project.compiler.version||checked.compiler.evmVersion!==project.compiler.evmVersion
    ||checked.compiler.optimizerRuns!==project.compiler.optimizerRuns||checked.compiler.viaIR!==project.compiler.viaIR
    ||canonicalBrowserSha256V2("programmable.project-entrypoints.v1",checked.entrypoints)!==canonicalBrowserSha256V2("programmable.project-entrypoints.v1",project.entrypoints))return fail();
  return createGeneralCheckPlan(checked.scenarios,project);
}
