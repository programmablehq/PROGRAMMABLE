import assert from "node:assert/strict";
import test from "node:test";
import { isInterfaceMaintenance } from "./interface-maintenance.mjs";

test("test deletions and interface verifier changes do not require rebuilding unchanged contracts", () => {
  assert.equal(isInterfaceMaintenance(["scripts/ci/interface-plan.mjs", "tests/token-detail-layout.test.ts"],
    () => ["old test", null]), true);
  assert.equal(isInterfaceMaintenance(["tests/wallet.test.ts"], () => ["old test", "changed test"]), false);
  assert.equal(isInterfaceMaintenance(["lib/wallet-operation.ts"], () => ["old", "new"]), false);
  assert.equal(isInterfaceMaintenance(["contracts/src/FeeVault.sol"], () => ["old", "new"]), false);
  assert.equal(isInterfaceMaintenance(["scripts/ci/contracts-ci.mjs"], () => ["old", "new"]), false);
});

test("only interface commands can change in the package manifest", () => {
  const before = { dependencies: { viem: "1" }, scripts: { "verify:interface:ci": "old", build: "build" } };
  const after = structuredClone(before); after.scripts["verify:interface:ci"] = "new";
  const check = () => isInterfaceMaintenance(["package.json"], () => [JSON.stringify(before), JSON.stringify(after)]);
  assert.equal(check(), true);
  after.dependencies.viem = "2"; assert.equal(check(), false);
  after.dependencies.viem = "1"; after.scripts.build = "different"; assert.equal(check(), false);
});

test("contract jobs, final proof and permissions cannot change through the maintenance lane", () => {
  const before = "permissions:\n  contents: read\njobs:\n  scope:\n    name: old\n  interface-quality:\n    name: old\n  contracts:\n    name: Contracts\n  production-proof:\n    name: Proof\n";
  const check = after => isInterfaceMaintenance([".github/workflows/verify.yml"], () => [before, after]);
  assert.equal(check(before.replaceAll("name: old", "name: new")), true);
  assert.equal(check(before.replace("name: Contracts", "name: Changed")), false);
  assert.equal(check(before.replace("name: Proof", "name: Changed")), false);
  assert.equal(check(before.replace("contents: read", "contents: write")), false);
});
