import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import {createPlatformStore} from "../lib/custom-ai/platform/project-store.server";
import {createPlatformLaunchDrafts} from "../lib/custom-ai/platform/launch-draft.server";
import {PROJECT_PLATFORM_SCHEMA} from "../lib/custom-ai/platform/schema.generated";
import {CUSTOM_AI_SCHEMA,type AIPool} from "../lib/custom-ai/store.server";
let db:PGlite,pool:AIPool,projects:ReturnType<typeof createPlatformStore>,drafts:ReturnType<typeof createPlatformLaunchDrafts>,revisionId:string;
const scope={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"},account=`0x${"a".repeat(40)}`;
beforeEach(async()=>{db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();pool={connect:async()=>{const previous=tail;let release!:()=>void;tail=new Promise<void>(done=>{release=done;});await previous;return{query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};}};projects=createPlatformStore(pool);const first=await projects.createProject(scope);revisionId=(await projects.applyProjectPatch({...scope,expectedRevisionId:first.revisionId,idempotencyKey:"contract",patch:{architecture:{kind:"contract",chainId:1}}})).revisionId;drafts=createPlatformLaunchDrafts(pool);});
afterEach(()=>db.close());
it("keeps launch settings separate from source and bound to owner, wallet and revision",async()=>{
 const initial=await drafts.read(scope,account);expect(initial.revision).toBe(0);
 const saved=await drafts.save(scope,{account,expectedRevision:0,sourceRevision:revisionId,settings:{name:"Counter",symbol:"CNT"}});
 expect(saved.revision).toBe(1);expect((await projects.readProject(scope)).revisionId).toBe(revisionId);
 expect((await drafts.save(scope,{account,expectedRevision:1,sourceRevision:revisionId,settings:{name:"Counter",symbol:"CNT"}})).revision).toBe(1);
 await expect(drafts.read({...scope,ownerId:"bob"},account)).rejects.toMatchObject({code:"project-missing"});
 expect((await drafts.read(scope,`0x${"b".repeat(40)}`)).revision).toBe(0);
 await expect(drafts.save(scope,{account,expectedRevision:0,sourceRevision:revisionId,settings:{name:"Stale"}})).rejects.toMatchObject({code:"launch-draft-conflict"});
});
it("rejects a changed source or foreign image without altering the saved launch details",async()=>{
 const next=await projects.applyProjectPatch({...scope,expectedRevisionId:revisionId,idempotencyKey:"next",patch:{title:"Changed"}});
 await expect(drafts.save(scope,{account,expectedRevision:0,sourceRevision:revisionId,settings:{name:"Stale"}})).rejects.toMatchObject({code:"launch-source-changed"});
 await expect(drafts.save(scope,{account,expectedRevision:0,sourceRevision:next.revisionId,settings:{name:"Valid"},imageId:"a".repeat(64)})).rejects.toMatchObject({code:"launch-image"});
 expect((await drafts.read(scope,account)).revision).toBe(0);
});

it.each([8453,999,99901])("saves launch details on the project's supported chain (%i)",async chainId=>{
 const current=await projects.applyProjectPatch({...scope,expectedRevisionId:revisionId,idempotencyKey:`chain-${chainId}`,patch:{architecture:{kind:"contract",chainId}}});
 const initial=await drafts.read(scope,account);expect(initial.settings.chainId).toBe(chainId);
 expect(initial.settings.pairToken).toBe(chainId===8453?"ETH":"HYPE");
 expect(initial.settings.initialBuy).toBe(chainId===8453?"0.01":"");
 const saved=await drafts.save(scope,{account,expectedRevision:0,sourceRevision:current.revisionId,settings:{name:"Counter",symbol:"CNT",chainId}});
 expect(saved.settings.chainId).toBe(chainId);
 await expect(drafts.save(scope,{account,expectedRevision:1,sourceRevision:current.revisionId,settings:{chainId:1}})).rejects.toMatchObject({code:"launch-chain"});
 expect((await drafts.read(scope,account)).settings.chainId).toBe(chainId);
});
