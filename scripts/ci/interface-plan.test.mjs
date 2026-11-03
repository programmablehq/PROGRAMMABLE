import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { interfacePlan, relatedInputs, runtimeDependencySource } from "./interface-plan.mjs";
import { GENERAL_CONSTRUCTOR_WORKERS, GENERAL_BEHAVIOR_WORKERS } from "./classify-verify-paths.mjs";

test("runtime test selection ignores type-only edges and retains mixed/runtime imports",()=>{
  const source="import type {Config} from './types'; import {type Result} from './result'; export type {Shape} from './shape'; import {type Data, run} from './runtime'; import './side-effect'; type Lazy = import('./lazy').Value;";
  const scanned=runtimeDependencySource(source,"test.ts");
  for(const name of ["./types","./result","./shape","./lazy"])assert.equal(scanned.includes(name),false,name);
  for(const name of ["./runtime","./side-effect"])assert.equal(scanned.includes(name),true,name);
  const broken="import type { from './unfinished'";
  assert.equal(runtimeDependencySource(broken,"test.ts"),broken);
});

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

test("known classifier maintenance runs its own verification without unrelated interface suites",()=>{
  const plan=interfacePlan(["scripts/ci/classify-verify-paths.mjs"]);
  assert.equal(plan.full,false);
  assert.equal(plan.verificationTools,true);
  assert.equal(plan.scriptTests,true);
  assert.equal(plan.customAI,false);
  assert.deepEqual(plan.browser,[]);
  assert.equal(interfacePlan(["scripts/ci/unknown-policy.mjs"]).full,true);
});

test("a read-only Custom AI extension does not select financial or wallet browser work", () => {
  const plan=interfacePlan(["lib/custom-ai/capabilities/search-hooks/index.server.ts"]);
  assert.equal(plan.activation,false);assert.equal(plan.customAI,false);assert.equal(plan.wallet,false);
  assert.equal(plan.customAICompiler,false);
  assert.equal(interfacePlan(["components/custom-ai/workspace.tsx"]).customAI,true);
  assert.equal(interfacePlan(["lib/custom-ai/capabilities/search-hooks/index.server.ts","contracts/src/custom-ai/CustomAIProgramFactoryV1.sol"]).activation,true);
});

test("compiler changes require the isolated EVM toolchain in CI", () => {
  for (const path of ["lib/custom-ai/rule-compiler.server.ts", "scripts/custom-ai/compile-worker.mjs",
    "tests/custom-ai-rule-compiler.test.ts", "lib/custom-ai/composable-code.json"]) {
    assert.equal(interfacePlan([path]).customAICompiler, true, path);
  }
});

test("source generation and admission checks install their actual compiler dependency", () => {
  for (const path of ["lib/custom-ai/service.server.ts", "lib/custom-ai/general-builder.server.ts",
    "lib/custom-ai/intent-coverage.server.ts", "lib/custom-ai/contract-project.server.ts",
    "lib/custom-ai/check-blueprint.ts", "lib/custom-ai/project-store.server.ts",
    "tests/custom-ai-general-launch-source.test.ts", "tests/custom-ai-general-builder.test.ts"]) {
    assert.equal(interfacePlan([path]).customAICompiler, true, path);
  }
  assert.equal(interfacePlan(["components/custom-ai/requested-rules.tsx"]).customAICompiler, false);
});

test("model configuration and transport changes provision the compiler used by their source-selection consumers", () => {
  for (const path of ["lib/custom-ai/ai-config.ts", "lib/custom-ai/surplus.server.ts",
    "lib/custom-ai/surplus-schema.server.ts", "lib/custom-ai/model-provider.server.ts", "lib/custom-ai/provider-config.server.ts"]) {
    const plan = interfacePlan([path]);
    assert.equal(plan.customAICompiler, true, path);
    assert.equal(plan.full, false, path);
    assert.equal(plan.activation, false, path);
    assert.deepEqual(plan.browser, [], path);
  }
});

test("constructor worker changes retain real-EVM, browser and pack-consumer coverage", () => {
  const files = ["lib/custom-ai/runtime-materialization.server.ts", "lib/custom-ai/general-pack.server.ts",
    "lib/custom-ai/general-plan-pack.server.ts", "tests/custom-ai-runtime-materialization.test.ts",
    "tests/custom-ai-constructor-children-runtime.test.ts", "tests/custom-ai-runtime-forwarded-gas.test.ts",
    "tests/custom-ai-general-plan-pack.test.ts", ...GENERAL_CONSTRUCTOR_WORKERS];
  for (const worker of GENERAL_CONSTRUCTOR_WORKERS.filter(path => !path.endsWith("/dependency-call-worker.mjs"))) {
    const plan = interfacePlan([worker]);
    assert.equal(plan.full, false);
    assert.equal(plan.customAI, true);
    assert.equal(plan.customAICompiler, true);
    assert.equal(plan.wallet, true);
    assert.deepEqual(plan.browser, []);
    const selected = relatedInputs([worker], files);
    for (const required of files.filter(file => !file.startsWith("scripts/"))) assert.ok(selected.includes(required), required);
  }
});

