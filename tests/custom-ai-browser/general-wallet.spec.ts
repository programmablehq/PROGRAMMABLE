import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
// @ts-expect-error The isolated browser renderer is JavaScript.
import { createGeneralWalletServer } from "./general-wallet-server.mjs";
import fixtures from "../fixtures/custom-ai-general-wallet-v1.json";
import { recordFixture } from "../fixtures/universal-launch-v1";
import { graphFinalityFixture } from "../fixtures/custom-ai-general-wallet-finality-v1";
import type { GeneralWalletSubject } from "../../lib/custom-ai/general-wallet";
let server: Server, origin: string;
const hash = `0x${"aa".repeat(32)}`;
test.beforeAll(async () => { server = await createGeneralWalletServer(); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw Error("No renderer"); origin = `http://127.0.0.1:${address.port}`; });
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
async function fixture(page: Page, chainId = 1) {
  const graph = chainId === 4663 ? undefined : structuredClone(fixtures.fixtures[String(chainId) as "1" | "8453" | "999"]), plan = chainId === 4663 ? recordFixture() : undefined;
  const subject = graph?.subject ?? { chainId, controller: plan!.plan.controller.address, resourceId: plan!.planId, requestHash: plan!.planHash,
    rawRequestSha256: plan!.rawRequestSha256, deadline: plan!.plan.budgets.deadline };
  const control = { subject: subject as GeneralWalletSubject, body: (graph?.resource ?? { schemaVersion: "programmable.website-launch-history.v1", launches: [{ sourceVersion: "custom_launch_plan_v1", controller: subject.controller, resource: plan }], nextCursor: null }) as unknown,
    reads: 0, proofs: [] as unknown[], wallet: [] as Record<string, unknown>[], providers: [] as unknown[], errors: [] as string[], unknown: false, reject: false,
    beforeRead: undefined as (() => Promise<void>) | undefined, beforeWallet: undefined as (() => Promise<void>) | undefined };
  page.on("pageerror", error => control.errors.push(error.message));
  await page.clock.setFixedTime(new Date((Number(fixtures.fixtures["1"].resource.output.signedPermit.validAfter) + 90) * 1000));
  await page.route("**/api/developer/**", async route => {
    const request = route.request();
    if (request.method() === "POST") { control.proofs.push(request.postDataJSON()); return route.fulfill({ status: 202, json: { accepted: true } }); }
    control.reads++; await control.beforeRead?.(); return route.fulfill({ json: control.body });
  });
  await page.route("**/fixture-wallet", async route => {
    control.wallet.push(route.request().postDataJSON()); await control.beforeWallet?.();
    if (control.unknown) return route.abort("failed");
    if (control.reject) return route.fulfill({ status: 400, json: { code: 4001, message: "Rejected" } });
    return route.fulfill({ json: { hash } });
  });
  await page.route("**/fixture-provider", async route => {
    control.providers.push(route.request().postDataJSON());
    const action = control.wallet.at(-1)!.action as Record<string, unknown>;
    return route.fulfill({ json: { hash, from: action.from, to: action.to, input: action.data, value: action.value, chainId: `0x${chainId.toString(16)}` } });
  });
  await page.route("**/fixture-status", route => route.fulfill({ json: {} }));
  await page.route("https://**", route => { control.errors.push("Unexpected external request: " + new URL(route.request().url()).origin); return route.abort(); });
  await page.goto(origin + `/?chain=${chainId}`); return control;
}
for (const chainId of [1, 4663, 8453, 999]) test(`chain ${chainId}: no work on mount, explicit review/send once, original receipt survives reload`, async ({ page }) => {
  const f = await fixture(page, chainId), region = page.getByRole("region", { name: "Wallet step" });
  await expect(region.getByRole("button", { name: "Continue launch here" })).toBeVisible();
  expect(f.reads).toBe(0); expect(f.wallet).toEqual([]); expect(f.proofs).toEqual([]);
  await region.getByRole("button", { name: "Continue launch here" }).click();
  const send = region.getByRole("button", { name: "Confirm launch in wallet" }); await expect(send).toBeVisible();
  expect(f.wallet).toEqual([]);
  await send.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(region.getByText("Transaction saved:", { exact: false })).toBeVisible();
  await expect(region.getByRole("button", { name: "Refresh confirmation" })).toBeEnabled();
  expect(f.wallet).toHaveLength(1); expect(f.proofs).toHaveLength(chainId === 4663 ? 1 : 0);
  await page.reload(); await expect(page.getByText("Transaction saved:", { exact: false })).toBeVisible();
  expect(f.wallet).toHaveLength(1); expect(f.errors).toEqual([]);
});
test("an unknown Graph send cannot be repeated and recovers only the provider-matched original transaction", async ({ page }) => {
  const f = await fixture(page); f.unknown = true;
  await page.getByRole("button", { name: "Continue launch here" }).click(); await page.getByRole("button", { name: "Confirm launch in wallet" }).click();
  await expect(page.getByRole("button", { name: "Recover transaction" })).toBeEnabled();
  await page.reload(); await expect(page.getByRole("button", { name: "Continue launch here" })).toHaveCount(0);
  expect(f.wallet).toHaveLength(1); expect(f.providers).toEqual([]);
  await page.getByLabel("Original transaction ID").fill(hash); await page.getByRole("button", { name: "Recover transaction" }).click();
  await expect(page.getByText("Transaction saved:", { exact: false })).toBeVisible();
  expect(f.wallet).toHaveLength(1); expect(f.providers).toEqual([{ method: "eth_getTransactionByHash", params: [hash] }]); expect(f.errors).toEqual([]);
});
test("an explicit rejection clears its local attempt and requires another explicit review", async ({ page }) => {
  const f = await fixture(page); f.reject = true;
  await page.getByRole("button", { name: "Continue launch here" }).click(); await page.getByRole("button", { name: "Confirm launch in wallet" }).click();
  await expect(page.getByRole("button", { name: "Continue launch here" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Recover transaction" })).toHaveCount(0);
  f.reject = false; await page.getByRole("button", { name: "Continue launch here" }).click(); await page.getByRole("button", { name: "Confirm launch in wallet" }).click();
  await expect(page.getByText("Transaction saved:", { exact: false })).toBeVisible(); expect(f.wallet).toHaveLength(2); expect(f.errors).toEqual([]);
});
test("a changed original resource fails before opening a wallet", async ({ page }) => {
  const f = await fixture(page); await page.getByRole("button", { name: "Continue launch here" }).click();
  (f.body as { requestHash: string }).requestHash = `sha256:${"ff".repeat(32)}`;
  await page.getByRole("button", { name: "Confirm launch in wallet" }).click();
  await expect(page.getByRole("alert")).toContainText("original saved submission"); expect(f.wallet).toEqual([]); expect(f.errors).toEqual([]);
});
test("a private-session change during a detail read prevents any wallet request", async ({ page }) => {
  const f = await fixture(page); let release: () => void = () => {};
  f.beforeRead = () => new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("button", { name: "Continue launch here" }).click(); await expect.poll(() => f.reads).toBe(1);
  await page.getByRole("button", { name: "Switch private session" }).click(); release();
  await expect(page.getByText("New private session", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm launch in wallet" })).toHaveCount(0); expect(f.wallet).toEqual([]); expect(f.errors).toEqual([]);
});
test("a late wallet receipt stays out of the next private session while the original journal retains it", async ({ page }) => {
  const f = await fixture(page); let release: () => void = () => {}; f.beforeWallet = () => new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("button", { name: "Continue launch here" }).click(); await page.getByRole("button", { name: "Confirm launch in wallet" }).click();
  await expect.poll(() => f.wallet.length).toBe(1); await page.getByRole("button", { name: "Switch private session" }).click(); release();
  await expect(page.getByText("New private session", { exact: true })).toBeVisible(); await expect(page.getByText("Transaction saved:", { exact: false })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => Object.values(localStorage).some(value => value.includes('"transactionHash":"0x' + "aa".repeat(32) + '"')))).toBe(true);
  expect(f.wallet).toHaveLength(1); expect(f.errors).toEqual([]);
});
for (const chainId of [1, 4663, 8453, 999]) test(`chain ${chainId}: exact finality releases only its original journal`, async ({ page }) => {
  const f = await fixture(page, chainId);
  await page.getByRole("button", { name: "Continue launch here" }).click(); await page.getByRole("button", { name: "Confirm launch in wallet" }).click();
  await expect(page.getByRole("button", { name: "Refresh confirmation" })).toBeEnabled();
  if (chainId === 4663) {
    const plan = recordFixture(), final = { ...plan, status: "final", steps: plan.steps.map(step => ({ ...step, status: "final", transactionHash: hash })) };
    f.body = { schemaVersion: "programmable.website-launch-history.v1", launches: [{ sourceVersion: "custom_launch_plan_v1", controller: f.subject.controller, resource: final }], nextCursor: null };
  } else f.body = graphFinalityFixture(String(chainId) as "1" | "8453" | "999").resource;
  await page.getByRole("button", { name: "Refresh confirmation" }).click();
  await expect(page.getByText("Transaction confirmed:", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue launch here" })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("programmable:custom-ai-graph-wallet:v1") || key.startsWith("programmable:custom-launch-send:v1")))).toEqual([]);
  expect(f.wallet).toHaveLength(1); expect(f.errors).toEqual([]);
});
test("an unknown send can reconcile exact finality without another wallet request or its five-minute lease", async ({ page }) => {
  const f = await fixture(page); f.unknown = true;
  await page.getByRole("button", { name: "Continue launch here" }).click(); await page.getByRole("button", { name: "Confirm launch in wallet" }).click();
  await expect(page.getByRole("button", { name: "Check launch confirmation" })).toBeEnabled();
  f.body = graphFinalityFixture().resource;
  await page.getByRole("button", { name: "Check launch confirmation" }).click();
  await expect(page.getByText("Transaction confirmed:", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("programmable:custom-ai-graph-wallet:v1") || key.startsWith("programmable:wallet-request:v1")))).toEqual([]);
  expect(f.wallet).toHaveLength(1); expect(f.providers).toEqual([]); expect(f.errors).toEqual([]);
});
test("a different finalized transaction never clears the original observed receipt", async ({ page }) => {
  const f = await fixture(page); await page.getByRole("button", { name: "Continue launch here" }).click(); await page.getByRole("button", { name: "Confirm launch in wallet" }).click();
  await expect(page.getByRole("button", { name: "Refresh confirmation" })).toBeEnabled();
  const final = graphFinalityFixture(); final.resource.output.onchain.transactionHash = `0x${"bb".repeat(32)}`; f.body = final.resource;
  await page.getByRole("button", { name: "Refresh confirmation" }).click();
  await expect(page.getByText("Your transaction is saved. Refresh its confirmation to continue.")).toBeVisible();
  await expect(page.getByText("Transaction confirmed:", { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('"transactionHash":"0x' + "aa".repeat(32) + '"')))).toBe(true);
  expect(f.wallet).toHaveLength(1); expect(f.errors).toEqual([]);
});
