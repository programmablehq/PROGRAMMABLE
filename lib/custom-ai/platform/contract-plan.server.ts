import "server-only";
import {createContractProject,type ContractProject} from "../contract-project";
import {createGeneralCheckBlueprint,bindGeneralCheckBlueprint} from "../check-blueprint";
import type {LaunchIntent} from "../launch-intent";
import type {LaunchProductionContext} from "../launch-production";
import {ProjectError,type ProjectRevision} from "./types";

type ContractRevision=Pick<ProjectRevision,"document"|"projectId"|"requirementsHash">;
export function platformContractIntent(project:ContractRevision):LaunchIntent {
  const requirements=project.document.requirements;
  if(!requirements.length||requirements.some(rule=>rule.open))throw new ProjectError("contract-plan","Resolve the complete contract requirements first.",409);
  return {version:1,id:project.projectId,revision:project.requirementsHash.slice(7),requirements,unresolved:[],changes:[]};
}
/** The same source-independent declaration used by the existing launch flow.
 * Source files are deliberately not part of its input. */
export function platformContractBlueprint(project:ContractRevision){
  const architecture=project.document.architecture;
  if(!architecture||typeof architecture!=="object"||Array.isArray(architecture)||![1,4663].includes(Number(architecture.chainId)))throw new ProjectError("contract-plan","Choose the contract chain and declare contractChecks before writing source.",409);
  try{return createGeneralCheckBlueprint(architecture.contractChecks,platformContractIntent(project),Number(architecture.chainId) as 1|4663,"cancun",
    architecture.production as unknown as LaunchProductionContext|undefined,architecture.compiler as unknown as ContractProject["compiler"]|undefined);
  }catch(error){if(error instanceof ProjectError)throw error;throw new ProjectError("contract-plan","Save a complete contractChecks declaration with interfaces, observable cases and deployment bindings before writing source.",409);}
}
export function platformContract(project:ContractRevision){
  const blueprint=platformContractBlueprint(project),intent=platformContractIntent(project);
  try{
    const contract=createContractProject({compiler:blueprint.compiler,entrypoints:blueprint.entrypoints,sources:Object.fromEntries(Object.entries(project.document.files).filter(([path])=>path.endsWith(".sol")).map(([path,content])=>{
      if(typeof content!=="string")throw new TypeError();return[path,{content}];
    }))},intent,blueprint.chainId,blueprint.production,blueprint.deployment);
    bindGeneralCheckBlueprint(blueprint,contract);return contract;
  }catch{throw new ProjectError("contract-source","Keep the exact contract interfaces, deployment bindings and complete pinned source package from the saved plan.",409);}
}
