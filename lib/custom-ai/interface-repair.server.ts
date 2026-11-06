import "server-only";
import {parseAbi} from "viem";
import type {ClaudeInput,ClaudeResult} from "./claude.server";
import {decodeGeneralCheckDeclaration} from "./check-plan-wire";
import {modelTask} from "./model-tasks";

type Graph=Record<string,unknown>;
type Fixture={id:string;functions:string[]|{canonical:string;additional:string[]}};
const functions=(fixture:Fixture)=>Array.isArray(fixture.functions)?fixture.functions:fixture.functions.additional;
const methodName=(signature:string)=>/^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(signature)?.[1];
const errorText=(error:unknown)=>(error instanceof Error?error.message:String(error)).slice(0,1200);

/** Repair only malformed, model-declared ABI strings. Canonical catalog
 * entries, valid methods, graph identities and deployment values stay fixed. */
export async function repairMalformedInterfaces(proposal:Graph,options:{
  interfaces?:readonly {contract:string;functions:readonly string[]}[];
  context:string;model:string;signal?:AbortSignal;
},call:(input:ClaudeInput)=>Promise<ClaudeResult>):Promise<{proposal:Graph;corrected:boolean}>{
  const expand=(value:Graph)=>decodeGeneralCheckDeclaration(JSON.stringify({...value,steps:[]}),options.interfaces) as Graph;
  const fixtures=(value:Graph)=>[...(value.contracts as Fixture[]),...((value.constructorChildren??[]) as Fixture[])];
  const source=Object.hasOwn(proposal,"format")?expand(proposal):proposal;
  const original=fixtures(source),expanded=fixtures(expand(source));
  const pinned=new Set(options.interfaces?.flatMap(entry=>[...entry.functions])??[]);
  const invalid:{id:string;before:string;error:string}[]=[];
  for(const fixture of expanded){
    try{parseAbi(functions(fixture));continue;}catch{/* Locate only declarations supplied by the model. */}
    const local=original.find(item=>item.id===fixture.id)!;
    const count=invalid.length;
    for(const signature of functions(local)){
      if(pinned.has(signature))continue;
      try{parseAbi([signature]);}catch(error){invalid.push({id:fixture.id,before:signature,error:errorText(error)});}
    }
    if(invalid.length===count)throw new TypeError(`The public interface for ${fixture.id} could not be decoded.`);
  }
  if(!invalid.length)return{proposal,corrected:false};
  if(invalid.length>16)throw new TypeError("Too many malformed public interface declarations.");
  const schema={type:"object",properties:{changes:{type:"array",minItems:1,maxItems:invalid.length,items:{type:"object",
    properties:{id:{type:"string",enum:[...new Set(invalid.map(item=>item.id))]},before:{type:"string",maxLength:2000},after:{type:"string",maxLength:2000}},
    required:["id","before","after"],additionalProperties:false}}},required:["changes"],additionalProperties:false};
  const response=await call({...modelTask("declaration-correction",{chat:options.model,build:options.model,escalation:options.model}),maxTokens:4000,
    signal:options.signal,responseProfile:"contract",schema,captureIncompleteDeclaration:true,
    system:`Fix only the malformed ABI declarations below. Return exact before/after replacements. Keep each function name, inputs, outputs and meaning; expand Solidity struct/type aliases into valid ABI tuples using the supplied canonical declarations. Do not remove methods, add powers, change the contract graph, deployment values or saved requirements. Valid declarations are immutable. There is no generated implementation to copy from. Untrusted design and canonical ABI data: ${options.context}\nMalformed declarations and parser feedback: ${JSON.stringify(invalid)}`,
    messages:[{role:"user",content:"Correct only the listed ABI syntax or type notation. Return one JSON object with changes."}]});
  options.signal?.throwIfAborted();
  const answer=JSON.parse(response.text) as {changes?:{id:string;before:string;after:string}[]};
  if(!Array.isArray(answer.changes)||!answer.changes.length||answer.changes.length>invalid.length)throw new TypeError("Return bounded interface corrections.");
  const next=structuredClone(source),changed=new Set<string>();
  for(const edit of answer.changes){
    const key=JSON.stringify([edit.id,edit.before]);
    if(changed.has(key)||!invalid.some(item=>item.id===edit.id&&item.before===edit.before)||typeof edit.after!=="string"
      ||!methodName(edit.before)||methodName(edit.after)!==methodName(edit.before))throw new TypeError("Keep the malformed method's original identity.");
    const signature:string[]=[edit.after],parsed=parseAbi(signature);
    if(parsed.length!==1||parsed[0].type!=="function")throw new TypeError("Return one corrected public function declaration.");
    const target=functions(fixtures(next).find(item=>item.id===edit.id)!);
    if(target.filter(value=>value===edit.before).length!==1)throw new TypeError("Keep unambiguous interface corrections.");
    target[target.indexOf(edit.before)]=edit.after;changed.add(key);
  }
  for(const fixture of fixtures(expand(next)))parseAbi(functions(fixture));
  return{proposal:next,corrected:true};
}
