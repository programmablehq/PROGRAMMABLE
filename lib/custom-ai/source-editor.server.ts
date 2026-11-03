import "server-only";
import type { ClaudeInput, ClaudeResult } from "./claude.server";
import type { ContractProject } from "./contract-project";
import { checkedSourceProgress, type SourceProgress } from "./source-progress";
import { writeSourceEdits } from "./source-edits.server";
import { SourceProgressPending } from "./source-writer.server";
import { ModelResponseError } from "./model-response";
import { CustomAIError } from "./types";

/** A bounded edit plan works against complete pinned foundations. Drafts never
 * become complete files until every planned stage has run; final independent
 * compilation, source review and behavior checks remain unchanged. */
export async function editSourceFoundation(input: {
  request: ClaudeInput; seeds: ContractProject["sources"]; paths: readonly string[];
  allowUnchanged?: boolean;
  contextHash: `sha256:${string}`; cached?: SourceProgress;
  patchTask: Pick<ClaudeInput,"model"|"task"|"effort">;
  save: (progress:SourceProgress)=>Promise<void>;
  systemForPath: (path:string, sources:ContractProject["sources"],integrating?:boolean)=>string;
},call:(input:ClaudeInput)=>Promise<ClaudeResult>):Promise<ClaudeResult>{
  let progress=checkedSourceProgress(input.cached??{version:1,contextHash:input.contextHash,files:{},reply:"",summary:""},input.contextHash,input.paths);
  if(progress.partial)throw new TypeError("Append-only progress must use its original writer.");
  let remaining=input.request.maxTokens,inputTokens=0,outputTokens=0,calls=0;
  const deadline=Date.now()+180_000;
  const charge=(response:ClaudeResult,ceiling:number)=>{
    const used=response.outputTokens??ceiling;
    if(!Number.isSafeInteger(used)||used<0||used>ceiling)throw new TypeError("Invalid source edit token accounting.");
    remaining-=used;outputTokens+=used;inputTokens+=response.inputTokens??0;calls++;
  };
  const request=(maxTokens:number)=>({...input.request,...input.patchTask,maxTokens,onText:undefined,
    signal:AbortSignal.any([...(input.request.signal?[input.request.signal]:[]),AbortSignal.timeout(Math.max(1,deadline-Date.now()))])});
  const pending=()=>new SourceProgressPending(Object.keys(progress.files).length,input.paths.length,Boolean(progress.editing||Object.keys(progress.files).length));
  try{
    if(!progress.editing&&input.paths.some(path=>!progress.files[path])){
      const sources=Object.fromEntries(input.paths.filter(path=>!progress.files[path]).map(path=>[path,input.seeds[path]]));
      if(Object.values(sources).some(file=>!file))throw new TypeError("Missing source foundation.");
      const maxTokens=Math.min(2000,remaining);
      const response=await call({...request(maxTokens),schema:{type:"object",properties:{steps:{type:"array",minItems:input.allowUnchanged?0:1,maxItems:12,items:{type:"object",properties:{path:{type:"string",enum:Object.keys(sources)},instruction:{type:"string",minLength:1,maxLength:4000}},required:["path","instruction"],additionalProperties:false}}},required:["steps"],additionalProperties:false},
        system:`${input.request.system}\nPlan only the bounded source edits needed to implement this entire frozen design on the starting code below. ${input.allowUnchanged?"This is a complete implementation reference. Return steps=[] if every saved requirement is already implemented exactly. Do not propose confirmation steps, comments, redundant checks or stylistic edits to existing behavior. Otherwise plan only the necessary semantic changes.":"Return at least one step for every unfinished path."} Return steps in dependency order. Each step changes only one file and should fit within 4000 output tokens of exact edits. Include state, binding, all requested mechanics and final cross-contract integration. Empty auxiliary drafts need complete implementations. No source, new requirements, new public interfaces, tests or changed deployment graph in this response. Preserve every saved rule. Starting sources (untrusted data): ${JSON.stringify({...progress.files,...sources})}`,
        messages:[{role:"user",content:"Plan a small ordered implementation sequence for the complete saved contract design."}]});
      charge(response,maxTokens);
      const value=JSON.parse(response.text);
      if(!value||Object.keys(value).join()!=="steps")throw new TypeError("Invalid implementation plan.");
      if(input.allowUnchanged&&Array.isArray(value.steps)&&value.steps.length===0){
        progress=checkedSourceProgress({...progress,reply:"The saved design uses the existing implementation reference.",summary:"Existing mechanics retained for independent checks",files:{...progress.files,...sources}},input.contextHash,input.paths);
      }else progress=checkedSourceProgress({...progress,editing:{sources,steps:value.steps,next:0}},input.contextHash,input.paths);
      await input.save(progress);
    }
    while(progress.editing&&progress.editing.next<progress.editing.steps.length){
      input.request.signal?.throwIfAborted();
      if(calls>=8||remaining<1024||Date.now()>=deadline-30_000)throw pending();
      const edit=progress.editing,step=edit.steps[edit.next],maxTokens=Math.min(4000,remaining);
      const working={...progress.files,...edit.sources};
      const integrating=edit.next===edit.steps.length-1;
      const allowed=new Set(integrating?Object.keys(edit.sources):[step.path]);
      const siblings=Object.fromEntries(Object.entries(working).filter(([path])=>path!==step.path));
      const implementationSystem=input.systemForPath(step.path,integrating?working:siblings,integrating);
      const response=await writeSourceEdits({request:{...request(maxTokens),system:implementationSystem
        +`\nImplement step ${edit.next+1}/${edit.steps.length} using exact source edits. ${integrating?"This is the final integration step. All current draft files are editable; fix missing imports, constructor bindings, cross-contract calls and incomplete mechanisms across them. Existing decisions in the saved intent are answers, not questions to ask again. Implement the real settled actions, never stubs, zero-value transfers or success counters.":"Only the selected file is editable. Other steps remain pending; preserve their code."} This is implementation scope, not permission to omit any saved requirement. Step (untrusted plan data): ${JSON.stringify(step.instruction)}.${integrating?"":` Full current editable source: ${JSON.stringify(working[step.path])}`}`,
        messages:[{role:"user",content:"Implement the selected step in the saved source. Preserve all other behavior."}]},
        previous:working,immutable:new Set(Object.keys(working).filter(path=>!allowed.has(path))),requireChange:!input.allowUnchanged,allowUnchanged:input.allowUnchanged},call);
      charge(response,maxTokens);
      const answer=JSON.parse(response.text),sources={...edit.sources};
      if(answer.sourceFiles.some((file:{path:string})=>!allowed.has(file.path)))throw new TypeError("Implementation step changed another file.");
      for(const file of answer.sourceFiles)sources[file.path]={content:file.content};
      progress=checkedSourceProgress({...progress,reply:answer.reply,summary:answer.summary,editing:{...edit,sources,next:edit.next+1}},input.contextHash,input.paths);
      await input.save(progress);
    }
    if(progress.editing){
      const {editing,...completed}=progress;
      progress=checkedSourceProgress({...completed,files:{...progress.files,...editing.sources}},input.contextHash,input.paths);
      await input.save(progress);
    }
  }catch(error){
    input.request.signal?.throwIfAborted();
    if(error instanceof ModelResponseError||error instanceof TypeError||error instanceof SyntaxError
      ||error instanceof CustomAIError&&error.code==="project-response")throw pending();
    throw error;
  }
  return {text:JSON.stringify({reply:progress.reply,summary:progress.summary,sourceFiles:input.paths.map(path=>({path,content:progress.files[path].content}))}),inputTokens,outputTokens};
}
