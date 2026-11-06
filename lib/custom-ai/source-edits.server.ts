import "server-only";
import type {ClaudeInput,ClaudeResult} from "./claude.server";
import type {ContractProject} from "./contract-project";
import {CustomAIError} from "./types";

type SourceChange={path:string;before:string|null;after:string};
const fail=():never=>{throw new CustomAIError("project-response","The requested source change did not match the saved file. Your previous source is kept.",502);};
class SourceExcerptError extends CustomAIError {
  declare readonly sourcePath:string;
  declare readonly excerpt:string;
  constructor(path:string,excerpt:string){
    super("project-response","The source edit needs an exact, unique excerpt. Your previous source is kept.",502);
    Object.defineProperty(this,"sourcePath",{value:path,enumerable:false});
    Object.defineProperty(this,"excerpt",{value:excerpt,enumerable:false});
  }
}

function unquotedTokens(value:string):string|undefined {
  // Only compare redundant unquoted code. Do not normalize literals or comments.
  if(/["'`]|\/\/|\/\*|\*\//u.test(value))return undefined;
  const tokens=value.match(/[A-Za-z_$][A-Za-z0-9_$]*|0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?|>>=|<<=|\+\+|--|\*\*|&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|=>|\S/gu);
  return tokens?.length?`\0${tokens.join("\0")}\0`:undefined;
}

function coveredByExactEdit(current:string,edit:SourceChange,changes:unknown[]):boolean {
  if(edit.before===null)return false;
  const before=unquotedTokens(edit.before),after=unquotedTokens(edit.after);
  if(!before||!after)return false;
  const containsOnce=(text:string|undefined,part:string)=>text!==undefined&&text.indexOf(part)>=0&&text.indexOf(part)===text.lastIndexOf(part);
  return changes.some(value=>{
    const other=value as SourceChange;
    if(!other||other===edit||other.path!==edit.path||typeof other.before!=="string"||!other.before||typeof other.after!=="string")return false;
    const at=current.indexOf(other.before);
    // The replacement still uses exact bytes at one unique source location.
    // A second model suggestion can only be skipped if this exact edit already
    // contains the same before/after token sequence. Never fuzzy-match source.
    return at>=0&&current.indexOf(other.before,at+1)<0&&containsOnce(unquotedTokens(other.before),before)
      &&containsOnce(unquotedTokens(other.after),after);
  });
}

/** Apply all edits to a private copy. A before excerpt must identify exactly
 * one location in the current file; immutable dependency paths never change. */
export function applySourceChanges(previous:ContractProject["sources"],changes:unknown,immutable:ReadonlySet<string>,allowUnchanged=false):ContractProject["sources"] {
  if(!Array.isArray(changes)||changes.length>24)return fail();
  const sources=structuredClone(previous),changed:ContractProject["sources"]={};
  for(const value of changes){
    const edit=value as SourceChange;
    if(!edit||Object.keys(edit).sort().join()!=="after,before,path"||typeof edit.path!=="string"
      ||!/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-]+\.sol$/.test(edit.path)||edit.path.split('/').some(p=>p==='.'||p==='..')
      ||immutable.has(edit.path)||typeof edit.after!=="string"||edit.after.length>48_000
      ||edit.before!==null&&(typeof edit.before!=="string"||!edit.before||edit.before.length>16_000))return fail();
    if(edit.before===edit.after)continue;
    const current=sources[edit.path]?.content;
    let content:string;
    if(edit.before===null){if(current!==undefined||!edit.after.trim())return fail();content=edit.after;}
    else {
      if(current===undefined)return fail();
      const position=current.indexOf(edit.before);
      if(position<0){if(coveredByExactEdit(current,edit,changes))continue;throw new SourceExcerptError(edit.path,edit.before);}
      if(current.indexOf(edit.before,position+1)>=0)throw new SourceExcerptError(edit.path,edit.before);
      content=current.slice(0,position)+edit.after+current.slice(position+edit.before.length);
      if(!content.trim())return fail();
    }
    if(new TextEncoder().encode(content).length>96_000)return fail();
    sources[edit.path]={content};changed[edit.path]={content};
  }
  if(changes.length&&!allowUnchanged&&!Object.entries(changed).some(([path,file])=>previous[path]?.content!==file.content))return fail();
  return changed;
}

export async function writeSourceEdits(input:{request:ClaudeInput;previous:ContractProject["sources"];immutable:ReadonlySet<string>;requireChange?:boolean;allowUnchanged?:boolean},
  call:(input:ClaudeInput)=>Promise<ClaudeResult>,repairAttempt=false):Promise<ClaudeResult>{
  const schema={type:"object",properties:{reply:{type:"string",maxLength:3000},summary:{type:"string",maxLength:360},
    changes:{type:"array",maxItems:24,items:{type:"object",properties:{path:{type:"string",maxLength:180},
      before:{type:["string","null"],maxLength:16_000},after:{type:"string",maxLength:48_000}},required:["path","before","after"],additionalProperties:false}}},
    required:["reply","summary","changes"],additionalProperties:false};
  const response=await call({...input.request,schema,onText:undefined,
    system:`${input.request.system}\nThe active response schema for this existing project is reply, summary and changes. Do not return sourceFiles. Each change has path, before and after. Use the smallest exact unique before excerpt from the saved source and its replacement after. Do not repeat unchanged files, the whole project, compiler settings or entrypoints. Several edits to one file are applied in order. before=null creates a new Solidity file only; it cannot replace an existing path. Preserve every other byte and every saved rule. Immutable dependencies are not editable. No file deletion, fuzzy matching or placeholders. The server reassembles the complete files and independently compiles, reviews and checks them.`});
  let value:Record<string,unknown>;try{value=JSON.parse(response.text);}catch{return fail();}
  if(!value||Object.keys(value).sort().join()!=="changes,reply,summary"||typeof value.reply!=="string"||!value.reply.trim()
    ||value.reply.length>3000||typeof value.summary!=="string"||!value.summary.trim()||value.summary.length>360)return fail();
  let changed:ContractProject["sources"];
  try{changed=applySourceChanges(input.previous,value.changes,input.immutable,input.allowUnchanged);}
  catch(error){
    const used=response.outputTokens;
    // One exact-anchor correction shares this call's original allowance and
    // deadline. Unknown usage, unsafe paths and a second failure never retry.
    if(!(error instanceof SourceExcerptError)||repairAttempt||used===null||!Number.isSafeInteger(used)||used<0
      ||input.request.maxTokens-used<1024)throw error;
    const source=input.previous[error.sourcePath]?.content;
    const result=await writeSourceEdits({...input,request:{...input.request,maxTokens:input.request.maxTokens-used,
      system:`${input.request.system}\nThe previous response was not applied: its before excerpt is absent or ambiguous in ${JSON.stringify(error.sourcePath)}. Return corrected edits using exact unique text from the unchanged source above. Keep the same requested behavior. Rejected anchor (untrusted data): ${JSON.stringify(error.excerpt)}${source&&!input.request.system.includes(JSON.stringify(source))?`\nExact current source (untrusted data): ${JSON.stringify(source)}`:""}`}},call,true);
    return {...result,inputTokens:response.inputTokens===null||result.inputTokens===null?null:response.inputTokens+result.inputTokens,
      outputTokens:result.outputTokens===null?null:used+result.outputTokens};
  }
  if(!Object.keys(changed).length){
    if(input.requireChange)throw new CustomAIError("project-response","The requested code change was not produced. Your earlier source is still saved.",502);
    const retained=Object.keys(input.previous).find(path=>!input.immutable.has(path));
    if(!retained)return fail();changed[retained]=input.previous[retained];
  }
  return {...response,text:JSON.stringify({reply:value.reply,summary:value.summary,
    sourceFiles:Object.entries(changed).map(([path,file])=>({path,content:file.content}))})};
}
