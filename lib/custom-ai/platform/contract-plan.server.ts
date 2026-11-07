import "server-only";
import {parseAbi,toFunctionSignature,type AbiParameter} from "viem";
import {createContractProject,type ContractProject} from "../contract-project";
import {createGeneralCheckBlueprint,bindGeneralCheckBlueprint} from "../check-blueprint";
import type {LaunchIntent} from "../launch-intent";
import type {LaunchProductionContext} from "../launch-production";
import {ProjectError,type ProjectRevision,type JsonValue} from "./types";
import {projectRequirementScopes} from "./requirement-scopes";
import {redactInlineCredentials} from "./secret-input";
import {canonicalInterfaceContext} from "../canonical-dependencies.server";

type ContractRevision=Pick<ProjectRevision,"document"|"projectId"|"requirementsHash">;
/** ABI facts come from the pinned source catalog before implementation, never
 * from the model's proposed code or a failed behavior check. Expectations stay
 * exactly as declared; only known canonical source/contract pairs are completed. */
export function completeCanonicalContractInterfaces(input:JsonValue,chainId:1|4663,references?:JsonValue):JsonValue{
  if(!input||typeof input!=="object"||Array.isArray(input))return input;
  const value=structuredClone(input),known=canonicalInterfaceContext(chainId).contracts;
  for(const field of ["contracts","constructorChildren"]){
    const entries=value[field];if(!Array.isArray(entries))continue;
    for(const entry of entries){
      if(!entry||typeof entry!=="object"||Array.isArray(entry))continue;
      const canonical=known.find(item=>item.source===entry.source&&item.contract===entry.contract);
      if(canonical)entry.functions=[...canonical.functions];
    }
  }
  if(references===undefined)return value;
  let completed:JsonValue=value;
  for(const reference of canonicalReferences(references)){
    completed=completeCanonicalContractReference(completed,chainId,reference.entryId,{source:reference.source,contract:reference.contract});
  }
  return completed;
}

const interfaceError=(detail="")=>new ProjectError("contract-interface",`Choose one declared contract and a matching source-verified canonical interface.${detail?` ${detail}`:""}`,409);
type CanonicalReference={entryId:string;source:string;contract:string};
function canonicalReferences(value:JsonValue|undefined):CanonicalReference[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>16)throw interfaceError();
  const selected=new Set<string>();
  return value.map(reference=>{
    if(!reference||typeof reference!=="object"||Array.isArray(reference)||Object.keys(reference).sort().join()!=="contract,entryId,source"
      ||typeof reference.entryId!=="string"||!reference.entryId||reference.entryId.length>128
      ||typeof reference.source!=="string"||!reference.source||reference.source.length>512
      ||typeof reference.contract!=="string"||!reference.contract||reference.contract.length>128)throw interfaceError();
    if(selected.has(reference.entryId))throw interfaceError("Duplicate entryId. Each mapping needs a distinct id from contractChecks.contracts or contractChecks.constructorChildren; a profile id is not a declared contract id.");
    selected.add(reference.entryId);return {entryId:reference.entryId,source:reference.source,contract:reference.contract};
  });
}
/** Caller has already grounded any changed requirement in the latest request.
 * Existing linkage comes only from the saved plan, never the replacement. */
