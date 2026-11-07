import "server-only";
import type {HostingProvider} from "./releases.server";
import {projectFileBytes} from "./files";
import {privateConnectorHTTP} from "./private-http.server";
import {ProjectError} from "./types";

export function createVercelHostingProvider(options:{token:string;teamId:string;fetch?:typeof fetch}):HostingProvider{
 if(!/^team_[A-Za-z0-9]+$/.test(options.teamId))throw new ProjectError("hosting-configuration","Application hosting is not configured.",503);
 const send=options.fetch??fetch;
 async function api(path:string,method="GET",body?:unknown,notFound=false):Promise<Record<string,unknown>|null>{
  if(!options.token)throw new ProjectError("hosting-configuration","Application hosting is not configured.",503);
  const url=new URL(`https://api.vercel.com${path}`);url.searchParams.set("teamId",options.teamId);
  const response=await send(url,{method,headers:{Authorization:`Bearer ${options.token}`,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(25000)});
  if(notFound&&response.status===404){await response.body?.cancel();return null;}
  if(!response.ok){await response.body?.cancel();throw new ProjectError("hosting-provider",`The hosting provider could not complete this action (${response.status}).`,503);}
  if(response.status===204)return {};
  const reader=response.body?.getReader();if(!reader)return {};const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1500000)throw new Error("limit");chunks.push(part.value);}const text=Buffer.concat(chunks).toString("utf8");if(!text.trim()&&method!=="GET")return {};return JSON.parse(text);}
  catch{throw new ProjectError("hosting-response","The hosting response could not be verified.",502);}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 }
 const identifier=(value:unknown,prefix:string)=>{if(typeof value!=="string"||!value.startsWith(prefix)||!/^[A-Za-z0-9_-]+$/.test(value))throw new ProjectError("hosting-response","The hosting resource identity is invalid.",502);return value;};
 const address=(value:unknown)=>{if(typeof value!=="string")throw new Error("Missing deployment address");const url=new URL(value.startsWith("https://")?value:`https://${value}`);if(url.protocol!=="https:"||!url.hostname.endsWith(".vercel.app")||url.username||url.password||url.search||url.hash)throw new ProjectError("hosting-response","The deployment address is invalid.",502);return url.origin;};
 async function confirmProject(id:string,accept:(value:Record<string,unknown>)=>boolean){
  for(let attempt=0;attempt<20;attempt++){
   const current=await api(`/v9/projects/${id}`);
   if(current?.accountId!==options.teamId)throw new ProjectError("hosting-owner","The hosting project belongs to another scope.",403);
   if(accept(current))return;
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new ProjectError("hosting-pending","The provider accepted the action, but its final state has not been observed yet.",503);
 }
 return {
  async ensureProject(name){
   if(!/^programmable-[a-f0-9]{24}$/.test(name))throw new ProjectError("hosting-name","Invalid project resource name.");
   let project=await api(`/v9/projects/${name}`,"GET",undefined,true);
   if(!project){
    try{project=await api("/v10/projects","POST",{name,framework:null});}
    catch(error){project=await api(`/v9/projects/${name}`,"GET",undefined,true);if(!project)throw error;}
   }
   if(project?.accountId!==options.teamId||project.name!==name)throw new ProjectError("hosting-owner","The hosting project belongs to another scope.",403);
   const id=identifier(project.id,"prj_");
   await api(`/v9/projects/${id}`,"PATCH",{nodeVersion:"24.x",ssoProtection:null,publicSource:false,autoExposeSystemEnvs:false,oidcTokenConfig:{enabled:false}});
   return {id,name};
  },
  async deploy(input){
   identifier(input.projectId,"prj_");
   if(!input.files[".vercel/output/config.json"]||Object.keys(input.files).some(path=>!path.startsWith(".vercel/output/")))throw new ProjectError("hosting-artifact","Only a verified prebuilt package can be deployed.",409);
   const created=await api("/v13/deployments?prebuilt=1","POST",{name:input.projectName,project:input.projectId,target:"production",autoAssignCustomDomains:false,
     files:Object.entries(input.files).map(([file,value])=>({file,data:projectFileBytes(value).toString("base64"),encoding:"base64"})),env:input.env,build:{env:{}},
     meta:{programmableReleaseId:input.releaseId,programmableRevision:input.revisionId,programmableArtifact:input.artifactHash},
     projectSettings:{framework:null,nodeVersion:"24.x",serverlessFunctionRegion:"fra1",installCommand:"",buildCommand:""}});
   if(!created)throw new Error("Missing deployment");return {id:identifier(created.id,"dpl_"),url:address(created.url)};
  },
  async inspect(id){identifier(id,"dpl_");const deployment=await api(`/v13/deployments/${id}`);if(!deployment)throw new Error();return {state:String(deployment.readyState??deployment.state),url:address(deployment.url)};},
  async probe(url,revisionId){try{const base=address(url);const paths=["/api/_programmable","/api/_programmable/"];for(const path of paths){const response=await privateConnectorHTTP({url:new URL(path,base).href,method:"GET",headers:{Accept:"application/json"}});if(response.status!==200)continue;const body=JSON.parse(response.text);if(body.ok===true&&body.revisionId===revisionId)return true;}return false;}catch{return false;}},
  async promote(projectId,deploymentId){identifier(projectId,"prj_");identifier(deploymentId,"dpl_");
   const current=await api(`/v9/projects/${projectId}`);
   if(current?.accountId!==options.teamId)throw new ProjectError("hosting-owner","The hosting project belongs to another scope.",403);
   const existing=(current.targets as {production?:{id?:string;readyState?:string}}|undefined)?.production;
   if(existing?.id===deploymentId&&existing.readyState==="READY")return;
   await api(`/v10/projects/${projectId}/promote/${deploymentId}`,"POST");
   await confirmProject(projectId,current=>{
    const targets=current.targets as {production?:{id?:string;readyState?:string}}|undefined;
    return targets?.production?.id===deploymentId&&targets.production.readyState==="READY";
   });
  },
  async pause(projectId){identifier(projectId,"prj_");await api(`/v1/projects/${projectId}/pause`,"POST");},
  async resume(projectId){identifier(projectId,"prj_");await api(`/v1/projects/${projectId}/unpause`,"POST");},
  async findDeployment(projectId,releaseId){identifier(projectId,"prj_");const list=await api(`/v6/deployments?projectId=${projectId}&limit=50`);const rows=list?.deployments;if(!Array.isArray(rows))return null;const found=rows.find(row=>row.meta?.programmableReleaseId===releaseId);return found?{id:identifier(found.uid??found.id,"dpl_"),url:address(found.url)}:null;},
 };
}
