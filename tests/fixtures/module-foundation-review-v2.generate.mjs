/**
 * Regenerate only from the exact local backend checkout below:
 * <backend>/services/custom-launch-api-v1/node_modules/.bin/tsx \
 *   tests/fixtures/module-foundation-review-v2.generate.mjs <backend>
 *
 * This compiles the backend's pinned, repository-owned Solidity fixture locally.
 * Injected conformance records exercise the transport; they provide no protected
 * worker execution, reviewer decision, deployment, or availability evidence.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const backendCommit = "bcbc7f71d59b43c43cf60dab5569ddc974f85cd0";
assert(process.argv[2], "The exact local backend checkout is required.");
const backendRoot = resolve(process.argv[2]);
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: backendRoot, encoding: "utf8" }).trim(), backendCommit);
assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: backendRoot, encoding: "utf8" }), "", "Backend tracked files must match the pinned commit.");
const serviceRoot = resolve(backendRoot, "services/custom-launch-api-v1");
const requireBackend = createRequire(resolve(serviceRoot, "package.json"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha256(await readFile(requireBackend.resolve("solc/soljson.js"))), "35ba6661f3bdaed995fc7af14c405502290cf681b3fd062fe8738cfdf6db14ed");
const loadBackend = path => import(pathToFileURL(resolve(serviceRoot, path)).href);
const { foundationProtocolFixedSourceCompilerV2 } = await loadBackend("test/module-foundation-protocol-v2-source-fixture.ts");
const { createFoundationProtocolBuilderV2, verifyFoundationProtocolBuildV2, FOUNDATION_PROTOCOL_CHECKS_V2,
  FOUNDATION_PROTOCOL_REVIEW_AREAS_V2, FOUNDATION_PROTOCOL_FIELDS_V2 } = await loadBackend("src/module-foundation-review/protocol-v2.ts");
const { foundationProtocolHostManifestHashV2 } = await loadBackend("src/module-foundation-review/availability-v2.ts");
const { foundationProtocolHostManifestHashV1 } = await loadBackend("src/module-foundation-review/availability-v1.ts");
const { fixture, compiler } = await foundationProtocolFixedSourceCompilerV2();
const artifact = await createFoundationProtocolBuilderV2({
  source: { read: async () => fixture.bytes }, compiler,
  tests: { execute: async request => ({
    schemaVersion: "programmable.modules.foundation-protocol-test-results.v2", requestDigest: request.requestDigest, planDigest: request.planDigest,
    harnessDigest: `0x${sha256("LOCAL TRANSPORT FIXTURE ONLY: injected V2 conformance records, no protected execution")}`,
    execution: "isolated-docker-anvil", checks: Object.fromEntries(FOUNDATION_PROTOCOL_CHECKS_V2.map(check => [check, true])), allRequiredChecksPassed: true,
  }) },
}).build(fixture.subject, fixture.plan);
verifyFoundationProtocolBuildV2(artifact, fixture.subject, fixture.plan, fixture.bytes);
assert.equal(artifact.factory.creationCodeHash, "0x86b7a27c33248cac17adba08daa8e6d771331bbafca963dfc5236dfa077f0ed9");
assert.equal(artifact.factory.runtimeTemplateHash, "0x8d6d56d1a6b12a81dad3484fb02ce1310a2808e11f760dd9a5741788a0994a66");
assert.equal(artifact.hookDeployer.creationCodeHash, "0xbe5dd5abce20638598b658024483a058848ba211a583cc816a6e5ecc6e235029");
assert.equal(artifact.hookDeployer.runtimeTemplateHash, "0xf480e7f7242d590d1656d6efec70cfe64470d02dc768cad3721d0937066a0152");
const v1 = JSON.parse(await readFile(new URL("./module-foundation-review.json", import.meta.url), "utf8"));
const result = {
  fixtureOnly: true,
  provenance: {
    backendCommit, backendProtocolPath: "services/custom-launch-api-v1/src/module-foundation-review/protocol-v2.ts",
    sourcePath: "services/custom-launch-api-v1/test/module-foundation-protocol-v2-source.json",
    sourceSha256: sha256(fixture.bytes), sourceCommit: fixture.plan.sourceCommit,
    compiler: "Local solc-js, exact backend binary hash, fixed repository-owned source only",
    conformance: "Injected success records for transport validation only; no protected worker execution",
    authority: "No reviewer decision, Registry approval, deployment, or availability evidence",
  },
  backend: {
    hostManifestHash: foundationProtocolHostManifestHashV2(artifact), v1HostManifestHash: foundationProtocolHostManifestHashV1(v1.protocol.artifact),
    checks: FOUNDATION_PROTOCOL_CHECKS_V2, reviewAreas: FOUNDATION_PROTOCOL_REVIEW_AREAS_V2, immutableFields: FOUNDATION_PROTOCOL_FIELDS_V2,
  },
  source: JSON.parse(fixture.bytes.toString("utf8")), plan: fixture.plan, artifact,
};
await writeFile(new URL("./module-foundation-review-v2.json", import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ fixtureOnly: true, backendCommit, sourceCommit: fixture.plan.sourceCommit,
  artifactDigest: artifact.artifactDigest, hostManifestHash: result.backend.hostManifestHash }));
