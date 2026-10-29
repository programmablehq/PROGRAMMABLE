import { PACK_CONFIG_V41_CONTRACT_URL, PACK_CONFIG_V41_EXAMPLE_URL } from "./profile-v41.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getAddress, keccak256 } from "viem";

import { loadCompilationUnits, loadTargetArtifact, canonicalIdentifier } from "./build.mjs";
import { canonicalizeJson } from "./canonical-json.mjs";
import {
  AGENT_ATTESTATION_SCHEMA_V1,
  AGENT_ATTESTATION_SCHEMA_V2,
  CREATE_REQUEST_SCHEMA_V1,
  CREATE_REQUEST_SCHEMA_V2,
  CREATE_REQUEST_SCHEMA_V3,
  CREATE_REQUEST_SCHEMA_V4,
  DIRECT_NATIVE_PROFILE_VERSION,
  DIRECT_NATIVE_PROFILE_VERSION_V3,
  DIRECT_NATIVE_PROFILE_VERSION_V35,
  DIRECT_NATIVE_PROFILE_VERSION_V36,
  DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY,
  DIRECT_NATIVE_PROFILE_VERSION_V3_METADATA_LEGACY,
  DIRECT_NATIVE_PROFILE_REVISION_V3,
  DIRECT_NATIVE_REQUIRED_SOLC_VERSION,
  MAINNET_CHAIN_ID,
  MAX_REQUEST_BYTES,
  MAX_STANDARD_JSON_SOURCES,
  OPENAPI_URL_V1,
  OPENAPI_URL_V2,
  OPENAPI_URL_V3,
  PACK_CONFIG_SCHEMA_V1,
  PACK_CONFIG_SCHEMA_V2,
  PACK_CONFIG_SCHEMA_V3,
  PACK_CONFIG_SCHEMA_V4,
  PACK_CONFIG_V3_CONTRACT_URL,
  PACK_CONFIG_V3_EXAMPLE_URL,
  PACKAGE_VERSION,
  SOURCE_DESCRIPTOR_SCHEMA,
} from "./constants.mjs";
import {
  createCliDiagnosticError,
  createCliWarning,
  observedError,
} from "./diagnostics.mjs";
import { inspectEip3009FundingCompatibility } from "./funding-compatibility.mjs";
import { buildGraphBundle, deriveRouteNamespace } from "./graph.mjs";
import {
  assertExactKeys,
  atomicWrite,
  canonicalRelativePath,
  compareUtf8,
  readStrictJsonFile,
  sha256Digest,
} from "./io.mjs";
import { buildSourceBundle } from "./source-bundle.mjs";
import { buildProjectMetadata } from "./project-metadata.mjs";
import {
  hashBehaviorScenarioInputs,
  validateBehaviorScenarioInputs,
} from "./behavior-scenario-inputs.mjs";
import { buildVerificationBundle } from "./verification.mjs";
import { buildV4Launch, validateV4PackConfig } from "./pack-v4.mjs";
import {
  buildLaunchProfileBinding,
  buildLaunchIntentHash,
  hashLaunchProfile,
  resolveLaunchProfile,
  validateFeeEnforcedProfileBuilds,
  validateFeeEnforcedProfileGraph,
  validateLaunchProfileSelection,
} from "./profile-v2.mjs";
import {
  buildDirectNativeLaunchIntentHash,
  buildDirectNativeProfileBinding,
  buildFundingAuthorization,
  buildFundingSignaturePatch,
  hashDirectNativeProfile,
  resolveDirectNativeProfile,
  validateDirectNativeProfileBuilds,
  validateDirectNativeProfileGraph,
  validateDirectNativePermitWindow,
  validateDirectNativeProfileSelection,
} from "./profile-direct-native-v1.mjs";

