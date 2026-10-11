import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Local executable browser fixture with no wallet or RPC calls.
import { createModuleLaunchSelectionServer } from "./fixtures/module-launch-selection-server.mjs";
// @ts-expect-error Local executable studio fixture with no wallet or RPC calls.
import { createModuleStudioServer } from "./fixtures/module-studio-server.mjs";

let server: Server, origin: string;
test.beforeAll(async () => {
  server = await createModuleLaunchSelectionServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) { server.close(); await once(server, "close"); } });

for (const [width, chainId] of [[1440, 4663], [390, 4663], [1440, 1], [390, 1]]) {
  test(`Module Mode warms the exact draft and reaches the wallet immediately on ${chainId} at ${width}px`, async ({ page }, testInfo) => {
    const studio = await createModuleStudioServer(); studio.listen(0, "127.0.0.1"); await once(studio, "listening");
    const address = studio.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
    const errors: string[] = [], requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (!request.url().startsWith(`http://127.0.0.1:${address.port}`) && !request.url().startsWith("data:")) requests.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://127.0.0.1:${address.port}/?mode=launch-speed&chainId=${chainId}`);
      if (width < 700) await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill("My coin");
      await page.getByLabel("Ticker", { exact: true }).fill("COIN");
      const events = () => page.evaluate(() => (window as unknown as { launchEvents: { preparations: number; coldPreparations: number; walletRequests: number; readyAt?: number; walletRequestedAt?: number; clickedAt?: number } }).launchEvents);
      await expect.poll(async () => (await events()).preparations).toBe(1);
      await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
      expect((await events()).walletRequests).toBe(0);
      await expect.poll(async () => (await events()).readyAt ?? 0).toBeGreaterThan(0);
      for (let i = 0; i < 3; i++) await page.getByTestId("rerender").click();
      await page.evaluate(() => document.addEventListener("click", event => {
        if ((event.target as Element)?.closest("button")?.textContent?.includes("Launch coin"))
          (window as unknown as { launchEvents: { clickedAt: number } }).launchEvents.clickedAt = performance.now();
      }, { capture: true }));
      await page.getByRole("button", { name: "Launch coin", exact: true }).click();
      await expect.poll(async () => (await events()).walletRequests).toBe(1);
      const result = await events();
      const elapsed = result.walletRequestedAt! - result.clickedAt!;
      expect(elapsed).toBeLessThan(150);
      expect(result.preparations).toBe(1); expect(result.coldPreparations).toBe(0);
      await expect(page.getByRole("alert")).toContainText("Fixture wallet rejected");
      expect(errors).toEqual([]); expect(requests).toEqual([]);
      await testInfo.attach("prepared-click-timing", { body: JSON.stringify({ width, elapsedMs: elapsed, ...result }), contentType: "application/json" });
      await page.screenshot({ path: testInfo.outputPath(`launch-speed-${width}.png`), fullPage: true });
    } finally { const closed = once(studio, "close"); studio.close(); studio.closeAllConnections(); await closed; }
  });
}