test("dependency replay worker keeps its actual VM reader coverage", () => {
  const worker = "scripts/custom-ai/dependency-call-worker.mjs";
  const plan = interfacePlan([worker]);
  assert.equal(plan.customAI, true);
  assert.equal(plan.customAICompiler, true);
  const files = [worker, "lib/custom-ai/dependency-witness.server.ts", "tests/custom-ai-dependency-witness.test.ts"];
  const selected = relatedInputs([worker], files);
  for (const file of files) assert.ok(selected.includes(file), file);
});

test("behavior workers retain their actual EVM consumers and Custom AI browser coverage", () => {
  const files = [...GENERAL_BEHAVIOR_WORKERS, "lib/custom-ai/behavior-checks.server.ts",
    "tests/custom-ai-event-checks.test.ts", "tests/custom-ai-general-v4-world.test.ts",
    "tests/custom-ai-protected-world.test.ts", "tests/custom-ai-general-launch-source.test.ts"];
  for (const worker of GENERAL_BEHAVIOR_WORKERS) {
    const plan = interfacePlan([worker]);
    assert.equal(plan.full, false);assert.equal(plan.customAI, true);assert.equal(plan.customAICompiler, true);assert.equal(plan.wallet, true);
    assert.deepEqual(plan.browser, []);assert.equal(plan.migration, false);assert.equal(plan.moduleTools, false);assert.equal(plan.activation, false);
    const selected = relatedInputs([worker], files);
    for (const required of files.filter(file => !file.startsWith("scripts/"))) assert.ok(selected.includes(required), `${worker}: ${required}`);
  }
});

test("an independently qualified trace addition retains targeted AI checks and rejects mixed global inputs", () => {
  const paths = ["next.config.ts", "scripts/custom-ai/declared-events.mjs", "lib/custom-ai/behavior-checks.server.ts"];
  assert.equal(interfacePlan(paths).full, true);
  const plan = interfacePlan(paths, { customAITracingOnly: true });
  assert.equal(plan.full, false);assert.equal(plan.customAI, true);assert.equal(plan.customAICompiler, true);assert.deepEqual(plan.browser, []);
  assert.equal(interfacePlan([...paths, "package-lock.json"], { customAITracingOnly: true }).full, true);
  assert.equal(interfacePlan(null, { customAITracingOnly: true }).full, true);
});

test("Custom AI interactions use their own browser suite while shared wallet changes retain coverage", () => {
  for (const path of ["components/custom-ai/launch-preview.tsx", "lib/custom-ai/wallet.ts", "app/api/custom-ai/launch/route.ts"]) {
    const plan = interfacePlan([path]);
    assert.equal(plan.customAI, true, path);
    assert.equal(plan.wallet, true, path);
    assert.deepEqual(plan.browser, [], path);
    assert.equal(plan.activation, false, path);
  }
  const mixed = interfacePlan(["components/custom-ai/launch-preview.tsx", "components/wallet-provider.tsx"]);
  assert.ok(mixed.browser.includes("wallet-request-lock"));
  assert.ok(mixed.browser.includes("wallet-session"));
  const contracts = interfacePlan(["components/custom-ai/launch-preview.tsx", "contracts/src/custom-ai/CustomAIProgramFactoryV1.sol"]);
  assert.equal(contracts.activation, true);
  assert.equal(contracts.customAI, true);
});

test("Custom AI design documentation does not select Module Mode browser flows", () => {
  const docs = interfacePlan(["docs/custom-ai/LAUNCH-INTENT.md"]);
  assert.deepEqual(docs.browser, []);assert.equal(docs.wallet, false);assert.equal(docs.activation, false);
  const source = interfacePlan(["docs/custom-ai/LAUNCH-INTENT.md", "lib/custom-ai/launch-preparation.server.ts"]);
  assert.deepEqual(source.browser, []);assert.equal(source.customAI, true);assert.equal(source.wallet, true);
  assert.ok(interfacePlan(["docs/custom-ai/LAUNCH-INTENT.md", "components/module-foundation-launch.tsx"]).browser.includes("module-signing"));
});

test("independent declaration changes provision the pinned contract checker", () => {
  for (const path of ["lib/custom-ai/check-declaration.server.ts", "lib/custom-ai/check-plan-wire.ts", "lib/custom-ai/behavior-checks.ts", "tests/custom-ai-check-declaration.test.ts"]) {
    const plan = interfacePlan([path]);
    assert.equal(plan.customAICompiler, true, path);
    assert.equal(plan.activation, false, path);
    assert.deepEqual(plan.browser, [], path);
  }
});