const NONZERO_HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export async function buildLaunch({ configPath, directNativeProfileVersion, directNativeRouter, directNativeTradeFeePolicy }) {
  const absoluteConfig = path.resolve(configPath);
  const { config, apiVersion } = await readPackConfig(absoluteConfig);
  if (apiVersion === "v4") {
    if (directNativeProfileVersion !== undefined) {
      throw new TypeError("directNativeProfileVersion is available only for V3 exact retries");
    }
    return buildV4Launch({ config, configPath: absoluteConfig });
  }
  const configuredDirectNativeProfileVersion = apiVersion === "v3"
    ? config.profileVersion ?? (["8453","999"].includes(config.chainId) ? DIRECT_NATIVE_PROFILE_VERSION_V36 : DIRECT_NATIVE_PROFILE_VERSION)
    : undefined;
  if (directNativeProfileVersion !== undefined
    && config.profileVersion !== undefined
    && directNativeProfileVersion !== config.profileVersion) {
    throw new TypeError(
      "pack config profileVersion does not match the exact request profile version",
    );
  }
  const launchProfileSelection = apiVersion === "v2"
    ? validateLaunchProfileSelection(config.launchProfile)
    : apiVersion === "v3"
      ? validateDirectNativeProfileSelection(config.launchProfile)
      : null;
  const permitWindow = apiVersion === "v3"
    ? validateDirectNativePermitWindow(config.permitWindow)
    : null;
  const directNativeProfile = apiVersion === "v3"
    ? resolveDirectNativeProfile(launchProfileSelection, {
        chainId: config.chainId,
        profileVersion: directNativeProfileVersion ?? configuredDirectNativeProfileVersion,
        router: directNativeRouter,
        programmableTradeFeePolicy: directNativeTradeFeePolicy,
      })
    : null;
  if (directNativeProfileVersion !== undefined && apiVersion !== "v3") {
    throw new TypeError("directNativeProfileVersion is available only for V3 exact retries");
  }
  const configDirectory = path.dirname(absoluteConfig);
  const sourceRoot = resolveSourceRoot(configDirectory, config.source.root);
  const launchWallet = getAddress(config.launchWallet);
  const nonce = canonicalNonce(config.nonce);

  const units = await loadCompilationUnits(config.compilationUnits, sourceRoot, {
    ...(apiVersion === "v3"
      && launchProfileSelection.profileRevision === DIRECT_NATIVE_PROFILE_REVISION_V3
      ? { maximumSources: MAX_STANDARD_JSON_SOURCES }
      : {}),
  });
  const unitsById = new Map(units.map((unit) => [unit.compilationUnitId, unit]));
  const targets = [];
  for (const [index, target] of config.targets.entries()) {
    targets.push(await loadTargetArtifact(target, index, sourceRoot, unitsById, {
      apiVersion: apiVersion === "v1" ? "v1" : "v2",
      ...(apiVersion === "v3"
        && launchProfileSelection.profileRevision === DIRECT_NATIVE_PROFILE_REVISION_V3
        ? { requiredCompilerVersion: DIRECT_NATIVE_REQUIRED_SOLC_VERSION }
        : {}),
    }));
  }
  const diagnostics = [];
  const metadataRequired = new Set([
    DIRECT_NATIVE_PROFILE_VERSION_V3,
    DIRECT_NATIVE_PROFILE_VERSION_V35,
    DIRECT_NATIVE_PROFILE_VERSION_V36,
    DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY,
    DIRECT_NATIVE_PROFILE_VERSION_V3_METADATA_LEGACY,
  ]).has(directNativeProfile?.profileVersion);
  const completeMetadataRequired = new Set([
    DIRECT_NATIVE_PROFILE_VERSION_V3,
    DIRECT_NATIVE_PROFILE_VERSION_V35,
    DIRECT_NATIVE_PROFILE_VERSION_V36,
    DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY,
  ]).has(directNativeProfile?.profileVersion);
  if (metadataRequired !== Object.hasOwn(config, "projectMetadata")) {
    throw new TypeError(metadataRequired
      ? `current direct-native ${DIRECT_NATIVE_PROFILE_VERSION_V3} launches require projectMetadata`
      : "this legacy exact profile must not add projectMetadata");
  }
  const metadata = metadataRequired
    ? await buildProjectMetadata(config.projectMetadata, {
      sourceRoot,
      tokenTarget: targets.find(
        ({ targetId }) => targetId === launchProfileSelection.targetRoles.tokenTargetId,
      ),
      requireComplete: completeMetadataRequired,
    })
    : null;
  const behaviorScenarioInputs = directNativeProfile?.profileVersion
    === DIRECT_NATIVE_PROFILE_VERSION_V3 || directNativeProfile?.profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V35
    ? validateBehaviorScenarioInputs(config.behaviorScenarioInputs, targets)
    : null;
  const behaviorScenarioInputsHash = behaviorScenarioInputs === null
    ? null
    : hashBehaviorScenarioInputs(behaviorScenarioInputs);

  const attestationEvidence = await buildAttestationEvidence(
    config.agentAttestation,
    sourceRoot,
  );
  const sourcePaths = new Set([
    ...config.source.paths,
    ...units.map(({ standardJsonRelativePath }) => standardJsonRelativePath),
    ...targets.map(({ artifactRelativePath }) => artifactRelativePath),
    ...attestationEvidence.map(({ evidencePath }) => evidencePath),
    ...(metadata?.imageSourcePath === null || metadata?.imageSourcePath === undefined
      ? []
      : [metadata.imageSourcePath]),
  ]);
  const sourceBundle = await buildSourceBundle(sourceRoot, [...sourcePaths]);
  const publicOriginCommitment = publicOriginCommitmentV1(config.source.publicOrigin);
  const sourceDescriptor = {
    schemaVersion: SOURCE_DESCRIPTOR_SCHEMA,
    kind: "deterministic-source-bundle",
    controllerWallet: launchWallet,
    sourceLineageNonce: canonicalUint(
      config.source.sourceLineageNonce,
      "source.sourceLineageNonce",
    ),
    sourceBundleDigest: sourceBundle.sourceBundleDigest,
    bundleContentSha256: sourceBundle.bundleContentSha256,
    publicOriginCommitment,
  };
  const {
    graphBundle,
    graphBundleHash,
    unboundGraphBundleHash,
    predictions,
    runtimeCodes,
  } = buildGraphBundle({
    targets,
    pool: apiVersion === "v3" ? graphPoolFromV3Config(config.pool) : config.pool,
    sourceBundleSha256: sourceBundle.bundleContentSha256,
    launchWallet,
    nonce,
    ...(metadata === null ? {} : { projectMetadataHash: metadata.projectMetadataHash }),
    noDelegationRuntimeTargetIds: apiVersion === "v2"
      ? [launchProfileSelection.targetRoles.customModuleTargetId]
      : [],
    enforceV4PermissionDependencies: apiVersion === "v3",
    ...(directNativeProfile ? { chainContext: directNativeProfile } : {}),
  });
  const { verificationBundle, verificationBundleHash } = buildVerificationBundle(
    units,
    targets,
    predictions,
    { apiVersion: apiVersion === "v1" ? "v1" : "v2", runtimeCodes },
  );
  const checks = attestationEvidence.map(({ checkId, evidenceSha256 }) => ({
    checkId,
    evidenceSha256,
  }));
  let request;
  let launchProfileHash = null;
  let launchIntentHash = null;
  let fundingIntentHash = null;
  if (apiVersion === "v1") {
    const agentAttestation = {
      schemaVersion: AGENT_ATTESTATION_SCHEMA_V1,
      subjectGraphBundleHash: graphBundleHash,
      agentId: canonicalIdentifier(config.agentAttestation.agentId, "agentAttestation.agentId"),
      checkedAt: canonicalCheckedAt(config.agentAttestation.checkedAt),
      checks,
    };
    request = {
      schemaVersion: CREATE_REQUEST_SCHEMA_V1,
      launchWallet,
      chainId: directNativeProfile?.chainId ?? MAINNET_CHAIN_ID,
      nonce,
      sourceDescriptor,
      sourceBundleManifest: sourceBundle.manifest,
      graphBundle,
      agentAttestation,
      verificationBundle,
    };
  } else if (apiVersion === "v2") {
    const launchProfile = resolveLaunchProfile(launchProfileSelection);
    const launchProfileBinding = buildLaunchProfileBinding(launchProfileSelection, {
      graphBundle,
      predictions,
    });
    validateFeeEnforcedProfileGraph(
      launchProfile,
      launchProfileBinding,
      graphBundle,
      launchWallet,
    );
    validateFeeEnforcedProfileBuilds(
      launchProfile,
      launchProfileBinding,
      graphBundle,
      verificationBundle,
    );
    launchProfileHash = hashLaunchProfile(launchProfile);
    launchIntentHash = buildLaunchIntentHash({
      launchWallet,
      chainId: directNativeProfile?.chainId ?? MAINNET_CHAIN_ID,
      nonce,
      sourceDescriptor,
      sourceBundleManifest: sourceBundle.manifest,
      graphBundleHash,
      verificationBundleHash,
      launchProfileHash,
      launchProfileSelection: launchProfileBinding,
    });
    const agentAttestation = {
      schemaVersion: AGENT_ATTESTATION_SCHEMA_V2,
      subjectLaunchIntentHash: launchIntentHash,
      agentId: canonicalIdentifier(config.agentAttestation.agentId, "agentAttestation.agentId"),
      checkedAt: canonicalCheckedAt(config.agentAttestation.checkedAt),
      checks,
    };
    request = {
      schemaVersion: CREATE_REQUEST_SCHEMA_V2,
      launchWallet,
      chainId: directNativeProfile?.chainId ?? MAINNET_CHAIN_ID,
      nonce,
      sourceDescriptor,
      sourceBundleManifest: sourceBundle.manifest,
      graphBundle,
      launchProfile,
      launchProfileSelection: launchProfileBinding,
      launchProfileHash,
      launchIntentHash,
      agentAttestation,
      verificationBundle,
    };
  } else {
    const routeNamespace = deriveRouteNamespace(
      sourceBundle.bundleContentSha256,
      launchWallet,
      directNativeProfile,
    );
    const fundingSignaturePatch = launchProfileSelection.fundingMode
      === "eip-3009-receive-with-authorization"
      ? buildFundingSignaturePatch(
          config.fundingSignaturePatch,
          graphBundle,
          targets.find(({ targetId }) => targetId === config.fundingSignaturePatch.targetId),
        )
      : undefined;
    if (fundingSignaturePatch?.schemaVersion === "programmable.eip3009-signature-patch.v1") {
      diagnostics.push(createCliWarning({
        code: "FUNDING_SIGNATURE_PATCH_V1_LEGACY",
        stage: "signature-patch",
        targetId: fundingSignaturePatch.targetId,
        targetRole: "initializer",
        sourcePath: targets.find(({ targetId }) => targetId === fundingSignaturePatch.targetId)
          ?.sourcePath,
        summary: "The legacy r/s/v-only EIP-3009 patch remains readable for exact retries but new launches must use the v2 nonce+r+s+v ABI-path descriptor.",
        expected: {
          schemaVersion: "programmable.eip3009-authorization-patch.v2",
          configFields: [
            "targetId",
            "nonceArgumentPath",
            "rArgumentPath",
            "sArgumentPath",
            "vArgumentPath",
          ],
        },
        observed: { schemaVersion: fundingSignaturePatch.schemaVersion },
      }));
    }
    if (fundingSignaturePatch !== undefined) {
      diagnostics.push(...inspectEip3009FundingCompatibility({
        launchProfileSelection,
        targets,
        unitsById,
      }));
    }
    const launchProfileBinding = buildDirectNativeProfileBinding(
      launchProfileSelection,
      {
        profileVersion: directNativeProfile.profileVersion,
        profile: directNativeProfile,
        graphBundle,
        predictions,
        routeNamespace,
        routeNonce: nonce,
        quoteCurrency: getAddress(config.pool.quoteCurrency),
        ...(fundingSignaturePatch === undefined ? {} : { fundingSignaturePatch }),
      },
    );
    const launchProfile = directNativeProfile;
    validateDirectNativeProfileGraph(launchProfile, launchProfileBinding, graphBundle);
    validateDirectNativeProfileBuilds(
      launchProfile,
      launchProfileBinding,
      graphBundle,
      verificationBundle,
    );
    launchProfileHash = hashDirectNativeProfile(launchProfile);
    launchIntentHash = buildDirectNativeLaunchIntentHash({
      schemaVersion: CREATE_REQUEST_SCHEMA_V3,
      launchWallet,
      chainId: directNativeProfile?.chainId ?? MAINNET_CHAIN_ID,
      nonce,
      sourceDescriptor,
      sourceBundleManifest: sourceBundle.manifest,
      graphBundleHash,
      ...(metadata === null ? {} : { projectMetadataHash: metadata.projectMetadataHash }),
      ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
      verificationBundleHash,
      launchProfileHash,
      launchProfileSelection: launchProfileBinding,
      permitWindow,
    });
    if (launchProfileSelection.fundingMode === "eip-3009-receive-with-authorization"
      && (config.fundingAuthorization.validAfter !== permitWindow.validAfter
        || config.fundingAuthorization.validBefore !== permitWindow.deadline)) {
      throw new TypeError(
        "fundingAuthorization validity must exactly match permitWindow",
      );
    }
    const funding = launchProfileSelection.fundingMode
      === "eip-3009-receive-with-authorization"
      ? buildFundingAuthorization(config.fundingAuthorization, {
          launchWallet,
          router: launchProfile.router,
          predictedInitializer: launchProfileBinding.predictedInitializer,
          routeNamespace,
          routeNonce: nonce,
          launchIntentHash,
        })
      : null;
    fundingIntentHash = funding?.fundingIntentHash ?? null;
    const agentAttestation = {
      schemaVersion: AGENT_ATTESTATION_SCHEMA_V2,
      subjectLaunchIntentHash: launchIntentHash,
      agentId: canonicalIdentifier(config.agentAttestation.agentId, "agentAttestation.agentId"),
      checkedAt: canonicalCheckedAt(config.agentAttestation.checkedAt),
      checks,
    };
    request = {
      schemaVersion: CREATE_REQUEST_SCHEMA_V3,
      launchWallet,
      chainId: directNativeProfile?.chainId ?? MAINNET_CHAIN_ID,
      nonce,
      permitWindow,
      sourceDescriptor,
      sourceBundleManifest: sourceBundle.manifest,
      graphBundle,
      ...(metadata === null
        ? {}
        : {
            projectMetadata: metadata.projectMetadata,
            projectMetadataHash: metadata.projectMetadataHash,
          }),
      ...(behaviorScenarioInputs === null
        ? {}
        : { behaviorScenarioInputs, behaviorScenarioInputsHash }),
      launchProfile,
      launchProfileSelection: launchProfileBinding,
      launchProfileHash,
      launchIntentHash,
      ...(funding === null
        ? {}
        : {
            fundingAuthorization: funding.fundingAuthorization,
            fundingIntentHash,
          }),
      agentAttestation,
      verificationBundle,
    };
  }
  const requestBytes = Buffer.from(`${canonicalizeJson(request)}\n`, "utf8");
  if (requestBytes.byteLength > MAX_REQUEST_BYTES) {
    throw new TypeError(`packed launch request exceeds the ${MAX_REQUEST_BYTES}-byte limit`);
  }
  const requestSha256 = sha256Digest(requestBytes);
  const receipt = {
    schemaVersion: apiVersion === "v1"
      ? "programmable.launch-pack-receipt.v1"
      : apiVersion === "v2"
        ? "programmable.launch-pack-receipt.v2"
        : "programmable.launch-pack-receipt.v3",
    package: { name: "@programmable/launch", version: PACKAGE_VERSION },
    openapi: apiVersion === "v1"
      ? OPENAPI_URL_V1
      : apiVersion === "v2"
        ? OPENAPI_URL_V2
        : OPENAPI_URL_V3,
    apiVersion,
    requestSha256,
    sourceBundleDigest: sourceBundle.sourceBundleDigest,
    bundleContentSha256: sourceBundle.bundleContentSha256,
    graphBundleHash,
    ...(metadata === null
      ? {}
      : {
          unboundGraphBundleHash,
          projectMetadataHash: metadata.projectMetadataHash,
        }),
    ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
    verificationBundleHash,
    launchProfileHash,
    launchIntentHash,
    fundingIntentHash,
    predictions,
  };
  if (apiVersion === "v1") {
    delete receipt.apiVersion;
    delete receipt.launchProfileHash;
    delete receipt.launchIntentHash;
    delete receipt.fundingIntentHash;
  } else if (apiVersion === "v2") {
    delete receipt.fundingIntentHash;
  } else if (fundingIntentHash === null) {
    delete receipt.fundingIntentHash;
  }
  const receiptBytes = Buffer.from(`${canonicalizeJson(receipt)}\n`, "utf8");
  const result = {
    configDirectory,
    request,
    requestBytes,
    receipt,
    receiptBytes,
    requestSha256,
    graphBundleHash,
    ...(metadata === null
      ? {}
      : {
          unboundGraphBundleHash,
          projectMetadataHash: metadata.projectMetadataHash,
        }),
    ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
    verificationBundleHash,
    predictions,
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
  };
  if (apiVersion !== "v1") {
    result.launchProfileHash = launchProfileHash;
    result.launchIntentHash = launchIntentHash;
  }
  if (apiVersion === "v3" && fundingIntentHash !== null) {
    result.fundingIntentHash = fundingIntentHash;
  }
  return result;
}