for (const width of [1440, 390]) {
  test(`arbitrary quote pricing uses token units and retains the ETH first buy at ${width}px`, async ({ page }) => {
    const studio = await createModuleStudioServer(); studio.listen(0, "127.0.0.1"); await once(studio, "listening");
    const address = studio.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://127.0.0.1:${address.port}/?mode=open-quote`);
      if (width < 700) await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill("My coin");
      await page.getByLabel("Ticker", { exact: true }).fill("COIN");
      if (width < 700) await page.getByRole("button", { name: "Modules", exact: true }).click();
      await page.getByRole("switch", { name: "Any Quote Pool", exact: true }).click();
      await page.getByLabel("Quote token address").fill("0x1111111111111111111111111111111111111111");
      await page.getByRole("button", { name: "Set in PAIR", exact: true }).click();
      await page.getByLabel("Starting market cap · PAIR").fill("12.345678");
      const lastDraft = () => page.evaluate(() => (window as unknown as { launchEvents: { lastDraft?: { quoteValuation?: string; initialBuy: string }; walletRequests: number } }).launchEvents);
      await expect.poll(async () => (await lastDraft()).lastDraft).toMatchObject({ quoteValuation: "12.345678", initialBuy: "0.001" });
      expect((await lastDraft()).walletRequests).toBe(0);
      await page.getByRole("button", { name: "Launch coin", exact: true }).click();
      await expect.poll(async () => (await lastDraft()).walletRequests).toBe(1);
      await expect(page.getByRole("alert")).toContainText("Fixture wallet rejected");
      await page.getByLabel("Quote token address").fill("0x2222222222222222222222222222222222222222");
      await expect(page.getByRole("button", { name: "Automatic USD", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByLabel("Starting market cap · PAIR")).toHaveCount(0);
      await expect.poll(async () => (await lastDraft()).lastDraft?.initialBuy).toBe("0.001");
    } finally { const closed = once(studio, "close"); studio.close(); studio.closeAllConnections(); await closed; }
  });
}

test("a click joins pending launch work once, and wallet switches cancel the older draft", async ({ page }) => {
  const studio = await createModuleStudioServer(); studio.listen(0, "127.0.0.1"); await once(studio, "listening");
  const address = studio.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
  const events = () => page.evaluate(() => (window as unknown as { launchEvents: { preparations: number; walletRequests: number; aborts: number; walletContext?: string } }).launchEvents);
  try {
    await page.goto(`http://127.0.0.1:${address.port}/?mode=launch-speed&holdWallet=1`);
    await page.getByLabel("Name", { exact: true }).fill("My coin");
    await page.getByLabel("Ticker", { exact: true }).fill("COIN");
    await expect.poll(async () => (await events()).preparations).toBe(1);
    await page.getByTestId("wallet-switch").click();
    await expect.poll(async () => (await events()).preparations).toBe(2);
    expect((await events()).aborts).toBeGreaterThanOrEqual(1);
    expect((await events()).walletRequests).toBe(0);
    // A real click must be available during preparation and join it without a second click.
    const launch = page.getByRole("button", { name: "Launch coin", exact: true });
    await expect(launch).toBeEnabled();
    await launch.click();
    await page.evaluate(() => document.querySelector("form")!.requestSubmit());
    await expect.poll(async () => (await events()).walletRequests).toBe(1);
    expect((await events()).preparations).toBe(2);
    expect((await events()).walletContext).toBe("other-wallet:4663:release");
    // Keep the wallet open until both submissions were observed. An immediate fixture
    // rejection correctly warms another attempt and raced this assertion on slow CI.
    await page.evaluate(() => (window as unknown as { rejectFixtureWallet: () => void }).rejectFixtureWallet());
    await expect(page.getByRole("alert")).toContainText("Fixture wallet rejected");
    await expect.poll(async () => (await events()).preparations).toBe(3);
    expect((await events()).walletRequests).toBe(1);
  } finally { const closed = once(studio, "close"); studio.close(); studio.closeAllConnections(); await closed; }
});

test("restoring a completed launch keeps the new draft open without background recovery reads", async ({ page }) => {
  const studio = await createModuleStudioServer(); studio.listen(0, "127.0.0.1"); await once(studio, "listening");
  const address = studio.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
  const apiCalls: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url()); });
  try {
    const url = `http://127.0.0.1:${address.port}/?mode=restored-launch`;
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Module Mode", exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Module library" }).getByRole("button", { name: "Open your previous coin", exact: true })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("My next coin");
    await expect(page).toHaveURL(url);
    expect(apiCalls).toEqual([]);
    await page.getByRole("button", { name: "Open your previous coin", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Your previous launch could not be checked yet. Try opening it again.");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My next coin");
    await expect(page).toHaveURL(url);
    expect(apiCalls).toHaveLength(1);
  } finally { const closed = once(studio, "close"); studio.close(); studio.closeAllConnections(); await closed; }
});

