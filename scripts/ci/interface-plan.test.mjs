import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { interfacePlan, relatedInputs } from "./interface-plan.mjs";

test("coin metadata does not run unrelated wallet, migration, CLI or activation checks", () => {
  const plan = interfacePlan(["lib/server/codex-token-metadata.ts", "lib/coin-metadata.ts"]);
  assert.equal(plan.full, false);
  assert.deepEqual(plan.browser, []);
  for (const key of ["wallet", "migration", "moduleTools", "activation"]) assert.equal(plan[key], false);
});

test("affected trading, launch and wallet behavior retains its browser coverage", () => {
  assert.deepEqual(interfacePlan(["components/robinhood-market-view.tsx"]).browser,
    ["trade-panel", "foundation-swap-recovery"]);
  for (const path of ["components/wallet-provider.tsx", "lib/wallet-operation.ts"])
    assert.ok(interfacePlan([path]).browser.includes("wallet-request-lock"));
  assert.ok(interfacePlan(["components/module-foundation-launch.tsx"]).browser.includes("module-signing"));
  assert.equal(interfacePlan(["scripts/programmable-v41-api-activation.mjs"]).activation, true);
  assert.equal(interfacePlan(["packages/classic-modules/index.mjs"]).moduleTools, true);
});

test("missing history, unknown configuration and CI changes keep complete coverage", () => {
  for (const paths of [null, ["package-lock.json"], [".github/workflows/verify.yml"],
    ["unexpected-new-input"]]) {
    const plan = interfacePlan(paths);
    for (const key of ["full", "wallet", "migration", "moduleTools", "activation"]) assert.equal(plan[key], true);
  }
});

test("related selection follows transitive source imports and includes dynamic filesystem tests", () => {
  const root = mkdtempSync(join(tmpdir(), "interface-dependencies-"));
  try {
    mkdirSync(join(root, "tests"));
    const sources = { "source.ts": "export const value=1", "middle.ts": "export { value } from './source'",
      "tests/behavior.test.ts": "import {value} from '../middle'", "tests/other.test.ts": "import {value} from '../other'",
      "tests/files.test.ts": "import {readFileSync} from 'node:fs'; readFileSync(dynamicPath)", "other.ts": "export const value=2" };
    for (const [path, source] of Object.entries(sources)) writeFileSync(join(root, path), source);
    const paths = Object.keys(sources).map(path => relative(process.cwd(), join(root, path)));
    const selected = relatedInputs([paths[0]], paths);
    assert.ok(selected.includes(paths[1]));
    assert.ok(selected.includes(paths[2]));
    assert.ok(selected.includes(paths[4]));
    assert.equal(selected.includes(paths[3]), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

 test("known file readers stay scoped while unresolved readers remain conservative", () => {
  const root = mkdtempSync(join(tmpdir(), "interface-readers-"));
  try {
    mkdirSync(join(root, "tests"));
    const names = ["source.ts", "other.ts", "tests/source.test.ts", "tests/other.test.ts", "tests/dynamic.test.ts"];
    const paths = names.map(name => relative(process.cwd(), join(root, name)));
    const source = ["export const x=1", "export const x=2",
      `readFileSync('${paths[0]}', 'utf8')`, `readFileSync('${paths[1]}', 'utf8')`, "readFileSync(dynamicPath)"];
    paths.forEach((path, index) => writeFileSync(path, source[index]));
    const selected = relatedInputs([paths[0]], paths);
    assert.ok(selected.includes(paths[2]));
    assert.ok(selected.includes(paths[4]));
    assert.equal(selected.includes(paths[3]), false);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test("Interface selector maintenance keeps affected wallet coverage without full contract work", () => {
  const plan = interfacePlan(["scripts/ci/interface-plan.mjs", "components/wallet-provider.tsx"]);
  assert.equal(plan.full, false);
  assert.equal(plan.verificationTools, true);
  assert.ok(plan.browser.includes("wallet-session"));
  assert.equal(plan.activation, false);
});

test("a read-only Custom AI extension does not select financial or wallet browser work", () => {
  const plan=interfacePlan(["lib/custom-ai/capabilities/search-hooks/index.server.ts"]);
  assert.equal(plan.activation,false);assert.equal(plan.customAI,false);assert.equal(plan.wallet,false);
  assert.equal(interfacePlan(["components/custom-ai/workspace.tsx"]).customAI,true);
  assert.equal(interfacePlan(["lib/custom-ai/capabilities/search-hooks/index.server.ts","contracts/src/custom-ai/CustomAIProgramFactoryV1.sol"]).activation,true);
});
