import assert from "node:assert/strict";
import {
  chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  canonicalJson,
  canonicalSha256,
  currentGitBlobIdentity,
  deriveGenericLaunchReadModelContractV2,
  readProtectedDerivationInput,
  sha256Bytes,
} from "../custom-v2-read-model-contract-v2.mjs";
import { discoverRetainedWebsiteProjectionPlan } from
  "../website-projection-db-operator-core.mjs";

const DIGEST = (label) => sha256Bytes(Buffer.from(label, "utf8"));

async function fixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "generic-v2-contract-"));
  const websiteSource = {
    repositoryId: "1314365508",
    repositoryFullName: "0xprogrammable/programmable",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
  };
  const registrySource = {
    repositoryId: "1314365508",
    repositoryFullName: "0xprogrammable/programmable",
    commit: "1".repeat(40),
    tree: "2".repeat(40),
  };
  const registryAddress = "0x845506084a1afb969fa4def444a2bdeee794aaad";
  const registryRuntimeCodeKeccak256 = `0x${"3".repeat(64)}`;
  const registryPolicyCommitment = `0x${"4".repeat(64)}`;
  const sourceArtifactSha256 = DIGEST("registry-source");
  const abiArtifactSha256 = DIGEST("registry-abi");
  const eventSetSha256 = DIGEST("registry-events");
  const registryDeployment = {
    schemaVersion: "programmable.custom-registry-v2-deployment.v1",
    status: "live",
    generation: "2",
    chainId: "1",
    caip2: "eip155:1",
    publicReadEnabled: true,
    indexingEnabled: true,
    registry: {
      address: registryAddress,
      runtimeCodeKeccak256: registryRuntimeCodeKeccak256,
      deploymentTransactionHash: `0x${"5".repeat(64)}`,
      deploymentBlock: "100",
      deploymentBlockHash: `0x${"6".repeat(64)}`,
    },
    release: {
      sourceCommit: registrySource.commit,
      sourceTree: registrySource.tree,
      sourceArtifactSha256,
      abiArtifactSha256,
      eventSetSha256,
    },
    finality: {
      minimumConfirmations: "12",
      policyBindingHash: registryPolicyCommitment,
    },
    profiles: {
      NoMarket0: { marketMode: 0, protocolFeeBps: 0 },
      Standard10: { marketMode: 1, protocolFeeBps: 10 },
    },
  };
  const files = {
    "app/api/custom-launch/generic/v2/launches/[recordHash]/route.ts":
      "detail\n",
    "app/api/custom-launch/generic/v2/launches/route.ts": "feed\n",
    "app/api/custom-launch/generic/v2/readiness/route.ts": "readiness\n",
    "app/api/ops/custom-launch/generic-v2-projector/route.ts": "project\n",
    "app/api/ops/custom-launch/generic-v2-signer-probe/route.ts": "probe\n",
    "app/v2/internal/projections/approval-descriptors/[projectionKey]/route.ts":
      "ingress\n",
    "config/custom-registry-v2.deployment.prelaunch.json":
      `${JSON.stringify(registryDeployment)}\n`,
    "config/generic-launch-public.v2.schema.json": "schema\n",
    "lib/server/custom-launch/generic-launch-contract-v2.ts": "contract\n",
    "lib/server/custom-launch/generic-launch-postgres-v2.ts": "persistence\n",
    "lib/server/custom-launch/generic-launch-production-v2.ts": "production\n",
    "lib/server/custom-launch/generic-launch-projector-v2.ts": "projector\n",
    "lib/server/custom-launch/generic-launch-read-production-probe-v1.ts":
      "production probe\n",
    "lib/server/custom-launch/generic-launch-read-signer-v2.ts": "signer\n",
    "lib/server/custom-launch/generic-launch-read-v2.ts": "reader\n",
    "lib/server/custom-launch/generic-launch-registry-reader-v2.ts": "registry\n",
    "lib/server/projection-target/approval-v3-target.ts": "approval\n",
    "ops/website-projection-target/migrations/0001_projection_records_v1.sql":
      "BEGIN;\nSELECT 1;\nCOMMIT;\n",
    "ops/website-projection-target/migrations/0002_custom_launch_wallet_profile_v2.sql":
      "BEGIN;\nSELECT 2;\nCOMMIT;\n",
    "ops/website-projection-target/migrations/0003_registry_custom_public_read_v1.sql":
      "BEGIN;\nSELECT 3;\nCOMMIT;\n",
    "ops/website-projection-target/migrations/0004_approval_v3_artifacts_v1.sql":
      "BEGIN;\nSELECT 4;\nCOMMIT;\n",
    "ops/website-projection-target/migrations/0005_generic_launch_materializations_v2.sql":
      "BEGIN;\nSELECT 5;\nCOMMIT;\n",
  };
  for (const [path, source] of Object.entries(files)) {
    await mkdir(dirname(join(repoRoot, path)), { recursive: true });
    await writeFile(join(repoRoot, path), source, "utf8");
  }
  const artifact = (path) => ({
    path,
    sha256: sha256Bytes(Buffer.from(files[path], "utf8")),
    gitBlobOid: sha256Bytes(Buffer.from(files[path], "utf8")).slice(7, 47),
  });
  const plan = await discoverRetainedWebsiteProjectionPlan({
    workspace: repoRoot,
    repositoryCommit: websiteSource.commit,
    repositoryTree: websiteSource.tree,
  });
  const target = {
    projectRef: "mnnvlrqwhfoppogslsje",
    host: "db.mnnvlrqwhfoppogslsje.supabase.co",
    port: 5432,
    database: "postgres",
    sslMode: "verify-full",
  };
  const operatorIdentity = {
    mode: "database-owner",
    sessionUser: "postgres",
    effectiveRole: "postgres",
  };
  const operatorResult = (operation, state, changed) => ({
    kind: "programmable-website-projection-db-operator-result",
    schemaVersion: 1,
    operation,
    planSha256: plan.planSha256,
    target,
    operatorIdentity,
    state,
    changed,
  });
  const catalog = `0x${"7".repeat(64)}`;
  const protectedValues = {
    plan,
    adoption: operatorResult("adopt-existing", {
      status: "pending",
      appliedCount: 3,
      pending: plan.migrations.slice(3).map(
        ({ ordinal, version, file }) => ({ ordinal, version, file }),
      ),
      catalogSha256: `0x${"8".repeat(64)}`,
      runtimeRoleStatus: "current",
      adoptedExisting: true,
      adoptedThisRun: ["0001", "0002", "0003"],
      adoptionSourceCatalogSha256: `0x${"9".repeat(64)}`,
      adoptionDataSha256: `0x${"a".repeat(64)}`,
      adoptionAttestationSha256: `0x${"b".repeat(64)}`,
    }, true),
    apply: operatorResult("apply", {
      status: "current",
      appliedCount: 5,
      pending: [],
      catalogSha256: catalog,
      runtimeRoleStatus: "current",
      appliedThisRun: ["0004", "0005"],
      roleCreated: false,
    }, true),
    verify: operatorResult("verify", {
      status: "current",
      appliedCount: 5,
      pending: [],
      catalogSha256: catalog,
      runtimeRoleStatus: "current",
    }, false),
  };
  const protectedArtifacts = {};
  for (const [name, value] of Object.entries(protectedValues)) {
    const path = join(repoRoot, `${name}.json`);
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    await writeFile(path, bytes, { mode: 0o600 });
    protectedArtifacts[name] = { path, sha256: sha256Bytes(bytes) };
  }
  const input = {
    schemaVersion:
      "programmable.generic-launch-read-model-contract-derivation-input.v1",
    websiteSource,
    implementation: {
      artifacts: [
        artifact("app/api/ops/custom-launch/generic-v2-projector/route.ts"),
        artifact("app/v2/internal/projections/approval-descriptors/[projectionKey]/route.ts"),
        artifact("lib/server/custom-launch/generic-launch-contract-v2.ts"),
        artifact("lib/server/custom-launch/generic-launch-production-v2.ts"),
        artifact("lib/server/custom-launch/generic-launch-projector-v2.ts"),
        artifact("lib/server/custom-launch/generic-launch-registry-reader-v2.ts"),
        artifact("lib/server/projection-target/approval-v3-target.ts"),
      ],
    },
    persistence: {
      artifacts: [
        artifact("lib/server/custom-launch/generic-launch-postgres-v2.ts"),
        ...plan.migrations.map(({ file }) => artifact(file)),
      ],
      hostedEvidence: protectedArtifacts,
    },
    queryContract: {
      artifacts: [
        artifact("app/api/custom-launch/generic/v2/launches/[recordHash]/route.ts"),
        artifact("app/api/custom-launch/generic/v2/launches/route.ts"),
        artifact("app/api/custom-launch/generic/v2/readiness/route.ts"),
        artifact("app/api/ops/custom-launch/generic-v2-signer-probe/route.ts"),
        artifact("config/generic-launch-public.v2.schema.json"),
        artifact("lib/server/custom-launch/generic-launch-read-production-probe-v1.ts"),
        artifact("lib/server/custom-launch/generic-launch-read-signer-v2.ts"),
        artifact("lib/server/custom-launch/generic-launch-read-v2.ts"),
      ],
      feedPath: "/api/custom-launch/generic/v2/launches",
      detailPathTemplate:
        "/api/custom-launch/generic/v2/launches/{recordHash}",
      readinessPath: "/api/custom-launch/generic/v2/readiness",
    },
    approvalArtifactSchema: {
      status: "frozen",
      source: {
        repositoryId: "1318883798",
        repositoryFullName: "0xprogrammable/programmable-open-hook-v2-internal",
        commit: "c".repeat(40),
        tree: "d".repeat(40),
      },
      schemaVersion:
        "programmable.approval-registry-v2-descriptor-binding.v2",
      domain: "programmable.approval-registry-descriptor-binding.v3",
      audience: "programmable.custom-registry.v2",
      artifact: {
        path: "services/autonomous-approval-v1/schemas/approval-registry-v2-descriptor-binding-v2.schema.json",
        sha256: DIGEST("approval-schema"),
      },
      handoffEvidenceSha256: DIGEST("approval-schema-handoff"),
    },
    approvalRelease: {
      status: "live",
      source: {
        repositoryId: "1318883798",
        repositoryFullName: "0xprogrammable/programmable-open-hook-v2-internal",
        commit: "e".repeat(40),
        tree: "f".repeat(40),
      },
      packageArtifactSha256: DIGEST("approval-package"),
      aggregateReadinessBindingHash: DIGEST("approval-readiness"),
      artifactVerifierBindingHash: DIGEST("approval-verifier"),
      liveDeploymentEvidenceSha256: DIGEST("approval-live"),
    },
    registryProjection: {
      status: "live",
      source: registrySource,
      artifacts: [
        artifact("config/custom-registry-v2.deployment.prelaunch.json"),
        artifact("lib/server/custom-launch/generic-launch-contract-v2.ts"),
        artifact("lib/server/custom-launch/generic-launch-projector-v2.ts"),
        artifact("lib/server/custom-launch/generic-launch-registry-reader-v2.ts"),
      ],
      deploymentArtifactSha256: artifact(
        "config/custom-registry-v2.deployment.prelaunch.json",
      ).sha256,
      sourceArtifactSha256,
      abiArtifactSha256,
      eventSetSha256,
      registryAddress,
      registryRuntimeCodeKeccak256,
      registryPolicyCommitment,
      minimumFinalityBlocks: "12",
      liveVerificationEvidenceSha256: DIGEST("registry-live"),
      sourceVerificationEvidenceSha256: DIGEST("registry-source-verification"),
    },
  };
  const options = {
    repoRoot,
    hostedEvidenceIdentity: {
      planArtifactSha256: protectedArtifacts.plan.sha256,
      adoptionArtifactSha256: protectedArtifacts.adoption.sha256,
      applyArtifactSha256: protectedArtifacts.apply.sha256,
      verifyArtifactSha256: protectedArtifacts.verify.sha256,
      planRepositoryCommit: plan.repositoryCommit,
      planRepositoryTree: plan.repositoryTree,
      planSha256: plan.planSha256,
      orderSha256: plan.orderSha256,
      finalCatalogSha256: catalog,
    },
    gitBlobIdentity: async (_root, commit, path) => {
      assert.equal(commit, websiteSource.commit);
      const value = artifact(path);
      return {
        mode: "100644",
        type: "blob",
        oid: value.gitBlobOid,
        contentSha256: value.sha256,
      };
    },
  };
  return { repoRoot, input, files, options, protectedArtifacts };
}