for (const width of [1440, 390, 320]) {
  test(`selection explains fees, keeps button size, and restores settings at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width, height: 900 }); await page.goto(origin);
    const summary = page.getByRole("complementary");
    await expect(summary).toContainText("Includes the 0.10% platform fee.");
    const trigger = page.getByRole("button", { name: "Add modules", exact: true });
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog"), card = dialog.getByRole("article");
    await expect(dialog.getByText("Estimated platform fee: 0.30% per trade.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("searchbox")).toBeHidden();
    await expect(card).toHaveCount(1);
    const add = dialog.getByRole("button", { name: "Add Opening buy cap", exact: true });
    const before = await add.boundingBox(), cardBefore = await card.boundingBox();
    expect(before!.height).toBeGreaterThanOrEqual(44);
    await add.press("Enter");
    const remove = dialog.getByRole("button", { name: "Remove Opening buy cap", exact: true });
    await expect(remove).toHaveText("Remove"); await expect(remove).toHaveAttribute("aria-pressed", "true");
    const after = await remove.boundingBox(), cardAfter = await card.boundingBox();
    expect(after!.width).toBeCloseTo(before!.width, 0); expect(after!.height).toBeCloseTo(before!.height, 0);
    expect(cardAfter!.height).toBeCloseTo(cardBefore!.height, 0);
    await page.screenshot({ path: testInfo.outputPath(`selection-${width}.png`) });
    await remove.press("Enter"); await expect(add).toHaveText("Add"); await add.press("Enter");
    await dialog.getByRole("button", { name: "Done", exact: true }).press("Enter");
    await expect(trigger).toBeFocused();
    await expect(summary).toContainText("Includes the 0.30% platform fee.");
    const configure = page.getByRole("button", { name: "Configure Opening buy cap", exact: true });
    await configure.press("Enter");
    await dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true }).fill("0.25");
    await page.keyboard.press("Escape"); await expect(configure).toBeFocused();
    await page.getByRole("button", { name: "Remove Opening buy cap", exact: true }).press("Enter");
    await expect(summary).toContainText("Includes the 0.10% platform fee.");
    await page.getByRole("button", { name: "Undo", exact: true }).press("Enter");
    await expect(configure).toBeFocused(); await configure.press("Enter");
    await expect(dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true })).toHaveValue("0.25");
    await page.screenshot({ path: testInfo.outputPath(`configuration-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" }); await trigger.click();
    expect(await dialog.evaluate(element => element.getAnimations().length)).toBe(0);
    await dialog.getByRole("button", { name: "Done", exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("a delayed remove frame cannot steal the next Undo keyboard activation", async ({ page }) => {
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    const frames = new Map<number, FrameRequestCallback>();
    let hold = false, nextId = -1;
    window.addEventListener("hold-module-selection-frames", () => { hold = true; });
    window.addEventListener("flush-module-selection-frames", () => {
      hold = false;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(performance.now());
    });
    window.requestAnimationFrame = callback => {
      if (!hold) return requestFrame(callback);
      const id = nextId--; frames.set(id, callback); return id;
    };
    window.cancelAnimationFrame = id => { if (!frames.delete(id)) cancelFrame(id); };
  });
  await page.setViewportSize({ width: 320, height: 900 }); await page.goto(origin);
  const trigger = page.getByRole("button", { name: "Add modules", exact: true });
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add Opening buy cap", exact: true }).press("Enter");
  await dialog.getByRole("button", { name: "Done", exact: true }).press("Enter");
  const configure = page.getByRole("button", { name: "Configure Opening buy cap", exact: true });
  await configure.press("Enter");
  await dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true }).fill("0.25");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new Event("hold-module-selection-frames")));
  await page.getByRole("button", { name: "Remove Opening buy cap", exact: true }).press("Enter");
  await expect(page.getByRole("complementary")).toContainText("Includes the 0.10% platform fee.");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.focus();
  await page.evaluate(() => window.dispatchEvent(new Event("flush-module-selection-frames")));
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(configure).toBeFocused();
  await expect(page.getByRole("complementary")).toContainText("Includes the 0.30% platform fee.");
  await configure.press("Enter");
  await expect(dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true })).toHaveValue("0.25");
});

