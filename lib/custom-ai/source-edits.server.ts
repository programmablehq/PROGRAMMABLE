import "server-only";
import type {ClaudeInput,ClaudeResult} from "./claude.server";
import type {ContractProject} from "./contract-project";
import {CustomAIError} from "./types";

type SourceChange={path:string;before:string|null;after:string};
const fail=():never=>{throw new CustomAIError("project-response","The requested source change did not match the saved file. Your previous source is kept.",502);};

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
      if(position<0||current.indexOf(edit.before,position+1)>=0)return fail();
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
  call:(input:ClaudeInput)=>Promise<ClaudeResult>):Promise<ClaudeResult>{
  const schema={type:"object",properties:{reply:{type:"string",maxLength:3000},summary:{type:"string",maxLength:360},
    changes:{type:"array",maxItems:24,items:{type:"object",properties:{path:{type:"string",maxLength:180},
      before:{type:["string","null"],maxLength:16_000},after:{type:"string",maxLength:48_000}},required:["path","before","after"],additionalProperties:false}}},
    required:["reply","summary","changes"],additionalProperties:false};
  const response=await call({...input.request,schema,onText:undefined,
    system:`${input.request.system}\nThe active response schema for this existing project is reply, summary and changes. Do not return sourceFiles. Each change has path, before and after. Use the smallest exact unique before excerpt from the saved source and its replacement after. Do not repeat unchanged files, the whole project, compiler settings or entrypoints. Several edits to one file are applied in order. before=null creates a new Solidity file only; it cannot replace an existing path. Preserve every other byte and every saved rule. Immutable dependencies are not editable. No file deletion, fuzzy matching or placeholders. The server reassembles the complete files and independently compiles, reviews and checks them.`});
  let value:Record<string,unknown>;try{value=JSON.parse(response.text);}catch{return fail();}
  if(!value||Object.keys(value).sort().join()!=="changes,reply,summary"||typeof value.reply!=="string"||!value.reply.trim()
    ||value.reply.length>3000||typeof value.summary!=="string"||!value.summary.trim()||value.summary.length>360)return fail();
  const changed=applySourceChanges(input.previous,value.changes,input.immutable,input.allowUnchanged);
  if(!Object.keys(changed).length){
    if(input.requireChange)throw new CustomAIError("project-response","The requested code change was not produced. Your earlier source is still saved.",502);
    const retained=Object.keys(input.previous).find(path=>!input.immutable.has(path));
    if(!retained)return fail();changed[retained]=input.previous[retained];
  }
  return {...response,text:JSON.stringify({reply:value.reply,summary:value.summary,
    sourceFiles:Object.entries(changed).map(([path,file])=>({path,content:file.content}))})};
}
