import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import { createPlatformStore } from "../lib/custom-ai/platform/project-store.server";
import { createConnectionStore, type ConnectionManifest } from "../lib/custom-ai/platform/connections.server";
import { createConnectionService } from "../lib/custom-ai/platform/connector-service.server";
import { PROJECT_PLATFORM_SCHEMA } from "../lib/custom-ai/platform/schema.generated";
import type { AIPool } from "../lib/custom-ai/store.server";

let db:PGlite,store:ReturnType<typeof createConnectionStore>;
const scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"},id="22222222-2222-4222-8222-222222222222";
const manifest:ConnectionManifest={name:"Scores",kind:"http",baseUrl:"https://api.scores.com",auth:{kind:"api-key",header:"Authorization",prefix:"Bearer "},actions:[{id:"score",description:"Read the score",method:"GET",path:"/score",effect:"read",inputSchema:{type:"object",properties:{},additionalProperties:false},outputSchema:{type:"object"}}]};
beforeEach(async()=>{
 db=new PGlite();await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const old=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});await old;return {query:(s,v)=>db.query<Record<string,unknown>>(s,v),release}}};
 await createPlatformStore(pool).createProject(scope);store=createConnectionStore(pool,{active:"one",keys:{one:randomBytes(32)}});
});
afterEach(async()=>{await db.close()});
describe("private project connections",()=>{
 it("encrypts secrets and never includes them in public connection metadata",async()=>{
  const saved=await store.saveConnection(scope,{id,manifest,allowedActions:["score"],secret:{apiKey:"private-test-secret"}});
  expect(JSON.stringify(saved)).not.toContain("private-test-secret");
  expect(JSON.stringify((await db.query("SELECT * FROM programmable_projects_v1.connection_secrets")).rows)).not.toContain("private-test-secret");
  await expect(store.authorize({...scope,ownerId:"bob"},id,saved.version,"score")).rejects.toMatchObject({status:404});
 });
 it("redacts response credentials and rejects new calls after revocation",async()=>{
  const saved=await store.saveConnection(scope,{id,manifest,allowedActions:["score"],secret:{apiKey:"private-test-secret"}});
  const transport=vi.fn(async()=>({status:200,headers:{"content-type":"application/json"},text:JSON.stringify({score:3,echo:"private-test-secret",access_token:"hidden-token"})}));
  const service=createConnectionService(store,transport);
  const answer=await service.invoke(scope,{connectionId:id,version:saved.version,actionId:"score",input:{},idempotencyKey:"first"});
  expect(JSON.stringify(answer)).not.toContain("private-test-secret");expect(JSON.stringify(answer)).not.toContain("hidden-token");
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({headers:expect.objectContaining({Authorization:"Bearer private-test-secret"})}));
  await store.revoke(scope,id);
  await expect(service.invoke(scope,{connectionId:id,version:saved.version,actionId:"score",input:{},idempotencyKey:"second"})).rejects.toMatchObject({code:"connection-revoked"});
  expect(transport).toHaveBeenCalledOnce();
 });
 it("cannot add an ungranted action or silently reuse changed manifests",async()=>{
  const saved=await store.saveConnection(scope,{id,manifest,allowedActions:[],secret:{apiKey:"key"}});
  await expect(store.authorize(scope,id,saved.version,"score")).rejects.toMatchObject({code:"connection-action"});
  await expect(store.saveConnection(scope,{id,manifest:{...manifest,name:"Changed"},allowedActions:["score"],expectedVersion:"stale"})).rejects.toMatchObject({code:"connection-version"});
 });
 it("does not repeat an uncertain write or change its idempotency input",async()=>{
  const write={...manifest,actions:[{...manifest.actions[0],id:"award",method:"POST" as const,path:"/award",effect:"write" as const}]};
  const saved=await store.saveConnection(scope,{id,manifest:write,allowedActions:["award"],secret:{apiKey:"key"}});
  const transport=vi.fn(async()=>{throw Error("network lost after send")});const service=createConnectionService(store,transport);
  const input={connectionId:id,version:saved.version,actionId:"award",input:{},idempotencyKey:"award-one"};
  await expect(service.invoke(scope,input)).rejects.toMatchObject({code:"connection-unknown"});
  await expect(service.invoke(scope,input)).rejects.toMatchObject({code:"connection-unknown"});
  expect(transport).toHaveBeenCalledOnce();
 });
});
