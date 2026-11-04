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
import type { GeneralProjectView } from "../../lib/custom-ai/project-view";
import type { LaunchIntent } from "../../lib/custom-ai/launch-intent";
import { overviewFromView } from "../../lib/custom-ai/project-overview";
let server:Server,origin:string;
test.beforeAll(async()=>{server=await createHistoryServer();server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==="string")throw Error("Missing fixture port");origin=`http://127.0.0.1:${address.port}`;});
test.afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
function generalFixture(revision=1,compiled=true){
 const intent:LaunchIntent={version:1,id:"general-browser-design",revision:(revision===1?"c":"d").repeat(64),...(revision>1?{parentRevision:"c".repeat(64)}:{}),
  requirements:[{id:"counter",text:revision===1?"Anyone can increment the counter":"Anyone can increment and read the counter",kind:"behavior",open:null,origin:{kind:"legacy"}}],unresolved:[],changes:[]};
 const generalProject:GeneralProjectView={version:1,projectHash:`sha256:${(revision===1?"a":"b").repeat(64)}`,artifactHash:`sha256:${"f".repeat(64)}`,chainId:1,intentRevision:intent.revision,summary:"A general counter contract",
  compiler:{version:"0.8.26+commit.8a97fa7a",optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},entrypoints:[{source:"Counter.sol",contract:"Counter",role:"auxiliary"}],sourceFiles:1,sourceBytes:240,compiled,
  diagnostics:compiled?[]:[{severity:"error",message:"The source needs a declared helper."}],requirementCoverage:"proposed",verification:"not-run",launchReady:false};
 return {intent,generalProject,reply:"The complete general source is saved.",change:compiled?"applied" as const:"blocked" as const};
}
function checkedFixture(revision=1,passed=true){
 const base=generalFixture(revision);
 return {...base,change:passed?"applied" as const:"blocked" as const,generalProject:{...base.generalProject,blueprintId:`sha256:${"2".repeat(64)}` as const,
  scenarios:{scope:"isolated-declared-scenarios-v1" as const,hash:`sha256:${"3".repeat(64)}` as const,planHash:`sha256:${"4".repeat(64)}` as const,passed,cases:5,
    failures:passed?[]:[{caseId:"increment-one",code:"return-value",message:"The declared increment did not match."}]}}};
}

for(const width of [360,1440])test(`first visit explains wallet access without exposing unavailable editor controls at ${width}px`,async({page},info)=>{
 const f=await fixture(page);await page.setViewportSize({width,height:900});await page.goto(origin+'/?signed-out=1');
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeEnabled();
 await expect(page.getByRole('region',{name:'Build your coin'})).toHaveAttribute('data-chat-state','wallet-required');
 await expect(page.getByText('Connect your wallet to build and save your hook. You can write your idea first.',{exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Coin preview and details'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Attach image',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Chat options',{exact:true})).toHaveCount(0);
 const connect=page.getByRole('button',{name:'Connect wallet',exact:true});await connect.focus();await expect(connect).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.calls).toEqual([]);expect(f.chats.size).toBe(0);
 await page.screenshot({path:info.outputPath(`guest-entry-${width}.png`),fullPage:true});
});

test('the visible connect action accepts an empty idea and exposes the active wallet after sign-in',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/?signed-out=1');
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
 await page.getByRole('button',{name:'Finish sample connection',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Connected wallet 0x[a]+\. Manage wallet$/})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Describe your coin or ask a question'})).toHaveValue('');
 expect(f.calls).toEqual([]);
});

test('the visible connect action preserves the current idea without calling the model',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/?signed-out=1');
 const box=page.getByRole('textbox',{name:'Describe your coin or ask a question'});
 await expect(box).toBeEditable();await box.fill('Build my hook on Base after I sign in');
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
 await page.getByRole('button',{name:'Finish sample connection',exact:true}).click();
 await expect(box).toHaveValue('Build my hook on Base after I sign in');expect(f.calls).toEqual([]);
});

