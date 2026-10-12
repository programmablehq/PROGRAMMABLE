/** Regenerate with the pinned backend's tsx and checkout argument.
 * Unit transport fixtures only: injected results are not deployment or review evidence.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const backendCommit = "ca8912c3d84340c3185b9ec816e15c697c8fc21b";
const root = resolve(process.argv[2]);
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), backendCommit);
assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }), "");
const load = path => import(pathToFileURL(resolve(root, "services/custom-launch-api-v1", path)).href);
const { protocolUnitFixtureV3, protocolUnitCompilerV3, protocolUnitResultsV3 } = await load("test/module-foundation-protocol-v3-fixture.ts");
const { createFoundationProtocolBuilderV3, verifyFoundationProtocolBuildV3 } = await load("src/module-foundation-review/protocol-v3.ts");
const { foundationProtocolHostManifestHashV3 } = await load("src/module-foundation-review/availability-v3.ts");
const cases = [];
for (const platformBps of [30, 100]) {
  const f = protocolUnitFixtureV3(platformBps);
  const artifact = await createFoundationProtocolBuilderV3({ source: { read: async () => f.bytes }, compiler: protocolUnitCompilerV3,
    tests: { execute: async request => protocolUnitResultsV3(request) } }).build(f.subject, f.plan);
  verifyFoundationProtocolBuildV3(artifact, f.subject, f.plan, f.bytes);
  cases.push({ source: f.request, plan: f.plan, artifact, hostManifestHash: foundationProtocolHostManifestHashV3(artifact) });
}
await writeFile(new URL("./module-foundation-review-v3.json", import.meta.url), JSON.stringify({ fixtureOnly: true, backendCommit,
  authority: "Unit transport only; no protected execution, review approval or deployment", cases }, null, 2) + "\n");