export async function packLaunch({ configPath, outputPath, receiptPath, directNativeProfileVersion, directNativeRouter, directNativeTradeFeePolicy }) {
  const built = await buildLaunch({ configPath, directNativeProfileVersion, directNativeRouter, directNativeTradeFeePolicy });
  const resolvedOutput = path.resolve(outputPath ?? path.join(built.configDirectory, "launch.json"));
  const resolvedReceipt = path.resolve(receiptPath ?? `${resolvedOutput}.receipt.json`);
  await atomicWrite(resolvedOutput, built.requestBytes, 0o600);
  await atomicWrite(resolvedReceipt, built.receiptBytes, 0o600);
  const result = {
    outputPath: resolvedOutput,
    receiptPath: resolvedReceipt,
    requestSha256: built.requestSha256,
    graphBundleHash: built.graphBundleHash,
    verificationBundleHash: built.verificationBundleHash,
    predictions: built.predictions,
  };
  if (built.projectMetadataHash !== undefined) {
    result.unboundGraphBundleHash = built.unboundGraphBundleHash;
    result.projectMetadataHash = built.projectMetadataHash;
  }
  if (built.behaviorScenarioInputsHash !== undefined) {
    result.behaviorScenarioInputsHash = built.behaviorScenarioInputsHash;
  }
  if (built.request.schemaVersion === CREATE_REQUEST_SCHEMA_V2
    || built.request.schemaVersion === CREATE_REQUEST_SCHEMA_V3
    || built.request.schemaVersion === CREATE_REQUEST_SCHEMA_V4) {
    result.launchProfileHash = built.launchProfileHash;
    result.launchIntentHash = built.launchIntentHash;
  }
  if (built.request.schemaVersion === CREATE_REQUEST_SCHEMA_V3
    && built.fundingIntentHash !== undefined) {
    result.fundingIntentHash = built.fundingIntentHash;
  }
  if ((built.diagnostics?.length ?? 0) !== 0) result.diagnostics = built.diagnostics;
  return result;
}

