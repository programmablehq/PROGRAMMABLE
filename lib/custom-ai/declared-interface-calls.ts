import {parseAbi,toFunctionSignature,type AbiFunction,type AbiParameter} from "viem";
import type {GeneralCheckScenarios} from "./behavior-checks";
import type {GeneralDeploymentBlueprint} from "./deployment-blueprint";
import {V4_WORLD_STEP_SIGNATURES} from "./behavior-world";

function compatible(value:unknown,parameter:AbiParameter):boolean{
  const array=/^(.*)\[(\d*)\]$/u.exec(parameter.type);
  if(array)return Array.isArray(value)&&(!array[2]||value.length===Number(array[2]))
    &&value.every(item=>compatible(item,{...parameter,type:array[1]} as AbiParameter));
  if(parameter.type==="tuple"){
    if(value&&typeof value==="object"&&!Array.isArray(value)&&"pool" in value)return true;
    const parts="components" in parameter?parameter.components:[];
    return Array.isArray(value)&&value.length===parts.length&&parts.every((part,index)=>compatible(value[index],part));
  }
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    const ref=value as Record<string,unknown>;
    const kind="fixtureHash" in ref?"bytes32":"account" in ref||"contract" in ref||"target" in ref||"fixture" in ref?"address"
      :"input" in ref?["controller","quote"].includes(String(ref.input))?"address":ref.input==="funding"?"integer":"string"
      :"binding" in ref?String(ref.binding).endsWith("runtime-hash")?"bytes32":String(ref.binding).startsWith("opening-")?"integer":"address":null;
    return kind==="integer"?/^u?int\d*$/u.test(parameter.type):kind===parameter.type;
  }
  if(parameter.type==="bool")return typeof value==="boolean";
  if(/^u?int\d*$/u.test(parameter.type))return typeof value==="string"&&/^-?\d+$/u.test(value)&&(!parameter.type.startsWith("uint")||!value.startsWith("-"));
  if(parameter.type==="address")return typeof value==="string"&&/^0x[0-9a-f]{40}$/iu.test(value);
  if(/^bytes\d*$/u.test(parameter.type))return typeof value==="string"&&/^0x(?:[0-9a-f]{2})*$/iu.test(value);
  return typeof value==="string";
}
function mismatch(value:unknown,parameter:AbiParameter,path:string):string|undefined{
  if(compatible(value,parameter))return;
  const array=/^(.*)\[(\d*)\]$/u.exec(parameter.type);
  if(array&&Array.isArray(value))for(const [index,item] of value.entries()){
    const issue=mismatch(item,{...parameter,type:array[1]} as AbiParameter,`${path}[${index}]`);if(issue)return issue;
  }
  if(parameter.type==="tuple"&&Array.isArray(value)&&"components" in parameter)for(const [index,part] of parameter.components.entries()){
    const issue=mismatch(value[index],part,`${path}[${index}]${part.name?`(${part.name})`:""}`);if(issue)return issue;
  }
  const kind=value&&typeof value==="object"&&!Array.isArray(value)?`reference ${Object.keys(value).join(",")}`:Array.isArray(value)?"array":typeof value;
  return `${path} expects ${parameter.type}, received ${kind}`;
}

/** Validate against the independently agreed ABI before paying for source.
 * This is a declaration check, never proof that generated code implements it. */
export function validateDeclaredInterfaceCalls(plan:GeneralCheckScenarios,deployment?:GeneralDeploymentBlueprint){
  const fixtures=[...plan.contracts,...(plan.constructorChildren??[])];
  const interfaces=new Map(fixtures.map(fixture=>[fixture.id,parseAbi(fixture.functions).filter((item):item is AbiFunction=>item.type==="function")]));
  const worldSignatures:string[]=[...V4_WORLD_STEP_SIGNATURES.map(signature=>`function ${signature}`),"function nativeBalance(address) view returns (uint256)"];
  const worldFunctions=plan.world?parseAbi(worldSignatures)
    .filter((item):item is AbiFunction=>item.type==="function"):undefined;
  const issues:string[]=[];
  const world=plan.world;
  const exercisesProtectedChildren=world?.kind==="v4-protected-native-token-v1"&&plan.steps.some(step=>
    step.contract===world.initializer&&step.signature==="initialize(address,address,int24,address,uint256)"
    ||step.contract==="v4-router"&&step.signature===V4_WORLD_STEP_SIGNATURES[2]);
  if(exercisesProtectedChildren){
    const declared=new Set(plan.allowedCalls.flatMap(value=>value&&typeof value==="object"&&!Array.isArray(value)&&"contract" in value?[value.contract]:[]));
    const missing=(plan.constructorChildren??[]).filter(child=>!declared.has(child.id)).map(child=>child.id);
    if(missing.length)issues.push(`protected-world child call targets missing from allowedCalls: ${missing.join(", ")}; explicitly include these declared contract references before source generation`);
  }
  for(const step of plan.steps){
    const isWorld=step.contract==="v4-router"&&!interfaces.has(step.contract);
    const functions=interfaces.get(step.contract)??(isWorld?worldFunctions:undefined);
    if(!functions)continue;
    const method=functions.find(item=>toFunctionSignature(item)===step.signature);
    if(!method){issues.push(`${step.id}: ${step.contract}.${step.signature} is absent from the declared interface`);continue;}
    if(step.arguments.length!==method.inputs.length)issues.push(`${step.id}: expected ${method.inputs.length} arguments, received ${step.arguments.length}`);
    else method.inputs.forEach((parameter,index)=>{const issue=mismatch(step.arguments[index],parameter,`${step.id}: argument ${index}`);if(issue)issues.push(issue);});
    if(!isWorld){
      if(step.expect.returns&&step.expect.returns.length!==method.outputs.length)issues.push(`${step.id}: expected ${method.outputs.length} return values, received ${step.expect.returns.length}`);
      else step.expect.returns?.forEach((value,index)=>{const issue=mismatch(value,method.outputs[index],`${step.id}: return ${index}`);if(issue)issues.push(issue);});
    }
  }
  for(const target of deployment?.targets??[]){
    if(!target.initializer)continue;
    const fixture=fixtures.find(item=>item.source===target.source&&item.contract===target.contract);
    const functions=fixture?interfaces.get(fixture.id):undefined;
    const matches=functions?.filter(method=>method.name===target.initializer!.function&&method.inputs.length===target.initializer!.arguments.length)??[];
    if(matches.length!==1)issues.push(`deployment ${target.id}: initializer ${target.initializer.function} with ${target.initializer.arguments.length} arguments does not select one declared function`);
    else matches[0].inputs.forEach((parameter,index)=>{const issue=mismatch(target.initializer!.arguments[index],parameter,`deployment ${target.id}: initializer argument ${index}`);if(issue)issues.push(issue);});
  }
  if(issues.length)throw new TypeError(`Invalid declared calls: ${issues.slice(0,16).join("; ")}. Use the fixed source interfaces and the trusted world router.`);
}