test("empty and single-template libraries keep irrelevant controls out of the flow", async ({ page }) => {
  await page.goto(`${origin}?mode=empty`); await page.getByRole("button", { name: "Add modules", exact: true }).click();
  await expect(page.getByText("No modules available yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
  await page.goto(`${origin}?mode=engine`);
  await expect(page.getByRole("button", { name: "Choose module Timed escrow", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox")).toBeHidden(); await expect(page.getByRole("combobox")).toBeHidden();
  await page.goto(`${origin}?mode=unknown`); await page.getByRole("button", { name: "Add modules", exact: true }).click();
  await expect(page.getByText("Platform fee unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toContainText("0.30%");
});

test.describe("Module Studio", () => {
  let studioServer: Server, studioOrigin: string;
  test.beforeAll(async () => {
    studioServer = await createModuleStudioServer(); studioServer.listen(0, "127.0.0.1"); await once(studioServer, "listening");
    const address = studioServer.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
    studioOrigin = `http://127.0.0.1:${address.port}`;
  });
  test.afterAll(async () => { if (studioServer) { studioServer.close(); await once(studioServer, "close"); } });

  for (const width of [1440, 390]) test(`drafts survive chain navigation and modules offer a direct return at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${studioOrigin}?mode=draft-navigation`);
    if (width < 600) await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Robinhood draft");
    await page.getByLabel("Ticker", { exact: true }).fill("KEEP");
    await page.getByLabel("First buy · ETH", { exact: true }).fill("0");
    await page.getByLabel("Coin image file", { exact: true }).setInputFiles("public/icon-512.png");
    await expect(page.getByRole("button", { name: "Change image", exact: true })).toBeVisible();
    if (width < 600) await page.getByRole("button", { name: "Modules", exact: true }).click();
    await page.getByRole("switch", { name: "Initial wallet buy limit", exact: true }).click();
    await page.getByRole("button", { name: "Back to coin details", exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Robinhood draft");
    await page.getByRole("button", { name: "Fixture Ethereum", exact: true }).click();
    if (width < 600) await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Robinhood draft");
    await page.getByLabel("Name", { exact: true }).fill("Ethereum draft");
    await expect(page.getByRole("switch", { name: "Initial wallet buy limit", exact: true, includeHidden: true })).toHaveAttribute("aria-checked", "false");
    await page.goBack();
    if (width < 600) await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Robinhood draft");
    await expect(page.getByLabel("First buy · ETH", { exact: true })).toHaveValue("0");
    await expect(page.getByRole("button", { name: "Change image", exact: true })).toBeVisible();
    if (width < 600) await page.getByRole("button", { name: "Your coin", exact: true }).click();
    await page.getByRole("button", { name: "Edit Initial wallet buy limit", exact: true }).click();
    await page.getByRole("button", { name: "Remove Initial wallet buy limit", exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Robinhood draft");
    await expect(page.getByRole("switch", { name: "Initial wallet buy limit", exact: true, includeHidden: true })).toHaveAttribute("aria-checked", "false");
  });

  for (const chainId of [1, 4663]) test(`zero and under-minimum first buys stop before the wallet on chain ${chainId}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${studioOrigin}?mode=launch-speed&chainId=${chainId}`);
    await page.getByLabel("Name", { exact: true }).fill("No first buy");
    await page.getByLabel("Ticker", { exact: true }).fill("ZERO");
    for (const amount of ["0", "0.0001"]) {
      await page.getByLabel("First buy · ETH", { exact: true }).fill(amount);
      await page.getByRole("button", { name: "Launch coin", exact: true }).click();
      await expect(page.locator("#foundation-initial-buy-error")).toContainText("$2");
      const events = await page.evaluate(() => (window as unknown as { launchEvents: { walletRequests: number; preparations: number } }).launchEvents);
      expect(events.walletRequests).toBe(0); expect(events.preparations).toBe(0);
    }
  });

  for (const width of [1440, 390]) test(`coming soon modules stay hidden while available modules can launch at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${studioOrigin}?mode=availability`);
    if (width < 600) await page.getByRole("button", { name: "Modules", exact: true }).click();
    const ready = ["Initial wallet buy limit", "Hot potato", "Plague", "Reactive pair", "Entangled"];
    const pending = ["Buyback and burn", "Dip buyback", "LP rewards", "Full-range liquidity", "Buyer rewards", "Nth-buy pot", "King of the Hill"];
    for (const name of pending) {
      const card = page.getByRole("switch", { name, exact: true, includeHidden: true });
      await expect(card).toBeHidden();
      await expect(card).toBeDisabled();
    }
    if (width < 600) await page.getByRole("button", { name: "Your coin", exact: true }).click();
    await page.getByRole("button", { name: "Add module", exact: true }).click({ position: { x: 10, y: 10 } });
    const picker = page.getByRole("dialog", { name: "Add module", exact: true });
    for (const name of pending) {
      const option = picker.getByRole("button", { name: new RegExp(`^${name}`), includeHidden: true });
      await expect(option).toBeHidden();
      await expect(option).toBeDisabled();
    }
    for (const name of ready) await expect(picker.getByRole("button", { name, exact: true })).toBeEnabled();
    await picker.getByRole("button", { name: "Close module list", exact: true }).click();
    for (const name of ready) {
      if (width < 600) await page.getByRole("button", { name: "Modules", exact: true }).click();
      const card = page.getByRole("switch", { name, exact: true });
      await expect(card).toBeEnabled();
      await card.click();
      await expect(page.getByRole("switch", { name, exact: true, includeHidden: true })).toHaveAttribute("aria-checked", "true");
    }
    if (width < 600) await page.getByRole("button", { name: "Your coin", exact: true }).click();
    await page.getByRole("button", { name: "Edit coin details", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Available modules");
    await page.getByLabel("Ticker", { exact: true }).fill("READY");
    await page.getByRole("button", { name: "Launch coin", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { launchEvents: { walletRequests: number } }).launchEvents.walletRequests)).toBe(1);
    const selected = await page.evaluate(() => (window as unknown as { launchEvents: { lastDraft: { modules: { id: string }[] } } }).launchEvents.lastDraft.modules.map(module => module.id));
    expect(selected).toEqual(["wallet-cap-fixture", "ready-0", "ready-1", "ready-2", "ready-3"]);
  });

  test("a recovered wallet clears its old network error and keeps the coin draft", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${studioOrigin}?mode=wallet-recovery`);
    await page.getByLabel("Name", { exact: true }).fill("My coin");
    await page.getByLabel("Ticker", { exact: true }).fill("MINE");
    await page.getByRole("button", { name: "Switch to Ethereum", exact: true }).click();
    await expect(page.getByText("Network change cancelled.", { exact: true })).toBeVisible();
    await page.getByTestId("wallet-switch").click();
    await expect(page.getByText("Network change cancelled.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Launch coin", exact: true })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My coin");
    await expect(page.getByLabel("Ticker", { exact: true })).toHaveValue("MINE");
  });

  test("quote toggle restores a saved choice but respects an explicitly cleared address", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(studioOrigin);
    const toggle = page.getByRole("switch", { name: "Any Quote Pool", exact: true });
    const address = page.getByLabel("Quote token address", { exact: true });
    const node = page.locator('[data-node-id="quote"]');
    await expect(node).toHaveCount(0);
    await toggle.click(); await address.fill("0x1111111111111111111111111111111111111111");
    await toggle.click(); await expect(node).toHaveCount(0);
    await expect(page.locator('[data-node-id="coin"]')).toContainText("$COIN / ETH");
    await toggle.click(); await expect(address).toHaveValue("0x1111111111111111111111111111111111111111");
    await address.fill(""); await toggle.click(); await toggle.click();
    await expect(address).toHaveValue(""); await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("coin fields keep exact names after validation and describe their errors", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${studioOrigin}?mode=error`);
    const name = page.getByLabel("Name", { exact: true });
    await expect(name).toHaveAccessibleDescription("Enter a coin name");
    await name.fill("Garden");
    await page.getByLabel("Ticker", { exact: true }).fill("$GARDEN");
    await expect(page.getByLabel("Ticker", { exact: true })).toHaveValue("GARDEN");
    await page.getByRole("button", { name: "Links", exact: true }).click();
    await page.getByLabel("X", { exact: true }).fill("@ garden");
    await page.getByLabel("Telegram", { exact: true }).fill("@garden");
    await page.getByRole("button", { name: "Add other link", exact: true }).click();
    await expect(page.getByLabel("X", { exact: true })).toHaveValue("https://x.com/garden");
    await expect(page.getByLabel("Telegram", { exact: true })).toHaveValue("https://t.me/garden");
    await page.getByLabel("Other link 1", { exact: true }).fill("garden.example");
    await page.getByRole("button", { name: "Links", exact: true }).click();
    await expect(page.getByRole("button", { name: "Links", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("textbox", { name: "Other link 1", exact: true })).toHaveCount(0);
  });

  test("a creator fee error returns to its visible coin field from a module", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${studioOrigin}?mode=fees`);
    const navigation = page.getByRole("navigation", { name: "Studio panels" });
    await navigation.getByRole("button", { name: "Modules", exact: true }).click();
    await page.getByRole("switch", { name: "Initial wallet buy limit", exact: true }).click();
    await page.getByRole("button", { name: "Review coin", exact: true }).click();
    const fee = page.getByLabel("Creator fees · %", { exact: true });
    await expect(fee).toBeVisible();
    await expect(fee).toHaveAttribute("aria-invalid", "true");
    await expect(fee).toHaveAccessibleDescription("Choose a whole percentage from 0% to 10%.");
    await expect(page.getByRole("heading", { name: "Coin details", exact: true })).toBeVisible();
  });

  for (const width of [390, 320]) {
    test(`validation highlights the visible panel and still allows navigation at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 }); await page.goto(`${studioOrigin}?mode=error`);
      const navigation = page.getByRole("navigation", { name: "Studio panels" });
      const settings = navigation.getByRole("button", { name: "Settings", exact: true });
      const modules = navigation.getByRole("button", { name: "Modules", exact: true });
      const canvas = navigation.getByRole("button", { name: "Your coin", exact: true });
      await expect(settings).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#foundation-name")).toBeVisible();
      await modules.click(); await expect(modules).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("switch", { name: "Any Quote Pool", exact: true })).toBeVisible();
      await expect(page.locator("#foundation-name")).toBeHidden();
      await canvas.click(); await expect(canvas).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Edit coin details", exact: true })).toBeVisible();
      await settings.click(); await expect(page.locator("#foundation-name")).toBeVisible();
    });
  }

  test("resubmitting unchanged validation errors reveals coin details from a module inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${studioOrigin}?mode=error`);
    await page.getByRole("switch", { name: "Initial wallet buy limit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Initial wallet buy limit", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review coin", exact: true }).click();
    await expect(page.locator("#foundation-name")).toBeVisible();
    await page.getByRole("button", { name: "Edit Initial wallet buy limit", exact: true }).click();
    await page.getByRole("button", { name: "Review coin", exact: true }).click();
    await expect(page.locator("#foundation-name")).toBeVisible();
    await expect(page.getByText("Enter a coin name", { exact: true })).toBeVisible();
  });

  test("dragging a module flower moves its card and line while the coin stays centered", async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(studioOrigin);
    await page.getByRole("switch", { name: "Initial wallet buy limit", exact: true }).click();
    const moduleCard = page.locator('[data-node-id="wallet-cap-fixture"]');
    const coin = page.locator('[data-node-id="coin"]');
    await expect(moduleCard).toBeVisible();
    const before = await moduleCard.boundingBox(), coinBefore = await coin.boundingBox();
    const flower = await moduleCard.locator('[data-flower]').boundingBox();
    const line = page.locator('section[aria-label="Coin composition"] svg path').first();
    await expect(line).toBeVisible(); const pathBefore = await line.getAttribute("d");
    await page.mouse.move(flower!.x + flower!.width / 2, flower!.y + flower!.height / 2);
    await page.mouse.down(); await page.mouse.move(flower!.x + flower!.width / 2 + 30, flower!.y + flower!.height / 2 + 150, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await moduleCard.boundingBox())!.y).toBeGreaterThan(before!.y + 40);
    const after = await moduleCard.boundingBox(), coinAfter = await coin.boundingBox();
    expect(coinAfter!.x).toBeCloseTo(coinBefore!.x, 1); expect(coinAfter!.y).toBeCloseTo(coinBefore!.y, 1);
    expect(after!.x + after!.width <= coinAfter!.x || after!.x >= coinAfter!.x + coinAfter!.width || after!.y + after!.height <= coinAfter!.y || after!.y >= coinAfter!.y + coinAfter!.height).toBe(true);
    await expect(line).not.toHaveAttribute("d", pathBefore!);
    expect(errors).toEqual([]);
  });
});

