import {once} from "node:events";
import type {Server} from "node:http";
import {test,expect} from "@playwright/test";
// @ts-expect-error Executable esbuild fixture host.
import {createGameEventsServer} from "./game-events-server.mjs";
let server:Server,origin:string;
test.beforeAll(async()=>{server=await createGameEventsServer();server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==="string")throw Error("Fixture unavailable");origin=`http://127.0.0.1:${address.port}`;});
test.afterAll(async()=>{server.close();await once(server,"close");});
async function open(page:import("@playwright/test").Page){await page.goto(origin);await page.getByText("Game integration",{exact:true}).click();}
async function configure(page:import("@playwright/test").Page){await page.getByLabel("Game name",{exact:true}).fill("maze");await page.getByLabel("Game issuer address",{exact:true}).fill(`0x${"11".repeat(20)}`);await page.getByLabel("Deployed receiver address",{exact:true}).fill(`0x${"55".repeat(20)}`);}
test("reviews actual receiver configuration before registering it",async({page})=>{
 await open(page);await configure(page);await page.getByRole("button",{name:"Check deployed receiver",exact:true}).click();
 await expect(page.getByText("Receiver verified. Review and save this binding.",{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__gameFixture.calls.some(c=>c.action==="bind"))).toBe(false);
 await page.getByRole("button",{name:"Save verified binding",exact:true}).click();
 await expect(page.getByText("Binding saved.",{exact:true})).toBeVisible();
 const call=await page.evaluate(()=>window.__gameFixture.calls.find(c=>c.action==="bind"));expect(call?.binding).toMatchObject({gameId:"maze",revisionId:`sha256:${"44".repeat(32)}`});
});
test("editing receiver fields invalidates the previous verified preview",async({page})=>{
 await open(page);await configure(page);await page.getByRole("button",{name:"Check deployed receiver",exact:true}).click();await expect(page.getByRole("button",{name:"Save verified binding",exact:true})).toBeVisible();
 await page.getByLabel("Deployed receiver address",{exact:true}).fill(`0x${"77".repeat(20)}`);await expect(page.getByRole("button",{name:"Save verified binding",exact:true})).toHaveCount(0);
});
test("rejects mismatched receiver code without offering a save",async({page})=>{
 await open(page);await configure(page);await page.evaluate(()=>{window.__gameFixture.fail=true;});await page.getByRole("button",{name:"Check deployed receiver",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("does not match");await expect(page.getByRole("button",{name:"Save verified binding",exact:true})).toHaveCount(0);
});
test("discarding a project revision discards an in-flight receiver check",async({page})=>{
 await open(page);await configure(page);await page.evaluate(()=>{window.__gameFixture.delay=400;});await page.getByRole("button",{name:"Check deployed receiver",exact:true}).click();await page.getByRole("button",{name:"Change project revision",exact:true}).click();await page.waitForTimeout(600);
 await expect(page.getByRole("button",{name:"Save verified binding",exact:true})).toHaveCount(0);expect(await page.evaluate(()=>window.__gameFixture.calls.some(c=>c.action==="bind"))).toBe(false);
});
test("imports a signed result with its selected saved binding and fits a narrow screen",async({page})=>{
 await page.setViewportSize({width:320,height:800});await open(page);await page.getByRole("button",{name:"Refresh game state",exact:true}).click();
 await page.getByLabel("Signed game file",{exact:true}).setInputFiles({name:"game-result.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({eventId:`0x${"88".repeat(32)}`,player:`0x${"99".repeat(20)}`,playerIdHash:`0x${"aa".repeat(32)}`,sequence:"1",score:"1",observedAt:1800000000,validUntil:1800000120,signature:`0x${"bb".repeat(65)}`}))});
 await page.getByRole("button",{name:"Record signed result",exact:true}).click();await expect(page.getByText("Signed result recorded. Onchain confirmation is still required.",{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__gameFixture.calls.find(c=>c.action==="record"))).toMatchObject({bindingId:`0x${"33".repeat(32)}`,projectId:"11111111-1111-4111-8111-111111111111"});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("does not attach a late file read to another selected binding",async({page})=>{
 await open(page);await page.getByRole("button",{name:"Refresh game state",exact:true}).click();
 await page.evaluate(()=>{const original=File.prototype.text;File.prototype.text=async function(){await new Promise(r=>setTimeout(r,300));return original.call(this);};});
 await page.getByLabel("Signed game file",{exact:true}).setInputFiles({name:"slow.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({eventId:`0x${"88".repeat(32)}`,signature:`0x${"bb".repeat(65)}`}))});
 await page.getByLabel("Selected game",{exact:true}).selectOption(`0x${"aa".repeat(32)}`);await page.waitForTimeout(500);
 await expect(page.getByRole("button",{name:"Record signed result",exact:true})).toHaveCount(0);
});
