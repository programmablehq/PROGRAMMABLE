import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyInterfaceFile } from "./interface-readonly-ui.mjs";
import { interfacePlan } from "./interface-plan.mjs";

const baseSha = "a".repeat(40), headSha = "b".repeat(40);
const component = body => `import Link from 'next/link'; export function Entry({chainId}) { return <div>${body}</div> }`;
const options = (before, after) => ({ baseSha, headSha, validateFile() {}, readChange: () => [before, after] });
const link = (label, path) => component(`<Link href={\`${path}\`}>${label}</Link>`);

test("copy and internal entry links do not select financial browser suites in a mixed change", () => {
  const before = link("Build a hook", "/developers/api-keys?start=custom&chainId=${chainId}");
  const after = link("Custom Contract with API", "/developers/api-keys?guide=custom-hook&chainId=${chainId}");
  const plan = interfacePlan(["components/module-foundation-launch-host.tsx", "components/custom-ai/chat-library.tsx",
    "components/custom-ai/workspace.module.css"], { ...options(before, after), readChange: path => path.includes("chat-library") ? ["export const f=()=>1", "export const f=()=>2"] : [before, after] });
  assert.deepEqual(plan.browser, []);
  assert.equal(plan.customAI, true);
  assert.deepEqual(plan.customAIBrowser, ["flow.spec.ts", "history.spec.ts"]);
  assert.equal(isReadOnlyInterfaceFile("components/module-foundation-launch-host.tsx", options(before, after)), true);
});

test("event handlers, values, redirects to signing, external URLs and computed calls retain behavior coverage", () => {
  const before = link("Open", "/docs/start");
  for (const after of [link("Open", "https://example.com"), link("Open", "/launch/confirm"),
    component('<Link href={nextRoute()}>Open</Link>'),
    before.replace("return <div>", "sendTransaction(); return <div>"),
    before.replace("<Link href", "<Link onClick={submit} href")]) {
    assert.equal(isReadOnlyInterfaceFile("components/module-foundation-launch-host.tsx", options(before, after)), false);
    assert.ok(interfacePlan(["components/module-foundation-launch-host.tsx"], options(before, after)).browser.includes("module-signing"));
  }
});

test("a custom component named Link is never treated as Next navigation", () => {
  const before = 'import Link from "./payment"; export const E=()=> <Link href="/docs">1</Link>';
  assert.equal(isReadOnlyInterfaceFile("components/entry.tsx", options(before, before.replace(">1<", ">2<"))), false);
});

test("missing source history stays conservative, CSS stays in the presentation lane", () => {
  assert.equal(isReadOnlyInterfaceFile("components/entry.tsx", { baseSha, headSha, validateFile() {}, readChange() { throw Error("missing"); } }), false);
  assert.deepEqual(interfacePlan(["components/custom-ai/workspace.module.css"]).customAIBrowser, []);
  assert.ok(interfacePlan(["components/module-foundation-launch-host.tsx"]).browser.includes("module-signing"));
});

test("chat shell changes select their own flows while wallet and compiler paths retain broad coverage", () => {
  assert.deepEqual(interfacePlan(["components/custom-ai/chat-library.tsx"]).customAIBrowser, ["flow.spec.ts", "history.spec.ts"]);
  assert.equal(interfacePlan(["components/custom-ai/chat-library.tsx"]).productionBuild, false);
  assert.ok(interfacePlan(["components/custom-ai/general-wallet.tsx"]).customAIBrowser.includes("general-wallet.spec.ts"));
  assert.equal(interfacePlan(["lib/custom-ai/service.server.ts"]).productionBuild, true);
  assert.equal(interfacePlan(["components/wallet-provider.tsx"]).productionBuild, true);
});
