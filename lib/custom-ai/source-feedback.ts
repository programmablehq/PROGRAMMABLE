import {parseAbi,toFunctionSignature,type AbiFunction} from "viem";
import type {GeneralCheckBlueprint} from "./check-blueprint";
import type {CompiledProject} from "./contract-project.server";
import type {GeneralScenarioReport} from "./behavior-checks.server";

const shape=(fn:AbiFunction)=>`${toFunctionSignature(fn)} ${fn.stateMutability} -> ${toFunctionSignature({...fn,name:"returns",inputs:fn.outputs})}`;

/** Add exact compiler evidence to a correction prompt. The original scenario
 * result, interface requirements and acceptance criteria remain unchanged. */
export function sourceCorrectionFeedback(blueprint:GeneralCheckBlueprint|undefined,compilation:CompiledProject,
  failures:GeneralScenarioReport["failures"],execution?:GeneralScenarioReport["execution"]):GeneralScenarioReport["failures"] {
  if(!blueprint)return failures;
  return failures.map(failure=>{
    if(failure.code!=="unexpected-interface"||!failure.caseId.startsWith("surface:")){
      const declared=blueprint.scenarios.steps?.find(step=>step.id===failure.caseId);
      const observed=execution?.steps.find(step=>step.id===failure.caseId);
      if(!declared||!observed||["contract","signature","from","afterSeconds","read","value"].some(key=>
        declared[key as keyof typeof declared]!==observed[key as keyof typeof observed]))return failure;
      const evidence={contract:declared.contract,call:declared.signature,from:declared.from,afterSeconds:declared.afterSeconds,
        arguments:declared.arguments,
        expected:declared.expect,observed:{status:observed.status,outputs:observed.outputs,
          nativeChanges:observed.nativeChanges,detailsComplete:observed.detailsComplete}};
      const detail=JSON.stringify(evidence);
      // Keep only a complete bounded evidence record. Truncated JSON can hide
      // a real observed value and must not become an invented diagnosis.
      return detail.length>3500?failure:{...failure,message:`${failure.message} Observed isolated call (data): ${detail}. Correct the implementation; keep the saved intent and checks unchanged.`};
    }
    const target=[...blueprint.scenarios.contracts,...(blueprint.scenarios.constructorChildren??[])].find(item=>`surface:${item.id}`===failure.caseId);
    const artifact=target&&compilation.contracts.find(item=>item.source===target.source&&item.contract===target.contract);
    if(!target||!artifact)return failure;
    const expected=new Set(parseAbi(target.functions).filter((fn):fn is AbiFunction=>fn.type==="function").map(shape));
    const actual=new Set(artifact.abi.filter((fn):fn is AbiFunction=>fn.type==="function").map(shape));
    const missing=[...expected].filter(fn=>!actual.has(fn)),extra=[...actual].filter(fn=>!expected.has(fn));
    if(!missing.length&&!extra.length)return failure;
    return {...failure,message:`${target.source}:${target.contract}. Missing (${missing.length}): ${missing.slice(0,32).join("; ")||"none"}. Extra (${extra.length}): ${extra.slice(0,32).join("; ")||"none"}. Match the frozen interface; do not add or revise checks.`};
  });
}