async function currentEvidenceFixture() {
  const value = await fixture();
  const plan = JSON.parse(await readFile(
    value.protectedArtifacts.plan.path,
    "utf8",
  ));
  const currentVerify = JSON.parse(await readFile(
    value.protectedArtifacts.verify.path,
    "utf8",
  ));
  const finalCatalogSha256 = currentVerify.state.catalogSha256;
  const operatorCatalogSha256 = `0x${"6".repeat(64)}`;
  const rotationSource = {
    repositoryCommit: "1".repeat(40),
    repositoryTree: "2".repeat(40),
    repositoryParent: "3".repeat(40),
  };
  const rotationReceipt = {
    schemaVersion:
      "programmable.website-projection-runtime-credential-rotation.v1",
    operation: "rotate-existing-runtime-role-password",
    changed: true,
    rotatedAt: "2026-08-21T07:34:02.793Z",
    source: rotationSource,
    target: {
      projectRef: "mnnvlrqwhfoppogslsje",
      database: "postgres",
      authorityEndpoint: "db.mnnvlrqwhfoppogslsje.supabase.co:5432",
      runtimeEndpoint: "aws-0-eu-central-1.pooler.supabase.com:6543",
      runtimeRole: "programmable_website_projection_runtime",
    },
    migrationEvidence: {
      migrationCount: 5,
      planSha256: plan.planSha256,
      repositoryCommit: plan.repositoryCommit,
      repositoryTree: plan.repositoryTree,
      catalogSha256: finalCatalogSha256,
      operatorCatalogSha256,
    },
    catalog: {
      beforeSha256: finalCatalogSha256,
      afterSha256: finalCatalogSha256,
      unchanged: true,
    },
    runtimeProbe: {
      runtimeRole: "programmable_website_projection_runtime",
      databaseName: "postgres",
      serverVersionNum: "170006",
      sslVersion: "TLSv1.3",
      sslCipher: "TLS_AES_256_GCM_SHA384",
      sslBits: 256,
      leastPrivilege: true,
    },
    tls: {
      mode: "verify-full-equivalent",
      caSha256: DIGEST("provider-ca"),
      hostnameVerified: true,
    },
    cutover: {
      passwordSlots: 1,
      overlappingPasswordsSupported: false,
      existingSessionsAreNotCutoverEvidence: true,
      preCommitFailure: "automatic-transaction-rollback",
      postCommitFailure:
        "forward-rotate-or-rerun-with-the-same-protected-secret",
      vercelMutationPerformed: false,
    },
    protectedOutputs: {
      databaseUrl: "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL",
      databaseRole: "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE",
      databaseCaPem: "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM",
      receipt:
        "programmable-website-projection-runtime-credential-rotation-v1.json",
      mode: "0600",
      containsSecretDerivedDigest: false,
    },
  };
  const rotationPath = join(value.repoRoot, "rotation-receipt.json");
  const rotationBytes = Buffer.from(`${JSON.stringify(rotationReceipt)}\n`, "utf8");
  await writeFile(rotationPath, rotationBytes, { mode: 0o600 });
  const rotationArtifact = {
    path: rotationPath,
    sha256: sha256Bytes(rotationBytes),
  };
  value.input.persistence.hostedEvidence = {
    plan: value.protectedArtifacts.plan,
    rotationReceipt: rotationArtifact,
    currentVerify: value.protectedArtifacts.verify,
  };
  value.options.currentHostedEvidenceIdentity = {
    planArtifactSha256: value.protectedArtifacts.plan.sha256,
    rotationReceiptArtifactSha256: rotationArtifact.sha256,
    planRepositoryCommit: plan.repositoryCommit,
    planRepositoryTree: plan.repositoryTree,
    planSha256: plan.planSha256,
    orderSha256: plan.orderSha256,
    finalCatalogSha256,
    operatorCatalogSha256,
    rotationSourceCommit: rotationSource.repositoryCommit,
    rotationSourceTree: rotationSource.repositoryTree,
    rotationSourceParent: rotationSource.repositoryParent,
  };
  return { ...value, rotationArtifact };
}