async function readPackConfig(absoluteConfig) {
  let config;
  try {
    config = (await readStrictJsonFile(absoluteConfig, 2_097_152)).value;
  } catch (error) {
    throw invalidPackConfig(error, undefined);
  }
  try {
    return { config, apiVersion: assertPackConfig(config) };
  } catch (error) {
    if (config?.schemaVersion === PACK_CONFIG_SCHEMA_V1
      || config?.schemaVersion === PACK_CONFIG_SCHEMA_V2) throw error;
    throw invalidPackConfig(error, config?.schemaVersion, config?.profile?.profileVersion);
  }
}

function invalidPackConfig(error, schemaVersion, profileVersion) {
  const isV4 = schemaVersion === PACK_CONFIG_SCHEMA_V4;
  return createCliDiagnosticError({
    code: isV4 ? "PACK_CONFIG_V4_INVALID" : "PACK_CONFIG_V3_INVALID",
    stage: "pack-config",
    summary: isV4
      ? "The supplied pack config does not satisfy the public Robinhood V4 config contract."
      : "The supplied pack config does not satisfy the public Ethereum V3 config contract.",
    expected: {
      schemaVersion: isV4 ? PACK_CONFIG_SCHEMA_V4 : PACK_CONFIG_SCHEMA_V3,
      configContract: isV4
        ? profileVersion === "4.1.0" ? PACK_CONFIG_V41_CONTRACT_URL : "https://programmable.market/schemas/custom-launch/v4/pack-config.json"
        : PACK_CONFIG_V3_CONTRACT_URL,
      executableExample: isV4
        ? profileVersion === "4.1.0" ? PACK_CONFIG_V41_EXAMPLE_URL : "https://github.com/programmablehq/PROGRAMMABLE/tree/programmable-launch-v4.0.0/packages/launch/examples/robinhood-v4-no-broadcast"
        : PACK_CONFIG_V3_EXAMPLE_URL,
    },
    observed: {
      schemaVersion: typeof schemaVersion === "string" ? schemaVersion : null,
      ...observedError(error),
    },
  });
}

