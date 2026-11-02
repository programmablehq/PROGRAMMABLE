import {once} from "node:events";
import type {Server} from "node:http";
import {expect,test,type Page} from "@playwright/test";
// @ts-expect-error The isolated renderer is a JavaScript host.
import {createGeneralLaunchServer} from "./general-launch-server.mjs";
import type {GeneralPreparationView} from "../../lib/custom-ai/general-preparation";
import type {CoinSetup} from "../../lib/custom-ai/coin-setup";
let server:Server,origin:string;
test.beforeAll(async()=>{server=await createGeneralLaunchServer();server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==="string")throw Error("Missing local renderer");origin=`http://127.0.0.1:${address.port}`;});
test.afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});

test('Plan source verification remains confirmed and stops automatic status reads',async({page})=>{
 const f=await fixture(page);f.currentStatus='source_verified';await page.clock.install();await page.goto(origin+'/?chain=4663');
 await page.getByLabel('Launch wallet type').selectOption('eoa');await page.getByRole('button',{name:'Submit for review',exact:true}).click();
 await expect(page.getByText('Your launch transactions are confirmed.',{exact:false})).toBeVisible();
 expect(f.statusReads).toBe(1);await page.clock.runFor(150000);expect(f.statusReads).toBe(1);
 expect(f.posts.map(value=>value.action)).toEqual(['prepare','prepare','create']);expect(f.errors).toEqual([]);
});
async function fixture(page:Page){
 const control={saved:null as GeneralPreparationView|null,posts:[] as {action:string;id:string;selection?:Record<string,unknown>}[],saves:[] as {settings:CoinSetup;image:{id:string}}[],reads:0,statusReads:0,currentStatus:"pending_review",statusFailure:false,lostCreate:false,beforePrepare:undefined as undefined|(()=>Promise<void>),beforeRead:undefined as undefined|(()=>Promise<void>),beforeStatus:undefined as undefined|(()=>Promise<void>),errors:[] as string[]};
 page.on('pageerror',error=>control.errors.push(error.message));
 await page.route('**/fixture-studio',async route=>{control.saves.push(route.request().postDataJSON());await route.fulfill({json:{revision:33}});});
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname!=="/api/custom-ai/general-launch")throw Error("Unexpected API call: "+url.pathname);
  if(request.method()==="GET"){
   if(url.searchParams.get('view')==='status'){
    control.statusReads++;await control.beforeStatus?.();if(control.statusFailure)return route.fulfill({status:503,json:{error:'Status unavailable'}});
    const saved=control.saved!;expect(url.searchParams.get('id')).toBe(saved.id);
    return route.fulfill({json:{status:{schemaVersion:'programmable.wallet-launch-status.v1',kind:saved.chainId===4663?'plan-v1':'graph-v3',chainId:String(saved.chainId),
     resourceId:saved.submission!.resourceId,controller:saved.account,requestHash:saved.requestHash,rawRequestSha256:saved.chainId===4663?`sha256:${'b'.repeat(64)}`:null,
     status:control.currentStatus,errorCode:null,createdAt:new Date(saved.createdAt).toISOString(),updatedAt:new Date(saved.updatedAt).toISOString(),checkedAt:new Date().toISOString(),deadline:String(saved.expiresAt/1000),launchReady:false}}});
   }
   control.reads++;await control.beforeRead?.();const account=url.searchParams.get('account');
   return route.fulfill({json:{preparation:account&&control.saved?.account.toLowerCase()!==account.toLowerCase()?null:control.saved}});
  }
  const body=request.postDataJSON();control.posts.push(body);
  if(body.action==="prepare"){
   const selected=body.selection,studio=control.saves.at(-1)!;
   expect(selected.studioRevision).toBe(33);
   if(selected.chainId===4663)expect(body.controllerKind).toBe("eoa");else expect(body.controllerKind).toBeUndefined();
   control.saved={version:1,id:"general-client-ticket-0001",account:selected.account,chainId:selected.chainId,sourceId:selected.id,conversationId:selected.conversation,
    projectHash:selected.projectHash,artifactHash:selected.artifactHash,coin:{name:studio.settings.name,symbol:studio.settings.symbol},editor:{settings:studio.settings,imageId:studio.image.id},packState:"complete",requestHash:selected.projectHash,createdAt:Date.now(),updatedAt:Date.now(),expiresAt:(Math.floor(Date.now()/1000)+1800)*1000,launchReady:false};
   await control.beforePrepare?.();return route.fulfill({json:{preparation:control.saved}});
  }
  expect(body).toEqual({action:"create",id:control.saved!.id});
  if(control.lostCreate){control.lostCreate=false;control.saved!.submission={state:"unknown"};return route.abort('failed');}
  control.saved!.submission={state:"completed",resourceId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",backendState:"pending_review",httpStatus:201};
  return route.fulfill({json:{preparation:control.saved}});
 });return control;
}

