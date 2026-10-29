import { test, expect } from "@playwright/test";
import rules from "../fixtures/custom-ai/london-liquidity-v2.json";
const hash = "a".repeat(64);
const draft = { source: "fixture-source", sourceHash: hash, compiled: true, diagnostics: [], hookSummary: "charges 3% on buys and sells",
  verification: { status: "passed", sourceHash: hash, requirements: ["Charge 3% on buys and sells"], checks: [true,false].map(buy=>({afterSeconds:0,buy,totalFeeBps:300})), cases:8 },
  validation: { status: "passed", samples: [], cases:8 } };
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
  await page.getByLabel("Name",{exact:true}).fill("Rain");
  await expect(page.getByLabel("Name",{exact:true})).toHaveValue("Rain");
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
