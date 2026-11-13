import {once} from "node:events";
import {expect,test} from "@playwright/test";
// @ts-expect-error Isolated browser fixture host.
import {createPlatformServer} from "./platform-server.mjs";
let fixture:Awaited<ReturnType<typeof createPlatformServer>>,origin:string;
test.beforeEach(async()=>{fixture=await createPlatformServer();fixture.server.listen(0,"127.0.0.1");await once(fixture.server,"listening");origin=`http://127.0.0.1:${fixture.server.address().port}`;});
test.afterEach(async()=>{await fixture.close();});

test("starts from the first message, names the project and opens its saved result",async({page})=>{
 const creations:string[]=[],titles:string[]=[];
 page.on("request",request=>{if(request.method()==="POST"&&request.url().endsWith("/platform/projects"))creations.push(request.postDataJSON().projectId);if(request.method()==="PATCH"&&request.url().endsWith("/platform/projects"))titles.push(request.postDataJSON().patch.title);});
 await page.goto(origin);const input=page.getByRole("textbox",{name:"Describe your idea",exact:true});await expect(input).toBeEnabled();
 await input.fill("Build a shared counter for our game");await input.press("Enter");
 await expect(page.getByText("The counter source is saved. Behavior checks have not run yet.",{exact:true})).toBeVisible({timeout:12000});
 await expect(page.getByRole("tab",{name:"Files",exact:true})).toHaveAttribute("aria-selected","true");
 expect(creations).toHaveLength(1);expect(titles).toEqual(["Shared counter for our game"]);
 await expect(page.getByRole("button",{name:"index.js",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Your work",exact:true}).click();
 await expect(page.getByRole("button",{name:/Shared counter.*Project/})).toBeVisible();
});

test("uses the selected network for a hook starter and resets a new project to build mode",async({page})=>{
 await page.goto(origin);
 await page.getByRole("combobox",{name:"Network for contract starters",exact:true}).selectOption("99901");
 await page.getByRole("button",{name:/^Custom hook/}).click();
 await expect(page.getByRole("textbox",{name:"Describe your idea",exact:true})).toHaveValue("Build a custom hook on Elysium. ");
 await page.getByRole("combobox",{name:"Work mode",exact:true}).selectOption("plan");
 await page.getByRole("button",{name:"New project",exact:true}).click();
 await expect(page.getByRole("textbox",{name:"Message your project",exact:true})).toBeEnabled();
 await expect(page.getByRole("combobox",{name:"Work mode",exact:true})).toHaveValue("build");
 await expect(page.getByRole("textbox",{name:"Message your project",exact:true})).toHaveValue("");
});

for(const summary of ["provider-refused","incomplete"])test(`keeps editing available and distinguishes ${summary} from an unchanged continuation`,async({page,request})=>{
 await request.post(origin+"/fixture/pause",{data:{paused:true}});
 let starts=0;page.on("request",r=>{if(r.method()==="POST"&&r.url().endsWith("/platform/runs"))starts++;});
 await page.route(url=>url.pathname.endsWith("/platform/runs")&&url.searchParams.has("runId"),async route=>{
  if(route.request().method()!=="GET")return route.continue();
  const response=await route.fetch(),body=await response.json();
  await route.fulfill({json:{...body,run:{...body.run,status:"failed",summary}}});
 });
 await page.goto(origin);await page.getByRole("textbox",{name:"Describe your idea",exact:true}).fill("Read the saved project");await page.getByRole("button",{name:"Send",exact:true}).click();
 const input=page.getByRole("textbox",{name:"Message your project",exact:true}),continuation=page.getByRole("button",{name:"Continue from here",exact:true});
 if(summary==="provider-refused"){
  await expect(page.getByRole("region",{name:"Project chat"}).getByText(/AI provider declined/)).toBeVisible();
  await expect(continuation).toHaveCount(0);
 }else await expect(continuation).toBeVisible();
 await expect(input).toBeEnabled();await input.fill("Explain the saved requirements instead");expect(starts).toBe(1);
});

test("recovers a lost first-project response with the same project after reload",async({page,request})=>{
 await request.post(origin+"/fixture/pause",{data:{paused:true}});
 const ids:string[]=[];let lose=true;
 await page.route("**/api/custom-ai/platform/projects",async route=>{
  if(route.request().method()!=="POST")return route.continue();ids.push(route.request().postDataJSON().projectId);
  if(lose){lose=false;await route.fetch();return route.abort("failed");}return route.continue();
 });
 await page.goto(origin);await page.getByRole("textbox",{name:"Describe your idea",exact:true}).fill("Keep this first project exactly once");await page.getByRole("button",{name:"Send",exact:true}).click();
 await expect(page.getByRole("button",{name:"Retry saved message",exact:true})).toBeVisible();await page.reload();
 await expect(page.getByRole("textbox",{name:"Message your project",exact:true})).toHaveValue("Keep this first project exactly once");
 await page.getByRole("button",{name:"Send",exact:true}).click();await expect(page.getByRole("button",{name:"Stop",exact:true})).toBeVisible();
 expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(1);
 const listed=await request.get(origin+"/api/custom-ai/platform/projects",{headers:{Authorization:"Bearer fixture-alice"}});expect((await listed.json()).projects).toHaveLength(1);
 await page.getByRole("button",{name:"Stop",exact:true}).click();await expect(page.getByRole("button",{name:"Stop",exact:true})).toBeHidden();
});

test("shows real work phases and keeps input credentials out of a new project",async({page,request})=>{
 await page.goto(origin);let created=0;page.on("request",r=>{if(r.method()==="POST"&&r.url().endsWith("/platform/projects"))created++;});
 const box=page.getByRole("textbox",{name:"Describe your idea",exact:true});await box.fill("Use sk-ant-api03-"+"a".repeat(120));await page.getByRole("button",{name:"Send",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("private credential");expect(created).toBe(0);
 await request.post(origin+"/fixture/pause",{data:{paused:true}});
 await page.route(url=>url.pathname.endsWith("/platform/runs")&&url.searchParams.has("runId"),async route=>{if(route.request().method()!=="GET")return route.continue();const r=await route.fetch(),body=await r.json();await route.fulfill({json:{...body,run:{...body.run,status:body.run.status==="stopped"?"stopped":"running"},activeStep:{capabilityId:"project.check",state:"dispatching"},events:[{cursor:"1",capabilityId:"project.patch",ok:true},{cursor:"2",capabilityId:"repository.import",ok:false}]}});});
 await box.fill("Check the saved game files");await page.getByRole("button",{name:"Send",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:"Checking your app"})).toBeVisible();await expect(page.getByText("Files saved",{exact:true})).toBeVisible();await expect(page.getByText("Files imported",{exact:true})).toBeHidden();
 await expect(page.getByText(/work units ·/)).toBeHidden();await page.getByText("Run details",{exact:true}).click();await expect(page.getByText(/work units ·/)).toBeVisible();
 await page.getByRole("button",{name:"Stop",exact:true}).click();await expect(page.getByRole("button",{name:"Stop",exact:true})).toBeHidden();
});

test("queues only a checked current app preview and opens it without publishing",async({page})=>{
 let projectId="",revisionId="",release:Record<string,unknown>|undefined;const writes:Record<string,unknown>[]=[];
  await page.route(url=>url.pathname.endsWith("/platform/projects")&&url.searchParams.has("projectId"),async route=>{const r=await route.fetch(),body=await r.json();projectId=body.project.projectId;revisionId=body.project.revisionId;body.project.document.architecture={application:{framework:"static",outputDirectory:"public"}};await route.fulfill({json:body});});
 await page.route("**/api/custom-ai/platform/checks**",route=>route.fulfill({json:{level:"checked",verified:true,missingRequirementIds:[],evidence:[]}}));
 await page.route("**/api/custom-ai/platform/releases**",async route=>{
  if(route.request().method()==="POST"){const body=route.request().postDataJSON();writes.push(body);expect(body.mode).toBe("preview");expect(body.action).toBe("queue");release={id:"11111111-1111-4111-8111-111111111111",revisionId,state:"ready",mode:"preview",url:"https://checked-preview.vercel.app",errorCode:null,observedAt:new Date().toISOString()};return route.fulfill({status:202,json:{release}});}
  return route.fulfill({json:{releases:release?[release]:[]}});
 });
 await page.route("https://checked-preview.vercel.app/**",route=>route.fulfill({contentType:"text/html",body:"<h1>Saved app preview</h1>"}));
 await page.goto(origin);await page.getByRole("textbox",{name:"Describe your idea",exact:true}).fill("Build a game with saved scores");await page.getByRole("button",{name:"Send",exact:true}).click();
 await expect(page.getByTitle("Your app preview")).toBeVisible({timeout:12000});expect(projectId).not.toBe("");expect(writes).toHaveLength(1);expect(writes[0].idempotencyKey).toMatch(/^preview:/);
 await expect(page.getByRole("button",{name:"Publish this version",exact:true})).toBeVisible();
 await page.reload();await page.getByRole("tab",{name:"Preview & run",exact:true}).click();await expect(page.getByTitle("Your app preview")).toBeVisible();expect(writes).toHaveLength(1);
});

for(const reason of ["unchecked version","preview opted out"])test(`does not queue an app preview for ${reason}`,async({page})=>{
 let writes=0;
 await page.route(url=>url.pathname.endsWith("/platform/projects")&&url.searchParams.has("projectId"),async route=>{const r=await route.fetch(),body=await r.json();body.project.document.architecture={kind:"application",application:{framework:"static",outputDirectory:"public"}};await route.fulfill({json:body});});
 await page.route("**/api/custom-ai/platform/checks**",route=>route.fulfill({json:{level:"checked",verified:reason!=="unchecked version",missingRequirementIds:[],evidence:[]}}));
 await page.route("**/api/custom-ai/platform/releases**",route=>{if(route.request().method()==="POST")writes++;return route.fulfill({json:{releases:[]}});});
 await page.goto(origin);
 if(reason==="preview opted out")await page.getByRole("checkbox",{name:"Preview apps after successful checks",exact:true}).uncheck();
 await page.getByRole("textbox",{name:"Describe your idea",exact:true}).fill("Build an app with a score counter");await page.getByRole("button",{name:"Send",exact:true}).click();
 const preview=page.getByRole("button",{name:/^Build preview for version/});await expect(preview).toBeVisible({timeout:12000});
 if(reason==="unchecked version")await expect(preview).toBeDisabled();else await expect(preview).toBeEnabled();
 expect(writes).toBe(0);await expect(page.getByTitle("Your app preview")).toHaveCount(0);
});