test("derives all six content-addressed bindings and the runtime contract", async (t) => {
  const { repoRoot, input, options } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const result = await deriveGenericLaunchReadModelContractV2(input, options);
  const again = await deriveGenericLaunchReadModelContractV2(
    JSON.parse(JSON.stringify(input)),
    options,
  );

  assert.equal(canonicalJson(result), canonicalJson(again));
  assert.equal(result.contract.schemaVersion,
    "programmable.generic-launch-read-model-contract.v2");
  assert.equal(result.contract.sourceLane, "generic.finalized-launch-v2");
  assert.deepEqual(
    Object.keys(result.componentBindingHashes).sort(),
    [
      "approvalArtifactSchemaBindingHash",
      "approvalReleaseBindingHash",
      "implementationBindingHash",
      "persistenceBindingHash",
      "queryContractBindingHash",
      "registryProjectionBindingHash",
    ],
  );
  assert.equal(new Set(Object.values(result.componentBindingHashes)).size, 6);
  assert.equal(
    result.readModelBindingHash,
    canonicalSha256(result.contract.schemaVersion, result.contract),
  );
  assert.equal(
    result.derivationHash,
    canonicalSha256(result.schemaVersion, {
      schemaVersion: result.schemaVersion,
      websiteSource: result.websiteSource,
      components: result.components,
      componentBindingHashes: result.componentBindingHashes,
      contract: result.contract,
      readModelBindingHash: result.readModelBindingHash,
    }),
  );
});

