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

test("a history read can finish after the first upstream attempt times out", async ({ page }) => {
  await page.goto(origin + "?scenario=workspace-retry");
  const workspace = page.getByRole("region", { name: "Your launches" });
  await expect(workspace.getByRole("button", { name: /Custom launch Base/ })).toBeVisible({ timeout: 25_000 });
  await expect(workspace.getByRole("status")).toHaveText("3 launches");
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(0);
});

test("a verified launch is usable while another history source is pending and after it fails", async ({ page }) => {
  await page.goto(origin + "?scenario=workspace-progress");
  const workspace = page.getByRole("region", { name: "Your launches" });
  const card = workspace.getByRole("button", { name: /Open Signal.*Source verified/ });
  await expect(card).toBeVisible();
  await expect(workspace.getByRole("status")).toHaveText("Loading your launches…");
  await page.evaluate(() => window.dispatchEvent(new Event("finish-history-read")));
  await expect(workspace.getByRole("status")).toHaveText("4 launches");
  await card.click();
  await expect(page.getByRole("heading", { name: "Opening your coin" })).toBeVisible();
  expect(await page.evaluate(() => window.__customLaunchFixture.navigated)).toBe("");
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(0);
});

test("wallet history polls and paginates only the selected chain", async ({ page }) => {
  await page.clock.install();
  await page.goto(origin + "?scenario=workspace-pagination");
  const workspace = page.getByRole("region", { name: "Your launches" });
  const chain = workspace.getByRole("combobox", { name: "Chain" });
  const more = workspace.getByRole("button", { name: "Load more launches" });
  const takeReads = () => page.evaluate(() => window.__customLaunchFixture.historyReads.splice(0));

  await expect(workspace.getByRole("status")).toHaveText("3 launches");
  expect((await takeReads()).map(read => read.source)).toEqual(["combined", "8453", "999", "99901", "custom_launch_plan_v1", "multi_role_v2"]);
  await chain.selectOption("99901");
  await expect(workspace.getByRole("status")).toHaveText("1 launch");
  await expect(more).toHaveCount(0);
  expect(await takeReads()).toEqual([{ source: "99901", cursor: null }]);

  await chain.selectOption("8453");
  await expect(more).toBeEnabled();
  await more.click();
  await expect(more).toHaveCount(0);
  expect(await takeReads()).toEqual([{ source: "8453", cursor: null }, { source: "8453", cursor: "next-8453" }]);
  await page.clock.fastForward(20_100);
  await expect.poll(() => page.evaluate(() => window.__customLaunchFixture.historyReads)).toEqual([{ source: "8453", cursor: null }]);
  await expect(more).toHaveCount(0);
});

