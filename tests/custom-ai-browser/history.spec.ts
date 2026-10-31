import {once} from "node:events";
import type {Server} from "node:http";
import {expect,test,type Page} from "@playwright/test";
// @ts-expect-error The isolated esbuild fixture is a JavaScript host.
import {createHistoryServer} from "./history-server.mjs";
import {LEGACY_CONVERSATION,type ConversationItem} from "../../lib/custom-ai/conversation";
import type {ChatRequest,ChatResult} from "../../lib/custom-ai/types";
import type {StudioState} from "../../lib/custom-ai/studio";
import {EMPTY_COIN_SETUP} from "../../lib/custom-ai/coin-setup";
import {studioSnapshot} from "../../lib/custom-ai/studio-sync";
let server:Server,origin:string;
test.beforeAll(async()=>{server=await createHistoryServer();server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==="string")throw Error("Missing fixture port");origin=`http://127.0.0.1:${address.port}`;});
test.afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function fixture(page:Page,cacheScope="a".repeat(64)){
 const chats=new Map<string,ConversationItem>(),studios=new Map<string,{revision:number;state:StudioState}>(),jobs=new Map<string,{request:ChatRequest;state:string;result?:ChatResult}>();
 const calls:ChatRequest[]=[],control={delay:false,beforeUpdate:undefined as undefined|(()=>Promise<void>),beforeCreate:undefined as undefined|(()=>Promise<void>),listQueries:[] as {q:string;archived:boolean}[]};
 const key=(account:string,id:string,principal="alice")=>principal+":"+account+":"+id;
 const create=(account:string,id:string,principal="alice")=>{const k=key(account,id,principal);if(!chats.has(k))chats.set(k,{id,account,title:id===LEGACY_CONVERSATION?"Original idea":"New coin",archived:false,revision:1,updatedAt:new Date().toISOString(),createdAt:new Date().toISOString()});return chats.get(k)!;};
 await page.route("**/api/**",async route=>{
  const request=route.request(),url=new URL(request.url()),body=request.method()==="POST"?request.postDataJSON():undefined;
  const principal=request.headers().authorization?.endsWith(":bob")?"bob":"alice";
  if(body&&["/api/custom-ai","/api/custom-ai/studio"].includes(url.pathname)&&request.headers()["x-custom-ai-cache-scope"]!==(principal==="bob"?"b".repeat(64):cacheScope))return route.fulfill({status:409,json:{code:"session_changed",error:"Reload for the current account"}});
  const account=body?.account??url.searchParams.get("account")??"",id=body?.conversationId??url.searchParams.get("conversation")??LEGACY_CONVERSATION,k=key(account,id,principal);
  if(url.pathname==="/api/custom-ai/conversations"){
   if(body?.action==="bootstrap"||body?.action==="create"){const chat=create(account,body.action==="bootstrap"?LEGACY_CONVERSATION:body.id,principal);if(body.action==="create")await control.beforeCreate?.();return route.fulfill({json:{...chat,...(body.action==="bootstrap"?{cacheScope:principal==="bob"?"b".repeat(64):cacheScope}:{})}});}
   if(body?.action==="update"){await control.beforeUpdate?.();const chat=chats.get(key(account,body.id,principal))!;if(body.revision!==chat.revision)return route.fulfill({status:409,json:{error:"Chat changed"}});Object.assign(chat,body.title?{title:body.title,customTitle:true}:{archived:body.archived});chat.revision++;return route.fulfill({json:chat});}
   const one=url.searchParams.get("id");if(one)return route.fulfill({json:chats.get(key(account,one,principal))});
   control.listQueries.push({q:url.searchParams.get("q")??"",archived:url.searchParams.get("archived")==="true"});
   return route.fulfill({json:{conversations:[...chats.entries()].filter(([entry])=>entry.startsWith(principal+":" )).map(([,chat])=>chat).filter(c=>c.account===account&&c.archived===(url.searchParams.get("archived")==="true")&&c.title.toLowerCase().includes((url.searchParams.get("q")??"").toLowerCase()))}});
  }
  if(url.pathname==="/api/custom-ai/studio"){
   if(body){const prev=studios.get(k);if((prev?.revision??0)!==body.revision)return route.fulfill({status:409,json:{error:"Studio changed"}});studios.set(k,{revision:body.revision+1,state:body.state});const chat=chats.get(k)!;if(!chat.customTitle)chat.title=body.state.settings.name||body.state.messages.find((m:{role:string})=>m.role==="user")?.content||chat.title;chat.revision++;if(chat.activeRequest===body.state.contextId)delete chat.activeRequest;return route.fulfill({json:{revision:body.revision+1}});}
   const saved=studios.get(k),chat=chats.get(k),active=chat?.activeRequest?jobs.get(chat.activeRequest):undefined;
   return route.fulfill({json:saved?{...saved,...(active&&saved.state.contextId!==active.request.id?{activeRequest:active.request}:{})}:null});
  }
  if(url.pathname==="/api/custom-ai"){
   if(body){calls.push(body);const scope=body.conversation,chat=chats.get(key(scope.account,scope.id,principal))!;expect(scope.revision).toBe(studios.get(key(scope.account,scope.id,principal))?.revision);chat.activeRequest=body.id;if(!chat.customTitle)chat.title=body.coin?.name||body.messages.find((m:{role:string})=>m.role==="user")?.content||chat.title;chat.revision++;
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
test("a submitted signed-out idea survives connection in its own private chat",async({page})=>{
 const f=await fixture(page),account="0x"+"a".repeat(40),oldKey="alice:"+account+":"+LEGACY_CONVERSATION,now=new Date().toISOString();
 f.chats.set(oldKey,{id:LEGACY_CONVERSATION,account,title:"Existing private coin",archived:false,revision:1,createdAt:now,updatedAt:now});
 const old:StudioState={settings:{...EMPTY_COIN_SETUP,name:"Existing private coin",symbol:"OLD"},messages:[{role:"user",content:"Earlier private rules"}],input:"Earlier unsent message"};
 f.studios.set(oldKey,{revision:1,state:old});await page.goto(origin+"?signed-out=1");
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await box.fill("A new idea before connecting");await box.press("Enter");
 expect(f.calls).toHaveLength(0);
 await page.getByRole("button",{name:"Finish sample connection",exact:true}).click();
 await expect(box).toHaveValue("A new idea before connecting");
 expect(f.calls).toHaveLength(0);
 await expect.poll(()=>[...f.studios.entries()].find(([key])=>key!==oldKey)?.[1].state.input).toBe("A new idea before connecting");
 await page.reload();await expect(box).toHaveValue("A new idea before connecting");expect(f.calls).toHaveLength(0);
 await box.press("Enter");await expect(page.getByText("Reply for A new idea before connecting",{exact:true})).toBeVisible();
 expect(f.calls).toHaveLength(1);expect(f.calls[0].messages).toEqual([{role:"user",content:"A new idea before connecting"}]);
 expect(f.calls[0].conversation?.id).not.toBe(LEGACY_CONVERSATION);expect(f.calls[0].coin).toEqual(EMPTY_COIN_SETUP);
 expect(f.studios.get(oldKey)).toEqual({revision:1,state:old});
 await page.getByRole("button",{name:"Chats",exact:true}).click();await page.getByRole("button",{name:/^Existing private coin/}).click();
 await expect(box).toHaveValue("Earlier unsent message");
});
test("a principal switch during sign-in bootstrap cannot receive the pending prompt",async({page})=>{
 const f=await fixture(page);await page.goto(origin+"?signed-out=1");const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
 await expect(box).toBeEditable();await box.fill("Only for the first connected identity");await box.press("Enter");
 let release!:()=>void,started=false;const gate=new Promise<void>(resolve=>{release=resolve;});f.control.beforeCreate=async()=>{started=true;await gate;};
 try{
  await page.getByRole("button",{name:"Finish sample connection",exact:true}).click();await expect.poll(()=>started).toBe(true);
  await page.getByRole("button",{name:"Switch sample identity",exact:true}).click();await expect(box).toBeEditable();await expect(box).toHaveValue("");
  release();expect(f.calls).toHaveLength(0);expect([...f.studios.entries()].filter(([key])=>key.startsWith("bob:")).every(([,value])=>!value.state.input)).toBe(true);
 }finally{release();}
});
test("signed-out submission rejects a secret before opening any private chat",async({page})=>{
 const f=await fixture(page);await page.goto(origin+"?signed-out=1");const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
 await expect(box).toBeEditable();const secret="-----BEGIN PRIVATE KEY----- synthetic fixture";await box.fill(secret);await box.press("Enter");
 await expect(page.getByRole("alert")).toContainText("secret key");await expect(box).toHaveValue(secret);expect(f.calls).toHaveLength(0);expect(f.chats.size).toBe(0);
 await box.fill("");await page.getByRole("button",{name:"Finish sample connection",exact:true}).click();await expect(box).toHaveValue("");expect(f.chats.size).toBe(1);
});
test("a signed-out browser copy is not treated as a current sign-in prompt",async({page})=>{
 const f=await fixture(page);await page.goto(origin+"?signed-out=1");const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("programmable-custom-ai-v1",1);r.onupgradeneeded=()=>r.result.createObjectStore("drafts");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction("drafts","readwrite");tx.objectStore("drafts").put(JSON.stringify({version:1,messages:[{role:"user",content:"Old anonymous rules"}],input:"Old anonymous input"}),"programmable.custom-ai.studio.v1:signed-out");tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 });
 await page.reload();await expect(box).toBeEditable();await expect(box).toHaveValue("");await expect(page.getByText("Old anonymous rules",{exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Finish sample connection",exact:true}).click();await expect(box).toHaveValue("");expect(f.chats.size).toBe(1);expect(f.calls).toHaveLength(0);
});
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
test("another authenticated owner using the same wallet cannot inherit a private browser draft",async({page})=>{
 const alice=await fixture(page,"a".repeat(64));await page.goto(origin);
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await box.fill("Alice private unsent design");
 await expect.poll(()=>[...alice.studios.values()].some(studio=>studio.state.input==="Alice private unsent design")).toBe(true);
 // A different verified server principal has its own empty storage but the
 // same linked wallet and legacy chat id. Browser storage is unchanged.
 const bob=await fixture(page,"b".repeat(64));await page.reload();
 await expect(box).toBeEditable();await expect(box).toHaveValue("");
 await expect(page.getByText("Alice private unsent design",{exact:true})).toHaveCount(0);
 expect(bob.calls).toHaveLength(0);expect(alice.calls).toHaveLength(0);
});

test("changing principal without changing the wallet immediately remounts the private workspace",async({page})=>{
 const f=await fixture(page);await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
 await expect(box).toBeEditable();await box.fill("Private to Alice only");
 await expect.poll(()=>[...f.studios.values()].some(s=>s.state.input==="Private to Alice only")).toBe(true);
 await page.getByRole("button",{name:"Switch sample identity",exact:true}).click();await expect(box).toHaveValue("");await box.fill("Private to Bob only");
 await expect.poll(()=>[...f.studios.values()].some(s=>s.state.input==="Private to Bob only")).toBe(true);
 await page.getByRole("button",{name:"Switch sample identity",exact:true}).click();await expect(box).toHaveValue("Private to Alice only");
 expect(f.calls).toHaveLength(0);
});
async function seedLegacy(page:Page,value:unknown){
 return page.evaluate(async value=>{
  const account="0x"+"a".repeat(40),prefix="programmable.custom-ai.studio.";
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("programmable-custom-ai-v1",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction("drafts","readwrite"),store=tx.objectStore("drafts");
   store.put(JSON.stringify(value),prefix+"v1:"+account);store.delete(prefix+"v2:"+"a".repeat(64)+":"+account);
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });db.close();
 },value);
}
test("an older local copy migrates only after its saved job is returned in the owned studio",async({page})=>{
 const f=await fixture(page);await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 const account="0x"+"a".repeat(40),job="owned-old-request-00001",state:StudioState={settings:EMPTY_COIN_SETUP,messages:[],contextId:job};
 f.studios.set("alice:"+account+":"+LEGACY_CONVERSATION,{revision:1,state});
 await seedLegacy(page,{version:1,...state,input:"Earlier owned unsent change",syncBase:{revision:1,snapshot:studioSnapshot(state)}});
 await page.reload();await expect(box).toHaveValue("Earlier owned unsent change");
 expect(f.calls).toHaveLength(0);await expect(page.getByText("Choose which draft to keep.",{exact:false})).toHaveCount(0);
});
test("an older local-only copy remains stored without being adopted by a newly signed-in principal",async({page})=>{
 const f=await fixture(page);await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await seedLegacy(page,{version:1,settings:EMPTY_COIN_SETUP,messages:[],input:"Unattributed older private input"});
 await page.reload();await expect(box).toHaveValue("");expect(f.calls).toHaveLength(0);
 const retained=await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("programmable-custom-ai-v1",1);r.onsuccess=()=>resolve(r.result);});
  const raw=await new Promise<unknown>(resolve=>{const r=db.transaction("drafts").objectStore("drafts").get("programmable.custom-ai.studio.v1:0x"+"a".repeat(40));r.onsuccess=()=>resolve(r.result);});db.close();return raw;
 });expect(JSON.parse(retained as string).input).toBe("Unattributed older private input");
});