test("accepts the authenticated rotation receipt plus one current verify", async (t) => {
  const value = await currentEvidenceFixture();
  t.after(() => rm(value.repoRoot, { recursive: true, force: true }));
  const result = await deriveGenericLaunchReadModelContractV2(
    value.input,
    value.options,
  );
  const evidence = result.components.persistence.hostedEvidence;
  assert.equal(
    evidence.evidenceBasis,
    "authenticated-rotation-plus-current-read-only-verify",
  );
  assert.equal(
    evidence.protectedArtifacts.rotationReceiptSha256,
    value.rotationArtifact.sha256,
  );
  assert.equal(
    evidence.protectedArtifacts.currentVerifySha256,
    value.protectedArtifacts.verify.sha256,
  );
  assert.equal(evidence.migratedThrough, "0005");
});

test("rejects fabricated current evidence and historical substitutes", async (t) => {
  const forged = await currentEvidenceFixture();
  t.after(() => rm(forged.repoRoot, { recursive: true, force: true }));
  const verify = JSON.parse(await readFile(
    forged.protectedArtifacts.verify.path,
    "utf8",
  ));
  verify.operation = "apply";
  verify.changed = true;
  const verifyBytes = Buffer.from(`${JSON.stringify(verify)}\n`, "utf8");
  await writeFile(forged.protectedArtifacts.verify.path, verifyBytes, {
    mode: 0o600,
  });
  forged.protectedArtifacts.verify.sha256 = sha256Bytes(verifyBytes);
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(forged.input, forged.options),
    /Hosted verify evidence identity|current verify/u,
  );

  const historical = await currentEvidenceFixture();
  t.after(() => rm(historical.repoRoot, { recursive: true, force: true }));
  historical.input.persistence.hostedEvidence.rotationReceipt =
    historical.protectedArtifacts.adoption;
  historical.options.currentHostedEvidenceIdentity.rotationReceiptArtifactSha256 =
    historical.protectedArtifacts.adoption.sha256;
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(historical.input, historical.options),
    /credential rotation receipt/u,
  );
});