test('editing an idea after cancelling sign-in revokes its earlier pending handoff',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/?signed-out=1');const box=page.getByRole('textbox',{name:'Describe your coin or ask a question'});
 await expect(box).toBeEditable();await box.fill('Earlier abandoned idea');await box.press('Enter');
 await box.fill('New unsent idea');
 await page.getByRole('button',{name:'Finish sample connection',exact:true}).click();
 await expect(box).toHaveValue('');expect(f.calls).toEqual([]);
 expect([...f.studios.values()].every(studio=>!studio.state.input)).toBe(true);
});
test("a plain launch request uses the checked source without another model call", async ({page}) => {
 const f=await fixture(page),result=checkedFixture();
 f.control.respond=()=>({...result,generalProject:{...result.generalProject,sourceReview:"passed"}});
 const launchWrites:unknown[]=[];
 await page.route("**/api/custom-ai/general-launch**",async route=>{
  if(route.request().method()!=="GET")launchWrites.push(route.request().postDataJSON());
  await route.fulfill({json:{preparation:null}});
 });
 await page.goto(origin+"?launch");
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
 await box.fill("Build my hook");await box.press("Enter");
 await expect(page.getByRole("region",{name:"Your built hook"})).toBeVisible();
 await box.fill("Okay, launch it");await box.press("Enter");
 await expect(page.getByText("I’m preparing your checked hook for launch.",{exact:false})).toBeVisible();
 await expect(page.getByRole("button",{name:"Add coin name",exact:true})).toBeVisible();
 await expect(page.getByRole("textbox",{name:"Name",exact:true})).toBeFocused();
 await expect(box).toHaveValue("");
 await expect.poll(()=>[...f.studios.values()].some(saved=>saved.state.messages.at(-1)?.content.startsWith("I’m preparing your checked hook"))).toBe(true);
 expect(f.calls).toHaveLength(1);expect(launchWrites).toEqual([]);
 expect([...f.studios.values()].at(-1)?.state.draftId).toBe(f.calls[0].id);
});

