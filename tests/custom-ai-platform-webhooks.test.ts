import {createHmac,randomBytes} from "node:crypto";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {createConnectionStore} from "../lib/custom-ai/platform/connections.server";
import {createProjectWebhooks} from "../lib/custom-ai/platform/webhooks.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import type {AIPool} from "../lib/custom-ai/store.server";
let db:PGlite,webhooks:ReturnType<typeof createProjectWebhooks>,connections:ReturnType<typeof createConnectionStore>;
const scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"},id="22222222-2222-4222-8222-222222222222";
beforeEach(async()=>{db=new PGlite();await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();const pool:AIPool={connect:async()=>{const old=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});await old;return {query:(s,v)=>db.query<Record<string,unknown>>(s,v),release}}};await createPlatformStore(pool).createProject(scope);connections=createConnectionStore(pool,{active:"one",keys:{one:randomBytes(32)}});await connections.saveConnection(scope,{id,manifest:{kind:"http",name:"Events",baseUrl:"https://api.scores.com",auth:{kind:"none"},actions:[]},allowedActions:[]});webhooks=createProjectWebhooks(pool,connections);});
afterEach(async()=>{await db.close()});
it("authenticates and deduplicates signed events; revocation stops intake",async()=>{
 const route=await webhooks.create(scope,id),timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify({player:"alice",score:3});
 const signature=createHmac("sha256",route.secret).update(JSON.stringify(["programmable-webhook-v1",route.id,"win-one",timestamp,body])).digest("hex");
 const input={routeId:route.id,eventId:"win-one",timestamp,signature,body};
 await expect(webhooks.ingest({...input,signature:"0".repeat(64)})).rejects.toMatchObject({code:"webhook-signature"});
 expect(await webhooks.ingest(input)).toMatchObject({duplicate:false});expect(await webhooks.ingest(input)).toMatchObject({duplicate:true});
 await expect(webhooks.ingest({...input,eventId:"changed-event"})).rejects.toMatchObject({code:"webhook-signature"});
 await expect(webhooks.ingest({...input,body:JSON.stringify({player:"alice",score:99})})).rejects.toMatchObject({code:"webhook-signature"});
 await expect(webhooks.ingest({...input,timestamp:String(Number(timestamp)-1000)})).rejects.toMatchObject({code:"webhook-signature"});
 expect((await webhooks.list(scope,id)).events).toHaveLength(1);
 await connections.revoke(scope,id);await expect(webhooks.ingest({...input,eventId:"win-two"})).rejects.toMatchObject({code:"connection-revoked"});
});
it("binds the route as well as the event ID, including two routes with the same connection key",async()=>{
 const first=await webhooks.create(scope,id),second=await webhooks.create(scope,id),timestamp=String(Math.floor(Date.now()/1000)),body="{}";
 const input={routeId:first.id,eventId:"shared-event",timestamp,body,signature:createHmac("sha256",second.secret).update(JSON.stringify(["programmable-webhook-v1",first.id,"shared-event",timestamp,body])).digest("hex")};
 expect(await webhooks.ingest(input)).toMatchObject({duplicate:false});
 await expect(webhooks.ingest({...input,routeId:second.id})).rejects.toMatchObject({code:"webhook-signature"});
});
it("bounds retained webhook events per owner while preserving duplicate receipts",async()=>{
 const route=await webhooks.create(scope,id),timestamp=String(Math.floor(Date.now()/1000)),body="{}";
 await db.query("INSERT INTO programmable_projects_v1.webhook_inbox(owner,project_id,connection_id,event_id,body_hash,payload,received_at) SELECT $1,$2,$3,'saved-'||n,$4,'{}'::jsonb,$5 FROM generate_series(1,5000) n",[scope.ownerId,scope.projectId,id,"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",new Date(Date.now()-3600000).toISOString()]);
 const input=(eventId:string)=>({routeId:route.id,eventId,timestamp,body,signature:createHmac("sha256",route.secret).update(JSON.stringify(["programmable-webhook-v1",route.id,eventId,timestamp,body])).digest("hex")});
 await expect(webhooks.ingest(input("new-event"))).rejects.toMatchObject({code:"webhook-quota",status:429});
 await expect(webhooks.ingest(input("saved-1"))).resolves.toMatchObject({duplicate:true});
});
it("bounds retained webhook bytes across connections",async()=>{
 await webhooks.create(scope,id);const timestamp=String(Math.floor(Date.now()/1000)),body="{}";
 await db.query("INSERT INTO programmable_projects_v1.webhook_inbox(owner,project_id,connection_id,event_id,body_hash,payload,received_at) SELECT $1,$2,$3,'saved-'||n,'hash',jsonb_build_object('data',repeat('x',125000)),$4 FROM generate_series(1,256) n",[scope.ownerId,scope.projectId,id,new Date(Date.now()-3600000).toISOString()]);
 const other=await webhooks.create(scope,id);
 const input={routeId:other.id,eventId:"new-event",timestamp,body,signature:createHmac("sha256",other.secret).update(JSON.stringify(["programmable-webhook-v1",other.id,"new-event",timestamp,body])).digest("hex")};
 await expect(webhooks.ingest(input)).rejects.toMatchObject({code:"webhook-quota",status:429});
});
