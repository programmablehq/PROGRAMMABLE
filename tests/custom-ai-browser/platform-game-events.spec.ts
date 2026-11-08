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
test("signs a game invitation and keeps transaction review separate from sending",async({page})=>{
 await open(page);await page.getByRole("button",{name:"Refresh game state",exact:true}).click();
 await page.getByLabel("Signed game file",{exact:true}).setInputFiles({name:"invitation.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({player:`0x${"22".repeat(20)}`,playerIdHash:`0x${"77".repeat(32)}`,nonce:`0x${"88".repeat(32)}`,validUntil:Math.floor(Date.now()/1000)+120,issuerSignature:`0x${"bb".repeat(65)}`}))});
 await page.getByRole("button",{name:"Sign game account link",exact:true}).click();
 await expect(page.getByText("Signed wallet agreement saved. Onchain confirmation is still required.",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Prepare wallet link",exact:true}).click();await expect(page.getByRole("button",{name:"Confirm game transaction",exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__gameFixture.calls.filter(c=>c.walletKind==="send").length)).toBe(0);
 await page.getByRole("button",{name:"Confirm game transaction",exact:true}).click();
 await expect(page.getByText("Wallet linked onchain.",{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__gameFixture.calls.filter(c=>c.walletKind==="send").length)).toBe(1);
});
async function readyWalletTransaction(page:import("@playwright/test").Page){
 await open(page);await page.getByRole("button",{name:"Refresh game state",exact:true}).click();
 await page.getByLabel("Signed game file",{exact:true}).setInputFiles({name:"signed.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({player:`0x${"22".repeat(20)}`,playerIdHash:`0x${"77".repeat(32)}`,nonce:`0x${"88".repeat(32)}`,validUntil:Math.floor(Date.now()/1000)+120,signature:`0x${"cc".repeat(65)}`,issuerSignature:`0x${"bb".repeat(65)}`}))});
 await page.getByRole("button",{name:"Record signed result",exact:true}).click();await page.getByRole("button",{name:"Prepare wallet link",exact:true}).click();
}
test("moves an uncertain wallet result into recovery without another confirmation button",async({page})=>{
 await readyWalletTransaction(page);await page.evaluate(()=>{window.__gameFixture.walletError=true;});await page.getByRole("button",{name:"Confirm game transaction",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("uncertain");await expect(page.getByRole("button",{name:"Confirm game transaction",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Check wallet link",exact:true}).click();await expect(page.getByText("Wallet response pending",{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__gameFixture.calls.filter(c=>c.walletKind==="send").length)).toBe(1);
});
test("prevents double-click sends and releases a changing project wallet lock once",async({page})=>{
 await readyWalletTransaction(page);await page.evaluate(()=>{window.__gameFixture.walletDelay=400;});
 await page.getByRole("button",{name:"Confirm game transaction",exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 await page.getByRole("button",{name:"Change project revision",exact:true}).click();await expect(page.getByLabel("Game name",{exact:true})).toHaveValue("my-game");
 expect(await page.evaluate(()=>window.__gameFixture.calls.filter(c=>c.walletBusy!==undefined).map(c=>c.walletBusy))).toEqual([true,false]);await page.waitForTimeout(600);
 expect(await page.evaluate(()=>window.__gameFixture.calls.filter(c=>c.walletKind==="send").length)).toBe(1);
 expect(await page.evaluate(()=>window.__gameFixture.calls.filter(c=>c.walletBusy!==undefined).map(c=>c.walletBusy))).toEqual([true,false]);
 expect(await page.evaluate(()=>window.__gameFixture.calls.some(c=>c.action==="reconcile-wallet"))).toBe(false);
});
test("rejects private fields in a game file before any network request",async({page})=>{
 await open(page);await page.getByRole("button",{name:"Refresh game state",exact:true}).click();await page.getByLabel("Signed game file",{exact:true}).setInputFiles({name:"unsafe.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({eventId:`0x${"88".repeat(32)}`,signature:`0x${"bb".repeat(65)}`,privateKey:"never send"}))});
 await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByRole("button",{name:"Record signed result",exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.__gameFixture.calls.some(c=>c.action==="record"))).toBe(false);
});
test("discards an unsent review without submitting a wallet transaction",async({page})=>{
 await readyWalletTransaction(page);await page.getByRole("button",{name:"Discard unsent request",exact:true}).click();
 await expect(page.getByText("Unsent request discarded. You can prepare a new review.",{exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Confirm game transaction",exact:true})).toHaveCount(0);expect(await page.evaluate(()=>window.__gameFixture.calls.some(c=>c.walletKind==="send"))).toBe(false);
});
test("can reopen an original game result after a lost dispatch acknowledgement",async({page})=>{
 await open(page);await page.evaluate(()=>{window.__gameFixture.events=[{id:`0x${"ab".repeat(32)}`,bindingId:`0x${"33".repeat(32)}`,state:"prepared",walletPending:true,player:`0x${"22".repeat(20)}`,transactionHash:null,step:{id:"original-event-step",kind:"program-action",state:"dispatching",preparedBlock:"100",expiresAt:Math.floor(Date.now()/1000)+120,transaction:{from:`0x${"22".repeat(20)}`,to:`0x${"55".repeat(20)}`,chainId:4663,value:"0x0",nonce:"0x1",gas:"0x100000",data:"0x1234"}}}]});
 await page.getByRole("button",{name:"Refresh game state",exact:true}).click();await page.getByRole("button",{name:"Review saved game request",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Review game transaction",exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__gameFixture.calls.some(c=>c.action==="prepare"||c.walletKind==="send"))).toBe(false);
});
test("clears the transaction review after an explicit wallet rejection",async({page})=>{
 await readyWalletTransaction(page);await page.evaluate(()=>{window.__gameFixture.walletRejected=true;});await page.getByRole("button",{name:"Confirm game transaction",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("rejected");await expect(page.getByRole("button",{name:"Confirm game transaction",exact:true})).toHaveCount(0);
});
test("shows recovery instead of a fresh confirmation when prepare returns a pending request",async({page})=>{
 await readyWalletTransaction(page);await page.getByRole("button",{name:"Close transaction review",exact:true}).click();await page.evaluate(()=>{window.__gameFixture.prepareState="dispatching";});
 await page.getByRole("button",{name:"Prepare wallet link",exact:true}).click();await expect(page.getByRole("button",{name:"Confirm game transaction",exact:true})).toHaveCount(0);
 await expect(page.getByText("Wallet response pending",{exact:true}).first()).toBeVisible();
});
