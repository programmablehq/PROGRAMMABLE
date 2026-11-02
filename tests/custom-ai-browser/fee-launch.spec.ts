import {once} from "node:events";
import type {Server} from "node:http";
import {expect,test,type Page} from "@playwright/test";
// @ts-expect-error The isolated renderer is a JavaScript host.
import {createFeeLaunchServer} from "./fee-launch-server.mjs";
let server:Server,origin:string;
test.beforeAll(async()=>{server=await createFeeLaunchServer();server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==='string')throw Error('Missing fixture');origin=`http://127.0.0.1:${address.port}`;});
test.afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});

async function fixture(page:Page){
  const saved={revision:1,session:{id:'fee-launch-request-0001',account:'0x'+'1'.repeat(40),chainId:1,draftId:'saved-fee-source-0001',sourceHash:'a'.repeat(64),
    settings:{name:'Fee fixture',symbol:'FEE',quote:'0x'+'0'.repeat(40),imageURI:'/image.svg',initialBuy:'0.01'},state:'ready',steps:[{id:'fee-step-1',kind:'module',state:'prepared',transaction:{from:'0x'+'1'.repeat(40),to:'0x'+'2'.repeat(40),data:'0x1234',value:'0x0',chainId:1,nonce:'0x0',gas:'0x10000'},expiresAt:Date.now()+60000}]}};
  const control={posts:[] as {action:string}[],wallet:0,reads:0,saved:undefined as undefined|typeof saved,read:undefined as undefined|(()=>Promise<void>),errors:[] as string[],ready:saved};
  page.on('pageerror',error=>control.errors.push(error.message));
  await page.route('**/fixture-wallet',async route=>{control.wallet++;saved.session.state='waiting';saved.session.steps[0].state='submitted';await route.fulfill({json:{hash:'0x'+'c'.repeat(64)}});});
  await page.route('**/api/custom-ai/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/api/custom-ai/readiness')return route.fulfill({json:{state:'ready',message:'Launch prepared',revision:'a'.repeat(64),expiresAt:Date.now()+60000,ticket:'local-ticket'}});
    if(path!=='/api/custom-ai/launch')return route.fulfill({status:404,json:{error:'Unexpected test request'}});
    if(request.method()==='GET'){control.reads++;await control.read?.();return route.fulfill({json:control.saved??null});}
    const body=request.postDataJSON();control.posts.push(body);control.saved=saved;await route.fulfill({json:saved});
  });
  return control;
}

test('a chat launch prepares once and waits for the explicit wallet button',async({page})=>{
  const f=await fixture(page);await page.goto(origin);
  await page.getByRole('button',{name:'Ask to launch in chat'}).click();
  await expect(page.getByRole('button',{name:'Continue in wallet',exact:true})).toBeVisible();
  expect(f.posts.map(p=>p.action)).toEqual(['create']);expect(f.wallet).toBe(0);
  await page.getByRole('button',{name:'Ask to launch in chat'}).click();expect(f.posts).toHaveLength(1);
  await page.getByRole('button',{name:'Continue in wallet',exact:true}).click();
  await expect(page.getByText('Waiting for the transaction to confirm.',{exact:true})).toBeVisible();
  expect(f.wallet).toBe(1);expect(f.posts.map(p=>p.action)).toEqual(['create','next','next']);expect(f.errors).toEqual([]);
});

test('a stale chat command never prepares a different draft',async({page})=>{
  const f=await fixture(page);await page.goto(origin);
  await page.getByRole('button',{name:'Stale launch request'}).click();
  await expect(page.getByRole('button',{name:'Launch coin',exact:true})).toBeVisible();
  expect(f.posts).toEqual([]);expect(f.wallet).toBe(0);expect(f.errors).toEqual([]);
});

test('a late restore retains the existing launch without creating or sending another',async({page})=>{
  const f=await fixture(page);let release=()=>{};f.saved=f.ready;f.read=()=>new Promise<void>(resolve=>{release=resolve;});
  await page.goto(origin);await expect.poll(()=>f.reads).toBe(1);await page.getByRole('button',{name:'Ask to launch in chat'}).click();
  expect(f.posts).toEqual([]);release();
  await expect(page.getByRole('button',{name:'Continue in wallet',exact:true})).toBeVisible();
  expect(f.posts).toEqual([]);expect(f.wallet).toBe(0);expect(f.errors).toEqual([]);
});

test('a missing coin name opens the editor instead of preparing a wallet request',async({page})=>{
  const f=await fixture(page);await page.goto(origin+'/?missing-name');
  await page.getByRole('button',{name:'Ask to launch in chat'}).click();
  await expect(page.getByRole('textbox',{name:'Name',exact:true})).toBeFocused();
  expect(f.posts).toEqual([]);expect(f.wallet).toBe(0);expect(f.errors).toEqual([]);
});