test("fails closed while the Approval release handoff is unresolved", async (t) => {
  const { repoRoot, input, options } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  input.approvalRelease.status = "pending";
  input.approvalRelease.liveDeploymentEvidenceSha256 = null;
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, options),
    /Approval release|live deployment/u,
  );
});

test("rejects a local artifact whose bytes drift after review", async (t) => {
  const { repoRoot, input, options } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await writeFile(
    join(repoRoot, "lib/server/custom-launch/generic-launch-read-v2.ts"),
    "drift\n",
    "utf8",
  );
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, options),
    /artifact bytes do not match/u,
  );

  const linked = await fixture();
  t.after(() => rm(linked.repoRoot, { recursive: true, force: true }));
  const target = join(linked.repoRoot, "reader-target.ts");
  const path = join(
    linked.repoRoot,
    "lib/server/custom-launch/generic-launch-read-v2.ts",
  );
  await writeFile(target, "reader\n", "utf8");
  await rm(path);
  await symlink(target, path);
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(linked.input, linked.options),
    /ELOOP|symbolic link/iu,
  );
});

test("rejects unsorted, duplicate and escaping artifact inventories", async (t) => {
  const { repoRoot, input, options } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  input.implementation.artifacts.reverse();
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, options),
    /unique and sorted/u,
  );

  const duplicate = (await fixture());
  t.after(() => rm(duplicate.repoRoot, { recursive: true, force: true }));
  duplicate.input.queryContract.artifacts.push(
    duplicate.input.queryContract.artifacts[1],
  );
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(duplicate.input, duplicate.options),
    /unique and sorted/u,
  );

  const escaping = (await fixture());
  t.after(() => rm(escaping.repoRoot, { recursive: true, force: true }));
  escaping.input.implementation.artifacts[0].path = "../outside";
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(escaping.input, escaping.options),
    /path is (?:invalid|not canonical)/u,
  );
});

