import "server-only";
import { randomUUID } from "node:crypto";
import type { ConnectionAction,ConnectionManifest } from "./connections.server";
import { privateConnectorHTTP,validateConnectorURL,type ConnectorTransport,type ConnectorResponse } from "./private-http.server";
import { projectHash } from "./document";
import { ProjectError,type JsonValue } from "./types";
const bad=()=>new ProjectError("mcp-protocol","The plugin did not return a supported MCP response.",502);
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
function headerValue(value:string){return /^[\x20-\x7e]*$/.test(value)&&value===value.trim()&&!/^=\?base64\?.*\?=$/.test(value)?value:`=?base64?${Buffer.from(value).toString("base64")}?=`;}
export function mcpInputHeaders(schema:object,input:JsonValue){
  const output:Record<string,string>={},seen=new Set<string>();
  function visit(value:unknown,path:string[],reachable:boolean,depth:number){
    if(depth>30)throw bad();if(!object(value))return;
    if(Object.hasOwn(value,"x-mcp-header")){
      const name=value["x-mcp-header"];
      if(!reachable||typeof name!=="string"||!/^[-!#$%&'*+.^_`|~0-9A-Za-z]{1,64}$/.test(name)||seen.has(name.toLowerCase())||!["string","integer","boolean"].includes(String(value.type)))throw bad();
      seen.add(name.toLowerCase());if(seen.size>32)throw bad();
      let data:unknown=input;for(const key of path){if(!object(data)||!Object.hasOwn(data,key)){data=undefined;break;}data=data[key];}
      if(data!==undefined&&data!==null){if(value.type==="integer"&&!Number.isSafeInteger(data)||value.type==="boolean"&&typeof data!=="boolean"||value.type==="string"&&typeof data!=="string")throw bad();output[`Mcp-Param-${name}`]=headerValue(String(data));}
    }
    if(object(value.properties))for(const[key,child]of Object.entries(value.properties))visit(child,[...path,key],reachable,depth+1);
    for(const[key,child]of Object.entries(value))if(!["properties","x-mcp-header"].includes(key)){
      if(Array.isArray(child))for(const item of child)visit(item,path,false,depth+1);else if(object(child))visit(child,path,false,depth+1);
    }
  }
  visit(schema,[],true,0);return output;
}
function result(response:ConnectorResponse,id:string):Record<string,unknown>{
  if(response.status!==200)throw bad();let candidates:unknown[];
  try{candidates=response.headers["content-type"]?.includes("text/event-stream")
    ?response.text.split(/\r?\n\r?\n/).flatMap(event=>{const data=event.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");if(!data)return [];try{return [JSON.parse(data)];}catch{return [];}})
    :[JSON.parse(response.text)];}catch{throw bad();}
  const found=candidates.find(item=>object(item)&&item.jsonrpc==="2.0"&&String(item.id)===id);
  if(!object(found)||Object.hasOwn(found,"error")||!object(found.result)||found.result.inputRequests)throw bad();return found.result;
}
async function withMCP<T>(manifest:ConnectionManifest,authHeaders:Record<string,string>,transport:ConnectorTransport,signal:AbortSignal|undefined,run:(rpc:(method:string,params:Record<string,unknown>,extra?:Record<string,string>)=>Promise<Record<string,unknown>>)=>Promise<T>){
  const url=validateConnectorURL(manifest.baseUrl).href,modern=manifest.protocol==="2026-07-28";let session:string|undefined;
  const headers=()=>({...authHeaders,Accept:"application/json, text/event-stream","Content-Type":"application/json","MCP-Protocol-Version":manifest.protocol!,...(session?{"Mcp-Session-Id":session}:{})});
  const rpc=async(method:string,params:Record<string,unknown>,extra:Record<string,string>={})=>{
    const id=randomUUID(),body={jsonrpc:"2.0",id,method,params:{...params,...(modern?{_meta:{"io.modelcontextprotocol/protocolVersion":manifest.protocol,"io.modelcontextprotocol/clientInfo":{name:"Programmable",version:"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}:{})}};
    const response=await transport({url,method:"POST",headers:{...headers(),...(modern?{"Mcp-Method":method,...(typeof params.name==="string"?{"Mcp-Name":headerValue(params.name)}:{})}:{}),...extra},body:JSON.stringify(body),responseId:id,...(signal?{signal}:{})});
    if(!modern&&response.headers["mcp-session-id"]){if(response.headers["mcp-session-id"].length>1024||/[\r\n]/.test(response.headers["mcp-session-id"]))throw bad();session=response.headers["mcp-session-id"];}
    return result(response,id);
  };
  try{
    if(!modern){const initial=await rpc("initialize",{protocolVersion:manifest.protocol,capabilities:{},clientInfo:{name:"Programmable",version:"1.0.0"}});if(initial.protocolVersion!==manifest.protocol)throw bad();
      const response=await transport({url,method:"POST",headers:headers(),body:JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"}),...(signal?{signal}:{})});if(response.status!==202)throw bad();}
    return await run(rpc);
  }finally{if(session)await transport({url,method:"DELETE",headers:headers()}).catch(()=>undefined);}
}
function normalizeTools(raw:unknown,manifest:ConnectionManifest):ConnectionAction[]{
  if(!Array.isArray(raw)||raw.length>64)throw bad();const tools:ConnectionAction[]=[];
  for(const item of raw){
    if(!object(item)||typeof item.name!=="string"||!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(item.name)||!object(item.inputSchema))continue;
    try{mcpInputHeaders(item.inputSchema,{});}catch{continue;}
    tools.push({id:item.name,description:typeof item.description==="string"?item.description.slice(0,4000):item.name,method:"POST",path:new URL(manifest.baseUrl).pathname,effect:"write",inputSchema:item.inputSchema,outputSchema:object(item.outputSchema)?item.outputSchema:{type:"object"}});
  }
  return tools;
}
async function list(rpc:(method:string,params:Record<string,unknown>)=>Promise<Record<string,unknown>>,manifest:ConnectionManifest){
  const actions:ConnectionAction[]=[];let cursor:string|undefined;
  for(let page=0;page<4;page++){
    const response=await rpc("tools/list",cursor?{cursor}:{});actions.push(...normalizeTools(response.tools,manifest));if(actions.length>64)throw bad();
    if(!response.nextCursor)return actions;if(typeof response.nextCursor!=="string"||response.nextCursor.length>1024)throw bad();cursor=response.nextCursor;
  }
  throw new ProjectError("mcp-limit","This plugin exposes more tools than this project can review.",413);
}
export function discoverMCP(manifest:ConnectionManifest,headers:Record<string,string>,transport:ConnectorTransport=privateConnectorHTTP,signal?:AbortSignal){
  return withMCP(manifest,headers,transport,signal,rpc=>list(rpc,manifest));
}
export function callMCP(manifest:ConnectionManifest,action:ConnectionAction,input:JsonValue,headers:Record<string,string>,transport:ConnectorTransport=privateConnectorHTTP,signal?:AbortSignal){
  return withMCP(manifest,headers,transport,signal,async rpc=>{
    const current=(await list(rpc,manifest)).find(tool=>tool.id===action.id);
    if(!current||projectHash(current)!==projectHash(action))throw new ProjectError("mcp-changed","The plugin's tool definition changed. Review its permissions again.",409);
    const response=await rpc("tools/call",{name:action.id,arguments:input},manifest.protocol==="2026-07-28"?mcpInputHeaders(action.inputSchema,input):{});
    if(response.isError===true)throw new ProjectError("mcp-tool","The plugin reported an action error.",502);
    return (response.structuredContent??response) as JsonValue;
  });
}
