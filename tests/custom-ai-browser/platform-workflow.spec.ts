import {once} from "node:events";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {test,expect} from "@playwright/test";
// @ts-expect-error Local esbuild fixture host.
import {createPlatformServer} from "./platform-server.mjs";
let fixture:Awaited<ReturnType<typeof createPlatformServer>>,origin:string;
test.beforeAll(async()=>{fixture=await createPlatformServer();fixture.server.listen(0,"127.0.0.1");await once(fixture.server,"listening");origin=`http://127.0.0.1:${fixture.server.address().port}`;});
test.afterAll(async()=>{if(fixture)await fixture.close();});
test("creates, runs and edits a real persisted project, then isolates another account",async({page})=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await page.goto(origin);
  const firstInput=page.getByRole("textbox",{name:"Describe your idea"});await expect(firstInput).toBeEnabled();
  await firstInput.fill("Baue einen Zähler für unser Spiel.");await page.getByRole("button",{name:"Send",exact:true}).click();
  await expect(page.getByText("The counter source is saved. Behavior checks have not run yet.")).toBeVisible({timeout:12000});
  await page.reload();await expect(page.getByRole("region",{name:"Project chat"}).getByText("Baue einen Zähler für unser Spiel.",{exact:true})).toBeVisible();
  await page.getByRole("tab",{name:"Files",exact:true}).click();await page.getByRole("button",{name:"index.js",exact:true}).click();
  await page.getByRole("textbox",{name:"index.js",exact:true}).fill("export const count = 2;\n");
  await expect(page.getByLabel("Your projects",{exact:true})).toBeDisabled();await page.getByRole("button",{name:"Save file",exact:true}).click();
  await expect(page.getByLabel("Your projects",{exact:true})).toBeEnabled();await page.reload();await page.getByRole("tab",{name:"Files",exact:true}).click();await page.getByRole("button",{name:"index.js",exact:true}).click();await expect(page.getByRole("textbox",{name:"index.js",exact:true})).toHaveValue("export const count = 2;\n");
  await page.getByLabel("Fixture account",{exact:true}).selectOption("bob");await expect(page.getByRole("textbox",{name:"Describe your idea"})).toBeVisible();await expect(page.getByText("Baue einen Zähler für unser Spiel.",{exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});
test("keeps one queued request through refresh and stops that saved run",async({page,request})=>{
  await request.post(`${origin}/fixture/pause`,{data:{paused:true}});await page.goto(origin);await page.getByRole("button",{name:"New project",exact:true}).click();
  const prompt="Wait for my next step.";await page.getByRole("textbox",{name:"Message your project"}).fill(prompt);await page.getByRole("button",{name:"Send",exact:true}).click();await expect(page.getByRole("button",{name:"Stop",exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole("region",{name:"Project chat"}).getByText(prompt,{exact:true})).toHaveCount(1);await page.getByRole("button",{name:"Stop",exact:true}).click();await expect(page.getByRole("region",{name:"Project chat"}).getByText("Stopped · progress saved",{exact:true}).last()).toBeVisible();await request.post(`${origin}/fixture/pause`,{data:{paused:false}});
});
test("reviews and revokes a connection without exposing its private key",async({page})=>{
  await page.goto(origin);await page.getByRole("button",{name:"New project",exact:true}).click();
  await page.getByRole("tab",{name:"Connections",exact:true}).click();await page.getByText("Add a connection",{exact:true}).click();
  await page.getByLabel("Connection name",{exact:true}).fill("Sample API");await page.getByLabel("API base URL",{exact:true}).fill("https://api.example.com");await page.getByLabel("Authentication",{exact:true}).selectOption("api-key");await page.getByLabel("Private API key",{exact:true}).fill("synthetic-browser-secret");await page.getByRole("button",{name:"Review connection",exact:true}).click();await page.getByRole("button",{name:"Save connection",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Sample API",exact:true})).toBeVisible();await expect(page.getByText("synthetic-browser-secret",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Revoke",exact:true}).click();await expect(page.getByText("revoked",{exact:true})).toBeVisible();
});
test("supports keyboard tabs and a narrow mobile layout",async({page})=>{
  await page.goto(origin);await page.getByRole("button",{name:"New project",exact:true}).click();
  const projectTab=page.getByRole("tab",{name:"Project",exact:true});await projectTab.focus();await page.keyboard.press("ArrowRight");await expect(page.getByRole("tab",{name:"Files",exact:true})).toBeFocused();await expect(page.getByRole("tabpanel",{name:"Files",exact:true})).toBeVisible();
  await page.screenshot({path:join(process.env.PLATFORM_EVIDENCE_DIR??tmpdir(),"p11-desktop.png"),fullPage:true});
  await page.setViewportSize({width:320,height:780});await page.getByRole("button",{name:"Result",exact:true}).click();await page.getByRole("tab",{name:"Files",exact:true}).focus();await page.keyboard.press("Home");await expect(projectTab).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:join(process.env.PLATFORM_EVIDENCE_DIR??tmpdir(),"p11-mobile.png"),fullPage:true});
});
test("imports an OpenAPI document into the review and saves its actual actions",async({page})=>{
 await page.goto(origin);const selected=page.getByLabel("Your projects",{exact:true}),before=await selected.inputValue();await page.getByRole("button",{name:"New project",exact:true}).click();await expect(selected).not.toHaveValue(before);
 await page.getByRole("tab",{name:"Connections",exact:true}).click();await page.getByText("Add a connection",{exact:true}).click();
 await page.getByLabel("Connection name",{exact:true}).fill("Score OpenAPI");await page.getByLabel("Connection type",{exact:true}).selectOption("openapi");
 await page.getByLabel("OpenAPI JSON",{exact:true}).fill(JSON.stringify({openapi:"3.1.0",servers:[{url:"https://api.scores.com"}],paths:{"/scores":{get:{operationId:"listScores",summary:"List scores",responses:{"200":{description:"Scores",content:{"application/json":{schema:{type:"array"}}}}}}}}}));
 await page.getByRole("button",{name:"Review connection",exact:true}).click();await expect(page.getByRole("heading",{name:"Review Score OpenAPI",exact:true})).toBeVisible();
 await expect(page.getByRole("checkbox",{name:"List scores · read"})).toBeChecked();await page.getByRole("button",{name:"Save connection",exact:true}).click();await expect(page.getByRole("heading",{name:"Score OpenAPI",exact:true})).toBeVisible();
});
test("keeps a recognizable pasted credential out of the saved chat and run request",async({page,request})=>{
 await page.goto(origin);const selected=page.getByLabel("Your projects",{exact:true}),before=await selected.inputValue();await page.getByRole("button",{name:"New project",exact:true}).click();await expect(selected).not.toHaveValue(before);
 let runRequests=0;page.on("request",request=>{if(request.method()==="POST"&&request.url().endsWith("/platform/runs"))runRequests++;});
 await page.getByRole("textbox",{name:"Message your project"}).fill(`Use sk-proj-${"fixture".repeat(10)}`);await page.getByRole("button",{name:"Send",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("private credential");expect(runRequests).toBe(0);
 const saved=await request.get(`${origin}/api/custom-ai/platform/runs?projectId=${await selected.inputValue()}`,{headers:{Authorization:"Bearer fixture-alice"}});expect((await saved.json()).runs).toEqual([]);
});
test("keeps a saved GitHub connection selectable after URL normalization and reload",async({page})=>{
 await page.goto(origin);const selected=page.getByLabel("Your projects",{exact:true}),before=await selected.inputValue();await page.getByRole("button",{name:"New project",exact:true}).click();await expect(selected).not.toHaveValue(before);
 await page.getByRole("tab",{name:"Import & export",exact:true}).click();await page.getByLabel("GitHub repository",{exact:true}).fill("example/score-game");await page.getByText("Connect a private repository",{exact:true}).click();await page.getByLabel("Private GitHub access token",{exact:true}).fill("synthetic-browser-github-secret");await page.getByRole("button",{name:"Save GitHub connection",exact:true}).click();
 await expect(page.getByText("GitHub connected to this project.",{exact:true})).toBeVisible();
 await expect(page.getByLabel("GitHub connection",{exact:true})).toContainText("GitHub · example/score-game");
 await page.reload();await page.getByRole("tab",{name:"Import & export",exact:true}).click();await expect(page.getByLabel("GitHub connection",{exact:true})).toContainText("GitHub · example/score-game");
});
test("reviews a real checked contract through the launch adapter without sending a transaction",async({page,request})=>{
 await page.goto(origin);const selected=page.getByLabel("Your projects",{exact:true}),before=await selected.inputValue();await page.getByRole("button",{name:"New project",exact:true}).click();await expect(selected).not.toHaveValue(before);
 const projectId=await page.getByLabel("Your projects",{exact:true}).inputValue();
 expect((await request.post(`${origin}/fixture/contract`,{headers:{Authorization:"Bearer fixture-alice"},data:{projectId}})).ok()).toBe(true);
 await page.reload();await page.getByRole("tab",{name:"Preview & run",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Contract review",exact:true})).toBeVisible();
 const pending=page.waitForResponse(response=>response.url().endsWith("/platform/launch")&&response.request().postDataJSON()?.action==="freeze");
 await page.getByRole("button",{name:"Review checked contract",exact:true}).click();const reply=await pending;expect(reply.ok()).toBe(true);const value=await reply.json();
 expect(value.project.compiled).toBe(true);expect(value.project.sourceReview).toBe("passed");expect(value.project.scenarios.passed).toBe(true);expect(value.sourceId).toMatch(/^pp-/);
 await expect(page.getByText("Compilation passed · source review passed · declared behavior checks passed",{exact:true})).toBeVisible();
 await page.getByText("Compilation passed · source review passed · declared behavior checks passed",{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:join(process.env.PLATFORM_EVIDENCE_DIR??tmpdir(),"p11-contract-review.png"),fullPage:true});
});
test("shows exhausted hosting recovery and retries only the saved action",async({page})=>{
 await page.goto(origin);const selected=page.getByLabel("Your projects",{exact:true});const created=page.waitForResponse(response=>response.request().method()==="POST"&&response.url().endsWith("/platform/projects"));await page.getByRole("button",{name:"New project",exact:true}).click();
 const projectId=(await (await created).json()).project.projectId;await expect(selected).toHaveValue(projectId);const releaseId="22222222-2222-4222-8222-222222222222";let retried=false;
 await page.route("**/api/custom-ai/platform/releases**",async route=>{
  const request=route.request();
  if(request.method()==="POST"){expect(request.postDataJSON()).toEqual({action:"retry-control",projectId,releaseId});retried=true;await route.fulfill({json:{release:{id:releaseId,state:"published"}}});return;}
  await route.fulfill({json:{releases:[{id:releaseId,revisionId:"earlier",state:retried?"published":"reconcile",mode:"production",url:null,observedAt:"2026-11-07T12:00:00.000Z",errorCode:retried?null:"release-control-unknown",control:retried?null:{action:"promote",state:"unknown",attempts:3}}]}});
 });
 await page.getByRole("tab",{name:"Preview & run",exact:true}).click();
 await expect(page.getByText("The hosting change could not be confirmed. App data access is paused. You can retry this same action.",{exact:true})).toBeVisible();
 await page.screenshot({path:join(process.env.PLATFORM_EVIDENCE_DIR??tmpdir(),"p12-hosting-recovery.png"),fullPage:true});
 await page.getByRole("button",{name:"Retry hosting action",exact:true}).click();await expect(page.getByRole("button",{name:"Retry hosting action",exact:true})).toHaveCount(0);expect(retried).toBe(true);
});
test("polls active run progress without repeatedly downloading project files",async({page,request})=>{
 await request.post(`${origin}/fixture/pause`,{data:{paused:true}});
 try{
  await page.goto(origin);
  const created=page.waitForResponse(response=>response.request().method()==="POST"&&response.url().endsWith("/platform/projects"));
  await page.getByRole("button",{name:"New project",exact:true}).click();
  const projectId=(await(await created).json()).project.projectId;
  await expect(page.getByLabel("Your projects",{exact:true})).toHaveValue(projectId);
  let fullReads=0,progressReads=0;
  page.on("request",request=>{const url=new URL(request.url());if(request.method()!=="GET")return;if(url.pathname.endsWith("/platform/projects")&&url.searchParams.get("projectId")===projectId)fullReads++;if(url.pathname.endsWith("/platform/runs")&&url.searchParams.has("runId"))progressReads++;});
  await page.getByRole("textbox",{name:"Message your project"}).fill("Keep this saved work queued.");
  const refreshed=page.waitForResponse(response=>response.request().method()==="GET"&&response.url().includes(`/platform/runs?projectId=${projectId}`));
  await page.getByRole("button",{name:"Send",exact:true}).click();await refreshed;
  await expect(page.getByRole("button",{name:"Stop",exact:true})).toBeVisible();
  const initialReads=fullReads;
  await expect.poll(()=>progressReads,{timeout:15000}).toBeGreaterThanOrEqual(2);
  expect(fullReads).toBe(initialReads);
  await page.getByRole("button",{name:"Stop",exact:true}).click();
 }finally{await request.post(`${origin}/fixture/pause`,{data:{paused:false}});}
});
test("shows a terminal run even when its changed files cannot reload",async({page,request})=>{
 await request.post(`${origin}/fixture/pause`,{data:{paused:true}});
 let projectId:string|undefined,runId:string|undefined;
 try{
  await page.goto(origin);
  const created=page.waitForResponse(response=>response.request().method()==="POST"&&response.url().endsWith("/platform/projects"));
  await page.getByRole("button",{name:"New project",exact:true}).click();
  projectId=(await(await created).json()).project.projectId;
  await page.getByRole("textbox",{name:"Message your project"}).fill("Keep the saved run status visible.");
  const started=page.waitForResponse(response=>response.request().method()==="POST"&&response.url().endsWith("/platform/runs"));
  await page.getByRole("button",{name:"Send",exact:true}).click();
  runId=(await(await started).json()).run.runId;
  await expect(page.getByRole("button",{name:"Stop",exact:true})).toBeVisible();
  await page.route(url=>url.pathname.endsWith("/platform/projects")&&url.searchParams.get("projectId")===projectId,route=>route.fulfill({status:429,json:{error:"File reads are temporarily limited. Refresh saved state later.",code:"budget"}}));
  const summary="The run reached its work limit. Its saved changes are kept.";
  await page.route(url=>url.pathname.endsWith("/platform/runs")&&url.searchParams.get("runId")===runId,async route=>{
   const original=await route.fetch(),progress=await original.json();
   await route.fulfill({json:{...progress,run:{...progress.run,status:"failed",summary},events:[{cursor:"1",capabilityId:"project.patch"}]}});
  });
  await expect(page.getByRole("region",{name:"Project chat"}).getByText(summary,{exact:true})).toBeVisible({timeout:10000});
  await expect(page.getByRole("button",{name:"Stop",exact:true})).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("File reads are temporarily limited");
 }finally{
  if(projectId&&runId)await request.delete(`${origin}/api/custom-ai/platform/runs?projectId=${projectId}&runId=${runId}`,{headers:{Authorization:"Bearer fixture-alice","x-custom-ai-cache-scope":"fixture:alice"}});
  await request.post(`${origin}/fixture/pause`,{data:{paused:false}});
 }
});
test("polls a building release without repeatedly loading checks and jobs",async({page})=>{
 await page.goto(origin);await page.getByRole("button",{name:"New project",exact:true}).click();
 let progressReads=0,checks=0,jobs=0;
 const release={id:"11111111-1111-4111-8111-111111111111",revisionId:"sha256:"+"1".repeat(64),state:"building",mode:"preview",url:null,errorCode:null,observedAt:null};
 await page.route(url=>url.pathname.endsWith("/platform/releases"),route=>{
  if(new URL(route.request().url()).searchParams.has("releaseId")){progressReads++;return route.fulfill({json:{release:{...release,state:"ready"}}});}
  return route.fulfill({json:{releases:[release]}});
 });
 page.on("request",request=>{if(request.method()!=="GET")return;const path=new URL(request.url()).pathname;if(path.endsWith("/platform/checks"))checks++;if(path.endsWith("/platform/jobs"))jobs++;});
 await page.getByRole("tab",{name:"Preview & run",exact:true}).click();
 await expect(page.getByText("Building · earlier version",{exact:true})).toBeVisible();
 const initial={checks,jobs};
 await expect.poll(()=>progressReads,{timeout:12000}).toBe(1);
 await expect(page.getByText("Preview ready · earlier version",{exact:true})).toBeVisible();
 expect({checks,jobs}).toEqual(initial);
});

for(const allowance of [{hourly:6,daily:100,available:true,want:6},{hourly:25,daily:3,available:false,want:3}]){
 test(`uses the remaining work allowance (${allowance.hourly} hourly, ${allowance.daily} daily)`,async({page})=>{
  await page.route("**/api/custom-ai/usage",route=>route.fulfill({json:{available:allowance.available,active:0,hourly:{used:25-allowance.hourly,limit:25,remaining:allowance.hourly,resetsAt:Date.now()+60000},daily:{used:100-allowance.daily,limit:100,remaining:allowance.daily,resetsAt:Date.now()+60000},resumesAt:0}}));
  await page.goto(origin);await page.getByRole("button",{name:"New project",exact:true}).click();
  await page.getByRole("textbox",{name:"Message your project"}).fill("Discuss the remaining change.");
  const response=page.waitForResponse(response=>response.request().method()==="POST"&&response.url().endsWith("/platform/runs"));
  await page.getByRole("button",{name:"Send",exact:true}).click();
  const saved=await response;expect(saved.request().postDataJSON().budgetUnits).toBe(allowance.want);expect((await saved.json()).run.reservedUnits).toBe(allowance.want);
 });
}
test("keeps the message without starting work when the allowance is exhausted",async({page})=>{
 await page.route("**/api/custom-ai/usage",route=>route.fulfill({json:{available:false,active:0,hourly:{used:25,limit:25,remaining:0,resetsAt:Date.now()+60000},daily:{used:25,limit:100,remaining:75,resetsAt:Date.now()+60000},resumesAt:Date.now()+60000}}));
 await page.goto(origin);await page.getByRole("button",{name:"New project",exact:true}).click();let posts=0;
 page.on("request",request=>{if(request.method()==="POST"&&request.url().endsWith("/platform/runs"))posts++;});
 const input=page.getByRole("textbox",{name:"Message your project"});await input.fill("Keep my requested change.");await page.getByRole("button",{name:"Send",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("allowance");expect(posts).toBe(0);await expect(input).toHaveValue("Keep my requested change.");
});
test("retries the same reservation after a lost response without reading a reduced allowance",async({page,request})=>{
 await request.post(`${origin}/fixture/pause`,{data:{paused:true}});let usageReads=0;const attempts:Record<string,unknown>[]=[];
 try{
  await page.route("**/api/custom-ai/usage",route=>{usageReads++;return route.fulfill({json:{available:usageReads===1,active:0,hourly:{used:usageReads===1?19:25,limit:25,remaining:usageReads===1?6:0,resetsAt:Date.now()+60000},daily:{used:19,limit:100,remaining:81,resetsAt:Date.now()+60000},resumesAt:0}});});
  await page.route("**/api/custom-ai/platform/runs",async route=>{
   if(route.request().method()!=="POST")return route.continue();attempts.push(route.request().postDataJSON());
   if(attempts.length===1){await route.fetch();return route.abort("failed");}return route.continue();
  });
  await page.goto(origin);await page.getByRole("button",{name:"New project",exact:true}).click();await page.getByRole("textbox",{name:"Message your project"}).fill("Save this request once.");await page.getByRole("button",{name:"Send",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button",{name:"Send",exact:true}).click();await expect(page.getByRole("button",{name:"Stop",exact:true})).toBeVisible();
  expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);expect(attempts[0].budgetUnits).toBe(6);expect(usageReads).toBe(1);
  await page.getByRole("button",{name:"Stop",exact:true}).click();
 }finally{await request.post(`${origin}/fixture/pause`,{data:{paused:false}});}
});
