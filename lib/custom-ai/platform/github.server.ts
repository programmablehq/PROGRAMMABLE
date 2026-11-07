import "server-only";
import {randomUUID} from "node:crypto";
import type {createConnectionStore,ConnectionManifest} from "./connections.server";
import {validateConnectionManifest} from "./connections.server";
import {privateConnectorHTTP,type ConnectorTransport} from "./private-http.server";
import {projectHash} from "./document";
import {repositoryName,type RepositoryClient} from "./repository-import.server";
import {ProjectError,type ProjectScope,type JsonValue} from "./types";

const operations=[
 ["info","GET","","read"],["commit","GET","/commits/{ref}","read"],["tree","GET","/git/trees/{sha}","read"],["blob","GET","/git/blobs/{sha}","read"],
 ["ref","GET","/git/ref/heads/{branch}","read"],["pulls","GET","/pulls","read"],
 ["blob-create","POST","/git/blobs","write"],["tree-create","POST","/git/trees","write"],["commit-create","POST","/git/commits","write"],
 ["ref-create","POST","/git/refs","write"],["pull-create","POST","/pulls","write"],
] as const;
export function githubConnectionManifest(repository:string):ConnectionManifest{
 const root=`/repos/${repositoryName(repository)}`;
 return validateConnectionManifest({name:`GitHub · ${repository}`.slice(0,100),kind:"http",baseUrl:"https://api.github.com",auth:{kind:"api-key",header:"Authorization",prefix:"Bearer "},actions:operations.map(([id,method,path,effect])=>({id:`github-${id}`,description:`${effect==="read"?"Read":"Write"} ${repository}: ${id}`,method,path:root+path,effect,inputSchema:{type:"object"},outputSchema:{}}))});
}
function matches(path:string,template:string){const expression=template.split(/(\{[^}]+\})/).map(part=>part.startsWith("{")?"[^/]+":part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("");return new RegExp(`^${expression}$`).test(path);}
function writeResult(value:unknown):JsonValue{
 const raw=value as Record<string,unknown>;if(!raw||typeof raw!=="object")throw new ProjectError("github-response","GitHub returned an incomplete object.",502);
 const result:Record<string,JsonValue>={};
 for(const key of ["sha","ref","number","html_url"])if(typeof raw[key]==="string"||typeof raw[key]==="number")result[key]=raw[key] as string|number;
 for(const key of ["object","head","base"])if(raw[key]&&typeof raw[key]==="object"){const item=raw[key] as Record<string,unknown>;result[key]=Object.fromEntries(["sha","ref","type"].filter(field=>typeof item[field]==="string").map(field=>[field,item[field] as string]));}
 return result;
}
export function createGitHubRepositoryClient(options:{scope:ProjectScope;repository:string;connection?:{id:string;version:string};store?:ReturnType<typeof createConnectionStore>;transport?:ConnectorTransport;refresh?:(scope:ProjectScope,id:string,version:string)=>Promise<void>;signal?:AbortSignal}):RepositoryClient{
 const repository=repositoryName(options.repository),expected=githubConnectionManifest(repository),transport=options.transport??privateConnectorHTTP;
 async function perform(path:string,method:"GET"|"POST",body?:unknown,requestKey?:string){
  if(typeof path!=="string"||!path.startsWith(`/repos/${repository}`)||path.includes("\\")||path.includes("#"))throw new ProjectError("github-scope","Use the repository approved for this connection.",403);
  const url=new URL(path,"https://api.github.com"),action=expected.actions.find(item=>item.method===method&&matches(url.pathname,item.path));
  if(url.origin!=="https://api.github.com"||!action||[...url.searchParams.keys()].some(key=>!(["github-tree"].includes(action.id)?["recursive"]:["github-pulls"].includes(action.id)?["head","state","base"]:[]).includes(key)))throw new ProjectError("github-scope","This GitHub request is outside the approved repository operation.",403);
  const headers:Record<string,string>={Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2026-03-10"};
  if(method==="POST")headers["Content-Type"]="application/json";
  const key=requestKey??`github-${randomUUID()}`,connection=options.connection,store=options.store;let secretValues:string[]=[];
  if(method==="POST"&&!connection)throw new ProjectError("github-connection","Connect a GitHub account with the required repository write permission.",403);
  if(connection){
   if(!store)throw new ProjectError("github-configuration","Private repository access is unavailable.",503);
   await options.refresh?.(options.scope,connection.id,connection.version);
   const grant=await store.authorize(options.scope,connection.id,connection.version,action.id),manifest=grant.manifest;
   secretValues=Object.values(grant.secret).filter(value=>value.length>=3);
   if(manifest.kind!=="http"||new URL(manifest.baseUrl).origin!=="https://api.github.com"||grant.action.path!==action.path||grant.action.method!==method||grant.action.effect!==action.effect)throw new ProjectError("github-scope","Review the GitHub repository connection before using it.",403);
   if(manifest.auth.kind==="api-key"&&manifest.auth.header.toLowerCase()==="authorization"&&manifest.auth.prefix==="Bearer "&&grant.secret.apiKey)headers.Authorization=`Bearer ${grant.secret.apiKey}`;
   else if(manifest.auth.kind==="oauth2"&&grant.secret.accessToken)headers.Authorization=`Bearer ${grant.secret.accessToken}`;
   else throw new ProjectError("github-connection","Use an authenticated GitHub repository connection.",403);
   const call=await store.beginCall(options.scope,{connectionId:connection.id,requestKey:key,hash:projectHash({method,path,body:body??null}),effect:action.effect,version:connection.version,actionId:action.id});
   if(!call.execute){if(method==="POST")return call.result;throw new ProjectError("github-response","Retry the repository read with a new request.",409);}
  }
  try{
   const response=await transport({url:url.href,method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:options.signal,maxRequestBytes:1048576,maxResponseBytes:1048576});
   if(response.status===404&&method==="GET"){if(connection&&store)await store.finishCall(options.scope,connection.id,key,{status:404});return null;}
   if(response.status<200||response.status>=300)throw new ProjectError("github-response",`GitHub could not complete this repository operation (${response.status}).`,response.status===429?429:502);
   let result:unknown;try{result=JSON.parse(response.text);}catch{throw new ProjectError("github-response","GitHub returned an unreadable repository object.",502);}
   if(action.id==="github-blob"&&result&&typeof result==="object"&&"content" in result&&typeof result.content==="string"){
    const decoded=Buffer.from(result.content,"base64").toString("utf8");if(secretValues.some(secret=>decoded.includes(secret)))throw new ProjectError("project-secret","Remove the exposed connection credential from source before importing it.",409);
   }
   if(connection&&store)await store.finishCall(options.scope,connection.id,key,method==="POST"?writeResult(result):{status:response.status});
   return method==="POST"?writeResult(result):result;
  }catch(error){
   if(connection&&store)await store.finishCall(options.scope,connection.id,key,null,true);
   if(method==="POST")throw new ProjectError("github-unknown","Check the saved branch before repeating an uncertain GitHub write.",409);
   if(error instanceof ProjectError)throw error;throw new ProjectError("github-network","The repository could not be read. Its saved project is unchanged.",503);
  }
 }
 return {get:path=>perform(path,"GET"),post:(path,body,key)=>perform(path,"POST",body,key)};
}
