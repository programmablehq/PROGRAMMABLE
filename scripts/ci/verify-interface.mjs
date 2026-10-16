import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { changedPaths, interfacePlan, relatedInputs } from "./interface-plan.mjs";

const mode = process.argv[2];
if (!["quality", "browser-build", "plan", "guidance"].includes(mode)) throw Error("Unknown interface verification mode");
const paths = process.env.PROGRAMMABLE_VERIFY_FULL_INTERFACE === "true" ? null : changedPaths();
const maintenance = process.env.PROGRAMMABLE_VERIFY_MAINTENANCE === "true";
const plan = interfacePlan(maintenance ? [] : paths);
if (mode === "plan") { console.log(JSON.stringify({ paths, ...plan }, null, 2)); process.exit(0); }
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const npm = name => run("npm", ["run", name]);
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
  if (plan.wallet) run("npx", ["--no-install", "playwright", "test", "--config", "playwright.wallet-lock.config.ts",
    ...plan.browser.map(name => `${name}.spec.ts`)]);
  if (plan.migration) npm("test:browser:late-migration");
  npm("build");
} else {
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
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n");
    const inputs = relatedInputs(paths, files);
    // Deleted files cannot be resolved by Vite; the changed-source mode keeps
    // importers covered even when an old module has just been removed.
    if (paths.some(file => !existsSync(file))) run("npx", ["--no-install", "vitest", "run",
      ...excluded.flatMap(file => ["--exclude", file])]);
    else if (inputs.length) run("npx", ["--no-install", "vitest", "related", "--run", "--passWithNoTests", ...inputs,
      ...excluded.flatMap(file => ["--exclude", file])]);
  }
}
