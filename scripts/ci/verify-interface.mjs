import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { changedPaths, interfacePlan, relatedInputs } from "./interface-plan.mjs";
import { isCustomAITracingOnlyChange } from "./classify-verify-paths.mjs";

const mode = process.argv[2];
if (!["quality", "browser-build", "plan", "guidance", "typecheck"].includes(mode)) throw Error("Unknown interface verification mode");
const revisions = { ...process.env };
const arguments_ = process.argv.slice(3);
for (let index = 0; index < arguments_.length; index += 2) {
  const name = arguments_[index], value = arguments_[index + 1];
  if (!["--base", "--head"].includes(name) || !/^[a-f0-9]{40}$/u.test(value ?? ""))
    throw Error("Use --base and --head with full Git commit hashes.");
  revisions[name === "--base" ? "PROGRAMMABLE_CI_BASE_SHA" : "PROGRAMMABLE_CI_HEAD_SHA"] = value;
}
if (arguments_.length && (!arguments_.includes("--base") || !arguments_.includes("--head")))
  throw Error("Provide both --base and --head; a partial range cannot select affected checks.");
const paths = process.env.PROGRAMMABLE_VERIFY_FULL_INTERFACE === "true" ? null : changedPaths(revisions);
const maintenance = process.env.PROGRAMMABLE_VERIFY_MAINTENANCE === "true";
const customAITracingOnly = paths && isCustomAITracingOnlyChange(paths, {
  baseSha: revisions.PROGRAMMABLE_CI_BASE_SHA, headSha: revisions.PROGRAMMABLE_CI_HEAD_SHA,
});
const plan = interfacePlan(maintenance ? [] : paths, { customAITracingOnly,
  baseSha: revisions.PROGRAMMABLE_CI_BASE_SHA, headSha: revisions.PROGRAMMABLE_CI_HEAD_SHA });
if (mode === "plan") { console.log(JSON.stringify({ paths, ...plan }, null, 2)); process.exit(0); }
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const npm = name => run("npm", ["run", name]);
const typecheck = () => {
  run("node", ["node_modules/next/dist/bin/next", "typegen"]);
  npm("typecheck");
};
if (mode === "typecheck") { typecheck(); process.exit(0); }
const excluded = ["tests/classic-v3-deployment-sequence.test.ts", "tests/deep-release-verifier.test.ts",
  "tests/deep-v2-release-verifier.test.ts", "tests/website-projection-target.test.ts", "tests/module-foundation-economic-modules.test.ts"];

console.log(`Interface: ${plan.full ? "complete" : "affected"} checks (${paths?.length ?? "unknown"} changed paths)`);
if (maintenance) {
  if (mode !== "browser-build") {
    npm("test:ci-scope");
    const lint = paths.filter(file => /\.[cm]?[jt]sx?$/u.test(file) && existsSync(file));
    if (lint.length) run("npx", ["--no-install", "eslint", ...lint]);
  }
  console.log("Verification maintenance only; application and contract sources are unchanged.");
  process.exit(0);
}
if (mode === "browser-build") {
  if (plan.browser.length) run("npx", ["--no-install", "playwright", "test", "--config", "playwright.wallet-lock.config.ts",
    ...plan.browser.map(name => `${name}.spec.ts`)]);
  if (plan.migration) npm("test:browser:late-migration");
  if (plan.customAIBrowser.length) run("npx", ["--no-install", "playwright", "test", "--config", "playwright.custom-ai.config.ts", ...plan.customAIBrowser]);
  if (plan.productionBuild) npm("build");
  else { typecheck(); console.log("Interface typecheck passed. The publisher performs the production build once before promotion."); }
} else {
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n");
  const inputs = paths ? relatedInputs(paths, files) : [];
  // Browser/client dependency tracing also selects the owned-source fixture,
  // which compiles one contract using the default pinned toolchain directory.
  // Provision that dependency without enabling unrelated compiler suites.
  const ownedSourceFixture = inputs.includes("tests/custom-ai-general-launch-source.test.ts");
  if (plan.customAICompiler || ownedSourceFixture) {
    run("node", ["scripts/custom-ai/install-toolchain.mjs"]);
  }
  if (plan.customAICompiler) {
    process.env.CUSTOM_AI_COMPILER_DIR = resolve("scripts/custom-ai/toolchain");
  }
  if (plan.full || plan.verificationTools) npm("test:ci-scope");
  const lint = paths?.filter(file => /\.[cm]?[jt]sx?$/u.test(file) && existsSync(file)) ?? [];
  if (plan.full) npm("lint");
  else if (lint.length) run("npx", ["--no-install", "eslint", ...lint]);
  if (plan.moduleTools) for (const name of ["modules:sdk:test", "modules:cli:check", "modules:cli:test"]) npm(name);
  if (plan.full) npm("test:interface:ci");
  else {
    if (plan.scriptTests) {
      const files = execFileSync("git", ["ls-files", "scripts"], { encoding: "utf8" }).trim().split("\n");
      // The mandatory Credential leak gate runs this test with its checksum-
      // verified binary. This runner has no such binary and must not rerun it.
      const selected = relatedInputs(paths, files).filter(file => file.endsWith(".test.mjs")
        && file !== "scripts/security/gitleaks-policy.test.mjs");
      if (selected.length) run("node", ["--test", ...selected]);
    }
    // Deleted files cannot be resolved by Vite; the changed-source mode keeps
    // importers covered even when an old module has just been removed.
    if (paths.some(file => !existsSync(file))) run("npx", ["--no-install", "vitest", "run",
      ...excluded.flatMap(file => ["--exclude", file])]);
    else if (inputs.length) run("npx", ["--no-install", "vitest", "related", "--run", "--passWithNoTests", ...inputs,
      ...excluded.flatMap(file => ["--exclude", file])]);
  }
}
