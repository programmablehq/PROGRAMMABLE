import { test, expect } from "@playwright/test";
import rules from "../fixtures/custom-ai/london-liquidity-v2.json";
const hash = "a".repeat(64);
const draft = { source: "fixture-source", sourceHash: hash, compiled: true, diagnostics: [], hookSummary: "charges 3% on buys and sells",
  verification: { status: "passed", sourceHash: hash, requirements: ["Charge 3% on buys and sells"], checks: [true,false].map(buy=>({afterSeconds:0,buy,totalFeeBps:300})), cases:8 },
  validation: { status: "passed", samples: [], cases:8 } };
test("keeps ten requested rules and four open choices through reload and a coin switch",async({page},testInfo)=>{
  const texts=["Start at 10%","Fall over ten minutes","Then stay at 1%","No transfer tax","No later minting","No creator liquidity withdrawal",
    "Use London rain","Send fees to liquidity","Buy back on a trigger","Cap the initial wallet buy"];
  const questions=["Which weather feed?","What execution limit?","Which trigger?","What wallet cap?"];
  const intent={version:1,id:"intent-browser-0001",revision:"b".repeat(64),unresolved:questions,changes:[],
    requirements:texts.map((text,index)=>({id:`rule-${index}`,text,kind:index>=3&&index<=5?"constraint":"behavior",
      origin:{kind:"message",requestId:"intent-browser-0001",messageIndex:0,quote:text},open:index<6?null:questions[index-6]}))};
  let calls=0;
  await page.route("**/api/custom-ai",route=>{calls++;return route.fulfill({json:{reply:"All ten requirements are saved. Four choices remain open.",intent,change:"blocked",setupPatch:{name:"Complete Idea",symbol:"IDEA"}}});});
  await page.goto("/launch/custom-ai");
  const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
  await box.fill(`Build this: ${texts.join(". ")}`);await box.press("Enter");
  const requested=page.locator("details").filter({has:page.locator("summary",{hasText:"Requested rules (10)"})});
  await expect(requested).toBeVisible();
  for(const text of texts)await expect(requested.getByText(text,{exact:true})).toBeVisible();
  for(const question of questions)await expect(requested.getByText(`Open: ${question}`,{exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("complete-intent.png"),fullPage:true});
  await expect(page.getByText("Checked draft",{exact:true})).toHaveCount(0);
  await box.fill("Only adjust the weather rule later.");await page.reload();
  await expect(box).toHaveValue("Only adjust the weather rule later.");
  await expect(requested.getByText("No later minting",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"New coin",exact:true}).click();
  await expect(page.getByText("Requested rules (10)",{exact:true})).toHaveCount(0);
  await page.getByText("Options",{exact:true}).click();
  await page.getByRole("button",{name:"Restore previous coin",exact:true}).click();
  await expect(requested.getByText("No later minting",{exact:true})).toBeVisible();
  await expect(box).toHaveValue("Only adjust the weather rule later.");
  expect(calls).toBe(1);
});
test("keeps a checked draft on reload and blocks an unapplied edit without a rule checkbox", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/custom-ai", async route => {
    calls++;
    if (calls === 1) await route.fulfill({ contentType: "application/json", body: JSON.stringify({ reply: "Your coin charges 3% on buys and sells.", draft,
      setupPatch: {name:"Rain",symbol:"RAIN"}, change:"applied" }) });
    else await route.fulfill({ status:503,contentType:"application/json",body:JSON.stringify({error:"The AI provider is temporarily unavailable.",requestState:"failed"}) });
  });
  await page.goto("/launch/custom-ai");
  const box = page.getByRole("textbox", { name: "Describe your coin or ask a question" });
  await expect(box).toBeEditable();
  await box.fill("Build Rain with a 3% fee on buys and sells"); await box.press("Enter");
  await expect(page.getByRole("heading", { name: "Rain", exact:true })).toBeVisible();
  await expect(page.getByText("Charge 3% on buys and sells", {exact:true})).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Rain", exact:true })).toBeVisible();
  await box.fill("Change to 4%"); await box.press("Enter");
  await expect(page.getByRole("alert").filter({hasText:"AI provider"})).toBeVisible();
  await expect(page.getByRole("heading", { name:"Change not applied" })).toBeVisible();
  expect(calls).toBe(2);
});
test("mobile layout reflows and the editor remains keyboard accessible", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/launch/custom-ai");
  const box=page.getByRole("textbox", {name:"Describe your coin or ask a question"});
  await box.focus(); await expect(box).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("summary").filter({ hasText: "Coin details" }).click();
  await page.getByLabel("Name",{exact:true}).fill("Rain");
  await expect(page.getByLabel("Name",{exact:true})).toHaveValue("Rain");
});
test("new coin is separate from clearing messages and restores the unsent edit", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/custom-ai", route => {
    calls++;
    return route.fulfill({ json: { reply: "Saved Rain.", draft, setupPatch: { name: "Rain", symbol: "RAIN" }, change: "applied" } });
  });
  await page.goto("/launch/custom-ai");
  const box = page.getByRole("textbox", { name: "Describe your coin or ask a question" });
  await box.fill("Build Rain with 3% fees"); await box.press("Enter");
  await expect(page.getByRole("heading", { name: "Rain", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add coin image", exact: true })).toBeEnabled();
  await page.getByText("Options", { exact: true }).click();
  await page.getByRole("button", { name: "Clear messages", exact: true }).click();
  await expect(page.getByText("Keep shaping your coin", { exact: true })).toBeVisible();
  await expect(page.getByText("Charge 3% on buys and sells", { exact: true })).toBeVisible();
  await box.fill("Only change the fee after five minutes");
  await page.getByRole("button", { name: "New coin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your coin", exact: true })).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(page.getByText("Charge 3% on buys and sells", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Restore previous coin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rain", exact: true })).toBeVisible();
  await expect(box).toHaveValue("Only change the fee after five minutes");
  expect(calls).toBe(1);
});

test("preview and composer remain reachable at each supported layout width", async ({ page }, testInfo) => {
  await page.goto("/launch/custom-ai");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("textbox", { name: "Describe your coin or ask a question" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your coin", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${width}.png`), fullPage: true });
  }
});
test("starter ideas fill the composer without spending a request", async ({page}) => {
  let calls=0;
  await page.route("**/api/custom-ai",route=>{calls++;return route.fulfill({json:{reply:"Unexpected request"}});});
  await page.goto("/launch/custom-ai");
  await page.getByRole("button",{name:"A falling launch fee"}).click();
  const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
  await expect(box).toHaveValue(/5%.*1%.*10 minutes/);
  await expect(box).toBeFocused();
  await expect(page.getByRole("button",{name:"Launch coin"})).toBeDisabled();
  expect(calls).toBe(0);
});
test("a selected rule is sent with the exact saved source and survives a failed reply",async({page})=>{
  const requests:Record<string,unknown>[]=[];
  await page.route("**/api/custom-ai",async route=>{
    requests.push(route.request().postDataJSON());
    if(requests.length===1)await route.fulfill({json:{reply:"Your complete rules are saved.",change:"applied",draft:{...draft,composable:{spec:rules,feeds:[]}}}});
    else await route.fulfill({status:503,json:{error:"Please retry later.",requestState:"failed"}});
  });
  await page.goto("/launch/custom-ai");
  const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});
  await box.fill("Build these rules");await box.press("Enter");
  await page.getByText("Edit a rule",{exact:true}).click();
  await page.getByRole("button",{name:"Edit rule: 10% declines to 1% over ten minutes",exact:true}).click();
  await expect(box).toBeFocused();
  await expect(page.getByText("Editing: 10% declines to 1% over ten minutes",{exact:true})).toBeVisible();
  await box.fill("Start at 8% instead.");await box.press("Enter");
  await expect(page.getByRole("alert").filter({hasText:"Please retry later."})).toHaveText("Please retry later.");
  expect(requests[1].editTarget).toEqual({sourceHash:hash,requirementId:"decay"});
  await page.reload();
  await expect(box).toHaveValue("Start at 8% instead.");
  await expect(page.getByText("Editing: 10% declines to 1% over ten minutes",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Keep previous rules",exact:true}).click();
  await expect(page.getByText("Editing: 10% declines to 1% over ten minutes",{exact:true})).toHaveCount(0);
  await box.fill("Explain the saved rules.");await box.press("Enter");
  await expect(page.getByRole("alert").filter({hasText:"Please retry later."})).toHaveText("Please retry later.");
  expect(requests[2].contextId).toBe(requests[0].id);
});
test("shows the full timed and weather rule together with its liquidity allocation",async({page},testInfo)=>{
  await page.route("**/api/custom-ai",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({reply:"The combined rules are ready for review.",change:"applied",setupPatch:{name:"Weather",symbol:"WTHR"},draft:{...draft,hookSummary:"starts at 10%, falls to 1% over ten minutes, then follows London rain and reinvests additional fees",composable:{spec:rules,feeds:[]}}})}));
  await page.goto("/launch/custom-ai");
  const box=page.getByRole("textbox",{name:"Describe your coin or ask a question"});await box.fill("Build the timed London liquidity rule");await box.press("Enter");
  const review=page.getByRole("region",{name:"Rules for this coin"});
  await expect(review.getByText("After 10 minutes",{exact:true})).toBeVisible();
  await expect(review.getByText(/London rain is at least 0.001 mm/)).toBeVisible();
  await expect(review.getByText("100% → permanently locked liquidity",{exact:true})).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath("combined-rules-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.reload();
  await expect(page.getByText("100% → permanently locked liquidity",{exact:true})).toBeVisible();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("combined-rules-mobile.png"),fullPage:true});
});