test("a changed or unfinished design still sends launch requests through the planner", async ({page}) => {
 const f=await fixture(page),result=checkedFixture(1,false);
 f.control.respond=()=>result;
 await page.goto(origin+"?launch");
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
 await box.fill("Build my hook");await box.press("Enter");
 await expect(page.getByText(result.reply,{exact:true})).toBeVisible();
 await box.fill("Launch it");await box.press("Enter");
 await expect.poll(()=>f.calls.length).toBe(2);
 expect(f.calls[1].messages.at(-1)?.content).toBe("Launch it");
});
async function fixture(page:Page,cacheScope="a".repeat(64)){
 const chats=new Map<string,ConversationItem>(),studios=new Map<string,{revision:number;state:StudioState}>(),jobs=new Map<string,{request:ChatRequest;state:string;result?:ChatResult}>();
 const calls:ChatRequest[]=[],control={delay:false,lostCreates:0,beforeUpdate:undefined as undefined|(()=>Promise<void>),beforeCreate:undefined as undefined|(()=>Promise<void>),listQueries:[] as {q:string;archived:boolean}[],respond:undefined as undefined|((request:ChatRequest)=>ChatResult|undefined),failure:"",otherReads:[] as string[]};
 const key=(account:string,id:string,principal="alice")=>principal+":"+account+":"+id;
 const create=(account:string,id:string,principal="alice")=>{const k=key(account,id,principal);if(!chats.has(k))chats.set(k,{id,account,title:id===LEGACY_CONVERSATION?"Original idea":"New coin",archived:false,revision:1,updatedAt:new Date().toISOString(),createdAt:new Date().toISOString()});return chats.get(k)!;};
 await page.route("**/api/**",async route=>{
  const request=route.request(),url=new URL(request.url()),body=request.method()==="POST"?request.postDataJSON():undefined;
  const principal=request.headers().authorization?.endsWith(":bob")?"bob":"alice";
  if(body&&["/api/custom-ai","/api/custom-ai/studio"].includes(url.pathname)&&request.headers()["x-custom-ai-cache-scope"]!==(principal==="bob"?"b".repeat(64):cacheScope))return route.fulfill({status:409,json:{code:"session_changed",error:"Reload for the current account"}});
  const account=body?.account??url.searchParams.get("account")??"",id=body?.conversationId??url.searchParams.get("conversation")??LEGACY_CONVERSATION,k=key(account,id,principal);
  if(url.pathname==="/api/custom-ai/conversations"){
   if(body?.action==="bootstrap"||body?.action==="create"){const chat=create(account,body.action==="bootstrap"?LEGACY_CONVERSATION:body.id,principal);if(body.action==="create"){await control.beforeCreate?.();if(control.lostCreates>0){control.lostCreates--;return route.abort("failed");}}return route.fulfill({json:{...chat,...(body.action==="bootstrap"?{cacheScope:principal==="bob"?"b".repeat(64):cacheScope}:{})}});}
   if(body?.action==="update"){await control.beforeUpdate?.();const chat=chats.get(key(account,body.id,principal))!;if(body.revision!==chat.revision)return route.fulfill({status:409,json:{error:"Chat changed"}});Object.assign(chat,body.title?{title:body.title,customTitle:true}:{archived:body.archived});chat.revision++;return route.fulfill({json:chat});}
   const one=url.searchParams.get("id");if(one)return route.fulfill({json:chats.get(key(account,one,principal))});
   control.listQueries.push({q:url.searchParams.get("q")??"",archived:url.searchParams.get("archived")==="true"});
   return route.fulfill({json:{conversations:[...chats.entries()].filter(([entry])=>entry.startsWith(principal+":" )).map(([,chat])=>chat).filter(c=>c.account===account&&c.archived===(url.searchParams.get("archived")==="true")&&c.title.toLowerCase().includes((url.searchParams.get("q")??"").toLowerCase()))}});
  }
  if(url.pathname==="/api/custom-ai/studio"){
   if(body){const prev=studios.get(k);if((prev?.revision??0)!==body.revision)return route.fulfill({status:409,json:{error:"Studio changed"}});studios.set(k,{revision:body.revision+1,state:body.state});const chat=chats.get(k)!;if(!chat.customTitle)chat.title=body.state.settings.name||body.state.messages.find((m:{role:string})=>m.role==="user")?.content||chat.title;chat.revision++;if(chat.activeRequest===body.state.contextId)delete chat.activeRequest;return route.fulfill({json:{revision:body.revision+1}});}
   const saved=studios.get(k),chat=chats.get(k),active=chat?.activeRequest?jobs.get(chat.activeRequest):undefined;
   const draft=saved?.state.draftId?jobs.get(saved.state.draftId)?.result:undefined,context=saved?.state.contextId?jobs.get(saved.state.contextId)?.result:undefined;
   const proposal=saved?.state.sourceId?jobs.get(saved.state.sourceId)?.result?.generalProject:undefined;
   return route.fulfill({json:saved?{...saved,draft:draft?.draft,generalProject:draft?.generalProject,intent:context?.intent??draft?.intent,buildIssue:context?.buildIssue,...(proposal?{sourceRecovery:overviewFromView(saved!.state.sourceId!,proposal)}:{}),...(active&&active.state!=="failed"&&saved.state.contextId!==active.request.id?{activeRequest:active.request}:{})}:null});
  }
  if(url.pathname==="/api/custom-ai"){
   if(body){calls.push(body);const scope=body.conversation,chat=chats.get(key(scope.account,scope.id,principal))!;expect(scope.revision).toBe(studios.get(key(scope.account,scope.id,principal))?.revision);chat.activeRequest=body.id;if(!chat.customTitle)chat.title=body.coin?.name||body.messages.find((m:{role:string})=>m.role==="user")?.content||chat.title;chat.revision++;
    if(control.delay){jobs.set(body.id,{request:body,state:"running"});return route.fulfill({contentType:"text/event-stream",body:'data: {"type":"phase","phase":"building"}\n\n'});}
    const proposed=control.respond?.(body);
    if(control.failure){jobs.set(body.id,{request:body,state:"failed"});return route.fulfill({status:503,json:{code:control.failure,error:"The isolated contract build did not finish. Your source package is saved.",requestState:"failed"}});}
    const result=proposed??{reply:`Reply for ${body.messages.at(-1).content}`,change:"unchanged" as const};jobs.set(body.id,{request:body,state:"completed",result});return route.fulfill({json:result});
   }
   const job=jobs.get(url.searchParams.get("id")!);return route.fulfill({json:{id:job?.request.id,...job,phase:"building",heartbeatAt:Date.now()}});
  }
  if(url.pathname.endsWith("/usage"))return route.fulfill({json:{available:true,active:0,hourly:{used:0,limit:100,remaining:100,resetsAt:Date.now()+100000},daily:{used:0,limit:100,remaining:100,resetsAt:Date.now()+100000},resumesAt:0}});
  control.otherReads.push(url.pathname);return route.fulfill({json:{versions:[],requests:[]}});
 });
 return {chats,studios,jobs,calls,control};
}
test("a failed declaration can resume after reopening without another automatic build",async({page})=>{
 const f=await fixture(page),intent=generalFixture().intent;
 f.control.respond=()=>({reply:"The saved build stopped before source generation.",intent,change:"blocked",buildIssue:{stage:"scenarios",code:"invalid-declaration"}});
 await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
 await expect(box).toBeEditable();await box.fill("Build the saved counter hook");await box.press("Enter");
 const resume=page.getByRole("button",{name:"Continue building",exact:true});await expect(resume).toBeEnabled();
 await box.fill("Keep this unsent change");await expect.poll(()=>[...f.studios.values()].some(s=>s.state.input==="Keep this unsent change")).toBe(true);
 await page.reload();await expect(box).toHaveValue("Keep this unsent change");await expect(resume).toBeDisabled();expect(f.calls).toHaveLength(1);
 await box.fill("");await resume.click();await expect.poll(()=>f.calls.length).toBe(2);expect(f.calls[1].messages.at(-1)?.content).toContain("Keep every saved rule unchanged");
});
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
test("authenticated chat reads do not wait for an unfinished signing connector",async({page})=>{
 const f=await fixture(page);await page.goto(origin+"?signer-loading=1");const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
 await expect(box).toBeEditable();await box.fill("Private unsent idea while the signer connects");
 await expect.poll(()=>[...f.studios.values()].some(value=>value.state.input==="Private unsent idea while the signer connects")).toBe(true);
 await page.reload();await expect(box).toHaveValue("Private unsent idea while the signer connects");expect(f.calls).toHaveLength(0);
});
test("a signed-out prompt can connect without waiting for transaction readiness",async({page})=>{
 const f=await fixture(page);await page.goto(origin+"?signed-out=1&signer-loading=1");const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
 await expect(box).toBeEditable();await box.fill("First idea without a signer");await box.press("Enter");
 await page.getByRole("button",{name:"Finish sample connection",exact:true}).click();await expect(box).toHaveValue("First idea without a signer");expect(f.calls).toHaveLength(0);
});
test("general source restores compactly and reads complete code only when explicitly opened",async({page},info)=>{
 const f=await fixture(page),result=generalFixture();f.control.respond=()=>result;let sourceReads=0;
 await page.route("**/api/custom-ai/projects?**",route=>{sourceReads++;return route.fulfill({json:{version:1,requestId:f.calls[0].id,project:{hash:result.generalProject.projectHash,sources:{"Counter.sol":{content:"pragma solidity 0.8.26; contract Counter { uint256 public value; }"}}}}});});
 await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await box.fill("Build a general counter contract");await box.press("Enter");await expect(page.getByText("Source compiled",{exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Launch coin",exact:true})).toBeDisabled();expect(sourceReads).toBe(0);
 await box.fill("Keep this unsent source edit");await expect.poll(()=>[...f.studios.values()].some(s=>s.state.input==="Keep this unsent source edit")).toBe(true);
 f.control.otherReads=[];await page.reload();await expect(box).toHaveValue("Keep this unsent source edit");await expect(page.getByText("Source compiled",{exact:true})).toBeVisible();
 expect(f.calls).toHaveLength(1);expect(sourceReads).toBe(0);expect(f.control.otherReads.filter(path=>path.endsWith("/launch")||path.endsWith("/readiness"))).toHaveLength(0);
 const source=page.getByRole("region",{name:"Contract source",exact:true});await source.locator("summary",{hasText:"View saved source"}).click();
 await expect(source.getByText("Counter.sol",{exact:true})).toBeVisible();expect(sourceReads).toBe(1);
 await source.locator("summary",{hasText:"View saved source"}).click();await source.locator("summary",{hasText:"View saved source"}).click();expect(sourceReads).toBe(1);
 const download=page.waitForEvent("download");await source.getByRole("button",{name:"Download source project"}).click();expect((await download).suggestedFilename()).toMatch(/^programmable-source-/);
 for(const width of [360,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`general-source-${width}.png`),fullPage:true});}
});
test("compile-only recovery keeps the working source, unsent text and pending request without fake chat turns",async({page})=>{
 const f=await fixture(page),first=generalFixture(),second=generalFixture(2);let inferenceRequests=0;
 f.control.respond=request=>{if(request.intent==="compile"){f.control.failure="";return second;}inferenceRequests++;if(inferenceRequests===1)return first;f.control.failure="project-compiler";return undefined;};
 await page.route("**/api/custom-ai/projects?**",route=>route.fulfill({json:{requestId:f.calls[1].id,projectHash:second.generalProject.projectHash,chainId:1,intentRevision:second.intent.revision,compiler:second.generalProject.compiler,sourceFiles:1,sourceBytes:240,compilation:"pending",diagnostics:[]}}));
 await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await box.fill("Build a general counter");await box.press("Enter");await expect(page.getByText("Source compiled",{exact:true})).toBeVisible();
 const change="Add a read helper";await box.fill(change);await box.press("Enter");
 const recovery=page.getByRole("region",{name:"Saved source recovery"});await expect(recovery).toBeVisible();await expect(box).toHaveValue(change);
 expect([...f.studios.values()][0].state.draftId).toBe(f.calls[0].id);
 await box.fill("Keep this other unsent change");await recovery.getByRole("button",{name:"Retry saved build"}).click();
 await expect(recovery).toHaveCount(0);await expect(box).toHaveValue("Keep this other unsent change");
 await expect.poll(()=>[...f.studios.values()][0].state.draftId).toBe(f.calls[2].id);
 expect(f.calls[2]).toMatchObject({intent:"compile",messages:[],compilationOf:{id:f.calls[1].id,projectHash:second.generalProject.projectHash}});
 expect([...f.studios.values()][0].state.pendingChange).toBe(change);
 expect([...f.studios.values()][0].state.messages).toEqual([{role:"user",content:"Build a general counter"},{role:"assistant",content:first.reply}]);
 await page.reload();await expect(box).toHaveValue("Keep this other unsent change");await expect(page.getByText("Source compiled",{exact:true})).toBeVisible();
 expect(inferenceRequests).toBe(2);expect(f.calls).toHaveLength(3);
});
test("general source diagnostics stay a separate proposal until explicitly selected for editing",async({page})=>{
 const f=await fixture(page);let n=0;f.control.respond=()=>++n===1?generalFixture():generalFixture(2,false);
 await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await box.fill("Build a general counter");await box.press("Enter");await expect(page.getByText("Source compiled",{exact:true})).toBeVisible();
 await box.fill("Add a read helper");await box.press("Enter");const recovery=page.getByRole("region",{name:"Saved source recovery"});await expect(recovery).toBeVisible();
 await expect.poll(()=>[...f.studios.values()][0].state.sourceId).toBe(f.calls[1].id);expect([...f.studios.values()][0].state.draftId).toBe(f.calls[0].id);
 await expect(recovery.getByRole("button",{name:"Retry saved build"})).toHaveCount(0);
 await recovery.getByRole("button",{name:"Edit this source"}).click();await expect(recovery).toHaveCount(0);await expect(page.getByText("Source needs changes",{exact:true})).toBeVisible();
 await expect.poll(()=>[...f.studios.values()][0].state.draftId).toBe(f.calls[1].id);expect(f.calls).toHaveLength(2);
});
test("a failed declared contract check preserves the working source and can be explicitly edited",async({page})=>{
 const f=await fixture(page);let n=0;f.control.respond=()=>++n===1?checkedFixture():checkedFixture(2,false);
 await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await box.fill("Build the complete counter");await box.press("Enter");await expect(page.getByText("Source compiled",{exact:true})).toBeVisible();
 await box.fill("Add a read helper");await box.press("Enter");const recovery=page.getByRole("region",{name:"Saved source recovery"});await expect(recovery).toBeVisible();
 await expect.poll(()=>[...f.studios.values()][0].state.sourceId).toBe(f.calls[1].id);expect([...f.studios.values()][0].state.draftId).toBe(f.calls[0].id);
 await expect(recovery.getByRole("button",{name:"Resume contract checks"})).toHaveCount(0);await recovery.locator("summary",{hasText:"A declared contract check failed"}).click();await expect(recovery.getByText("The declared increment did not match.",{exact:true})).toBeVisible();
 await page.reload();await expect(recovery).toBeVisible();expect(f.calls).toHaveLength(2);
 await recovery.getByRole("button",{name:"Edit this source"}).click();await expect(recovery).toHaveCount(0);await expect(page.getByText("Contract checks failed",{exact:true})).toBeVisible();
 await expect.poll(()=>[...f.studios.values()][0].state.draftId).toBe(f.calls[1].id);expect(f.calls).toHaveLength(2);
});
test("resuming saved contract checks preserves the unsent input and does not request another generation",async({page})=>{
 const f=await fixture(page);let modelRequests=0;
 f.control.respond=request=>{if(request.intent==="compile"){f.control.failure="";return checkedFixture(2);}if(++modelRequests===1)return checkedFixture();f.control.failure="behavior-worker";return undefined;};
 await page.route("**/api/custom-ai/projects?**",route=>route.fulfill({json:{requestId:f.calls[1].id,projectHash:generalFixture(2).generalProject.projectHash,chainId:1,intentRevision:generalFixture(2).intent.revision,
  compiler:generalFixture(2).generalProject.compiler,sourceFiles:1,sourceBytes:240,compilation:"compiled",artifactHash:generalFixture(2).generalProject.artifactHash,blueprintId:checkedFixture().generalProject.blueprintId,diagnostics:[]}}));
 await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();await box.fill("Build the complete counter");await box.press("Enter");await expect(page.getByText("Source compiled",{exact:true})).toBeVisible();
 await box.fill("Add a read helper");await box.press("Enter");const recovery=page.getByRole("region",{name:"Saved source recovery"});await expect(recovery).toBeVisible();
 await box.fill("Keep this newer unsent idea");await recovery.getByRole("button",{name:"Resume contract checks"}).click();await expect(recovery).toHaveCount(0);await expect(box).toHaveValue("Keep this newer unsent idea");
 await expect.poll(()=>[...f.studios.values()][0].state.draftId).toBe(f.calls[2].id);expect(f.calls[2]).toMatchObject({intent:"compile",messages:[]});expect(modelRequests).toBe(2);expect(f.calls).toHaveLength(3);
 await page.reload();await expect(box).toHaveValue("Keep this newer unsent idea");expect(f.calls).toHaveLength(3);
});
test("four-chain source settings retain native currency and never load a foreign fee core",async({page},info)=>{
 const f=await fixture(page);await page.goto(origin);const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await page.locator("summary").filter({hasText:"Coin details"}).click();
 for(const name of ["Ethereum","Robinhood","Base","HyperEVM"])await expect(page.getByRole("button",{name,exact:true})).toBeVisible();
 await page.getByRole("textbox",{name:"Initial buy",exact:true}).fill("2");f.control.otherReads=[];
 await page.getByRole("button",{name:"Base",exact:true}).click();await expect(page.getByText("Contract design",{exact:true})).toBeVisible();
 // Changing from the fixed core to the general preview remounts its details.
 await page.locator("summary").filter({hasText:"Coin details"}).click();await expect(page.getByRole("button",{name:"Pair ETH",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"HyperEVM",exact:true}).click();await expect(page.getByRole("button",{name:"Pair HYPE",exact:true})).toBeVisible();
 await expect(page.getByRole("textbox",{name:"Initial buy",exact:true})).toHaveValue("");await page.getByRole("textbox",{name:"Initial buy",exact:true}).fill("0.2");
 const metadata={description:"A public coin following its saved volume rule.",website:"https://example.com/",x:"https://x.com/example_coin"};
 await page.getByRole("textbox",{name:"Public description",exact:true}).fill(metadata.description);
 await page.getByRole("textbox",{name:"Project website",exact:true}).fill(metadata.website);
 await page.getByRole("textbox",{name:"X profile",exact:true}).fill(metadata.x);
 await expect.poll(()=>[...f.studios.values()][0]?.state.settings).toMatchObject({chainId:999,pairToken:"HYPE",initialBuy:"0.2",...metadata});
 await page.reload();await expect(box).toBeEditable();await expect(page.getByText("Contract design",{exact:true})).toBeVisible();
 await page.locator("summary").filter({hasText:"Coin details"}).click();await expect(page.getByRole("button",{name:"Pair HYPE",exact:true})).toBeVisible();
 await expect(page.getByRole("textbox",{name:"Initial buy",exact:true})).toHaveValue("0.2");
 await expect(page.getByRole("textbox",{name:"Public description",exact:true})).toHaveValue(metadata.description);
 await expect(page.getByRole("textbox",{name:"Project website",exact:true})).toHaveValue(metadata.website);
 await expect(page.getByRole("textbox",{name:"X profile",exact:true})).toHaveValue(metadata.x);
 await page.getByRole("textbox",{name:"Public description",exact:true}).focus();await page.keyboard.press("Tab");
 await expect(page.getByRole("textbox",{name:"Project website",exact:true})).toBeFocused();await page.keyboard.press("Tab");
 await expect(page.getByRole("textbox",{name:"X profile",exact:true})).toBeFocused();
 for(const width of [360,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`four-chain-${width}.png`),fullPage:true});}
 expect(f.control.otherReads.filter(path=>path.endsWith("/launch")||path.endsWith("/readiness"))).toHaveLength(0);expect(f.calls).toHaveLength(0);
});
test("metadata-only edits survive online save and reload without changing the chain",async({page})=>{
 const f=await fixture(page);
 f.studios.set(`alice:0x${"a".repeat(40)}:${LEGACY_CONVERSATION}`,{revision:1,state:{settings:{...EMPTY_COIN_SETUP,chainId:8453},messages:[]}});
 await page.goto(origin);
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 await page.locator("summary").filter({hasText:"Coin details"}).click();
 const metadata={description:"A coin with a transparent fee schedule for its holders.",website:"https://example.com/coin",x:"https://x.com/example_coin"};
 await page.getByRole("textbox",{name:"Public description",exact:true}).fill(metadata.description);
 await page.getByRole("textbox",{name:"Project website",exact:true}).fill(metadata.website);
 await page.getByRole("textbox",{name:"X profile",exact:true}).fill(metadata.x);
 await expect.poll(()=>[...f.studios.values()][0]?.state.settings).toMatchObject(metadata);
 await page.reload();await expect(box).toBeEditable();await page.locator("summary").filter({hasText:"Coin details"}).click();
 await expect(page.getByRole("textbox",{name:"Public description",exact:true})).toHaveValue(metadata.description);
 await expect(page.getByRole("textbox",{name:"Project website",exact:true})).toHaveValue(metadata.website);
 await expect(page.getByRole("textbox",{name:"X profile",exact:true})).toHaveValue(metadata.x);
 expect(f.calls).toHaveLength(0);
});
test("retrying a lost create response opens the same chat without making another one",async({page})=>{
 const f=await fixture(page);await page.goto(origin);
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 f.control.lostCreates=1;await openChatMenu(page);await page.getByRole("button",{name:"New coin",exact:true}).click();
 await expect(page.getByRole("region",{name:"Your saved chats"}).getByRole("alert")).toBeVisible();
 expect(f.chats.size).toBe(2);const created=[...f.chats.values()].find(chat=>chat.id!==LEGACY_CONVERSATION)!;
 await page.getByRole("button",{name:"New chat",exact:true}).click();await expect(box).toBeEditable();
 await box.fill("This is the retried chat");
 await expect.poll(()=>[...f.studios.entries()].some(([key,saved])=>key.endsWith(created.id)&&saved.state.input==="This is the retried chat")).toBe(true);
 expect(f.chats.size).toBe(2);expect(f.calls).toHaveLength(0);
});
test("opening the recovered chat clears the pending create before the next new coin",async({page})=>{
 const f=await fixture(page);await page.goto(origin);
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();
 f.control.lostCreates=1;await openChatMenu(page);await page.getByRole("button",{name:"New coin",exact:true}).click();
 const library=page.getByRole("region",{name:"Your saved chats"});await expect(library.getByRole("alert")).toBeVisible();
 await library.getByRole("button",{name:/^New coin/}).click();
 await box.fill("Work in the recovered chat");
 await openChatMenu(page);await page.getByRole("button",{name:"New coin",exact:true}).click();await expect(box).toHaveValue("");
 expect(f.chats.size).toBe(3);expect(f.calls).toHaveLength(0);
});
test("separate chats keep unsent text through switches and reload; names and archive are recoverable",async({page},info)=>{
 const f=await fixture(page);await page.goto(origin);
 const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await expect(box).toBeEditable();await box.fill("Keep this original unsent idea");
 await openChatMenu(page);await page.getByRole("button",{name:"New coin",exact:true}).dblclick();await expect(box).toHaveValue("");expect(f.chats.size).toBe(2);await box.fill("Second private idea");
 await page.getByRole("button",{name:"Chats",exact:true}).click();await page.getByRole("button",{name:/^Original idea/}).click();await expect(box).toHaveValue("Keep this original unsent idea");
 await page.reload();await expect(box).toHaveValue("Keep this original unsent idea");
 await page.getByRole("button",{name:"Chats",exact:true}).click();const original=[...f.chats.values()].find(c=>c.id===LEGACY_CONVERSATION)!;
 await page.getByRole("button",{name:`Rename ${original.title}`,exact:true}).click();await page.getByRole("textbox",{name:"Chat name"}).fill("London rain");await page.getByRole("button",{name:"Save chat name"}).click();
 await page.getByRole("searchbox",{name:"Search your chats"}).fill("London");await expect(page.getByRole("button",{name:/London rain/}).first()).toBeVisible();
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
 await openChatMenu(page);await page.getByRole("button",{name:"New coin",exact:true}).click();await page.getByRole("button",{name:"Chats",exact:true}).click();
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
  await page.getByRole("searchbox",{name:"Search your chats"}).fill("London");await expect.poll(()=>f.control.listQueries.at(-1)?.q).toBe("London");
  release();await expect(page.getByRole("button",{name:/^London rain/})).toBeVisible();
  await expect(page.getByRole("searchbox",{name:"Search your chats"})).toHaveValue("London");expect(f.control.listQueries.at(-1)?.q).toBe("London");expect(f.calls).toHaveLength(0);
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
 await expect(page.getByRole("status").filter({hasText:"Checking your wallet connection"})).toBeVisible();expect(f.chats.size).toBe(0);expect(f.calls).toHaveLength(0);
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

async function openChatMenu(page:import("@playwright/test").Page){const menu=page.getByLabel("Chat options",{exact:true});if(await menu.evaluate(element=>!(element.parentElement as HTMLDetailsElement).open))await menu.click();}

for (const reducedMotion of ["no-preference", "reduce"] as const) test(`menus preserve focus and unsent input with ${reducedMotion} motion`, async ({page}) => {
  const f = await fixture(page);
  await page.emulateMedia({reducedMotion});
  await page.setViewportSize({width: reducedMotion === "reduce" ? 360 : 1440, height: 900});
  await page.goto(origin);
  const chats = page.getByRole("button", {name:"Chats", exact:true});
  await chats.click();
  const panel = page.getByRole("region", {name:"Your saved chats"});
  await expect(panel).toBeVisible();
  await page.getByRole("button", {name:"Close chat list"}).click();
  await expect(chats).toBeFocused();
  await expect(page.locator("#custom-ai-chats")).toHaveAttribute("inert", "");
  await expect(panel).not.toBeVisible();
  const attach = page.getByRole("button", {name:"Attach image", exact:true});
  await attach.click();
  await page.getByRole("textbox", {name:"Or use an image link"}).fill("https://example.org/coin.png");
  await page.keyboard.press("Escape");
  await expect(attach).toBeFocused();
  await expect(page.locator("#custom-ai-image-options")).toHaveAttribute("inert", "");
  await attach.click();
  await expect(page.getByRole("textbox", {name:"Or use an image link"})).toHaveValue("https://example.org/coin.png");
  await page.keyboard.press("Escape");
  expect(f.calls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
