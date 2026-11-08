import { AIRequestError, type AISessionHeaders } from "@/lib/custom-ai/client";
import type { PlatformAPI } from "./types";

/** Mutations are never retried here: callers retain their idempotency key. */
export function platformAPI(headers:AISessionHeaders):PlatformAPI {
  return async<T>(path:string,options:Parameters<PlatformAPI>[1]={})=>{
    if(!/^\/[a-z]+(?:\?|$)/.test(path))throw Error("Invalid project request.");
    const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(45_000)]):AbortSignal.timeout(45_000);
    const credentials=await headers();signal.throwIfAborted();
    const response=await fetch(`/api/custom-ai/platform${path}`,{method:options.method??(options.body===undefined?"GET":"POST"),
      credentials:"same-origin",cache:"no-store",signal,headers:{...credentials,...(options.body===undefined?{}:{"Content-Type":"application/json"})},
      ...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
    const value=await response.json().catch(()=>null);
    if(!response.ok)throw new AIRequestError(typeof value?.error==="string"?value.error:"The project could not be loaded. Your saved work is kept.",response.status,0,typeof value?.code==="string"?value.code:"response");
    if(value===null)throw new AIRequestError("The service returned an unreadable result. Reload to check your saved work.",502,0,"response");
    return value as T;
  };
}
export async function textHash(text:string){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,"0")).join("")}`;
}
export function publicAppURL(value:string|null|undefined){
  try {const url=new URL(value??"");return url.protocol==="https:"&&!url.username&&!url.password&&url.hostname.endsWith(".vercel.app")?url.href:null;}catch{return null;}
}
export const isActiveRun=(state:string)=>state==="queued"||state==="running";