test("copies complete answers and exact code without another model request", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { copied: string[] };
    state.copied = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => { state.copied.push(value); } } });
  });
  let calls = 0;
  const code = "uint256 fee = 50;\naddress recipient = 0x1000000000000000000000000000000000000001;\n";
  const reply = `These are the exact values.\n\n\`\`\`solidity\n${code}\`\`\`\nKeep the recipient unchanged.`;
  await page.route("**/api/custom-ai", route => { calls++; return route.fulfill({ json: { reply, change: "unchanged" } }); });
  await page.goto("/launch/custom-ai");
  const box = page.getByRole("textbox", { name: "Describe your coin or ask a question" });
  await box.fill("Show the exact code"); await box.press("Enter");
  await page.getByRole("button", { name: "Copy answer", exact: true }).click();
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([reply, code]);
  expect(calls).toBe(1);
});

test("reports a blocked clipboard and displays unsafe markup as text", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw Error("Permission denied"); } } });
  });
  const reply = '<img src=x onerror="alert(1)"> javascript:alert(1)';
  await page.route("**/api/custom-ai", route => route.fulfill({ json: { reply, change: "unchanged" } }));
  await page.goto("/launch/custom-ai");
  const box = page.getByRole("textbox", { name: "Describe your coin or ask a question" });
  await box.fill("Explain this pasted markup"); await box.press("Enter");
  await page.getByRole("button", { name: "Copy answer", exact: true }).click();
  await expect(page.getByText("Copy did not work. Select the text and copy it manually.", { exact: true })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
});
