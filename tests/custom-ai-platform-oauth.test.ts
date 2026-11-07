import {randomBytes} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {createConnectionStore,type ConnectionManifest} from "../lib/custom-ai/platform/connections.server";
import {createProjectOAuth} from "../lib/custom-ai/platform/oauth.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import type {AIPool} from "../lib/custom-ai/store.server";
import type {ConnectorRequest} from "../lib/custom-ai/platform/private-http.server";
let db:PGlite,store:ReturnType<typeof createConnectionStore>;
const scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"},id="22222222-2222-4222-8222-222222222222";
const manifest:ConnectionManifest={name:"Account",kind:"http",baseUrl:"https://api.scores.com",auth:{kind:"oauth2",authorizeUrl:"https://login.scores.com/authorize",tokenUrl:"https://login.scores.com/token",clientId:"client",scopes:["score:read"]},actions:[]};
beforeEach(async()=>{db=new PGlite();await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const old=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});await old;return {query:(s,v)=>db.query<Record<string,unknown>>(s,v),release}}};await createPlatformStore(pool).createProject(scope);store=createConnectionStore(pool,{active:"one",keys:{one:randomBytes(32)}});await store.saveConnection(scope,{id,manifest,allowedActions:[]});});
afterEach(async()=>{await db.close()});
describe("bound OAuth sign-in",()=>{
 it("binds state to its owner and sends PKCE only to the pinned token endpoint",async()=>{
  const transport=vi.fn(async(_input:ConnectorRequest)=>({status:200,headers:{"content-type":"application/json"},text:JSON.stringify({access_token:"secret-access",refresh_token:"secret-refresh",expires_in:3600,token_type:"Bearer"})}));
  const oauth=createProjectOAuth(store,"https://programmable.market",transport),start=await oauth.start(scope,id),url=new URL(start.url),state=url.searchParams.get("state")!;
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  await expect(oauth.complete("bob",state,"code")).rejects.toMatchObject({code:"oauth-state"});expect(transport).not.toHaveBeenCalled();
  expect(await oauth.complete("alice",state,"code")).toMatchObject({connected:true,connectionId:id});
  const call=transport.mock.calls[0]![0];expect(call.url).toBe("https://login.scores.com/token");expect(new URLSearchParams(call.body).get("code_verifier")).toHaveLength(43);
  await expect(oauth.complete("alice",state,"code")).rejects.toMatchObject({code:"oauth-state"});
  expect(JSON.stringify(await store.listConnections(scope))).not.toContain("secret-access");
 });
 it("cannot reactivate a connection revoked during the sign-in flow",async()=>{
  const transport=vi.fn(async()=>({status:200,headers:{},text:"{}"}));const oauth=createProjectOAuth(store,"https://programmable.market",transport);
  const start=await oauth.start(scope,id);await store.revoke(scope,id);
  await expect(oauth.complete("alice",new URL(start.url).searchParams.get("state")!,"code")).rejects.toMatchObject({code:"oauth-state"});expect(transport).not.toHaveBeenCalled();
 });
});
