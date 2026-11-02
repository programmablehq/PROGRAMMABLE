/** Small transport grammar for one source-blind correction. Every resulting
 * declaration must still pass the original complete semantic validator. */
export const declarationCorrectionSchema={type:"object",properties:{changes:{type:"array",maxItems:32,items:{type:"object",properties:{
  path:{type:"string",maxLength:500},valueJson:{type:"string",maxLength:64000}},required:["path","valueJson"],additionalProperties:false}}},required:["changes"],additionalProperties:false};
const invalid=():never=>{throw new TypeError("Return bounded, non-overlapping JSON-pointer changes to the rejected declaration.");};
const forbidden=new Set(["__proto__","prototype","constructor"]);
/** Stable IDs avoid a model editing the wrong row after counting array indices.
 * Values and insertion order round-trip unchanged; this is only a review view. */
export function declarationCorrectionView(value:unknown,restore=false):unknown{
  const result=structuredClone(value);
  if(!result||typeof result!=="object"||Array.isArray(result))return result;
  const root=result as Record<string,unknown>;
  const collection=(value:unknown):unknown=>{
    if(!restore){
      if(!Array.isArray(value))return value;
      const ids=value.map(item=>item&&typeof item==="object"&&!Array.isArray(item)?item.id:null);
      if(ids.some(id=>typeof id!=="string"||forbidden.has(id))||new Set(ids).size!==ids.length)return value;
      return Object.fromEntries(value.map(item=>[item.id,item]));
    }
    if(!value||typeof value!=="object"||Array.isArray(value))return value;
    const entries=Object.entries(value);
    if(entries.some(([id,item])=>forbidden.has(id)||!item||typeof item!=="object"||Array.isArray(item)||(item as {id?:unknown}).id!==id))return invalid();
    return entries.map(([,item])=>item);
  };
  for(const key of ["contracts","constructorChildren","steps"])if(Object.hasOwn(root,key))root[key]=collection(root[key]);
  if(root.deployment&&typeof root.deployment==="object"&&!Array.isArray(root.deployment)){
    const deployment=root.deployment as Record<string,unknown>;
    for(const key of ["targets","constructorChildren"])if(Object.hasOwn(deployment,key))deployment[key]=collection(deployment[key]);
  }
  return result;
}
function checkKeys(value:unknown,depth=0,nodes={count:0}):void{
  if(depth>32||++nodes.count>10000)return invalid();
  if(Array.isArray(value)){for(const item of value)checkKeys(item,depth+1,nodes);}
  else if(value&&typeof value==="object")for(const [key,item] of Object.entries(value)){if(forbidden.has(key))return invalid();checkKeys(item,depth+1,nodes);}
}
export function applyDeclarationCorrection(base:unknown,answer:unknown):unknown{
  if(!answer||typeof answer!=="object"||Array.isArray(answer)||Object.keys(answer).join()!=="changes")return invalid();
  const changes=(answer as {changes:unknown}).changes;
  if(!Array.isArray(changes)||!changes.length||changes.length>32)return invalid();
  let result=structuredClone(base);const paths:string[][]=[];let bytes=0;
  for(const change of changes){
    if(!change||typeof change!=="object"||Object.keys(change).sort().join()!=="path,valueJson"
      ||typeof change.path!=="string"||change.path.length>500||typeof change.valueJson!=="string"||new TextEncoder().encode(change.valueJson).length>64000)return invalid();
    const path:string[]=change.path===""?[]:change.path.startsWith("/")?change.path.slice(1).split("/").map((part:string)=>{
      if(/~(?![01])/u.test(part))return invalid();const key=part.replace(/~1/g,"/").replace(/~0/g,"~");
      if(!key||forbidden.has(key))return invalid();return key;
    }):invalid();
    if(paths.some(existing=>existing.every((part,index)=>path[index]===part)||path.every((part,index)=>existing[index]===part)))return invalid();
    paths.push(path);
    bytes+=new TextEncoder().encode(change.valueJson).length;if(bytes>96000)return invalid();
    const value:unknown=JSON.parse(change.valueJson);checkKeys(value);
    if(!path.length){result=value;continue;}
    let parent=result;
    for(const key of path.slice(0,-1)){
      if(!parent||typeof parent!=="object"||!Object.hasOwn(parent,key))return invalid();
      parent=(parent as Record<string,unknown>)[key];
    }
    const key=path.at(-1)!;
    if(!parent||typeof parent!=="object")return invalid();
    if(Array.isArray(parent)){
      if(!/^(0|[1-9][0-9]*)$/u.test(key)||Number(key)>=parent.length)return invalid();
      parent[Number(key)]=value;
    }else (parent as Record<string,unknown>)[key]=value;
  }
  if(new TextEncoder().encode(JSON.stringify(result)).length>96000)return invalid();
  return result;
}
