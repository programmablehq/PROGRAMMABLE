import {randomBytes} from "node:crypto";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {createProjectSecretBox} from "../lib/custom-ai/platform/secrets.server";
import {createRuntimeDataStore} from "../lib/custom-ai/platform/runtime-data.server";
import {createAppJobs} from "../lib/custom-ai/platform/jobs.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import type {AIPool} from "../lib/custom-ai/store.server";
let db:PGlite,pool:AIPool,data:ReturnType<typeof createRuntimeDataStore>,clock:number,revisionId:string;
const scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"},releaseId="22222222-2222-4222-8222-222222222222";
beforeEach(async()=>{clock=Date.UTC(2026,10,7);db=new PGlite();await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();pool={connect:async()=>{const old=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});await old;return {query:(s,v)=>db.query<Record<string,unknown>>(s,v),release}}};revisionId=(await createPlatformStore(pool).createProject(scope)).revisionId;data=createRuntimeDataStore(pool,createProjectSecretBox({active:"one",keys:{one:randomBytes(32)}}),()=>clock);
await db.query("INSERT INTO programmable_projects_v1.app_releases(owner,project_id,id,revision_id,request_key,request_hash,artifact_hash,mode,state,data_version,evidence,created_at,url) VALUES($1,$2,$3,$4,'test','test','test','production','published',1,'[]',now(),'https://app.vercel.app')",[scope.ownerId,scope.projectId,releaseId,revisionId]);await db.query("INSERT INTO programmable_projects_v1.app_hosts(owner,project_id,provider_id,provider_name,active_release) VALUES($1,$2,'prj_test','test',$3)",[scope.ownerId,scope.projectId,releaseId]);});
afterEach(async()=>{await db.close()});
it("retries an idempotent scheduled callback with the same effect identity after restart",async()=>{
 let attempts=0;const callback=vi.fn(async(input)=>{const payload=JSON.parse(input.body!),token=input.headers.Authorization.slice(7);await data.invoke(token,{op:"increment",collection:"jobs",key:"runs",delta:1,idempotencyKey:payload.runId});if(++attempts===1)throw Error("response lost");return {status:200,headers:{"content-type":"application/json"},text:'{"ok":true}'};});
 let jobs=createAppJobs(pool,data,callback,()=>clock);await jobs.define(scope,{id:"refresh",path:"/api/refresh",intervalSeconds:60,idempotent:true,body:{}});clock+=60000;await jobs.dispatchDue();
 clock+=31000;jobs=createAppJobs(pool,data,callback,()=>clock);await jobs.dispatchDue();
 const key=await data.mintAppKey(scope,releaseId,1);expect(await data.invoke(key.token,{op:"get",collection:"jobs",key:"runs"})).toEqual({value:1,version:1});
 expect(callback).toHaveBeenCalledTimes(2);const calls=callback.mock.calls;expect(JSON.parse(calls[0][0].body!).runId).toBe(JSON.parse(calls[1][0].body!).runId);
 expect((await jobs.list(scope)).runs[0].state).toBe("completed");
});
it("does not dispatch a stopped application's scheduled work",async()=>{
 const callback=vi.fn(async()=>({status:200,headers:{},text:'{}'}));const jobs=createAppJobs(pool,data,callback,()=>clock);await jobs.define(scope,{id:"refresh",path:"/api/refresh",intervalSeconds:60,idempotent:true,body:{}});
 await db.query("UPDATE programmable_projects_v1.app_releases SET state='stopped'");clock+=60000;await jobs.dispatchDue();expect(callback).not.toHaveBeenCalled();
});
it("pauses and resumes one scheduled task without accepting another owner's changes",async()=>{
 const callback=vi.fn(async()=>({status:200,headers:{},text:'{}'}));const jobs=createAppJobs(pool,data,callback,()=>clock);
 await jobs.define(scope,{id:"refresh",path:"/api/refresh",intervalSeconds:60,idempotent:true,body:{}});
 await expect(jobs.setEnabled({...scope,ownerId:"bob"},"refresh",false)).rejects.toMatchObject({code:"job-missing"});
 await jobs.setEnabled(scope,"refresh",false);clock+=60000;await jobs.dispatchDue();expect(callback).not.toHaveBeenCalled();
 await jobs.setEnabled(scope,"refresh",true);clock+=60000;await jobs.dispatchDue();expect(callback).toHaveBeenCalledOnce();
});
it("preserves an unknown receipt when a task is paused during its callback",async()=>{
 let started!:()=>void,finish!:()=>void;const dispatched=new Promise<void>(resolve=>{started=resolve;}),response=new Promise<void>(resolve=>{finish=resolve;});
 const callback=vi.fn(async()=>{started();await response;return {status:200,headers:{},text:'{}'};});
 const jobs=createAppJobs(pool,data,callback,()=>clock);await jobs.define(scope,{id:"refresh",path:"/api/refresh",intervalSeconds:60,idempotent:true,body:{}});clock+=60000;
 const running=jobs.dispatchDue();await dispatched;await jobs.setEnabled(scope,"refresh",false);finish();await running;
 expect((await jobs.list(scope)).runs[0].state).toBe("reconcile");clock+=120000;await jobs.dispatchDue();expect(callback).toHaveBeenCalledOnce();
});
it("holds a non-idempotent unknown result for review instead of sending it again",async()=>{
 const callback=vi.fn(async()=>{throw Error("response lost")});const jobs=createAppJobs(pool,data,callback,()=>clock);
 await jobs.define(scope,{id:"write",path:"/api/write",intervalSeconds:60,idempotent:false,body:{}});clock+=60000;await jobs.dispatchDue();clock+=120000;await jobs.dispatchDue();
 expect(callback).toHaveBeenCalledOnce();const state=await jobs.list(scope);expect(state.runs[0].state).toBe("reconcile");expect(state.jobs[0].enabled).toBe(false);
});
