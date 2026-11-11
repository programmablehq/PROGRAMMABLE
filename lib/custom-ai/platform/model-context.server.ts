import "server-only";
import type {AgentContext} from "./agent.server";
import {projectFileBytes,projectFileHash} from "./files";

/** Tool decisions contain entire source writes. Replaying them alongside the
 * saved files doubles that source and crowds the actual tool evidence out. */
export function projectModelObservations(steps:AgentContext["steps"]){
  const selected=new Set(steps.filter(step=>step.capability_id!=="model.plan").slice(-8));
  for(const id of ["contract.context","contract.compile","contract.check","contract.verify","contract.audit","event.identity"]){
    const latest=steps.findLast(step=>step.capability_id===id);if(latest)selected.add(latest);
  }
  const last=steps.at(-1);
  if(last?.capability_id==="model.plan"&&last.result&&typeof last.result==="object"&&!Array.isArray(last.result)&&last.result.kind==="model-retry")selected.add(last);
  let bytes=0;
  return steps.filter(step=>selected.has(step)).reverse().map(step=>{
    const encoded=JSON.stringify(step.result),input=JSON.stringify(step.input);
    const fits=encoded.length<=120000&&bytes+encoded.length<=300000;
    const result=fits?step.result:{omitted:true,bytes:encoded.length,message:"This observation exceeds the context allowance. Read fewer source files or use the canonical interfaces and dependency-copy tool."};
    bytes+=fits?encoded.length:JSON.stringify(result).length;
    const saved=step.result&&typeof step.result==="object"&&!Array.isArray(step.result)&&step.result.ok===true;
    const argumentsSaved=saved&&["project.patch","project.plan","project.dependencies","contract.dependencies"].includes(step.capability_id);
    return {tool:step.capability_id,input:argumentsSaved?{savedInRevision:true}:input.length<=24000?step.input:{omitted:true,bytes:input.length},result};
  }).reverse();
}

/** Include small editable files with their real hashes so the next change
 * needs no extra read. Large files and copied dependencies remain discoverable
 * in the complete inventory and can be read explicitly without truncation. */
export function projectModelFiles(context:AgentContext){
  const dependencies=new Set<string>();
  for(const step of context.steps){
    if(step.capability_id!=="contract.dependencies"||!step.result||typeof step.result!=="object"||Array.isArray(step.result))continue;
    const value=step.result.value;
    if(value&&typeof value==="object"&&!Array.isArray(value)&&Array.isArray(value.files))for(const path of value.files)if(typeof path==="string")dependencies.add(path);
  }
  const paths=Object.keys(context.project.document.files);
  const architecture=context.project.document.architecture;
  const checks=architecture&&typeof architecture==="object"&&!Array.isArray(architecture)?architecture.contractChecks:undefined;
  const declared=checks&&typeof checks==="object"&&!Array.isArray(checks)?[checks.contracts,checks.constructorChildren].flatMap(items=>Array.isArray(items)?items.flatMap(item=>item&&typeof item==="object"&&!Array.isArray(item)&&typeof item.source==="string"?[item.source]:[]):[]):[];
  const recent=context.steps.filter(step=>step.capability_id==="model.plan"&&step.result&&typeof step.result==="object"&&!Array.isArray(step.result)&&step.result.tool==="project.patch").reverse()
    .flatMap(step=>{const decision=step.result as {input?:{fileChanges?:{path?:string}[]}};return decision.input?.fileChanges?.flatMap(change=>typeof change.path==="string"?[change.path]:[])??[];});
  const priorities=[...new Set([...recent,...declared,...paths])];let remaining=36000;
  const included=new Set<string>();
  for(const path of priorities){
    const file=context.project.document.files[path];
    if(typeof file!=="string"||dependencies.has(path)||path.startsWith("lib/")&&!declared.includes(path)||/(?:^|\/)(?:package-lock\.json|[^/]*\.min\.[^/]*|node_modules\/|vendor\/)/.test(path))continue;
    const size=projectFileBytes(file).length;
    if(size<=16000&&size<=remaining){included.add(path);remaining-=size;}
  }
  return paths.map(path=>{const file=context.project.document.files[path];return {path,hash:projectFileHash(file),bytes:projectFileBytes(file).length,...(included.has(path)?{content:file}:{})};});
}
