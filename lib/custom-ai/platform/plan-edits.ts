import {ProjectError,type JsonValue} from "./types";

const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const invalid=()=>new ProjectError("project-plan-edit","Use bounded updates to existing architecture paths; keep the server's production binding unchanged.",409);
const own=(object:object,key:string)=>Object.prototype.hasOwnProperty.call(object,key);
const arrayIndex=(key:string,length:number,append=false)=>{
 if(!/^(0|[1-9][0-9]*)$/.test(key))throw invalid();
 const index=Number(key);if(!Number.isSafeInteger(index)||index<0||index>=length+(append?1:0))throw invalid();return index;
};

/** Reconstruct the full architecture before the ordinary plan validators run. */
export function applyPlanArchitectureUpdates(previous:unknown,updates:unknown):Record<string,JsonValue>{
 if(!record(previous)||!Array.isArray(updates)||updates.length<1||updates.length>64)throw invalid();
 const result=JSON.parse(JSON.stringify(previous)) as Record<string,JsonValue>;
 for(const update of updates){
  if(!record(update)||Object.keys(update).some(key=>!["path","operation","value"].includes(key)))throw invalid();
  const path=update.path,operation=update.operation;
  if(!Array.isArray(path)||path.length<1||path.length>12||path.some(key=>typeof key!=="string"||key.length<1||key.length>120||key==="__proto__")||path[0]==="production")throw invalid();
  if(operation!=="set"&&operation!=="remove"||operation==="set"&&!own(update,"value")||operation==="remove"&&own(update,"value"))throw invalid();
  let parent:JsonValue=result;
  for(const key of path.slice(0,-1)){
   if(Array.isArray(parent))parent=parent[arrayIndex(key,parent.length)];
   else if(record(parent)&&own(parent,key))parent=parent[key] as JsonValue;
   else throw invalid();
  }
  const key=path.at(-1)!;
  if(!Array.isArray(parent)&&!record(parent))throw invalid();
  if(operation==="remove"){
   if(Array.isArray(parent))parent.splice(arrayIndex(key,parent.length),1);
   else {if(!own(parent,key))throw invalid();delete parent[key];}
  }else{
   const encoded=JSON.stringify(update.value);if(encoded===undefined||encoded.length>120000)throw invalid();
   const value=JSON.parse(encoded) as JsonValue;
   if(Array.isArray(parent))parent[arrayIndex(key,parent.length,true)]=value;
   else parent[key]=value;
  }
 }
 return result;
}
