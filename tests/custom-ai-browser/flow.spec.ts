import { test, expect } from "@playwright/test";
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
