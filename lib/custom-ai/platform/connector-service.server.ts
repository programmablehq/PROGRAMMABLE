import "server-only";
import Ajv from "ajv";
import type { createConnectionStore } from "./connections.server";
import { projectHash,canonicalProjectJSON } from "./document";
import { privateConnectorHTTP,redactConnectorData,validateConnectorURL,type ConnectorTransport } from "./private-http.server";
import { ProjectError,type ProjectScope,type JsonValue } from "./types";
import { callMCP } from "./mcp.server";

export function createConnectionService(store:ReturnType<typeof createConnectionStore>,transport:ConnectorTransport=privateConnectorHTTP,refresh?: (scope:ProjectScope,id:string,version:string,signal?:AbortSignal)=>Promise<void>){
  async function invoke(scope:ProjectScope,input:{connectionId:string;version:string;actionId:string;input:JsonValue;idempotencyKey:string},signal?:AbortSignal){
    await refresh?.(scope,input.connectionId,input.version,signal);
    const connection=await store.authorize(scope,input.connectionId,input.version,input.actionId),{action,manifest,secret}=connection;
    const valid=new Ajv({strict:false}).compile(action.inputSchema);
    if(canonicalProjectJSON(input.input).length>128000||!valid(input.input))throw new ProjectError("connection-arguments","The API arguments do not match the reviewed action.",422);
    const call=await store.beginCall(scope,{connectionId:input.connectionId,requestKey:input.idempotencyKey,hash:projectHash({version:input.version,action:input.actionId,input:input.input}),effect:action.effect,version:input.version,actionId:input.actionId});
    if(!call.execute)return call.result;
    try{
      let path=action.path;
      const argumentsObject=input.input&&typeof input.input==="object"&&!Array.isArray(input.input)?input.input:{};
      const boundPath=argumentsObject.path&&typeof argumentsObject.path==="object"&&!Array.isArray(argumentsObject.path)?argumentsObject.path:{};
      if(action.bindings)for(const key of action.bindings.path){const value=boundPath[key];if(!["string","number"].includes(typeof value)||/[\\/%]/.test(String(value))||/^\.\.?$/.test(String(value)))throw new ProjectError("connection-arguments","Use a valid path identifier.",422);path=path.replaceAll(`{${key}}`,encodeURIComponent(String(value)));}
      const url=validateConnectorURL(new URL(path,manifest.baseUrl).href),headers:Record<string,string>={Accept:"application/json"};
      if(manifest.auth.kind==="api-key"){if(!secret.apiKey)throw new ProjectError("connection-secret","Reconnect this API key.",409);headers[manifest.auth.header]=`${manifest.auth.prefix??""}${secret.apiKey}`;}
      if(manifest.auth.kind==="oauth2"){if(!secret.accessToken)throw new ProjectError("connection-secret","Reconnect this account.",409);headers.Authorization=`Bearer ${secret.accessToken}`;}
      if(action.idempotencyHeader)headers[action.idempotencyHeader]=input.idempotencyKey;
      if(manifest.kind==="mcp"){
        const raw=await callMCP(manifest,action,input.input,headers,transport,signal);
        if(!new Ajv({strict:false}).compile(action.outputSchema)(raw))throw new ProjectError("connection-response","The plugin result does not match the reviewed schema.",502);
        const result=redactConnectorData(raw,Object.values(secret));await store.finishCall(scope,input.connectionId,input.idempotencyKey,result);return result;
      }
      const query=action.bindings?(argumentsObject.query&&typeof argumentsObject.query==="object"&&!Array.isArray(argumentsObject.query)?argumentsObject.query:{}):action.method==="GET"?argumentsObject:{};
      if(Object.keys(query).length){
        for(const[key,value]of Object.entries(query)){
          if(action.bindings&&!action.bindings.query.includes(key))throw new ProjectError("connection-arguments","Use declared API query fields.",422);
          if(value!==null&&!["string","number","boolean"].includes(typeof value))throw new ProjectError("connection-arguments","GET actions accept scalar query values.",422);
          if(value!==null)url.searchParams.set(key,String(value));
        }
      }
      if(action.method!=="GET")headers["Content-Type"]="application/json";
      const body=action.bindings?argumentsObject.body:input.input;
      const response=await transport({url:url.href,method:action.method,headers,...(action.method==="GET"||body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});
      if(response.status<200||response.status>=300||!/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(response.headers["content-type"]??""))throw new ProjectError("connection-response","The API did not return a successful JSON response.",502);
      let raw:unknown;try{raw=JSON.parse(response.text);}catch{throw new ProjectError("connection-response","The API returned invalid JSON.",502);}
      if(!new Ajv({strict:false}).compile(action.outputSchema)(raw))throw new ProjectError("connection-response","The API response does not match the reviewed schema.",502);
      const result=redactConnectorData(raw,Object.values(secret));
      await store.finishCall(scope,input.connectionId,input.idempotencyKey,result);return result;
    }catch(error){await store.finishCall(scope,input.connectionId,input.idempotencyKey,null,true);
      if(action.effect==="write")throw new ProjectError("connection-unknown","The API write outcome is uncertain. Reconcile it before repeating.",409);
      if(error instanceof ProjectError)throw error;throw new ProjectError("connection-transport","The API request could not be completed.",503);}
  }
  return {invoke};
}
