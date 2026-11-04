import "server-only";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],
  ["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.88.99.0",24],["192.168.0.0",16],
  ["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const) blocked.addSubnet(address,prefix,"ipv4");
blocked.addAddress("168.63.129.16","ipv4");
// Special-purpose ranges are unsuitable as public application endpoints,
// including the newer 3fff::/20 documentation allocation.
for (const [address,prefix] of [["2001::",23],["2001:db8::",32],["2002::",16],["3fff::",20]] as const) blocked.addSubnet(address,prefix,"ipv6");
const globalV6 = new BlockList(); globalV6.addSubnet("2000::",3,"ipv6");

export function parsePublicDataJSON(text:string):unknown {
  const parse=JSON.parse as (text:string,reviver:(key:string,value:unknown,context?:{source?:string})=>unknown)=>unknown;
  // Preserve provider decimal lexemes before JavaScript number rounding.
  // The pinned Node runtime supports source-aware revivers; fail closed on a
  // different runtime rather than silently rounding a financial observation.
  return parse(text,(_key,value,context)=>{
    if(typeof value!=="number")return value;
    if(typeof context?.source!=="string")throw Error("Exact JSON number parsing is unavailable.");
    return context.source;
  });
}

export function publicDataAddress(address:string):boolean {
  const family=isIP(address);
  return family===4 ? !blocked.check(address,"ipv4") : family===6 && globalV6.check(address,"ipv6") && !blocked.check(address,"ipv6");
}
export function publicDataURL(value:string):URL {
  if(typeof value!=="string"||value.length>2048)throw Error("Use a public HTTPS JSON endpoint.");
  const url=new URL(value);
  if(url.protocol!=="https:"||url.username||url.password||url.hash||url.port||isIP(url.hostname.replace(/^\[|\]$/g,""))
    ||!url.hostname.includes(".")||/(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(url.hostname)
    ||/^(?:metadata|instance-data)(?:\.|$)/.test(url.hostname))throw Error("Use a public HTTPS JSON endpoint.");
  if([...url.searchParams.keys()].some(key=>/^(?:api[-_]?key|access[-_]?token|auth(?:orization)?|secret|password|signature|credential)$/i.test(key)))
    throw Error("Credentials must not be saved in a public data URL.");
  return url;
}

const cache=new Map<string,{storedAt:number;expires:number;value:unknown}>();
const pending=new Map<string,Promise<unknown>>();
async function fetchJSON(url:URL):Promise<unknown> {
  const signal=AbortSignal.timeout(8000);
  const addresses=await new Promise<LookupAddress[]>((resolve,reject)=>{
    const abort=()=>reject(Error("Data lookup timed out."));
    signal.addEventListener("abort",abort,{once:true});
    lookup(url.hostname,{all:true,verbatim:true}).then(resolve,()=>reject(Error("The data hostname could not be resolved."))).finally(()=>signal.removeEventListener("abort",abort));
  });
  signal.throwIfAborted();
  if(!addresses.length||addresses.length>32||addresses.some(item=>!publicDataAddress(item.address)))throw Error("The data endpoint does not resolve exclusively to public addresses.");
  const selected=addresses.find(item=>item.family===4)??addresses[0];
  return new Promise((resolve,reject)=>{
    // Connect to the already checked address. The original hostname remains
    // the HTTP authority and TLS identity; DNS cannot rebind between checks.
    const outgoing=request({protocol:"https:",hostname:selected.address,family:selected.family,port:443,servername:url.hostname,
      path:url.pathname+url.search,method:"GET",agent:false,rejectUnauthorized:true,signal,
      headers:{Host:url.hostname,Accept:"application/json","Accept-Encoding":"identity","User-Agent":"Programmable-Data-Adapter/1"}},response=>{
      const contentType=response.headers["content-type"]??"",encoding=response.headers["content-encoding"];
      if(response.statusCode!==200||!/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(contentType)||encoding&&encoding!=="identity"){
        response.destroy();reject(Error("The data endpoint must return uncompressed JSON with status 200."));return;
      }
      let bytes=0;const chunks:Buffer[]=[];
      response.on("data",(chunk:Buffer)=>{
        bytes+=chunk.length;
        if(bytes>128000){response.destroy();reject(Error("The data response exceeds its size limit."));return;}
        chunks.push(chunk);
      });
      response.once("error",()=>reject(Error("The data response was interrupted.")));
      response.once("aborted",()=>reject(Error("The data response was interrupted.")));
      response.once("end",()=>{try{resolve(parsePublicDataJSON(Buffer.concat(chunks).toString("utf8")));}catch{reject(Error("The data response is not valid exact JSON."));}});
    });
    outgoing.once("error",()=>reject(Error("The data endpoint could not be read.")));outgoing.end();
  });
}

/** Public, credential-free reads only. Callers cannot choose headers, methods,
 * redirects, filesystem paths or a network authority other than the URL. */
export async function readPublicJSON(value:string,signal?:AbortSignal,maximumCacheAgeMs=10000):Promise<unknown> {
  if(!Number.isSafeInteger(maximumCacheAgeMs)||maximumCacheAgeMs<1||maximumCacheAgeMs>10000)throw Error("Use a bounded public data cache age.");
  signal?.throwIfAborted();const url=publicDataURL(value),key=url.href,now=Date.now();
  const saved=cache.get(key);if(saved&&saved.storedAt+maximumCacheAgeMs>now)return structuredClone(saved.value);
  let work=pending.get(key);
  if(!work){
    if(pending.size>=16)throw Error("The data reader is busy. Try shortly.");
    work=fetchJSON(url).then(value=>{
      for(const [key,entry] of cache)if(entry.expires<=Date.now())cache.delete(key);
      if(cache.size>=64)cache.delete(cache.keys().next().value!);
      const storedAt=Date.now();cache.set(key,{storedAt,expires:storedAt+10000,value});return value;
    }).finally(()=>pending.delete(key));
    pending.set(key,work);
  }
  // Cancelling one reader must not cancel another user's shared public read.
  const result=await new Promise<unknown>((resolve,reject)=>{
    const abort=()=>reject(signal?.reason??Error("Data read cancelled."));
    signal?.addEventListener("abort",abort,{once:true});
    work!.then(resolve,reject).finally(()=>signal?.removeEventListener("abort",abort));
    if(signal?.aborted)abort();
  });
  signal?.throwIfAborted();return structuredClone(result);
}
