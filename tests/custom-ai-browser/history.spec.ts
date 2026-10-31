import {once} from "node:events";
import type {Server} from "node:http";
import {expect,test,type Page} from "@playwright/test";
// @ts-expect-error The isolated esbuild fixture is a JavaScript host.
import {createHistoryServer} from "./history-server.mjs";
import {LEGACY_CONVERSATION,type ConversationItem} from "../../lib/custom-ai/conversation";
import type {ChatRequest,ChatResult} from "../../lib/custom-ai/types";
import type {StudioState} from "../../lib/custom-ai/studio";
let server:Server,origin:string;
test.beforeAll(async()=>{server=await createHistoryServer();server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==="string")throw Error("Missing fixture port");origin=`http://127.0.0.1:${address.port}`;});
test.afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function fixture(page:Page){
 const chats=new Map<string,ConversationItem>(),studios=new Map<string,{revision:number;state:StudioState}>(),jobs=new Map<string,{request:ChatRequest;state:string;result?:ChatResult}>();
 const calls:ChatRequest[]=[],control={delay:false,beforeUpdate:undefined as undefined|(()=>Promise<void>),listQueries:[] as {q:string;archived:boolean}[]};
 const key=(account:string,id:string)=>account+":"+id;
 const create=(account:string,id:string)=>{const k=key(account,id);if(!chats.has(k))chats.set(k,{id,account,title:id===LEGACY_CONVERSATION?"Original idea":"New coin",archived:false,revision:1,updatedAt:new Date().toISOString(),createdAt:new Date().toISOString()});return chats.get(k)!;};
 await page.route("**/api/**",async route=>{
  const request=route.request(),url=new URL(request.url()),body=request.method()==="POST"?request.postDataJSON():undefined;
  const account=body?.account??url.searchParams.get("account")??"",id=body?.conversationId??url.searchParams.get("conversation")??LEGACY_CONVERSATION,k=key(account,id);
  if(url.pathname==="/api/custom-ai/conversations"){
   if(body?.action==="bootstrap"||body?.action==="create")return route.fulfill({json:create(account,body.action==="bootstrap"?LEGACY_CONVERSATION:body.id)});
   if(body?.action==="update"){await control.beforeUpdate?.();const chat=chats.get(key(account,body.id))!;if(body.revision!==chat.revision)return route.fulfill({status:409,json:{error:"Chat changed"}});Object.assign(chat,body.title?{title:body.title,customTitle:true}:{archived:body.archived});chat.revision++;return route.fulfill({json:chat});}
   const one=url.searchParams.get("id");if(one)return route.fulfill({json:chats.get(key(account,one))});
   control.listQueries.push({q:url.searchParams.get("q")??"",archived:url.searchParams.get("archived")==="true"});
   return route.fulfill({json:{conversations:[...chats.values()].filter(c=>c.account===account&&c.archived===(url.searchParams.get("archived")==="true")&&c.title.toLowerCase().includes((url.searchParams.get("q")??"").toLowerCase()))}});
  }
  if(url.pathname==="/api/custom-ai/studio"){
   if(body){const prev=studios.get(k);if((prev?.revision??0)!==body.revision)return route.fulfill({status:409,json:{error:"Studio changed"}});studios.set(k,{revision:body.revision+1,state:body.state});const chat=chats.get(k)!;if(!chat.customTitle)chat.title=body.state.settings.name||body.state.messages.find((m:{role:string})=>m.role==="user")?.content||chat.title;chat.revision++;if(chat.activeRequest===body.state.contextId)delete chat.activeRequest;return route.fulfill({json:{revision:body.revision+1}});}
   const saved=studios.get(k),chat=chats.get(k),active=chat?.activeRequest?jobs.get(chat.activeRequest):undefined;
   return route.fulfill({json:saved?{...saved,...(active&&saved.state.contextId!==active.request.id?{activeRequest:active.request}:{})}:null});
  }
  if(url.pathname==="/api/custom-ai"){
   if(body){calls.push(body);const scope=body.conversation,chat=chats.get(key(scope.account,scope.id))!;expect(scope.revision).toBe(studios.get(key(scope.account,scope.id))?.revision);chat.activeRequest=body.id;if(!chat.customTitle)chat.title=body.coin?.name||body.messages.find((m:{role:string})=>m.role==="user")?.content||chat.title;chat.revision++;
    if(control.delay){jobs.set(body.id,{request:body,state:"running"});return route.fulfill({contentType:"text/event-stream",body:'data: {"type":"phase","phase":"building"}\n\n'});}
    const result={reply:`Reply for ${body.messages.at(-1).content}`,change:"unchanged" as const};jobs.set(body.id,{request:body,state:"completed",result});return route.fulfill({json:result});
   }
   const job=jobs.get(url.searchParams.get("id")!);return route.fulfill({json:{id:job?.request.id,...job,phase:"building",heartbeatAt:Date.now()}});
  }
  if(url.pathname.endsWith("/usage"))return route.fulfill({json:{available:true,active:0,hourly:{used:0,limit:100,remaining:100,resetsAt:Date.now()+100000},daily:{used:0,limit:100,remaining:100,resetsAt:Date.now()+100000},resumesAt:0}});
  return route.fulfill({json:{versions:[],requests:[]}});
 });
 return {chats,studios,jobs,calls,control};
}
test("separate chats keep unsent text through switches and reload; names and archive are recoverable",async({page},info)=>{
 const f=await fixture(page);await page.goto(origin);
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();await box.fill("Keep this original unsent idea");
 await page.getByRole("button",{name:"New coin",exact:true}).dblclick();await expect(box).toHaveValue("");expect(f.chats.size).toBe(2);await box.fill("Second private idea");
 await page.getByRole("button",{name:"Chats",exact:true}).click();await page.getByRole("button",{name:/^Original idea/}).click();await expect(box).toHaveValue("Keep this original unsent idea");
 await page.reload();await expect(box).toHaveValue("Keep this original unsent idea");
 await page.getByRole("button",{name:"Chats",exact:true}).click();const original=[...f.chats.values()].find(c=>c.id===LEGACY_CONVERSATION)!;
 await page.getByRole("button",{name:`Rename ${original.title}`,exact:true}).click();await page.getByRole("textbox",{name:"Chat name"}).fill("London rain");await page.getByRole("button",{name:"Save chat name"}).click();
 await page.getByRole("textbox",{name:"Search your chats"}).fill("London");await expect(page.getByRole("button",{name:/London rain/}).first()).toBeVisible();
 await page.getByRole("button",{name:"Archive London rain",exact:true}).click();
 await expect.poll(()=>[...f.chats.values()].find(c=>c.id===LEGACY_CONVERSATION)?.archived).toBe(true);
 await page.getByRole("checkbox",{name:"Show archived"}).check();await expect(page.getByRole("button",{name:"Restore London rain",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Restore London rain",exact:true}).click();await page.getByRole("checkbox",{name:"Show archived"}).uncheck();await page.getByRole("button",{name:/^London rain/}).click();await expect(box).toHaveValue("Keep this original unsent idea");
 for(const width of [360,768,1440]){await page.setViewportSize({width,height:900});await page.getByRole("button",{name:"Chats",exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const panel=await page.getByRole("region",{name:"Your saved chats"}).boundingBox();expect(panel).not.toBeNull();expect(panel!.x).toBeGreaterThanOrEqual(0);expect(panel!.x+panel!.width).toBeLessThanOrEqual(width);await page.screenshot({path:info.outputPath(`history-${width}.png`),fullPage:true});await page.keyboard.press("Escape");await expect(page.getByRole("button",{name:"Chats",exact:true})).toBeFocused();}
 expect(f.calls).toHaveLength(0);
});
test("switching during a reply isolates its receiver and returning resumes it without POST",async({page})=>{
 const f=await fixture(page);await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 f.control.delay=true;await box.fill("First chat request");await box.press("Enter");await expect.poll(()=>f.calls.length).toBe(1);
 await page.getByRole("button",{name:"Chats",exact:true}).click();await page.getByRole("button",{name:"New chat",exact:true}).click();await expect(box).toBeEditable();await expect(box).toHaveValue("");
 const first=f.jobs.get(f.calls[0].id)!;first.state="completed";first.result={reply:"Saved first chat reply",change:"unchanged"};
 f.control.delay=false;await box.fill("Second chat request");await box.press("Enter");await expect(page.getByText("Reply for Second chat request",{exact:true})).toBeVisible();await expect(page.getByText("Saved first chat reply",{exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Chats",exact:true}).click();await page.getByRole("button",{name:/^First chat request/}).click();await expect(page.getByText("Saved first chat reply",{exact:true})).toHaveCount(1);
 expect(f.calls).toHaveLength(2);expect(f.calls[0].conversation?.id).not.toBe(f.calls[1].conversation?.id);
});
test("changing the selected wallet keeps private chat inputs separate",async({page})=>{
 const f=await fixture(page);await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();await box.fill("Only for wallet A");
 await page.getByRole("button",{name:"Switch sample wallet",exact:true}).click();await expect(box).toBeEditable();await expect(box).toHaveValue("");await box.fill("Only for wallet B");
 await page.getByRole("button",{name:"Switch sample wallet",exact:true}).click();await expect(box).toHaveValue("Only for wallet A");await page.reload();await expect(box).toHaveValue("Only for wallet A");
 expect(f.calls).toHaveLength(0);expect(new Set([...f.chats.values()].map(c=>c.account)).size).toBe(2);
});
test("restoring a chat uses the latest archive filter after a delayed write",async({page})=>{
 const f=await fixture(page);await page.goto(origin);await expect(page.getByRole("textbox",{name:"Describe your coin or ask a question"})).toBeEditable();
 await page.getByRole("button",{name:"New coin",exact:true}).click();await page.getByRole("button",{name:"Chats",exact:true}).click();
 await page.getByRole("button",{name:"Archive Original idea",exact:true}).click();
 await page.getByRole("checkbox",{name:"Show archived"}).check();await expect(page.getByRole("button",{name:"Restore Original idea",exact:true})).toBeVisible();
 let release!:()=>void,started=false;const gate=new Promise<void>(resolve=>{release=resolve;});f.control.beforeUpdate=async()=>{started=true;await gate;};
 try{
  await page.getByRole("button",{name:"Restore Original idea",exact:true}).click();await expect.poll(()=>started).toBe(true);
  await page.getByRole("checkbox",{name:"Show archived"}).uncheck();await expect.poll(()=>f.control.listQueries.at(-1)?.archived).toBe(false);
  release();await expect(page.getByRole("button",{name:/^Original idea/,exact:false})).toBeVisible();
  await expect(page.getByRole("checkbox",{name:"Show archived"})).not.toBeChecked();expect(f.control.listQueries.at(-1)?.archived).toBe(false);expect(f.calls).toHaveLength(0);
 }finally{release();}
});
test("renaming a chat refreshes the latest search instead of the search at submission",async({page})=>{
 const f=await fixture(page);await page.goto(origin);await expect(page.getByRole("textbox",{name:"Describe your coin or ask a question"})).toBeEditable();
 await page.getByRole("button",{name:"Chats",exact:true}).click();await page.getByRole("button",{name:"Rename Original idea",exact:true}).click();
 await page.getByRole("textbox",{name:"Chat name"}).fill("London rain");
 let release!:()=>void,started=false;const gate=new Promise<void>(resolve=>{release=resolve;});f.control.beforeUpdate=async()=>{started=true;await gate;};
 try{
  await page.getByRole("button",{name:"Save chat name",exact:true}).click();await expect.poll(()=>started).toBe(true);
  await page.getByRole("textbox",{name:"Search your chats"}).fill("London");await expect.poll(()=>f.control.listQueries.at(-1)?.q).toBe("London");
  release();await expect(page.getByRole("button",{name:/^London rain/})).toBeVisible();
  await expect(page.getByRole("textbox",{name:"Search your chats"})).toHaveValue("London");expect(f.control.listQueries.at(-1)?.q).toBe("London");expect(f.calls).toHaveLength(0);
 }finally{release();}
});
test("archiving the current chat cannot select an archived replacement",async({page})=>{
 const f=await fixture(page);await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();await box.fill("Keep the archived draft");
 await page.getByRole("button",{name:"Chats",exact:true}).click();
 let release!:()=>void,started=false;const gate=new Promise<void>(resolve=>{release=resolve;});f.control.beforeUpdate=async()=>{started=true;await gate;};
 try{
  await page.getByRole("button",{name:"Archive Original idea",exact:true}).click();await expect.poll(()=>started).toBe(true);
  await page.getByRole("checkbox",{name:"Show archived"}).check();await expect.poll(()=>f.control.listQueries.at(-1)?.archived).toBe(true);
  release();await expect(page.getByRole("button",{name:"Restore Original idea",exact:true})).toBeVisible();await expect(box).toHaveCount(0);
  f.control.beforeUpdate=undefined;await page.getByRole("button",{name:"Restore Original idea",exact:true}).click();
  await page.getByRole("checkbox",{name:"Show archived"}).uncheck();await page.getByRole("button",{name:/^Original idea/}).click();
  await expect(box).toHaveValue("Keep the archived draft");expect(f.calls).toHaveLength(0);
 }finally{release();}
});
test("a rate-limited optional identity endpoint does not block an authenticated chat",async({page})=>{
 const f=await fixture(page);await page.goto(origin+"/?identity-outage=1");
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await box.fill("Explain the hook without building");await box.press("Enter");
 await expect(page.getByText("Reply for Explain the hook without building",{exact:true})).toBeVisible();expect(f.calls).toHaveLength(1);
 await page.reload();await expect(page.getByText("Reply for Explain the hook without building",{exact:true})).toHaveCount(1);expect(f.calls).toHaveLength(1);
});
test("initial chat reads wait for the wallet session to finish restoring",async({page})=>{
 const f=await fixture(page);await page.goto(origin+"/?session-loading=1");
 await expect(page.getByRole("status").filter({hasText:"Restoring your wallet session"})).toBeVisible();expect(f.chats.size).toBe(0);expect(f.calls).toHaveLength(0);
 await page.getByRole("button",{name:"Restore sample session",exact:true}).click();
 await expect(page.getByRole("textbox",{name:"Describe your coin or ask a question"})).toBeEditable();expect(f.chats.size).toBe(1);expect(f.calls).toHaveLength(0);
});