function assertPackConfig(config) {
  const commonKeys = [
    "schemaVersion",
    "launchWallet",
    "chainId",
    "nonce",
    "source",
    "compilationUnits",
    "targets",
    "pool",
    "agentAttestation",
  ];
  let apiVersion;
  if (config?.schemaVersion === PACK_CONFIG_SCHEMA_V1) {
    apiVersion = "v1";
    assertExactKeys(config, commonKeys, "pack config");
  } else if (config?.schemaVersion === PACK_CONFIG_SCHEMA_V2) {
    apiVersion = "v2";
    assertExactKeys(config, [...commonKeys, "launchProfile"], "pack config");
    validateLaunchProfileSelection(config.launchProfile);
  } else if (config?.schemaVersion === PACK_CONFIG_SCHEMA_V3) {
    apiVersion = "v3";
    const launchProfile = validateDirectNativeProfileSelection(config.launchProfile);
    const profileVersion = config.profileVersion ?? DIRECT_NATIVE_PROFILE_VERSION;
    if (profileVersion !== DIRECT_NATIVE_PROFILE_VERSION
      && profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V3
      && profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V35
      && profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V36) {
      throw new TypeError(
        `pack config profileVersion must be one of ${[DIRECT_NATIVE_PROFILE_VERSION, DIRECT_NATIVE_PROFILE_VERSION_V3, DIRECT_NATIVE_PROFILE_VERSION_V35, DIRECT_NATIVE_PROFILE_VERSION_V36].join(", ")}`,
      );
    }
    assertExactKeys(config, [
      ...commonKeys,
      ...(Object.hasOwn(config, "profileVersion") ? ["profileVersion"] : []),
      "launchProfile",
      "permitWindow",
      ...([DIRECT_NATIVE_PROFILE_VERSION_V3, DIRECT_NATIVE_PROFILE_VERSION_V35].includes(profileVersion)
        ? ["behaviorScenarioInputs"]
        : []),
      ...(Object.hasOwn(config, "projectMetadata") ? ["projectMetadata"] : []),
      ...(launchProfile.fundingMode === "eip-3009-receive-with-authorization"
        ? ["fundingAuthorization", "fundingSignaturePatch"]
        : []),
    ], "pack config");
  } else if (config?.schemaVersion === PACK_CONFIG_SCHEMA_V4) {
    return validateV4PackConfig(config);
  } else {
    throw new TypeError(
      `pack config schemaVersion must be ${PACK_CONFIG_SCHEMA_V1}, ${PACK_CONFIG_SCHEMA_V2}, ${PACK_CONFIG_SCHEMA_V3}, or ${PACK_CONFIG_SCHEMA_V4}`,
    );
  }
  if (config.chainId !== MAINNET_CHAIN_ID && !(apiVersion === "v3" && ["8453","999"].includes(config.chainId)
    && (config.profileVersion === undefined || config.profileVersion === "3.6.0"))) throw new TypeError("Unsupported pack config chain/profile");
  if (!Array.isArray(config.targets) || config.targets.length < 2 || config.targets.length > 16) {
    throw new TypeError("pack config targets must contain between 2 and 16 entries");
  }
  if (apiVersion === "v3" && config.targets.length < 3) {
    throw new TypeError("direct-native V3 pack config targets must contain between 3 and 16 entries");
  }
  if (apiVersion === "v3"
    && [DIRECT_NATIVE_PROFILE_VERSION_V3, DIRECT_NATIVE_PROFILE_VERSION_V35].includes(config.profileVersion)
    && config.targets.length < 4) {
    throw new TypeError("preparatory profile 3.4 pack config requires between 4 and 16 entries");
  }
  if (apiVersion === "v3") {
    assertExactKeys(config.pool, [
      "tokenTargetId",
      "hookTargetId",
      "fee",
      "tickSpacing",
      "quoteCurrency",
    ], "pack config pool");
    getAddress(config.pool.quoteCurrency);
  }
  assertExactKeys(config.source, [
    "root",
    "paths",
    "sourceLineageNonce",
    "publicOrigin",
  ], "pack config source");
  if (typeof config.source.root !== "string" || config.source.root.length === 0
    || path.isAbsolute(config.source.root)) {
    throw new TypeError("source.root must be a relative directory");
  }
  if (!Array.isArray(config.source.paths) || config.source.paths.length === 0) {
    throw new TypeError("source.paths must be a non-empty array");
  }
  for (const sourcePath of config.source.paths) canonicalRelativePath(sourcePath, "source.paths entry");
  assertExactKeys(config.source.publicOrigin, ["url", "revision"], "source.publicOrigin");
  const origin = new URL(config.source.publicOrigin.url);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.hash) {
    throw new TypeError("source.publicOrigin.url must be a credential-free HTTPS URL without a fragment");
  }
  if (typeof config.source.publicOrigin.revision !== "string"
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(config.source.publicOrigin.revision)) {
    throw new TypeError("source.publicOrigin.revision must be an exact lowercase object id");
  }
  assertExactKeys(config.agentAttestation, ["agentId", "checkedAt", "checks"], "agentAttestation");
  if (!Array.isArray(config.agentAttestation.checks)
    || config.agentAttestation.checks.length === 0
    || config.agentAttestation.checks.length > 64) {
    throw new TypeError("agentAttestation.checks must contain between 1 and 64 checks");
  }
  return apiVersion;
}