export function assertCanonicalReferenceChanges(previous:Pick<ProjectRevision,"document">,requirements:ProjectRevision["document"]["requirements"],architecture:JsonValue):void{
  const record=(value:JsonValue|undefined):value is Record<string,JsonValue>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
  const before=previous.document.architecture;if(!record(before)||!record(before.contractChecks)||!record(architecture))return;
  const old=new Map(canonicalReferences(before.canonicalInterfaces).map(item=>[item.entryId,item]));
  const next=new Map(canonicalReferences(architecture.canonicalInterfaces).map(item=>[item.entryId,item]));
  const oldRules=new Map(previous.document.requirements.map(rule=>[rule.id,JSON.stringify([rule.text,rule.kind,rule.open])]));
  const nextRules=new Map(requirements.map(rule=>[rule.id,JSON.stringify([rule.text,rule.kind,rule.open])]));
  const changed=new Set([...oldRules.keys(),...nextRules.keys()].filter(id=>oldRules.get(id)!==nextRules.get(id)));
  const entries=(plan:Record<string,JsonValue>)=>[plan.contracts,plan.constructorChildren].flatMap(items=>Array.isArray(items)?items.filter(record):[]);
  const linked=(plan:Record<string,JsonValue>,id:string)=>{
    const ids=new Set(entries(plan).filter(entry=>entry.id===id).flatMap(entry=>Array.isArray(entry.surfaceRequirements)?entry.surfaceRequirements.filter(value=>typeof value==="string"):[]));
    if(Array.isArray(plan.steps))for(const step of plan.steps)if(record(step)&&step.contract===id&&Array.isArray(step.requirementIds))for(const value of step.requirementIds)if(typeof value==="string")ids.add(value);
    return ids;
  };
  for(const id of new Set([...old.keys(),...next.keys()])){
    if(JSON.stringify(old.get(id))===JSON.stringify(next.get(id)))continue;
    const existed=entries(before.contractChecks).some(entry=>entry.id===id);
    const ids=existed?linked(before.contractChecks,id):record(architecture.contractChecks)?linked(architecture.contractChecks,id):new Set<string>();
    if(![...ids].some(id=>changed.has(id)&&(existed||!oldRules.has(id))))throw new ProjectError("contract-interface","Change its linked requirements explicitly before retargeting a saved canonical reference.",409);
  }
}
function mergeCanonicalFunctions(declared:JsonValue,canonical:readonly string[]):JsonValue[]{
  if(!Array.isArray(declared)||declared.some(item=>typeof item!=="string"))throw interfaceError();
  const parameter=(item:AbiParameter):JsonValue=>({type:item.type,...("components" in item?{components:item.components.map(parameter)}:{})});
  const signature=(definition:JsonValue)=>{
    if(typeof definition!=="string")throw interfaceError();
    try{
      const definitions:readonly string[]=[definition],abi=parseAbi(definitions);
      if(abi.length!==1||abi[0].type!=="function")throw interfaceError();
      return {key:toFunctionSignature(abi[0]),shape:JSON.stringify({mutability:abi[0].stateMutability,inputs:abi[0].inputs.map(parameter),outputs:abi[0].outputs.map(parameter)})};
    }catch{throw interfaceError();}
  };
  const saved=new Map<string,string>();
  for(const definition of declared){const item=signature(definition);if(saved.has(item.key))throw interfaceError();saved.set(item.key,item.shape);}
  const additions:string[]=[];
  for(const definition of canonical){
    const item=signature(definition),existing=saved.get(item.key);
    if(existing!==undefined&&existing!==item.shape)throw new ProjectError("contract-interface","The saved function conflicts with its canonical interface. Keep its declared behavior until the requirement is reviewed.",409);
    if(existing===undefined)additions.push(definition);
  }
  return [...declared,...additions];
}

/** Completes known API metadata without learning expectations from generated
 * code or changing a behavior case, deployment argument or source file. */
export function completeCanonicalContractReference(input:JsonValue,chainId:Parameters<typeof canonicalInterfaceContext>[0],entryId:string,reference:{source:string;contract:string}):JsonValue{
  const invalid=(detail="")=>new ProjectError("contract-interface",`Choose one declared contract and a source-verified canonical interface.${detail?` ${detail}`:""}`,409);
  const known=canonicalInterfaceContext(chainId).contracts.find(item=>item.source===reference.source&&item.contract===reference.contract);
  if(!known||!input||typeof input!=="object"||Array.isArray(input))throw invalid();
  const value=structuredClone(input);
  const entries=["contracts","constructorChildren"].flatMap(field=>Array.isArray(value[field])?value[field].filter(item=>item&&typeof item==="object"&&!Array.isArray(item)&&item.id===entryId):[]);
  if(entries.length!==1)throw invalid("entryId must identify exactly one entry in contractChecks.contracts or contractChecks.constructorChildren. Use the id from your declaration, not the profile id from contract.context.");
  const entry=entries[0];
  if(!entry||typeof entry!=="object"||Array.isArray(entry)||!Array.isArray(entry.functions)||entry.functions.some(item=>typeof item!=="string"))throw invalid();
  entry.functions=mergeCanonicalFunctions(entry.functions,known.functions);
  return value;
}
export function platformContractIntent(project:ContractRevision):LaunchIntent {
  const ids=projectRequirementScopes(project.document).contract;
  const requirements=project.document.requirements.filter(rule=>ids.includes(rule.id));
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
  }catch(error){
    if(error instanceof ProjectError)throw error;
    const detail=error instanceof TypeError?` ${redactInlineCredentials(error.message).slice(0,1200)}`:"";
    throw new ProjectError("contract-plan",`Save a complete contractChecks declaration with interfaces, observable cases and deployment bindings before writing source.${detail}`,409);
  }
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