for (const [chainId, name] of [["8453", "Base"], ["999", "HyperEVM"], ["99901", "Elysium"]]) {
  test(`owned ${name} launches remain visible in the workspace and direct links`, async ({ page }) => {
    await page.goto(origin + "?scenario=workspace-history");
    const workspace = page.getByRole("region", { name: "Your launches" });
    await expect(workspace.getByRole("status")).toHaveText("3 launches");
    await workspace.getByRole("combobox", { name: "Chain" }).selectOption(chainId);
    await expect(workspace.locator("li")).toHaveCount(1);
    await expect(workspace.locator("li")).toContainText(name);
    await expect(page.getByRole("alert")).toHaveCount(0);
    const launchId = `80000000-0000-4000-8000-${chainId.padStart(12, "0")}`;
    await page.goto(`${origin}?scenario=workspace-history&launchId=${launchId}&chainId=${chainId}`);
    await page.getByRole("button", { name: "All launches", exact: false }).click();
    await expect(page).toHaveURL(`${origin}/?scenario=workspace-history&view=history`);
    await expect(workspace.getByRole("status")).toHaveText("3 launches");
    expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(0);
  });
}

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
  await expect.poll(() => page.evaluate(() => window.__customLaunchFixture.proofCalls)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("approval prepares and retries a temporary error without a click or wallet send", async ({ page }) => {
  await page.goto(origin + "?scenario=approved-retry");
  await expect(page.getByRole("status").filter({ hasText: "Preparation will retry automatically" })).toBeVisible();
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

test("review replies follow the latest discussion revision and retain drafts on conflict", async ({ page }) => {
  const subjectHash = `sha256:${"ab".repeat(32)}`;
  const requested = "Please share the existing liquidity report.";
  const followUp = "Please include the fee report too.";
  const draft = "Both reports are attached.";
  const link = "https://example.com/reports";
  const messages = [requested, followUp];
  const writes: number[] = [];
  let revision = 2;
  await page.route("**/api/custom-launch-reviews/feedback", async route => {
    const body = route.request().postDataJSON();
    if (body.operation === "reply") {
      writes.push(body.revision);
      expect(body.subjectHash).toBe(subjectHash);
      expect(body.message).toBe(draft);
      expect(body.links).toEqual([link]);
      if (writes.length === 1) {
        revision = 3;
        return route.fulfill({ status: 409, json: { error: "This review changed. Refresh before sending." } });
      }
      revision = 4;
      messages.push(draft);
    } else {
      expect(body.operation).toBe("ownerRead");
    }
    const submittedAt = "2026-10-01T00:00:00Z";
    return route.fulfill({ json: { review: {
      schemaVersion: "programmable.custom-launch-manual-review.v1", chainId: "4663",
      reviewId: "20000000-0000-4000-8000-000000000001", subjectHash, controller: `0x${"11".repeat(20)}`,
      state: "pending", revision, submittedAt, approvedAt: null, expiresAt: null, reason: null,
      discussion: messages.slice(0, revision - 1).map((message, index) => ({
        revision: index + 2, createdAt: submittedAt, author: message === draft ? "applicant" : "reviewer", message, links: [],
      })),
    }, assessment: {} } });
  });
  await page.goto(origin + "?scenario=manual-review");
  await page.getByText("Review messages", { exact: true }).click();
  await expect(page.getByText(requested, { exact: true })).toBeVisible();
  const message = page.getByLabel("Reply or deployment details");
  const documents = page.getByLabel(/Document links/);
  const send = page.getByRole("button", { name: "Send reply" });
  await message.fill(draft);
  await documents.fill(link);
  await send.click();
  await expect(page.getByText(followUp, { exact: true })).toBeVisible();
  await expect(message).toHaveValue(draft);
  await expect(documents).toHaveValue(link);
  expect(writes).toEqual([2]);
  await send.click();
  await expect(page.getByText(draft, { exact: true })).toBeVisible();
  await expect(message).toHaveValue("");
  expect(writes).toEqual([2, 3]);
});

test("an expired graph permit shows its review and allows an explicit receipt check", async ({ page }) => {
  await page.clock.install();
  await page.goto(origin + "?scenario=renewed-permit&chainId=99901&launchId=80000000-0000-4000-8000-000000099901");
  await expect(page.getByText("The transaction permit expired.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Project review: Approved/)).toBeVisible();
  const reads = await page.evaluate(() => window.__customLaunchFixture.legacyReads);
  await page.clock.fastForward(20000);
  expect(await page.evaluate(() => window.__customLaunchFixture.legacyReads)).toBe(reads);
  await page.getByRole("button", { name: "Check on-chain status" }).click();
  await expect.poll(() => page.evaluate(() => window.__customLaunchFixture.legacyReads)).toBeGreaterThan(reads);
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
  await page.clock.install();
  await page.goto(origin + "?scenario=automatic-recovery");
  await page.getByRole("button", { name: "Sign and launch", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checking your transaction", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and launch", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__customLaunchFixture.requests.length)).toBeGreaterThan(0);
  await page.evaluate(() => window.__customLaunchFixture.discoverMined());
  await page.clock.fastForward(20000);
  await expect(page.getByText("Transaction saved.", { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__customLaunchFixture.proofCalls)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(1);
  expect(await page.evaluate(() => window.__customLaunchFixture.requests.filter(call => /send|sign|wallet_/i.test(call.method)).length)).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("automatic-recovery.png"), fullPage: true });
  await page.evaluate(() => window.__customLaunchFixture.finalize());
  await page.getByRole("button", { name: "Refresh launch", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("programmable:custom-launch-send:v1:4663:0x1111111111111111111111111111111111111111"))).toBeNull();
});

test("an approval conflict requires attention and is not retried in the background", async ({ page }) => {
  await page.goto(origin + "?scenario=approved-conflict");
  await expect(page.getByRole("button", { name: "Retry preparation" })).toBeVisible();
  expect(await page.evaluate(() => window.__customLaunchFixture.startCalls)).toBe(1);
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(0);
});

test("finality keeps the completed launch open with coin and team-tag actions", async ({ page }) => {
  await page.clock.install();
  await page.goto(origin + "?scenario=indexing");
  await expect(page.getByRole("heading", { name: "Opening your coin", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__customLaunchFixture.navigated)).toBe("");
  await page.evaluate(() => window.__customLaunchFixture.setIndexed());
  await page.clock.fastForward(15000);
  await expect(page.getByRole("heading", { name: "Launch complete", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open coin", exact: true })).toHaveAttribute("href", /\?chain=4663$/);
  await expect(page.getByRole("link", { name: "Setup Team Tag on fomo (opens in a new tab)", exact: true })).toHaveAttribute("href", "https://fomo.family/team-tag-form");
  expect(await page.evaluate(() => window.__customLaunchFixture.navigated)).toBe("");
  expect(await page.evaluate(() => window.__customLaunchFixture.sends())).toBe(0);
});

for (const chainId of ["1","4663"]) test(`a confirmed legacy launch offers both actions after exact indexing on ${chainId}`,async ({page})=>{
  await page.clock.install();
  await page.goto(`${origin}?scenario=legacy-indexing-${chainId}`);
  await expect(page.getByRole("status")).toContainText("confirmed");
  expect(await page.evaluate(()=>window.__customLaunchFixture.navigated)).toBe("");
  await page.evaluate(()=>window.__customLaunchFixture.setIndexed());
  await page.clock.fastForward(15000);
  await expect(page.getByRole("link", { name: "Open coin", exact: true })).toHaveAttribute("href", new RegExp(`\\?chain=${chainId}$`));
  await expect(page.getByRole("link", { name: "Setup Team Tag on fomo (opens in a new tab)", exact: true })).toHaveAttribute("target", "_blank");
  expect(await page.evaluate(()=>window.__customLaunchFixture.navigated)).toBe("");
  expect(await page.evaluate(()=>window.__customLaunchFixture.sends())).toBe(0);
});
