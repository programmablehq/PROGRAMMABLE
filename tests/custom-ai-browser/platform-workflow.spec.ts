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
  await page.getByRole("button",{name:"Create your first project"}).click();
  const input=page.getByRole("textbox",{name:"Message your project"});await input.fill("Baue einen Zähler für unser Spiel.");await page.getByRole("button",{name:"Send",exact:true}).click();
  await expect(page.getByText("The counter source is saved. Behavior checks have not run yet.")).toBeVisible();
  await page.reload();await expect(page.getByRole("region",{name:"Project chat"}).getByText("Baue einen Zähler für unser Spiel.",{exact:true})).toBeVisible();
  await page.getByRole("tab",{name:"Files",exact:true}).click();await page.getByRole("button",{name:"index.js",exact:true}).click();
  await page.getByRole("textbox",{name:"index.js",exact:true}).fill("export const count = 2;\n");
  await expect(page.getByLabel("Your projects",{exact:true})).toBeDisabled();await page.getByRole("button",{name:"Save file",exact:true}).click();
  await expect(page.getByLabel("Your projects",{exact:true})).toBeEnabled();await page.reload();await page.getByRole("tab",{name:"Files",exact:true}).click();await page.getByRole("button",{name:"index.js",exact:true}).click();await expect(page.getByRole("textbox",{name:"index.js",exact:true})).toHaveValue("export const count = 2;\n");
  await page.getByLabel("Fixture account",{exact:true}).selectOption("bob");await expect(page.getByRole("button",{name:"Create your first project"})).toBeVisible();await expect(page.getByText("Baue einen Zähler für unser Spiel.",{exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});
test("keeps one queued request through refresh and stops that saved run",async({page,request})=>{
  await request.post(`${origin}/fixture/pause`,{data:{paused:true}});await page.goto(origin);await page.getByRole("button",{name:"New project",exact:true}).click();
  const prompt="Wait for my next step.";await page.getByRole("textbox",{name:"Message your project"}).fill(prompt);await page.getByRole("button",{name:"Send",exact:true}).click();await expect(page.getByRole("button",{name:"Stop",exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText(prompt,{exact:true})).toHaveCount(1);await page.getByRole("button",{name:"Stop",exact:true}).click();await expect(page.getByRole("region",{name:"Project chat"}).getByText("Stopped",{exact:true}).last()).toBeVisible();await request.post(`${origin}/fixture/pause`,{data:{paused:false}});
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
  await page.setViewportSize({width:320,height:780});await page.keyboard.press("Home");await expect(projectTab).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
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
