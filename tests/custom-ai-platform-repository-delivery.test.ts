import {createHash} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
vi.mock('server-only',()=>({}));
import {createRepositoryDelivery} from '../lib/custom-ai/platform/repository-delivery.server';
import {createPlatformStore} from '../lib/custom-ai/platform/project-store.server';
import {PROJECT_PLATFORM_SCHEMA} from '../lib/custom-ai/platform/schema.generated';
import type {AIPool} from '../lib/custom-ai/store.server';
import type {RepositoryClient} from '../lib/custom-ai/platform/repository-import.server';
let db:PGlite,pool:AIPool,projects:ReturnType<typeof createPlatformStore>,revisionId:string;
const scope={ownerId:'alice',projectId:'11111111-1111-4111-8111-111111111111'},base='a'.repeat(40),tree='b'.repeat(40),commit='c'.repeat(40),content='console.log("hello")\n';
const sha=(bytes:Buffer)=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
beforeEach(async()=>{
 db=new PGlite();await db.exec(PROJECT_PLATFORM_SCHEMA);let tail=Promise.resolve();pool={connect:async()=>{const old=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r});await old;return {query:(s,v)=>db.query<Record<string,unknown>>(s,v),release};}};
 projects=createPlatformStore(pool);const initial=await projects.createProject(scope);revisionId=(await projects.applyProjectPatch({...scope,expectedRevisionId:initial.revisionId,idempotencyKey:'code',patch:{files:{'index.js':content}}})).revisionId;
});
afterEach(async()=>{await db.close()});
function repository(uncertain=false){
 let branch:string|undefined,pr:unknown;const post=vi.fn<NonNullable<RepositoryClient['post']>>(async(path,body)=>{
  const input=body as Record<string,unknown>;
  if(path.endsWith('/git/blobs'))return {sha:sha(Buffer.from(String(input.content),'base64'))};
  if(path.endsWith('/git/trees'))return {sha:tree};if(path.endsWith('/git/commits'))return {sha:commit};
  if(path.endsWith('/git/refs')){branch=String(input.ref);if(uncertain){uncertain=false;throw Error('response lost');}return {ref:branch,object:{sha:commit}};}
  if(path.endsWith('/pulls'))return pr={html_url:'https://github.com/example/project/pull/1',number:1,head:{ref:branch!.replace('refs/heads/',''),sha:commit},base:{ref:'main'}};
  throw Error('Unexpected write');
 });
 const get=vi.fn<RepositoryClient['get']>(async path=>{
  if(path==='/repos/example/project')return {default_branch:'main'};
  if(path.endsWith('/commits/main'))return {sha:base,commit:{tree:{sha:'d'.repeat(40)}}};
  if(path.includes('/git/ref/heads/'))return branch?{ref:branch,object:{sha:commit}}:null;
  if(path.includes('/git/trees/'))return {sha:tree,truncated:false,tree:[{path:'index.js',type:'blob',mode:'100644',sha:sha(Buffer.from(content)),size:Buffer.byteLength(content)}]};
  if(path.includes('/pulls?'))return pr?[pr]:[];return null;
 });return {get,post};
}
it('writes one separate branch and draft PR for an immutable project export',async()=>{
 const client=repository(),delivery=createRepositoryDelivery(pool,projects,async()=>client),input={repository:'example/project',revisionId,idempotencyKey:'deliver',connectionId:'github',connectionVersion:'one'};
 const first=await delivery.deliver(scope,input),again=await delivery.deliver(scope,input);expect(first.state).toBe('complete');expect(again.id).toBe(first.id);expect(first.url).toBe('https://github.com/example/project/pull/1');
 expect(client.post.mock.calls.filter(([path])=>path.endsWith('/git/refs'))).toHaveLength(1);expect(client.post.mock.calls.filter(([path])=>path.endsWith('/pulls'))).toHaveLength(1);
 const ref=client.post.mock.calls.find(([path])=>path.endsWith('/git/refs'))![1] as {ref:string};expect(ref.ref).toMatch(/^refs\/heads\/programmable\//);expect(ref.ref).not.toBe('refs/heads/main');
});
it('reconciles an accepted branch after a lost response without writing it again',async()=>{
 const client=repository(true),delivery=createRepositoryDelivery(pool,projects,async()=>client),input={repository:'example/project',revisionId,idempotencyKey:'uncertain',connectionId:'github',connectionVersion:'one'};
 expect((await delivery.deliver(scope,input)).state).toBe('reconcile');expect((await delivery.deliver(scope,input)).state).toBe('complete');
 expect((await delivery.list(scope))[0].request).toEqual(input);
 expect(client.post.mock.calls.filter(([path])=>path.endsWith('/git/refs'))).toHaveLength(1);
});