function graphPoolFromV3Config(pool) {
  return {
    tokenTargetId: pool.tokenTargetId,
    hookTargetId: pool.hookTargetId,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
  };
}

async function buildAttestationEvidence(attestation, sourceRoot) {
  const evidence = [];
  for (const [index, check] of attestation.checks.entries()) {
    assertExactKeys(check, ["checkId", "evidence"], `agentAttestation.checks[${index}]`);
    const checkId = canonicalIdentifier(check.checkId, `agentAttestation.checks[${index}].checkId`);
    const evidencePath = canonicalRelativePath(check.evidence, `${checkId} evidence path`);
    const bytes = await readFile(path.join(sourceRoot, ...evidencePath.split("/")));
    evidence.push({ checkId, evidencePath, evidenceSha256: sha256Digest(bytes) });
  }
  evidence.sort((left, right) => compareUtf8(left.checkId, right.checkId));
  if (new Set(evidence.map(({ checkId }) => checkId)).size !== evidence.length) {
    throw new TypeError("agent attestation check IDs must be unique");
  }
  return evidence;
}

function publicOriginCommitmentV1(publicOrigin) {
  const bytes = Buffer.concat([
    Buffer.from("programmable.public-source-origin.v1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(publicOrigin), "utf8"),
  ]);
  return keccak256(`0x${bytes.toString("hex")}`);
}

function resolveSourceRoot(configDirectory, configuredRoot) {
  const resolved = path.resolve(configDirectory, configuredRoot);
  if (resolved === path.parse(resolved).root) throw new TypeError("source.root cannot be a filesystem root");
  return resolved;
}

function canonicalNonce(value) {
  if (typeof value !== "string" || !NONZERO_HEX32.test(value)) {
    throw new TypeError("nonce must be a nonzero lowercase bytes32 value");
  }
  return value;
}

function canonicalUint(value, label) {
  if (typeof value !== "string" || !DECIMAL.test(value) || BigInt(value) >= 1n << 256n) {
    throw new TypeError(`${label} must be a canonical uint256 string`);
  }
  return value;
}

function canonicalCheckedAt(value) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || new Date(value).toISOString() !== value) {
    throw new TypeError("agentAttestation.checkedAt must be a canonical UTC timestamp with milliseconds");
  }
  return value;
}
