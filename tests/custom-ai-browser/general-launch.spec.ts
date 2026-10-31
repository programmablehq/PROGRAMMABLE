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
async function fixture(page:Page){
 const control={saved:null as GeneralPreparationView|null,posts:[] as {action:string;id:string;selection?:Record<string,unknown>}[],saves:[] as {settings:CoinSetup;image:{id:string}}[],reads:0,lostCreate:false,beforePrepare:undefined as undefined|(()=>Promise<void>),errors:[] as string[]};
 page.on('pageerror',error=>control.errors.push(error.message));
 await page.route('**/fixture-studio',async route=>{control.saves.push(route.request().postDataJSON());await route.fulfill({json:{revision:33}});});
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname!=="/api/custom-ai/general-launch")throw Error("Unexpected API call: "+url.pathname);
  if(request.method()==="GET"){
   control.reads++;const account=url.searchParams.get('account');
   return route.fulfill({json:{preparation:account&&control.saved?.account.toLowerCase()!==account.toLowerCase()?null:control.saved}});
  }
  const body=request.postDataJSON();control.posts.push(body);
  if(body.action==="prepare"){
   const selected=body.selection,studio=control.saves.at(-1)!;
   expect(selected.studioRevision).toBe(33);
   if(selected.chainId===4663)expect(body.controllerKind).toBe("eoa");else expect(body.controllerKind).toBeUndefined();
   control.saved={version:1,id:"general-client-ticket-0001",account:selected.account,chainId:selected.chainId,sourceId:selected.id,conversationId:selected.conversation,
    projectHash:selected.projectHash,artifactHash:selected.artifactHash,coin:{name:studio.settings.name,symbol:studio.settings.symbol},editor:{settings:studio.settings,imageId:studio.image.id},packState:"complete",requestHash:selected.projectHash,createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+1800000,launchReady:false};
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
 expect(f.posts.map(body=>body.action)).toEqual(['prepare','create']);expect(f.saves).toHaveLength(1);
 await page.reload();await expect(page.getByRole('link',{name:'Open submission',exact:true})).toBeVisible();
 expect(f.posts).toHaveLength(2);expect(f.errors).toEqual([]);await expect(page.getByLabel('Chat editing')).toHaveText('Available');
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
 expect(f.posts.map(body=>body.action)).toEqual(['prepare','create','create']);expect(f.posts[2]).toEqual(f.posts[1]);expect(f.saves).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('a wallet switch cancels an in-flight preparation before create',async({page})=>{
 const f=await fixture(page);let release:()=>void=()=>{};f.beforePrepare=()=>new Promise<void>(resolve=>{release=resolve;});await page.goto(origin);
 await page.getByRole('button',{name:'Submit for review',exact:true}).click();await expect.poll(()=>f.posts.length).toBe(1);
 await page.getByRole('button',{name:'Switch sample wallet'}).click();release();
 await expect(page.getByRole('button',{name:'Submit for review',exact:true})).toBeEnabled();
 expect(f.posts.map(body=>body.action)).toEqual(['prepare']);await expect(page.getByRole('link',{name:'Open submission',exact:true})).toHaveCount(0);expect(f.errors).toEqual([]);
});
test('completed submission details stay distinct when the coin is edited',async({page})=>{
 const f=await fixture(page);await page.goto(origin);await page.getByRole('button',{name:'Submit for review',exact:true}).click();
 await expect(page.getByRole('link',{name:'Open submission',exact:true})).toBeVisible();await page.getByRole('button',{name:'Change sample coin'}).click();
 await expect(page.getByRole('button',{name:'Submit for review',exact:true})).toBeEnabled();
 await expect(page.getByRole('link',{name:'Open Original coin submission',exact:true})).toBeVisible();expect(f.posts).toHaveLength(2);
});
test('Robinhood wallet declarations are cleared on a wallet or private scope change',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/?chain=4663');
 const choice=page.getByLabel('Launch wallet type'),button=page.getByRole('button',{name:'Submit for review',exact:true});
 await choice.selectOption('eoa');await expect(button).toBeEnabled();
 await page.getByRole('button',{name:'Switch sample wallet'}).click();
 await expect(choice).toHaveValue('');await expect(button).toBeDisabled();expect(f.posts).toEqual([]);
});
test('disabled intake does no journal reads and exposes no submit control',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/?disabled=1');await expect(page.getByRole('heading',{name:'Original coin',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Launch submission'})).toHaveCount(0);expect(f.reads).toBe(0);expect(f.posts).toEqual([]);
});

for(const width of [360,1440])test(`submission controls render and remain keyboard accessible at ${width}px`,async({page},testInfo)=>{
 const f=await fixture(page);await page.setViewportSize({width,height:1000});await page.goto(origin);
 const button=page.getByRole('button',{name:'Submit for review',exact:true});await expect(button).toBeEnabled();await button.focus();await expect(button).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`general-launch-${width}.png`),fullPage:true});expect(f.errors).toEqual([]);expect(f.posts).toEqual([]);
});
