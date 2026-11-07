import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { publicDataAddress, publicDataURL } from "../feed-adapters/public-json.server";
import { ProjectError, type JsonValue } from "./types";

export const validateConnectorURL = (value: string) => {
  try { return publicDataURL(value); }
  catch { throw new ProjectError("connection-url", "Use a public HTTPS endpoint without credentials in its URL."); }
};
export type ConnectorRequest = { url: string; method: string; headers: Record<string,string>; body?: string; signal?: AbortSignal; responseId?: string };
export type ConnectorResponse = { status: number; headers: Record<string,string>; text: string };
export type ConnectorTransport = (request: ConnectorRequest) => Promise<ConnectorResponse>;
export function redactConnectorData(value: unknown, secrets: string[], depth=0): JsonValue {
  if(depth>24)return "[truncated]";
  if(typeof value==="string") {
    let text=value;
    for(const secret of secrets.filter(secret=>secret.length>=3))text=text.split(secret).join("[redacted]");
    return text.replace(/\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{20,}\b/g,"[redacted]").slice(0,128000);
  }
  if(value===null||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.slice(0,1000).map(item=>redactConnectorData(item,secrets,depth+1));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).slice(0,1000).map(([key,item])=>[key,/^(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|secret|private[-_]?key)$/i.test(key)?"[redacted]":redactConnectorData(item,secrets,depth+1)]));
  return null;
}
export const privateConnectorHTTP: ConnectorTransport = async input => {
  const url=validateConnectorURL(input.url);
  if(input.body&&Buffer.byteLength(input.body)>128000)throw new ProjectError("connection-size","The API request is too large.",413);
  if(Object.entries(input.headers).some(([key,value])=>!/^[-!#$%&'*+.^_`|~0-9A-Za-z]+$/.test(key)||/[\r\n\0]/.test(value)||value.length>16000||/^(host|connection|content-length|transfer-encoding|proxy-authorization|cookie)$/i.test(key)))throw new ProjectError("connection-header","Use valid API headers.");
  const signal=AbortSignal.any([AbortSignal.timeout(25000),...(input.signal?[input.signal]:[])]);
  const addresses=await new Promise<{address:string;family:number}[]>((resolve,reject)=>{
    const abort=()=>reject(new ProjectError("connection-timeout","The API hostname lookup timed out.",503));
    signal.addEventListener("abort",abort,{once:true});
    lookup(url.hostname,{all:true,verbatim:true}).then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
    if(signal.aborted)abort();
  });signal.throwIfAborted();
  if(!addresses.length||addresses.length>32||addresses.some(item=>!publicDataAddress(item.address)))throw new ProjectError("connection-network","The endpoint must resolve exclusively to public addresses.",403);
  const selected=addresses.find(item=>item.family===4)??addresses[0];
  return new Promise((resolve,reject)=>{
    const outgoing=request({protocol:"https:",hostname:selected.address,family:selected.family,port:443,servername:url.hostname,
      path:url.pathname+url.search,method:input.method,agent:false,rejectUnauthorized:true,signal,
      headers:{...input.headers,Host:url.hostname,"Accept-Encoding":"identity","User-Agent":"Programmable-Project-Connector/1"}},response=>{
      const status=response.statusCode??502;
      if(status>=300&&status<400||response.headers["content-encoding"]&&response.headers["content-encoding"]!=="identity") {response.destroy();reject(new ProjectError("connection-redirect","API redirects and encoded responses are not allowed.",502));return;}
      const headers=Object.fromEntries(Object.entries(response.headers).filter(([name,value])=>["content-type","mcp-session-id"].includes(name)&&typeof value==="string")) as Record<string,string>;
      let size=0,done=false;const chunks:Buffer[]=[];
      const finish=()=>{if(!done){done=true;resolve({status,headers,text:Buffer.concat(chunks).toString("utf8")});}};
      response.on("data",(chunk:Buffer)=>{
        size+=chunk.length;if(size>256000){response.destroy();reject(new ProjectError("connection-size","The API response is too large.",413));return;}chunks.push(chunk);
        if(input.responseId&&headers["content-type"]?.includes("text/event-stream")){
          const text=Buffer.concat(chunks).toString("utf8");
          for(const event of text.split(/\r?\n\r?\n/).slice(0,-1)){
            const data=event.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
            try{const message=JSON.parse(data);if(String(message.id)===input.responseId&&(Object.hasOwn(message,"result")||Object.hasOwn(message,"error"))){finish();response.destroy();break;}}catch{/* Wait for a complete event. */}
          }
        }
      });
      response.on("error",()=>{if(!done)reject(new ProjectError("connection-transport","The API response was interrupted.",503));});
      response.on("aborted",()=>{if(!done)reject(new ProjectError("connection-transport","The API response was interrupted.",503));});response.on("end",finish);
    });
    outgoing.on("error",()=>reject(new ProjectError("connection-transport","The API request did not complete.",503)));outgoing.end(input.body);
  });
};