for(const chainId of [1,4663,8453,999])test(`one explicit submission on chain ${chainId} survives reload without another POST`,async({page})=>{
 const f=await fixture(page);await page.goto(origin+`/?chain=${chainId}`);
 const region=page.getByRole('region',{name:'Launch submission'}),button=region.getByRole('button',{name:'Submit for review'});
 if(chainId===4663){const wallet=region.getByLabel('Launch wallet type');await wallet.selectOption('smart');await expect(button).toBeDisabled();await wallet.selectOption('eoa');}
 await expect(button).toBeEnabled();await expect(region.getByText('Submitting publishes this contract’s source.',{exact:false})).toBeVisible();
 await button.evaluate(element=>{(element as HTMLButtonElement).click();(element as HTMLButtonElement).click();});
 await expect(region.getByRole('link',{name:'Open submission',exact:true})).toBeVisible();
 expect(f.posts.map(body=>body.action)).toEqual(['prepare','prepare','create']);expect(f.saves).toHaveLength(2);
 await page.reload();await expect(page.getByRole('link',{name:'Open submission',exact:true})).toBeVisible();
 expect(f.posts).toHaveLength(3);expect(f.errors).toEqual([]);await expect(page.getByLabel('Chat editing')).toHaveText('Available');
});

test('the first missing detail opens and focuses its editor without any POST',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/?missing=description');
 await page.getByRole('button',{name:'Add description',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Public description',exact:true})).toBeFocused();expect(f.posts).toEqual([]);expect(f.saves).toEqual([]);
});
test('unknown create recovers the original coin after the current draft changes',async({page})=>{
 const f=await fixture(page);f.lostCreate=true;await page.goto(origin);
 await page.getByRole('button',{name:'Submit for review',exact:true}).click();await expect(page.getByRole('button',{name:'Recover submission',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Change sample coin'}).click();await expect(page.getByText(/Saved submission: Original coin on Ethereum/)).toBeVisible();
 await page.getByRole('button',{name:'Recover submission',exact:true}).click();
 await expect(page.getByRole('link',{name:'Open Original coin submission',exact:true})).toBeVisible();
 const submissions=f.posts.filter(body=>body.action==='create');expect(submissions).toHaveLength(2);
 expect(submissions[1]).toEqual(submissions[0]);expect(f.errors).toEqual([]);
});
test('a wallet switch cancels an in-flight preparation before create',async({page})=>{
 const f=await fixture(page);let release:()=>void=()=>{};f.beforePrepare=()=>f.posts.length===1?new Promise<void>(resolve=>{release=resolve;}):Promise.resolve();await page.goto(origin);
 await expect.poll(()=>f.posts.length).toBe(1);
 await page.getByRole('button',{name:'Switch sample wallet'}).click();release();
 await expect(page.getByRole('button',{name:'Submit for review',exact:true})).toBeEnabled();
 expect(f.posts.filter(body=>body.action==='create')).toEqual([]);await expect(page.getByRole('link',{name:'Open submission',exact:true})).toHaveCount(0);expect(f.errors).toEqual([]);
});
test('completed submission details stay distinct when the coin is edited',async({page})=>{
 const f=await fixture(page);await page.goto(origin);await page.getByRole('button',{name:'Submit for review',exact:true}).click();
 await expect(page.getByRole('link',{name:'Open submission',exact:true})).toBeVisible();await page.getByRole('button',{name:'Change sample coin'}).click();
 await expect(page.getByRole('button',{name:'Submit for review',exact:true})).toBeEnabled();
 await expect(page.getByRole('link',{name:'Open Original coin submission',exact:true})).toBeVisible();expect(f.posts.filter(body=>body.action==='create')).toHaveLength(1);
});
test('Robinhood wallet declarations are cleared on a wallet or private scope change',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/?chain=4663');
 const choice=page.getByLabel('Launch wallet type'),button=page.getByRole('button',{name:'Submit for review',exact:true});
 await choice.selectOption('eoa');await expect(button).toBeEnabled();
 await page.getByRole('button',{name:'Switch sample wallet'}).click();
 await expect(choice).toHaveValue('');await expect(button).toBeDisabled();expect(f.posts.map(body=>body.action)).toEqual(['prepare']);
});
test('disabled intake does no journal reads and exposes no submit control',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/?disabled=1');await expect(page.getByRole('heading',{name:'Original coin',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Launch submission'})).toHaveCount(0);expect(f.reads).toBe(0);expect(f.posts).toEqual([]);
});
test('a slow read of the saved journal does not lock chat or coin editing',async({page})=>{
 const f=await fixture(page);let release:()=>void=()=>{};f.beforeRead=()=>new Promise<void>(resolve=>{release=resolve;});
 await page.goto(origin);await expect.poll(()=>f.reads).toBe(1);
 await expect(page.getByLabel('Chat editing')).toHaveText('Available');
 await page.locator('summary').filter({hasText:'Coin details'}).click();await expect(page.getByRole('textbox',{name:'Name',exact:true})).toBeEnabled();
 release();await expect(page.getByRole('button',{name:'Submit for review',exact:true})).toBeEnabled();
 await expect.poll(()=>f.posts.map(body=>body.action)).toEqual(['prepare']);
});
test('current status updates the original accepted submission without repeating prepare or create',async({page})=>{
 const f=await fixture(page);await page.goto(origin);await page.getByRole('button',{name:'Submit for review',exact:true}).click();
 await expect(page.getByText('Your submission is waiting for review.',{exact:true})).toBeVisible();expect(f.statusReads).toBe(1);
 f.currentStatus='wallet_action_ready';await page.getByRole('button',{name:'Check current status'}).click();
 await expect(page.getByText('Your submission has wallet steps to review.',{exact:true})).toBeVisible();expect(f.posts.map(body=>body.action)).toEqual(['prepare','prepare','create']);
 await expect(page.getByLabel('Chat editing')).toHaveText('Available');expect(f.errors).toEqual([]);
});
test('a failed current-status read preserves the accepted link and can be checked explicitly',async({page})=>{
 await page.clock.install({time:new Date()});const f=await fixture(page);f.statusFailure=true;await page.goto(origin);await page.getByRole('button',{name:'Submit for review',exact:true}).click();
 await expect(page.getByText('The current status could not be refreshed. Your saved submission is still available.',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Open submission',exact:true})).toBeVisible();expect(f.posts).toHaveLength(3);
 await page.clock.fastForward(60000);expect(f.statusReads).toBe(1);
 f.statusFailure=false;await page.getByRole('button',{name:'Check current status'}).click();await expect(page.getByText('Your submission is waiting for review.',{exact:true})).toBeVisible();
 expect(f.posts).toHaveLength(3);expect(f.errors).toEqual([]);
});
test('status polling stops after twelve reads and does not catch up after laptop sleep',async({page})=>{
 // Keep the clock paused between explicit ticks, including asynchronous HTTP
 // completion. Real-time drift must not start a second interval mid-response.
 const start=new Date('2030-01-01T12:00:00Z');await page.clock.install({time:start});await page.clock.pauseAt(new Date(start.getTime()+1000));const f=await fixture(page);await page.goto(origin);await page.getByRole('button',{name:'Submit for review',exact:true}).click();
 await expect(page.getByText('Your submission is waiting for review.',{exact:true})).toBeVisible();expect(f.statusReads).toBe(1);
 for(let count=2;count<=12;count++){
  // A request reaching the route does not mean the browser has consumed it.
  // Alternate non-terminal states and await the rendered response before the
  // next clock tick, so a still-active read cannot consume a polling attempt.
  f.currentStatus=count%2===0?'wallet_action_ready':'pending_review';
  await page.clock.runFor(10000);
  await expect(page.getByText(count%2===0?'Your submission has wallet steps to review.':'Your submission is waiting for review.',{exact:true})).toBeVisible();
  expect(f.statusReads).toBe(count);
 }
 await page.clock.fastForward(3600000);expect(f.statusReads).toBe(12);expect(f.posts.map(body=>body.action)).toEqual(['prepare','prepare','create']);expect(f.errors).toEqual([]);
});
test('a terminal stored status stops background reads and keeps its original link',async({page})=>{
 await page.clock.install({time:new Date()});const f=await fixture(page);f.currentStatus='expired';await page.goto(origin);await page.getByRole('button',{name:'Submit for review',exact:true}).click();
 await expect(page.getByText('This submission expired. Open its details to continue.',{exact:true})).toBeVisible();
 await page.clock.fastForward(3600000);expect(f.statusReads).toBe(1);await expect(page.getByRole('link',{name:'Open submission',exact:true})).toBeVisible();expect(f.posts).toHaveLength(3);
});
test('a late status from the previous wallet cannot appear in the newly selected wallet',async({page})=>{
 const f=await fixture(page);let release:()=>void=()=>{};f.beforeStatus=()=>new Promise<void>(resolve=>{release=resolve;});
 await page.goto(origin);await page.getByRole('button',{name:'Submit for review',exact:true}).click();await expect.poll(()=>f.statusReads).toBe(1);
 await page.getByRole('button',{name:'Switch sample wallet'}).click();release();
 await expect(page.getByRole('button',{name:'Submit for review',exact:true})).toBeEnabled();
 await expect(page.getByRole('link',{name:'Open submission',exact:true})).toHaveCount(0);
 await expect(page.getByText('Your submission is waiting for review.',{exact:true})).toHaveCount(0);expect(f.posts.filter(body=>body.action==='create')).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const width of [360,1440])test(`submission controls render and remain keyboard accessible at ${width}px`,async({page},testInfo)=>{
 const f=await fixture(page);await page.setViewportSize({width,height:1000});await page.goto(origin);
 const button=page.getByRole('button',{name:'Submit for review',exact:true});await expect(button).toBeEnabled();await button.focus();await expect(button).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`general-launch-${width}.png`),fullPage:true});expect(f.errors).toEqual([]);expect(f.posts.map(body=>body.action)).toEqual(['prepare']);
});

test('background preparation keeps keyboard focus and cannot submit before it completes',async({page})=>{
 const f=await fixture(page);let release:()=>void=()=>{};
 f.beforePrepare=()=>new Promise<void>(resolve=>{release=resolve;});await page.goto(origin);
 await expect.poll(()=>f.posts.length).toBe(1);
 const button=page.getByRole('region',{name:'Launch submission'}).getByRole('button').first();
 await button.focus();await expect(button).toBeFocused();await expect(button).toHaveAttribute('aria-disabled','true');
 await button.press('Enter');expect(f.posts.map(body=>body.action)).toEqual(['prepare']);
 release();await expect(button).toHaveText('Submit for review');await expect(button).toBeFocused();
 expect(f.posts.map(body=>body.action)).toEqual(['prepare']);expect(f.errors).toEqual([]);
});