test("binds every local artifact to its exact HEAD Git blob", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.repoRoot, { recursive: true, force: true }));
  const expected = value.options.gitBlobIdentity;
  value.options.gitBlobIdentity = async (root, commit, path) => {
    const identity = await expected(root, commit, path);
    return path === "lib/server/custom-launch/generic-launch-projector-v2.ts"
      ? { ...identity, oid: "0".repeat(40) }
      : identity;
  };
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(value.input, value.options),
    /does not match the HEAD Git blob/u,
  );
});

test("does not treat an ignored working-tree file as a reviewed Git blob", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "generic-v2-git-blob-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args) => execFileSync("git", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  }).trim();
  git(["init"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.invalid"]);
  await writeFile(join(root, ".gitignore"), "ignored.ts\n", "utf8");
  await writeFile(join(root, "tracked.ts"), "tracked\n", "utf8");
  await writeFile(join(root, "ignored.ts"), "ignored\n", "utf8");
  git(["add", ".gitignore", "tracked.ts"]);
  git(["commit", "-m", "fixture"]);
  const commit = git(["rev-parse", "HEAD"]);
  assert.equal(currentGitBlobIdentity(root, commit, "tracked.ts").type, "blob");
  assert.throws(
    () => currentGitBlobIdentity(root, commit, "ignored.ts"),
    /does not contain exact artifact/u,
  );

  git(["update-index", "--assume-unchanged", "tracked.ts"]);
  await writeFile(join(root, "tracked.ts"), "drift\n", "utf8");
  assert.equal(git(["status", "--porcelain"]), "");
  assert.notEqual(
    currentGitBlobIdentity(root, commit, "tracked.ts").contentSha256,
    sha256Bytes(Buffer.from("drift\n", "utf8")),
  );

  const value = await fixture();
  t.after(() => rm(value.repoRoot, { recursive: true, force: true }));
  const artifact = value.input.queryContract.artifacts.find(
    ({ path }) => path === "lib/server/custom-launch/generic-launch-read-v2.ts",
  );
  await writeFile(
    join(value.repoRoot, artifact.path),
    "assume-unchanged drift\n",
    "utf8",
  );
  artifact.sha256 = sha256Bytes(Buffer.from("assume-unchanged drift\n", "utf8"));
  const original = value.options.gitBlobIdentity;
  value.options.gitBlobIdentity = async (...args) => {
    const identity = await original(...args);
    return args[2] === artifact.path
      ? { ...identity, contentSha256: sha256Bytes(Buffer.from("reader\n")) }
      : identity;
  };
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(value.input, value.options),
    /does not match the HEAD Git blob/u,
  );
});

