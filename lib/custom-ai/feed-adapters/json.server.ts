import "server-only";
import { parseUnits } from "viem";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { FeedSnapshot } from "../rule-evaluator";
import { publicDataURL, readPublicJSON } from "./public-json.server";

export type JSONAdapterDefinition={version:1;name:string;url:string;valuePath:string[];timestampPath:string[];
  timestampFormat:"unix-seconds"|"unix-milliseconds"|"iso8601";decimals:number;minimum:string;maximum:string;maxAgeSeconds:number;values:Record<string,string>|null};
export type JSONDataAdapter={id:string;implementationHash:`sha256:${string}`;definition:JSONAdapterDefinition};
const invalid=():never=>{throw new TypeError("Define the public JSON field, units, timestamp and bounds explicitly.");};
const path=(value:unknown):string[]=>{
  if(!Array.isArray(value)||!value.length||value.length>16||value.some(key=>typeof key!=="string"||!key||key.length>120||["__proto__","prototype","constructor"].includes(key)))return invalid();
  return [...value];
};
const integer=(value:unknown):string=>typeof value==="string"&&/^-?(?:0|[1-9]\d{0,76})$/.test(value)?BigInt(value).toString():invalid();
export function createJSONDataAdapter(value:unknown):JSONDataAdapter {
  if(!value||typeof value!=="object"||Array.isArray(value))return invalid();
  const v=value as JSONAdapterDefinition;
  if(Object.keys(v).sort().join()!=="decimals,maxAgeSeconds,maximum,minimum,name,timestampFormat,timestampPath,url,valuePath,values,version"
    ||v.version!==1||typeof v.name!=="string"||!v.name.trim()||v.name.length>120
    ||!["unix-seconds","unix-milliseconds","iso8601"].includes(v.timestampFormat)
    ||!Number.isInteger(v.decimals)||v.decimals<0||v.decimals>18
    ||!Number.isSafeInteger(v.maxAgeSeconds)||v.maxAgeSeconds<1||v.maxAgeSeconds>86400)return invalid();
  const url=publicDataURL(v.url).href,minimum=integer(v.minimum),maximum=integer(v.maximum);
  if(BigInt(minimum)>BigInt(maximum)||BigInt(minimum)<-(1n<<255n)||BigInt(maximum)>=(1n<<255n))return invalid();
  let values:Record<string,string>|null=null;
  if(v.values!==null){
    if(!v.values||typeof v.values!=="object"||Array.isArray(v.values)||!Object.keys(v.values).length||Object.keys(v.values).length>64)return invalid();
    values=Object.create(null);
    for(const [key,value] of Object.entries(v.values)){
      if(!key||key.length>120||["__proto__","prototype","constructor"].includes(key)||typeof value!=="string"||!/^(-?)(0|[1-9]\d{0,30})(?:\.\d{1,18})?$/.test(value)||(value.split(".")[1]?.length??0)>v.decimals)return invalid();
      values![key]=value;
    }
  }
  const definition:JSONAdapterDefinition={version:1,name:v.name.trim(),url,valuePath:path(v.valuePath),timestampPath:path(v.timestampPath),timestampFormat:v.timestampFormat,
    decimals:v.decimals,minimum,maximum,maxAgeSeconds:v.maxAgeSeconds,values};
  const implementationHash=canonicalBrowserSha256V2("programmable.json-data-adapter.v1",definition);
  return {id:`adapter-${implementationHash.slice(7,63)}`,implementationHash,definition};
}
const field=(value:unknown,path:string[])=>path.reduce<unknown>((value,key)=>{
  if(!value||typeof value!=="object"||!Object.hasOwn(value,key))return invalid();
  return (value as Record<string,unknown>)[key];
},value);

export function normalizeJSONObservation(adapter:JSONDataAdapter,payload:unknown,now:number,previous?:FeedSnapshot):FeedSnapshot {
  const checked=createJSONDataAdapter(adapter.definition);
  if(checked.implementationHash!==adapter.implementationHash||checked.id!==adapter.id||!Number.isSafeInteger(now))return invalid();
  const d=checked.definition,raw=field(payload,d.valuePath);
  if(!["number","string","boolean"].includes(typeof raw))return invalid();
  if(typeof raw==="number"&&!Number.isSafeInteger(raw))return invalid();
  const text=d.values?Object.hasOwn(d.values,String(raw))?d.values[String(raw)]:undefined:typeof raw==="boolean"?undefined:String(raw);
  if(typeof text!=="string"||!/^(-?)(0|[1-9]\d{0,30})(?:\.\d{1,18})?$/.test(text)||(text.split(".")[1]?.length??0)>d.decimals)return invalid();
  const value=parseUnits(text,d.decimals);
  if(value<BigInt(d.minimum)||value>BigInt(d.maximum))return invalid();
  const time=field(payload,d.timestampPath);
  let observedAt:number;
  if(d.timestampFormat==="iso8601"){
    if(typeof time!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(time))return invalid();
    observedAt=Math.floor(Date.parse(time)/1000);
  }else{
    if(typeof time!=="number"&&!(typeof time==="string"&&/^(0|[1-9]\d{0,15})$/.test(time)))return invalid();
    const timestamp=Number(time);
    if(!Number.isSafeInteger(timestamp))return invalid();
    observedAt=d.timestampFormat==="unix-milliseconds"?Math.floor(timestamp/1000):timestamp;
  }
  if(!Number.isSafeInteger(observedAt)||observedAt<0||observedAt>now||now-observedAt>d.maxAgeSeconds)return invalid();
  const sourceVersion=adapter.implementationHash;
  if(previous&&(previous.feedId!==adapter.id||previous.sourceVersion!==sourceVersion||observedAt<previous.observedAt))return invalid();
  if(previous&&observedAt===previous.observedAt){if(previous.value!==value.toString())return invalid();return structuredClone(previous);}
  const changed=Boolean(previous&&previous.value!==value.toString());
  return {feedId:adapter.id,sourceVersion,value:value.toString(),previousValue:changed?previous!.value:previous?.previousValue??value.toString(),
    sequence:(BigInt(previous?.sequence??"0")+1n).toString(),transitionSequence:(BigInt(previous?.transitionSequence??"0")+(changed?1n:0n)).toString(),
    changedAt:changed?observedAt:previous?.changedAt??0,observedAt,validUntil:observedAt+d.maxAgeSeconds,fresh:true};
}

export async function readJSONObservation(adapter:JSONDataAdapter,previous?:FeedSnapshot,signal?:AbortSignal){
  const payload=await readPublicJSON(adapter.definition.url,signal,Math.min(10000,adapter.definition.maxAgeSeconds*250));
  return {observation:normalizeJSONObservation(adapter,payload,Math.floor(Date.now()/1000),previous),responseHash:canonicalBrowserSha256V2("programmable.json-data-observation.v1",payload)};
}
