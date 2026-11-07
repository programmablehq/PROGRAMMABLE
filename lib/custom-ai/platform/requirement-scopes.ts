import {ProjectError,type ProjectDocument} from "./types";

/** Shared requirements may belong to both components. They need evidence from
 * each component; a contract check cannot verify visitor auth in an app. */
export function projectRequirementScopes(document:ProjectDocument){
  const all=document.requirements.map(rule=>rule.id),architecture=document.architecture;
  const plan=architecture&&typeof architecture==="object"&&!Array.isArray(architecture)?architecture:{};
  const contract=["contract","legacy-contract"].includes(String(plan.kind));
  if(!contract)return {contract:[] as string[],application:all};
  if(!plan.application)return {contract:all,application:[] as string[]};
  const raw=plan.requirementScopes;
  const invalid=()=>new ProjectError("project-requirement-scopes","Map every requirement to the contract, application, or both before building a combined project.",409);
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).some(key=>!["contract","application"].includes(key)))throw invalid();
  const result={contract:[] as string[],application:[] as string[]};
  for(const component of ["contract","application"] as const){
    const ids=raw[component];
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=="string"||!all.includes(id))||new Set(ids).size!==ids.length)throw invalid();
    result[component]=ids as string[];
  }
  if(all.some(id=>!result.contract.includes(id)&&!result.application.includes(id)))throw invalid();
  return result;
}