test("rejects semantic artifact substitution and canonical path aliases", async (t) => {
  const substituted = await fixture();
  t.after(() => rm(substituted.repoRoot, { recursive: true, force: true }));
  const replacement = substituted.input.queryContract.artifacts[0];
  substituted.input.implementation.artifacts[0] = { ...replacement };
  substituted.input.implementation.artifacts.sort((left, right) =>
    left.path.localeCompare(right.path));
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(substituted.input, substituted.options),
    /artifact inventory is not exact/u,
  );

  const alias = await fixture();
  t.after(() => rm(alias.repoRoot, { recursive: true, force: true }));
  alias.input.queryContract.artifacts[0].path =
    "app/api/custom-launch/generic/v2//launches/[recordHash]/route.ts";
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(alias.input, alias.options),
    /path is invalid/u,
  );
});

test("requires one exact protected 0001-0005 adoption apply verify chain", async (t) => {
  const frozen = await fixture();
  t.after(() => rm(frozen.repoRoot, { recursive: true, force: true }));
  const frozenRef = frozen.protectedArtifacts.verify;
  const forged = JSON.parse(await readFile(frozenRef.path, "utf8"));
  forged.state.catalogSha256 = `0x${"e".repeat(64)}`;
  const forgedBytes = Buffer.from(`${JSON.stringify(forged)}\n`, "utf8");
  await writeFile(frozenRef.path, forgedBytes, { mode: 0o600 });
  frozenRef.sha256 = sha256Bytes(forgedBytes);
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(frozen.input, frozen.options),
    /do not match the frozen closure/u,
  );

  const value = await fixture();
  t.after(() => rm(value.repoRoot, { recursive: true, force: true }));
  const ref = value.protectedArtifacts.verify;
  const parsed = JSON.parse(await readFile(ref.path, "utf8"));
  parsed.state.catalogSha256 = `0x${"f".repeat(64)}`;
  const bytes = Buffer.from(`${JSON.stringify(parsed)}\n`, "utf8");
  await writeFile(ref.path, bytes, { mode: 0o600 });
  ref.sha256 = sha256Bytes(bytes);
  value.options.hostedEvidenceIdentity.verifyArtifactSha256 = ref.sha256;
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(value.input, value.options),
    /does not close the 0005 catalog/u,
  );

  const partial = await fixture();
  t.after(() => rm(partial.repoRoot, { recursive: true, force: true }));
  const applyRef = partial.protectedArtifacts.apply;
  const apply = JSON.parse(await readFile(applyRef.path, "utf8"));
  apply.state.appliedCount = 4;
  const applyBytes = Buffer.from(`${JSON.stringify(apply)}\n`, "utf8");
  await writeFile(applyRef.path, applyBytes, { mode: 0o600 });
  applyRef.sha256 = sha256Bytes(applyBytes);
  partial.options.hostedEvidenceIdentity.applyArtifactSha256 = applyRef.sha256;
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(partial.input, partial.options),
    /not exact through 0005/u,
  );
});

test("binds exact Registry profiles and repository identity", async (t) => {
  const source = await fixture();
  t.after(() => rm(source.repoRoot, { recursive: true, force: true }));
  source.input.registryProjection.source.repositoryId = "999";
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(source.input, source.options),
    /exact Website repository/u,
  );

  const profile = await fixture();
  t.after(() => rm(profile.repoRoot, { recursive: true, force: true }));
  const path = "config/custom-registry-v2.deployment.prelaunch.json";
  const config = JSON.parse(profile.files[path]);
  config.profiles.Standard10.protocolFeeBps = 11;
  const contents = `${JSON.stringify(config)}\n`;
  profile.files[path] = contents;
  await writeFile(join(profile.repoRoot, path), contents, "utf8");
  for (const component of [profile.input.registryProjection]) {
    const artifact = component.artifacts.find((candidate) => candidate.path === path);
    artifact.sha256 = sha256Bytes(Buffer.from(contents));
    artifact.gitBlobOid = artifact.sha256.slice(7, 47);
    component.deploymentArtifactSha256 = artifact.sha256;
  }
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(profile.input, profile.options),
    /does not match the live deployment config/u,
  );

  const deployment = await fixture();
  t.after(() => rm(deployment.repoRoot, { recursive: true, force: true }));
  const deploymentConfig = JSON.parse(deployment.files[path]);
  deploymentConfig.registry.deploymentBlock = "0";
  const deploymentContents = `${JSON.stringify(deploymentConfig)}\n`;
  deployment.files[path] = deploymentContents;
  await writeFile(join(deployment.repoRoot, path), deploymentContents, "utf8");
  const deploymentArtifact = deployment.input.registryProjection.artifacts.find(
    (candidate) => candidate.path === path,
  );
  deploymentArtifact.sha256 = sha256Bytes(Buffer.from(deploymentContents));
  deploymentArtifact.gitBlobOid = deploymentArtifact.sha256.slice(7, 47);
  deployment.input.registryProjection.deploymentArtifactSha256 =
    deploymentArtifact.sha256;
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(deployment.input, deployment.options),
    /deployment block is invalid/u,
  );
});