for (const [width, chainId] of [[1440, 1], [390, 1], [1440, 4663], [390, 4663]]) {
  test(`wallet recovery unlocks the saved draft on ${chainId} at ${width}px`, async ({ page }) => {
    const studio = await createModuleStudioServer(); studio.listen(0, "127.0.0.1"); await once(studio, "listening");
    const address = studio.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
    try {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`http://127.0.0.1:${address.port}/?mode=pending-recovery&chainId=${chainId}`);
      if (width < 700) await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("button", { name: "Launch coin", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Check wallet activity", exact: true })).toBeVisible();
      expect(await page.locator("form form").count()).toBe(0);
      await page.getByRole("button", { name: "Check wallet activity", exact: true }).click();
      await expect(page.getByRole("button", { name: "Launch coin", exact: true })).toBeEnabled();
      await expect(page.getByLabel("Name", { exact: true })).toHaveValue("BRUNO");
      await expect(page.getByLabel("Ticker", { exact: true })).toHaveValue("BRUNO");
      await expect(page.getByLabel("First buy · ETH", { exact: true })).toHaveValue("0");
    } finally { const closed = once(studio, "close"); studio.close(); studio.closeAllConnections(); await closed; }
  });
}

for (const [width, chainId] of [[1440, 1], [390, 4663]]) {
  test(`hashless unsubmitted launch can be retried on ${chainId}`, async ({ page }) => {
    const studio = await createModuleStudioServer(); studio.listen(0, "127.0.0.1"); await once(studio, "listening");
    const address = studio.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
    try {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`http://127.0.0.1:${address.port}/?mode=pending-recovery&unmined=1&chainId=${chainId}`);
      if (width < 700) await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("button", { name: "Launch coin", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Check wallet activity", exact: true }).click();
      await expect(page.getByRole("button", { name: "Launch coin", exact: true })).toBeEnabled();
      await expect(page.getByText("Your previous request did not finish. You can retry the launch below.")).toBeVisible();
      await expect(page.getByLabel("Name", { exact: true })).toHaveValue("BRUNO");
      await expect(page.getByLabel("Ticker", { exact: true })).toHaveValue("BRUNO");
      await expect(page.getByLabel("First buy · ETH", { exact: true })).toHaveValue("0");
    } finally { const closed = once(studio, "close"); studio.close(); studio.closeAllConnections(); await closed; }
  });
}
