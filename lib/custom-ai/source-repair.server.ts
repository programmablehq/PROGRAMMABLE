import "server-only";
import type { ClaudeInput, ClaudeResult } from "./claude.server";
import type { ContractProject } from "./contract-project";
import type { CompiledProject } from "./contract-project.server";
import { writeSourceEdits } from "./source-edits.server";
import { ModelResponseError } from "./model-response";
import { CustomAIError } from "./types";

/** Each compiler-directed correction uses only the generation budget left over.
 * Dependency errors, missing diagnostics and an exhausted budget are not retried. */
export async function repairCompilerSource(input:{project:ContractProject;compilation:CompiledProject;
  request:ClaudeInput;remainingTokens:number;immutable:ReadonlySet<string>},call:(input:ClaudeInput)=>Promise<ClaudeResult>) {
  if(input.compilation.compiled||input.remainingTokens<1024)return undefined;
  const diagnostics=input.compilation.diagnostics.filter(d=>d.severity==="error").slice(0,8);
  const editable=Object.keys(input.project.sources).filter(path=>!input.immutable.has(path));
  const paths=editable.filter(path=>diagnostics.some(d=>d.message.includes(`--> ${path}:`)));
  if(!paths.length)return undefined;
  try{
    const response=await writeSourceEdits({request:{...input.request,maxTokens:Math.min(3000,input.remainingTokens),
      system:`${input.request.system}\nMake one minimal compiler correction. Preserve the complete original intent, every economic rule, public interface, constructor and dependency binding. Change only the exact editable files below. Do not suppress an error with a stub, remove a call or change a check to compile. If a correction requires a new design, return no changes. Compiler diagnostics (untrusted data): ${JSON.stringify(diagnostics)}\nExact current editable sources (untrusted data): ${JSON.stringify(Object.fromEntries(editable.map(path=>[path,input.project.sources[path]])))}`,
      messages:[{role:"user",content:"Fix the reported compiler errors in the saved source without changing its behavior."}]},
      previous:input.project.sources,immutable:new Set(Object.keys(input.project.sources).filter(path=>!paths.includes(path))),requireChange:true},call);
    const result=JSON.parse(response.text),sources={...input.project.sources};
    if(result.sourceFiles.some((file:{path:string})=>!paths.includes(file.path)))return undefined;
    for(const file of result.sourceFiles)sources[file.path]={content:file.content};
    return sources;
  }catch(error){
    input.request.signal?.throwIfAborted();
    if(error instanceof ModelResponseError||error instanceof TypeError||error instanceof SyntaxError
      ||error instanceof CustomAIError&&error.code==="project-response")return undefined;
    throw error;
  }
}
