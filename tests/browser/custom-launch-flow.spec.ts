import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Local server bundles the actual launch components with an inert wallet.
import { createCustomLaunchFlowServer } from "./fixtures/custom-launch-flow-server.mjs";

let server: Server, origin: string;
test.beforeAll(async () => {
  server = await createCustomLaunchFlowServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server.close(); await once(server, "close"); });

for (const width of [1440, 390]) test(`one visible signing action at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(origin);
  const sign = page.getByRole("button", { name: "Sign and launch", exact: true });
  await expect(sign).toBeVisible();
  await expect(page.getByText("Controller wallet", { exact: true })).toBeHidden();
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(0);
  await page.screenshot({ path: info.outputPath(`launch-${width}.png`), fullPage: true });
  await sign.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => page.evaluate(() => window.__customLaunchFixture.sends())).toBe(1);
  await expect(page.getByText("Transaction saved.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("approval prepares automatically without sending, and retry recovers a preparation error", async ({ page }) => {
  await page.goto(origin + "?scenario=approved-retry");
  await page.getByRole("button", { name: "Retry preparation" }).click();
  await expect(page.getByRole("button", { name: "Sign and launch", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__customLaunchFixture.startCalls)).toBe(2);
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(0);
});

test("pending review cannot prepare or sign", async ({ page }) => {
  await page.goto(origin + "?scenario=manual-review");
  await expect(page.getByRole("heading", { name: "Review pending", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and launch", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__customLaunchFixture.startCalls)).toBe(0);
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(0);
});

test("wallet cancellation permits a deliberate retry", async ({ page }) => {
  await page.goto(origin + "?scenario=rejected");
  const sign = page.getByRole("button", { name: "Sign and launch", exact: true });
  await sign.click();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  await expect(sign).toBeEnabled();
  await sign.click();
  await expect.poll(() => page.evaluate(() => window.__customLaunchFixture.sends())).toBe(2);
});

test("an interrupted wallet response never resends automatically", async ({ page }) => {
  await page.goto(origin + "?scenario=lost-response");
  await page.getByRole("button", { name: "Sign and launch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Checking your transaction", exact: true })).toBeVisible();
  await page.getByText("I already sent it", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Check transaction", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Checking your transaction", exact: true })).toBeVisible();
  await page.getByText("I already sent it", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Check transaction", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and launch", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(1);
});

test("a missing wallet hash is discovered and tracked without any new send", async ({ page }, info) => {
  await page.goto(origin + "?scenario=automatic-recovery");
  await page.getByRole("button", { name: "Sign and launch", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("wallet response was interrupted");
  await expect(page.getByRole("heading", { name: "Checking your transaction", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and launch", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__customLaunchFixture.requests.length)).toBeGreaterThan(0);
  await page.evaluate(() => window.__customLaunchFixture.discoverMined());
  await expect(page.getByText("Transaction saved.", { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__customLaunchFixture.proofCalls)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(1);
  expect(await page.evaluate(() => window.__customLaunchFixture.requests.filter(call => /send|sign|wallet_/i.test(call.method)).length)).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("automatic-recovery.png"), fullPage: true });
  await page.evaluate(() => window.__customLaunchFixture.finalize());
  await page.getByRole("button", { name: "Refresh custom projects", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("programmable:custom-launch-send:v1:4663:0x1111111111111111111111111111111111111111"))).toBeNull();
});