test("binds Approval release to the immutable schema repository ID", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.repoRoot, { recursive: true, force: true }));
  value.input.approvalRelease.source.repositoryId = "203";
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(value.input, value.options),
    /live release of the frozen schema/u,
  );
});

test("canonical JSON rejects lone Unicode surrogates", () => {
  assert.throws(() => canonicalJson({ value: "\ud800" }), /lone Unicode surrogate/u);
  assert.equal(canonicalJson({ value: "\ud83d\ude80" }), '{"value":"🚀"}');
});

test("requires the exact live Registry deployment artifact in the closure", async (t) => {
  const { repoRoot, input, options } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  input.registryProjection.deploymentArtifactSha256 = DIGEST("other");
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, options),
    /deployment artifact is not in the projection closure/u,
  );

  const matrixDrift = await fixture();
  t.after(() => rm(matrixDrift.repoRoot, { recursive: true, force: true }));
  matrixDrift.input.registryProjection.sourceArtifactSha256 = DIGEST("drift");
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(matrixDrift.input, matrixDrift.options),
    /does not match the live deployment config/u,
  );

  const raced = await fixture();
  t.after(() => rm(raced.repoRoot, { recursive: true, force: true }));
  const deploymentPath =
    "config/custom-registry-v2.deployment.prelaunch.json";
  let deploymentReads = 0;
  raced.options.readFile = async (path) => {
    if (path.endsWith(deploymentPath)) {
      deploymentReads += 1;
      if (deploymentReads === 2) {
        return Buffer.from(
          raced.files[deploymentPath].replace(
            '"protocolFeeBps":10',
            '"protocolFeeBps":11',
          ),
          "utf8",
        );
      }
    }
    return readFile(path);
  };
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(raced.input, raced.options),
    /changed during derivation/u,
  );
});

test("binds generation-two routes and a clean exact Website checkout", async (t) => {
  const { repoRoot, input, options } = await fixture();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  input.queryContract.feedPath = "/api/custom-launch/generic/v1/launches";
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(input, options),
    /query paths are invalid/u,
  );

  const checkout = await fixture();
  t.after(() => rm(checkout.repoRoot, { recursive: true, force: true }));
  await assert.rejects(
    deriveGenericLaunchReadModelContractV2(checkout.input, {
      ...checkout.options,
      gitIdentity: () => ({ commit: "9".repeat(40), tree: "8".repeat(40) }),
    }),
    /does not match the checkout/u,
  );
});

test("reads only an owner-only content-addressed regular input file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "generic-v2-protected-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.json");
  const bytes = Buffer.from('{"schemaVersion":"example"}\n', "utf8");
  await writeFile(path, bytes, { mode: 0o600 });
  assert.deepEqual(
    await readProtectedDerivationInput(path, sha256Bytes(bytes)),
    { schemaVersion: "example" },
  );

  await assert.rejects(
    readProtectedDerivationInput(path, DIGEST("wrong")),
    /digest does not match/u,
  );
  await chmod(path, 0o644);
  await assert.rejects(
    readProtectedDerivationInput(path, sha256Bytes(bytes)),
    /owner-only regular file/u,
  );
  await chmod(path, 0o600);
  const link = join(root, "input-link.json");
  await symlink(path, link);
  await assert.rejects(
    readProtectedDerivationInput(link, sha256Bytes(bytes)),
    /ELOOP|symbolic link/iu,
  );
});
