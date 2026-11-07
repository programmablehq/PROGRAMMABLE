import {randomBytes} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {createProjectSecretBox} from "../lib/custom-ai/platform/secrets.server";
import {createRuntimeDataStore} from "../lib/custom-ai/platform/runtime-data.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import type {AIPool} from "../lib/custom-ai/store.server";
let db:PGlite,pool:AIPool,box:ReturnType<typeof createProjectSecretBox>,data:ReturnType<typeof createRuntimeDataStore>;
const alice={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"},bob={ownerId:"bob",projectId:"22222222-2222-4222-8222-222222222222"};
beforeEach(async()=>{db=new PGlite();await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();pool={connect:async()=>{const old=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});await old;return {query:(s,v)=>db.query<Record<string,unknown>>(s,v),release}}};const projects=createPlatformStore(pool);await projects.createProject(alice);await projects.createProject(bob);box=createProjectSecretBox({active:"one",keys:{one:randomBytes(32)}});data=createRuntimeDataStore(pool,box);});
afterEach(async()=>{await db.close()});
describe("scoped application data",()=>{
 it("does not reuse a deleted item's version for a replacement",async()=>{
  const key=await data.mintAppKey(alice,"33333333-3333-4333-8333-333333333333",1);
  await data.invoke(key.token,{op:"put",collection:"scores",key:"same",value:1,idempotencyKey:"first"});
  await data.invoke(key.token,{op:"delete",collection:"scores",key:"same",expectedVersion:1,idempotencyKey:"delete"});
  const absent=await data.invoke(key.token,{op:"get",collection:"scores",key:"same"});expect(absent).toEqual({value:null,version:2});
  await data.invoke(key.token,{op:"put",collection:"scores",key:"same",value:3,expectedVersion:2,idempotencyKey:"new"});
  await expect(data.invoke(key.token,{op:"put",collection:"scores",key:"same",value:4,expectedVersion:1,idempotencyKey:"stale"})).rejects.toMatchObject({code:"app-data-conflict"});
 });
 it("isolates preview writes until that release is promoted",async()=>{
  const live=await data.mintAppKey(alice,"33333333-3333-4333-8333-333333333333",1,"production");
  const preview=await data.mintAppKey(alice,"55555555-5555-4555-8555-555555555555",1,"preview");
  await data.invoke(live.token,{op:"put",collection:"scores",key:"alice",value:9,idempotencyKey:"live"});
  await data.invoke(preview.token,{op:"put",collection:"scores",key:"alice",value:3,idempotencyKey:"preview"});
  expect(await data.invoke(live.token,{op:"get",collection:"scores",key:"alice"})).toEqual({value:9,version:1});
  await data.activateRelease(alice,preview.id);
  expect(await data.invoke(preview.token,{op:"get",collection:"scores",key:"alice"})).toEqual({value:9,version:1});
  await expect(data.invoke(live.token,{op:"get",collection:"scores",key:"alice"})).rejects.toMatchObject({code:"app-stopped"});
 });
 it("keeps app data private to its project without exposing platform database access",async()=>{
  const first=await data.mintAppKey(alice,"33333333-3333-4333-8333-333333333333",1),second=await data.mintAppKey(bob,"44444444-4444-4444-8444-444444444444",1);
  await data.invoke(first.token,{op:"put",collection:"scores",key:"user",value:3,idempotencyKey:"write-one"});
  expect(await data.invoke(second.token,{op:"get",collection:"scores",key:"user"})).toEqual({value:null,version:0});
  expect(JSON.stringify((await db.query("SELECT * FROM programmable_projects_v1.app_keys")).rows)).not.toContain(first.token);
 });
 it("preserves data after a new service instance and applies a retried mutation once",async()=>{
  const key=await data.mintAppKey(alice,"33333333-3333-4333-8333-333333333333",1);
  const input={op:"increment" as const,collection:"scores",key:"alice",delta:1,idempotencyKey:"scheduled-run-one"};
  expect(await data.invoke(key.token,input)).toEqual({value:1,version:1});
  const restarted=createRuntimeDataStore(pool,box);
  expect(await restarted.invoke(key.token,input)).toEqual({value:1,version:1});
  expect(await restarted.invoke(key.token,{op:"get",collection:"scores",key:"alice"})).toEqual({value:1,version:1});
 });
 it("rejects stale writes, changed retry bodies and stopped application access",async()=>{
  const key=await data.mintAppKey(alice,"33333333-3333-4333-8333-333333333333",1);
  await data.invoke(key.token,{op:"put",collection:"scores",key:"alice",value:3,idempotencyKey:"one"});
  await expect(data.invoke(key.token,{op:"put",collection:"scores",key:"alice",value:4,expectedVersion:0,idempotencyKey:"two"})).rejects.toMatchObject({code:"app-data-conflict"});
  await expect(data.invoke(key.token,{op:"put",collection:"scores",key:"alice",value:5,idempotencyKey:"one"})).rejects.toMatchObject({code:"app-idempotency"});
  await data.setActive(alice,false);await expect(data.invoke(key.token,{op:"get",collection:"scores",key:"alice"})).rejects.toMatchObject({code:"app-stopped"});
  await data.setActive(alice,true);expect(await data.invoke(key.token,{op:"get",collection:"scores",key:"alice"})).toEqual({value:3,version:1});
 });
});
