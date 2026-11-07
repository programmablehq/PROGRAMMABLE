import {randomBytes} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {createProjectSecretBox} from "../lib/custom-ai/platform/secrets.server";
import {createRuntimeDataStore} from "../lib/custom-ai/platform/runtime-data.server";
import {createProjectReleases,type HostingProvider} from "../lib/custom-ai/platform/releases.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import type {AIPool} from "../lib/custom-ai/store.server";
import type {ProjectRevision} from "../lib/custom-ai/platform/types";
let db:PGlite,pool:AIPool,projects:ReturnType<typeof createPlatformStore>,data:ReturnType<typeof createRuntimeDataStore>,revisionId:string;
const scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"};
beforeEach(async()=>{db=new PGlite();await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();pool={connect:async()=>{const old=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});await old;return {query:(s,v)=>db.query<Record<string,unknown>>(s,v),release}}};projects=createPlatformStore(pool);data=createRuntimeDataStore(pool,createProjectSecretBox({active:"one",keys:{one:randomBytes(32)}}));const first=await projects.createProject(scope);revisionId=(await projects.applyProjectPatch({...scope,expectedRevisionId:first.revisionId,idempotencyKey:"source",patch:{requirements:[{id:"page",text:"Shows a page",kind:"behavior",open:null,origin:{kind:"legacy"}}],files:{"index.html":"<h1>Page</h1>"},architecture:{application:{framework:"static",dataVersion:1}}}})).revisionId;});
afterEach(async()=>{await db.close()});
function provider(){return {ensureProject:vi.fn<HostingProvider["ensureProject"]>(async()=>({id:"prj_test",name:"programmable-test"})),deploy:vi.fn<HostingProvider["deploy"]>(async()=>({id:"dpl_test",url:"https://test.vercel.app"})),inspect:vi.fn<HostingProvider["inspect"]>(async()=>({state:"READY",url:"https://test.vercel.app"})),probe:vi.fn(async()=>true),promote:vi.fn(async()=>undefined),pause:vi.fn(async()=>undefined),resume:vi.fn(async()=>undefined),findDeployment:vi.fn(async()=>null)} satisfies HostingProvider;}
describe("source-bound app releases",()=>{
 it("recovers queued work after a restart and returns the receipt after later edits",async()=>{
  const host=provider(),deps={projects,data,provider:host,assess:async()=>({verified:true,evidence:[]}),pack:async()=>({files:{".vercel/output/config.json":'{"version":3}'},artifactHash:"sha256:prebuilt-fixture"}),platformOrigin:"https://programmable.market"};
  const first=await createProjectReleases(pool,deps).queue(scope,{revisionId,idempotencyKey:"durable",mode:"preview"});
  expect(first.state).toBe("queued");expect(host.deploy).not.toHaveBeenCalled();
  const restarted=createProjectReleases(pool,deps);await restarted.processPending();expect(host.deploy).toHaveBeenCalledOnce();
  await projects.applyProjectPatch({...scope,expectedRevisionId:revisionId,idempotencyKey:"later",patch:{title:"Later edit"}});
  expect((await restarted.publish(scope,{revisionId,idempotencyKey:"durable",mode:"preview"})).id).toBe(first.id);
 });
 it("reconciles an uncertain deployment without deploying again",async()=>{
  const host=provider();host.deploy.mockRejectedValueOnce(new Error("response lost"));
  const deps={projects,data,provider:host,assess:async()=>({verified:true,evidence:[]}),pack:async()=>({files:{".vercel/output/config.json":'{"version":3}'},artifactHash:"sha256:prebuilt-fixture"}),platformOrigin:"https://programmable.market"};
  const releases=createProjectReleases(pool,deps),first=await releases.publish(scope,{revisionId,idempotencyKey:"uncertain",mode:"preview"});
  expect(first.state).toBe("reconcile");host.findDeployment.mockResolvedValueOnce({id:"dpl_test",url:"https://test.vercel.app"} as never);
  expect((await releases.refresh(scope,first.id)).state).toBe("ready");expect(host.deploy).toHaveBeenCalledOnce();
 });
 it("blocks deployment until every requirement is verified",async()=>{
  const host=provider(),releases=createProjectReleases(pool,{projects,data,provider:host,assess:async()=>({verified:false,evidence:[]}),pack:async revision=>({files:revision.document.files,artifactHash:"sha256:prebuilt-fixture"}),platformOrigin:"https://programmable.market"});
  await expect(releases.publish(scope,{revisionId,idempotencyKey:"release",mode:"preview"})).rejects.toMatchObject({code:"release-unverified"});expect(host.deploy).not.toHaveBeenCalled();
 });
 it("puts only app credentials in the runtime environment and preserves one deployment per request",async()=>{
  const host=provider(),releases=createProjectReleases(pool,{projects,data,provider:host,assess:async()=>({verified:true,evidence:[{id:"proof"}]}),pack:async revision=>({files:revision.document.files,artifactHash:"sha256:prebuilt-fixture"}),platformOrigin:"https://programmable.market"});
  const first=await releases.publish(scope,{revisionId,idempotencyKey:"release",mode:"preview"});const again=await releases.publish(scope,{revisionId,idempotencyKey:"release",mode:"preview"});
  expect(again.id).toBe(first.id);expect(host.deploy).toHaveBeenCalledOnce();
  const deployment=host.deploy.mock.calls[0][0];expect(deployment.env.PROGRAMMABLE_APP_TOKEN).toMatch(/^pp1_/);
  expect(JSON.stringify(deployment.files)).not.toContain(deployment.env.PROGRAMMABLE_APP_TOKEN);
  expect(deployment.revisionId).toBe(revisionId);
  expect(first.state).toBe("building");expect((await releases.refresh(scope,first.id)).state).toBe("ready");
  expect(host.promote).not.toHaveBeenCalled();
 });
 it("keeps data across pause/resume and rejects promotion after a source change",async()=>{
  const host=provider(),releases=createProjectReleases(pool,{projects,data,provider:host,assess:async()=>({verified:true,evidence:[]}),pack:async revision=>({files:revision.document.files,artifactHash:"sha256:prebuilt-fixture"}),platformOrigin:"https://programmable.market"});
  const release=await releases.publish(scope,{revisionId,idempotencyKey:"release",mode:"preview"});await releases.refresh(scope,release.id);await releases.promote(scope,release.id);
  const token=host.deploy.mock.calls[0][0].env.PROGRAMMABLE_APP_TOKEN;await data.invoke(token,{op:"put",collection:"scores",key:"one",value:3,idempotencyKey:"data"});
  await releases.setActive(scope,release.id,false);await expect(data.invoke(token,{op:"get",collection:"scores",key:"one"})).rejects.toMatchObject({code:"app-stopped"});
  await releases.setActive(scope,release.id,true);expect(await data.invoke(token,{op:"get",collection:"scores",key:"one"})).toEqual({value:3,version:1});
  await projects.applyProjectPatch({...scope,expectedRevisionId:revisionId,idempotencyKey:"edit",patch:{title:"New source"}});
  await expect(releases.promote(scope,release.id)).rejects.toMatchObject({code:"release-stale"});
 });
 it("serializes competing promotions before changing the provider target or live data key",async()=>{
  const host=provider();let unblock!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{unblock=resolve});
  host.deploy.mockResolvedValueOnce({id:"dpl_first",url:"https://first.vercel.app"}).mockResolvedValueOnce({id:"dpl_second",url:"https://second.vercel.app"});
  const releases=createProjectReleases(pool,{projects,data,provider:host,assess:async()=>({verified:true,evidence:[]}),pack:async revision=>({files:revision.document.files,artifactHash:"sha256:prebuilt-fixture"}),platformOrigin:"https://programmable.market"});
  const first=await releases.publish(scope,{revisionId,idempotencyKey:"first",mode:"preview"}),second=await releases.publish(scope,{revisionId,idempotencyKey:"second",mode:"preview"});
  await releases.refresh(scope,first.id);await releases.refresh(scope,second.id);
  host.promote.mockImplementationOnce(async()=>{entered();await gate;});
  const promotion= releases.promote(scope,first.id);await started;
  try{await expect(releases.promote(scope,second.id)).rejects.toMatchObject({code:"release-control-busy"});expect(host.promote).toHaveBeenCalledTimes(1);}finally{unblock();await promotion;}
  await releases.promote(scope,second.id);
  const oldToken=host.deploy.mock.calls[0][0].env.PROGRAMMABLE_APP_TOKEN,newToken=host.deploy.mock.calls[1][0].env.PROGRAMMABLE_APP_TOKEN;
  await expect(data.authenticate(oldToken)).rejects.toMatchObject({code:"app-stopped"});
  expect((await data.authenticate(newToken)).namespace).toBe("production");
  expect((await db.query<{active_release:string}>("SELECT active_release FROM programmable_projects_v1.app_hosts")).rows[0].active_release).toBe(second.id);
 });
 it("closes live data access and preserves an uncertain promotion for explicit recovery",async()=>{
  const host=provider(),releases=createProjectReleases(pool,{projects,data,provider:host,assess:async()=>({verified:true,evidence:[]}),pack:async revision=>({files:revision.document.files,artifactHash:"sha256:prebuilt-fixture"}),platformOrigin:"https://programmable.market"});
  const first=await releases.publish(scope,{revisionId,idempotencyKey:"first",mode:"preview"});await releases.refresh(scope,first.id);await releases.promote(scope,first.id);
  const token=host.deploy.mock.calls[0][0].env.PROGRAMMABLE_APP_TOKEN;
  const next=await releases.publish(scope,{revisionId,idempotencyKey:"next",mode:"preview"});await releases.refresh(scope,next.id);
  host.promote.mockRejectedValueOnce(new Error("Provider response lost"));
  await expect(releases.promote(scope,next.id)).rejects.toMatchObject({code:"release-control-unknown"});
  expect(await releases.read(scope,next.id)).toMatchObject({state:"reconcile",errorCode:"release-control-unknown"});
  await expect(data.authenticate(token)).rejects.toMatchObject({code:"app-stopped"});
  expect((await releases.refresh(scope,next.id)).state).toBe("reconcile");await releases.promote(scope,next.id);
  expect(await releases.read(scope,next.id)).toMatchObject({state:"published",errorCode:null});
 });
 it("recovers a crashed control worker and fences its late completion",async()=>{
  let clock=Date.now(),unblock!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{unblock=resolve}),started=new Promise<void>(resolve=>{entered=resolve}),host=provider();
  const deps={projects,data,provider:host,assess:async()=>({verified:true,evidence:[]}),pack:async(revision:ProjectRevision)=>({files:revision.document.files,artifactHash:"sha256:prebuilt-fixture"}),platformOrigin:"https://programmable.market"};
  const releases=createProjectReleases(pool,deps,()=>clock),release=await releases.publish(scope,{revisionId,idempotencyKey:"release",mode:"preview"});await releases.refresh(scope,release.id);
  host.promote.mockImplementationOnce(async()=>{entered();await gate;});
  const stale=releases.promote(scope,release.id).catch(error=>error);await started;
  expect((await releases.refresh(scope,release.id)).state).toBe("reconcile");
  clock+=180001;
  const restarted=createProjectReleases(pool,deps,()=>clock);expect((await restarted.processPending()).controls).toEqual({recovered:1,failed:0});
  unblock();expect(await stale).toMatchObject({code:"release-control-lease"});
  expect(await restarted.read(scope,release.id)).toMatchObject({state:"published",errorCode:null});
  expect(host.promote).toHaveBeenCalledTimes(2);expect(host.promote.mock.calls[0]).toEqual(host.promote.mock.calls[1]);
  expect(host.resume).toHaveBeenCalledTimes(1);
 });
 it("stops automatic control recovery after three failed provider attempts",async()=>{
  let clock=Date.now();const host=provider();
  const releases=createProjectReleases(pool,{projects,data,provider:host,assess:async()=>({verified:true,evidence:[]}),pack:async revision=>({files:revision.document.files,artifactHash:"sha256:prebuilt-fixture"}),platformOrigin:"https://programmable.market"},()=>clock);
  const release=await releases.publish(scope,{revisionId,idempotencyKey:"release",mode:"preview"});await releases.refresh(scope,release.id);
  host.promote.mockRejectedValue(new Error("Provider unavailable"));await expect(releases.promote(scope,release.id)).rejects.toMatchObject({code:"release-control-unknown"});
  for(let n=0;n<4;n++){clock+=30001;await releases.processPending();}
  expect(host.promote).toHaveBeenCalledTimes(3);expect(await releases.read(scope,release.id)).toMatchObject({state:"reconcile"});
  expect((await db.query("SELECT * FROM programmable_projects_v1.app_control_queue")).rows).toHaveLength(0);
 });
});
