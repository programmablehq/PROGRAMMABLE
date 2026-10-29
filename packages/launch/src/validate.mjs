import { isRobinhoodProfileV41, PACK_CONFIG_V41_CONTRACT_URL, PACK_CONFIG_V41_EXAMPLE_URL } from "./profile-v41.mjs";
import { normalizeRobinhoodFundingPlanV1 } from "./funding-plan-v1.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getAddress, keccak256 } from "viem";

import {
  exactCompilerVersion,
  validateStandardJsonInput,
  canonicalIdentifier,
} from "./build.mjs";
import { canonicalizeJson, parseStrictJson } from "./canonical-json.mjs";
import {
  AGENT_ATTESTATION_SCHEMA_V1,
  AGENT_ATTESTATION_SCHEMA_V2,
  CREATE_REQUEST_SCHEMA_V1,
  CREATE_REQUEST_SCHEMA_V2,
  CREATE_REQUEST_SCHEMA_V3,
  CREATE_REQUEST_SCHEMA_V4,
  DIRECT_NATIVE_PROFILE_VERSION_V3,
  DIRECT_NATIVE_PROFILE_VERSION_V35,
  DIRECT_NATIVE_PROFILE_VERSION_V36,
  DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY,
  DIRECT_NATIVE_PROFILE_VERSION_V3_METADATA_LEGACY,
  DIRECT_NATIVE_PROFILE_REVISION_V3,
  DIRECT_NATIVE_REQUIRED_SOLC_VERSION,
  GRAPH_BUNDLE_SCHEMA,
  MAINNET_CHAIN_ID,
  MAX_REQUEST_BYTES,
  MAX_REQUEST_BYTES_V4,
  MAX_STANDARD_JSON_INPUT_BYTES,
  MAX_STANDARD_JSON_SOURCES,
  MAX_TOTAL_STANDARD_JSON_INPUT_BYTES,
  PACK_CONFIG_SCHEMA_V3,
  PACK_CONFIG_SCHEMA_V4,
  PACK_CONFIG_V4_CONTRACT_URL,
  PACK_CONFIG_V4_EXAMPLE_URL,
  ROBINHOOD_CHAIN_ID,
  PACK_CONFIG_V3_CONTRACT_URL,
  PACK_CONFIG_V3_EXAMPLE_URL,
  SOURCE_DESCRIPTOR_SCHEMA,
  SOURCE_MANIFEST_SCHEMA,
} from "./constants.mjs";
import { createCliDiagnosticError } from "./diagnostics.mjs";
import { deriveRouteNamespace, normalizeAndPredictSubmittedGraph } from "./graph.mjs";
import {
  assertAllowedKeys,
  assertExactKeys,
  canonicalRelativePath,
  compareUtf8,
  decodeExactUtf8,
  sha256Digest,
} from "./io.mjs";
import { buildLaunch } from "./pack.mjs";
import {
  hashProjectMetadata,
  validateProjectMetadata,
  validateProjectMetadataImageArtifactV4,
} from "./project-metadata.mjs";
import {
  hashBehaviorScenarioInputs,
  validateBehaviorScenarioInputs,
} from "./behavior-scenario-inputs.mjs";
import {
  assertDeployableRuntimeCode,
  assertNoDelegatingRuntimeOpcodes,
  materializeRuntimeCode,
  normalizeRuntimeMaterialization,
} from "./runtime-immutables.mjs";
import {
  buildLaunchIntentHash,
  hashLaunchProfile,
  validateEmbeddedLaunchProfile,
  validateFeeEnforcedProfileBuilds,
  validateFeeEnforcedProfileGraph,
  validateLaunchProfileBinding,
} from "./profile-v2.mjs";
import {
  buildDirectNativeLaunchIntentHash,
  hashDirectNativeProfile,
  validateDirectNativeProfileBinding,
  validateDirectNativeProfileBuilds,
  validateDirectNativeProfileGraph,
  validateDirectNativePermitWindow,
  validateEmbeddedDirectNativeProfile,
  validateFundingAuthorization,
} from "./profile-direct-native-v1.mjs";
import {
  assertV4ExternalContractLocators,
  assertV4FundingValueMatchesGraph,
  assertV4DeploymentDescriptorDigest,
  buildV4LaunchIntentHash,
  buildV4SourceBuildCommitment,
  normalizeV4ChainDeployment,
  normalizeV4ExternalContracts,
  normalizeV4FundingIntent,
  normalizeV4LiquidityModel,
  normalizeV4ProfileRef,
  v4GraphChainContext,
} from "./v4-contract.mjs";
import {
  VERIFICATION_BUNDLE_SCHEMA_V1,
  VERIFICATION_BUNDLE_SCHEMA_V2,
} from "./verification.mjs";

const HEX32 = /^0x[0-9a-f]{64}$/;
const NONZERO_HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export async function validateLaunchFile({ launchPath, configPath }) {
  const absolute = path.resolve(launchPath);
  const bytes = await readFile(absolute);
  if (bytes.byteLength > MAX_REQUEST_BYTES_V4) {
    throw new TypeError(`launch request exceeds the ${MAX_REQUEST_BYTES_V4}-byte limit`);
  }
  const source = decodeExactUtf8(bytes, absolute);
  const request = parseStrictJson(source, { maximumBytes: MAX_REQUEST_BYTES_V4 });
  const isV3 = request?.schemaVersion === CREATE_REQUEST_SCHEMA_V3;
  const isV4 = request?.schemaVersion === CREATE_REQUEST_SCHEMA_V4;
  if (!isV4 && bytes.byteLength > MAX_REQUEST_BYTES) {
    throw new TypeError(`launch request exceeds the ${MAX_REQUEST_BYTES}-byte limit`);
  }
  if (isV3 && configPath === undefined) throw v3ArtifactConfigRequired();
  if (isV4 && configPath === undefined) throw v4ArtifactConfigRequired(request?.profile?.profileVersion);
  const result = isV3
    ? validateV3LaunchRequest(request)
    : isV4
      ? validateV4LaunchRequest(request)
      : validateLaunchRequest(request);
  let diagnostics = [];
  if (configPath !== undefined) {
    const rebuilt = await buildLaunch({
      configPath,
      ...(isV3
        ? { directNativeProfileVersion: request?.launchProfile?.profileVersion, directNativeRouter: request?.launchProfile?.router, directNativeTradeFeePolicy: request?.launchProfile?.programmableTradeFeePolicy }
        : {}),
    });
    diagnostics = rebuilt.diagnostics ?? [];
    if (!bytes.equals(rebuilt.requestBytes)) {
      throw new TypeError(
        `PACK_REPRODUCTION_MISMATCH: ${absolute} is not byte-identical to a fresh pack of ${path.resolve(configPath)}`,
      );
    }
  }
  return {
    ...result,
    requestSha256: sha256Digest(bytes),
    byteLength: bytes.byteLength,
    reproducedFromConfig: configPath !== undefined,
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
  };
}

export function validateLaunchRequest(request) {
  if (request?.schemaVersion === CREATE_REQUEST_SCHEMA_V1) {
    return validateV1LaunchRequest(request);
  }
  if (request?.schemaVersion === CREATE_REQUEST_SCHEMA_V2) {
    return validateV2LaunchRequest(request);
  }
  if (request?.schemaVersion === CREATE_REQUEST_SCHEMA_V3) {
    throw v3ArtifactConfigRequired();
  }
  if (request?.schemaVersion === CREATE_REQUEST_SCHEMA_V4) {
    throw v4ArtifactConfigRequired(request?.profile?.profileVersion);
  }
  throw new TypeError(
    `schemaVersion must be ${CREATE_REQUEST_SCHEMA_V1}, ${CREATE_REQUEST_SCHEMA_V2}, ${CREATE_REQUEST_SCHEMA_V3}, or ${CREATE_REQUEST_SCHEMA_V4}`,
  );
}

function v3ArtifactConfigRequired() {
  return createCliDiagnosticError({
    code: "PACK_CONFIG_V3_MISSING",
    stage: "pack-config",
    summary: "V3 validation requires the exact pack config and build artifacts so the initializer ABI and authorization patch can be reproduced.",
    expected: {
      flag: "--config programmable-launch.config.json",
      schemaVersion: PACK_CONFIG_SCHEMA_V3,
      configContract: PACK_CONFIG_V3_CONTRACT_URL,
      executableExample: PACK_CONFIG_V3_EXAMPLE_URL,
    },
    observed: {
      flag: null,
      requestSchemaVersion: CREATE_REQUEST_SCHEMA_V3,
      legacyCode: "V3_ARTIFACT_CONFIG_REQUIRED",
    },
  });
}

function v4ArtifactConfigRequired(profileVersion) {
  return createCliDiagnosticError({
    code: "PACK_CONFIG_V4_MISSING",
    stage: "pack-config",
    summary: "V4 validation requires the exact Robinhood pack config and build artifacts.",
    expected: {
      flag: "--config programmable-launch.config.json",
      schemaVersion: PACK_CONFIG_SCHEMA_V4,
      configContract: profileVersion === "4.1.0" ? PACK_CONFIG_V41_CONTRACT_URL : PACK_CONFIG_V4_CONTRACT_URL,
      executableExample: profileVersion === "4.1.0" ? PACK_CONFIG_V41_EXAMPLE_URL : PACK_CONFIG_V4_EXAMPLE_URL,
    },
    observed: {
      flag: null,
      requestSchemaVersion: CREATE_REQUEST_SCHEMA_V4,
    },
  });
}

function validateV1LaunchRequest(request) {
  assertAllowedKeys(
    request,
    [
      "schemaVersion",
      "launchWallet",
      "chainId",
      "nonce",
      "sourceDescriptor",
      "sourceBundleManifest",
      "graphBundle",
      "agentAttestation",
    ],
    ["verificationBundle"],
    "launch request",
  );
  const common = validateCommonRequest(request);
  validateAttestationV1(request.agentAttestation, common.graph.graphBundleHash);
  const verification = request.verificationBundle === undefined
    ? { verificationBundleHash: null, exactSourceIncluded: false }
    : validateVerificationBundle(
      request.verificationBundle,
      common.graph.graphBundle,
      common.graph.predictions,
      "v1",
    );
  return {
    schemaVersion: request.schemaVersion,
    graphBundleHash: common.graph.graphBundleHash,
    verificationBundleHash: verification.verificationBundleHash,
    exactSourceIncluded: verification.exactSourceIncluded,
    predictions: common.graph.predictions,
  };
}

function validateV2LaunchRequest(request) {
  assertExactKeys(request, [
    "schemaVersion",
    "launchWallet",
    "chainId",
    "nonce",
    "sourceDescriptor",
    "sourceBundleManifest",
    "graphBundle",
    "launchProfile",
    "launchProfileSelection",
    "launchProfileHash",
    "launchIntentHash",
    "agentAttestation",
    "verificationBundle",
  ], "launch request");
  const common = validateCommonRequest(request);
  if (canonicalizeJson(request.graphBundle) !== canonicalizeJson(common.graph.graphBundle)) {
    throw new TypeError("V2 graphBundle must use the exact canonical target order and encoding");
  }
  const verification = validateVerificationBundle(
    request.verificationBundle,
    common.graph.graphBundle,
    common.graph.predictions,
    "v2",
  );
  const launchProfile = validateEmbeddedLaunchProfile(request.launchProfile);
  const launchProfileSelection = validateLaunchProfileBinding(request.launchProfileSelection, {
    launchProfile,
    graphBundle: common.graph.graphBundle,
    predictions: common.graph.predictions,
  });
  const customModuleRuntime = verification.runtimeCodes.get(
    launchProfileSelection.targetRoles.customModuleTargetId,
  );
  if (customModuleRuntime === undefined) {
    throw new TypeError("verificationBundle does not contain the selected custom module runtime");
  }
  assertNoDelegatingRuntimeOpcodes(customModuleRuntime, "submitted custom module runtime");
  const launchProfileHash = hashLaunchProfile(launchProfile);
  if (request.launchProfileHash !== launchProfileHash) {
    throw new TypeError("launchProfileHash does not match the closed embedded launchProfile");
  }
  validateFeeEnforcedProfileGraph(
    launchProfile,
    launchProfileSelection,
    common.graph.graphBundle,
    common.launchWallet,
  );
  validateFeeEnforcedProfileBuilds(
    launchProfile,
    launchProfileSelection,
    common.graph.graphBundle,
    request.verificationBundle,
  );
  const launchIntentHash = buildLaunchIntentHash({
    launchWallet: common.launchWallet,
    chainId: request.chainId,
    nonce: request.nonce,
    sourceDescriptor: common.sourceDescriptor,
    sourceBundleManifest: common.manifest,
    graphBundleHash: common.graph.graphBundleHash,
    verificationBundleHash: verification.verificationBundleHash,
    launchProfileHash,
    launchProfileSelection,
  });
  if (request.launchIntentHash !== launchIntentHash) {
    throw new TypeError("launchIntentHash does not match the normalized V2 launch intent");
  }
  validateAttestationV2(request.agentAttestation, launchIntentHash);
  return {
    schemaVersion: request.schemaVersion,
    graphBundleHash: common.graph.graphBundleHash,
    verificationBundleHash: verification.verificationBundleHash,
    launchProfileHash,
    launchIntentHash,
    exactSourceIncluded: true,
    predictions: common.graph.predictions,
  };
}

function validateV3LaunchRequest(request) {
  const fundingMode = request?.launchProfile?.fundingPolicy?.mode;
  const profileVersion = request?.launchProfile?.profileVersion;
  const metadataRequired = new Set([
    DIRECT_NATIVE_PROFILE_VERSION_V3,
    DIRECT_NATIVE_PROFILE_VERSION_V35,
    DIRECT_NATIVE_PROFILE_VERSION_V36,
    DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY,
    DIRECT_NATIVE_PROFILE_VERSION_V3_METADATA_LEGACY,
  ]).has(profileVersion);
  const completeMetadataRequired = new Set([
    DIRECT_NATIVE_PROFILE_VERSION_V3,
    DIRECT_NATIVE_PROFILE_VERSION_V35,
    DIRECT_NATIVE_PROFILE_VERSION_V36,
    DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY,
  ]).has(profileVersion);
  const behaviorScenarioRequired = [DIRECT_NATIVE_PROFILE_VERSION_V3, DIRECT_NATIVE_PROFILE_VERSION_V35].includes(profileVersion);
  assertExactKeys(request, [
    "schemaVersion",
    "launchWallet",
    "chainId",
    "nonce",
    "permitWindow",
    "sourceDescriptor",
    "sourceBundleManifest",
    "graphBundle",
    ...(metadataRequired ? ["projectMetadata", "projectMetadataHash"] : []),
    ...(behaviorScenarioRequired
      ? ["behaviorScenarioInputs", "behaviorScenarioInputsHash"]
      : []),
    "launchProfile",
    "launchProfileSelection",
    "launchProfileHash",
    "launchIntentHash",
    ...(fundingMode === "eip-3009-receive-with-authorization"
      ? ["fundingAuthorization", "fundingIntentHash"]
      : []),
    "agentAttestation",
    "verificationBundle",
  ], "launch request");
  const projectMetadata = metadataRequired
    ? validateProjectMetadata(request.projectMetadata, {
        requireComplete: completeMetadataRequired,
      })
    : null;
  const projectMetadataHash = projectMetadata === null
    ? null
    : hashProjectMetadata(projectMetadata, {
        requireComplete: completeMetadataRequired,
      });
  if (projectMetadata !== null && request.projectMetadataHash !== projectMetadataHash) {
    throw new TypeError("projectMetadataHash does not match canonical projectMetadata");
  }
  const common = validateCommonRequest(request, {
    expectedChainId: ["8453","999"].includes(request.launchProfile?.chainId) ? request.launchProfile.chainId : MAINNET_CHAIN_ID,
    chainContext: request.launchProfile,
    ...(projectMetadataHash === null ? {} : { projectMetadataHash }),
  });
  const behaviorScenarioInputs = behaviorScenarioRequired
    ? validateBehaviorScenarioInputs(
        request.behaviorScenarioInputs,
        common.graph.graphBundle.targets,
      )
    : null;
  const behaviorScenarioInputsHash = behaviorScenarioInputs === null
    ? null
    : hashBehaviorScenarioInputs(behaviorScenarioInputs);
  if (behaviorScenarioInputsHash !== null
    && request.behaviorScenarioInputsHash !== behaviorScenarioInputsHash) {
    throw new TypeError(
      "behaviorScenarioInputsHash does not match canonical behaviorScenarioInputs",
    );
  }
  if (projectMetadata !== null && projectMetadata.presentation.image !== null) {
    const image = projectMetadata.presentation.image;
    if (!common.manifest.entries.some((entry) => entry.kind === "file"
      && entry.contentSha256 === image.contentSha256
      && entry.byteLength === String(image.byteLength))) {
      throw new TypeError("projectMetadata presentation image bytes are absent from sourceBundleManifest");
    }
  }
  const permitWindow = validateDirectNativePermitWindow(request.permitWindow);
  if (canonicalizeJson(request.graphBundle) !== canonicalizeJson(common.graph.graphBundle)) {
    throw new TypeError("V3 graphBundle must use the exact canonical target order and encoding");
  }
  const launchProfile = validateEmbeddedDirectNativeProfile(request.launchProfile);
  const verification = validateVerificationBundle(
    request.verificationBundle,
    common.graph.graphBundle,
    common.graph.predictions,
    "v2",
    launchProfile.profileRevision === DIRECT_NATIVE_PROFILE_REVISION_V3
      ? { maximumSources: MAX_STANDARD_JSON_SOURCES }
      : {},
  );
  if (launchProfile.profileRevision === DIRECT_NATIVE_PROFILE_REVISION_V3) {
    for (const unit of request.verificationBundle.compilationUnits) {
      if (unit.compilerVersion !== DIRECT_NATIVE_REQUIRED_SOLC_VERSION) {
        throw new TypeError(
          `DIRECT_NATIVE_COMPILER_VERSION_UNSUPPORTED: ${unit.compilationUnitId} uses ${unit.compilerVersion}; the live profile requires ${DIRECT_NATIVE_REQUIRED_SOLC_VERSION}`,
        );
      }
    }
  }
  const quoteCurrency = directNativeQuoteCurrency(
    request.launchProfileSelection,
    common.graph.predictions,
  );
  const launchProfileSelection = validateDirectNativeProfileBinding(
    request.launchProfileSelection,
    {
      profileVersion: launchProfile.profileVersion,
      profile: launchProfile,
      graphBundle: common.graph.graphBundle,
      predictions: common.graph.predictions,
      routeNamespace: deriveRouteNamespace(
        common.sourceDescriptor.bundleContentSha256,
        common.launchWallet,
        launchProfile,
      ),
      routeNonce: request.nonce,
      quoteCurrency,
      ...(fundingMode === "eip-3009-receive-with-authorization"
        ? { fundingSignaturePatch: request.launchProfileSelection.fundingSignaturePatch }
        : {}),
    },
  );
  if (projectMetadata !== null
    && projectMetadata.tokenMetadataBinding.tokenTargetId
      !== launchProfileSelection.targetRoles.tokenTargetId) {
    throw new TypeError("projectMetadata token binding does not name the selected token target");
  }
  const hookRuntime = verification.runtimeCodes.get(
    launchProfileSelection.targetRoles.hookTargetId,
  );
  if (hookRuntime === undefined) {
    throw new TypeError("verificationBundle does not contain the selected direct hook runtime");
  }
  // V3 binds the exact applicant runtime but does not impose the legacy V2
  // custom-module opcode profile. Upgradeable/delegating graphs remain subject
  // to automatic role-aware admission and exact Router simulation instead of
  // being silently made unpackageable by the CLI.
  const launchProfileHash = hashDirectNativeProfile(launchProfile);
  if (request.launchProfileHash !== launchProfileHash) {
    throw new TypeError("launchProfileHash does not match the closed embedded V3 launchProfile");
  }
  validateDirectNativeProfileGraph(
    launchProfile,
    launchProfileSelection,
    common.graph.graphBundle,
  );
  validateDirectNativeProfileBuilds(
    launchProfile,
    launchProfileSelection,
    common.graph.graphBundle,
    request.verificationBundle,
  );
  const launchIntentHash = buildDirectNativeLaunchIntentHash({
    schemaVersion: CREATE_REQUEST_SCHEMA_V3,
    launchWallet: common.launchWallet,
    chainId: request.chainId,
    nonce: request.nonce,
    sourceDescriptor: common.sourceDescriptor,
    sourceBundleManifest: common.manifest,
    graphBundleHash: common.graph.graphBundleHash,
    ...(projectMetadataHash === null ? {} : { projectMetadataHash }),
    ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
    verificationBundleHash: verification.verificationBundleHash,
    launchProfileHash,
    launchProfileSelection,
    permitWindow,
  });
  if (request.launchIntentHash !== launchIntentHash) {
    throw new TypeError("launchIntentHash does not match the normalized V3 launch intent");
  }
  const funding = fundingMode === "eip-3009-receive-with-authorization"
    ? validateFundingAuthorization(
        request.fundingAuthorization,
        request.fundingIntentHash,
        {
          launchWallet: common.launchWallet,
          router: launchProfile.router,
          predictedInitializer: launchProfileSelection.predictedInitializer,
          routeNamespace: launchProfileSelection.routeNamespace,
          routeNonce: launchProfileSelection.routeNonce,
          launchIntentHash,
        },
      )
    : null;
  if (funding !== null
    && (funding.fundingAuthorization.validAfter !== permitWindow.validAfter
      || funding.fundingAuthorization.validBefore !== permitWindow.deadline)) {
    throw new TypeError("fundingAuthorization validity does not match permitWindow");
  }
  validateAttestationV2(request.agentAttestation, launchIntentHash);
  return {
    schemaVersion: request.schemaVersion,
    graphBundleHash: common.graph.graphBundleHash,
    ...(projectMetadataHash === null
      ? {}
      : {
          unboundGraphBundleHash: common.graph.unboundGraphBundleHash,
          projectMetadataHash,
        }),
    ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
    verificationBundleHash: verification.verificationBundleHash,
    launchProfileHash,
    launchIntentHash,
    ...(funding === null ? {} : { fundingIntentHash: funding.fundingIntentHash }),
    productionLaunchAuthorized: launchProfile.productionLaunchAuthorized,
    exactSourceIncluded: true,
    predictions: common.graph.predictions,
  };
}

function validateV4LaunchRequest(request) {
  const selectedProfile = normalizeV4ProfileRef(request?.profile);
  const behaviorScenarioPresent = Object.hasOwn(request ?? {}, "behaviorScenarioInputs")
    || Object.hasOwn(request ?? {}, "behaviorScenarioInputsHash");
  assertExactKeys(request, [
    "schemaVersion",
    "chainId",
    "caip2",
    "chainDeployment",
    "chainDeploymentDescriptorDigest",
    "profile",
    "launchWallet",
    "nonce",
    "permitWindow",
    "sourceDescriptor",
    "sourceBundleManifest",
    "externalContracts",
    "graphBundle",
    "projectMetadata",
    "projectMetadataHash",
    "projectMetadataImageArtifact",
    ...(behaviorScenarioPresent
      ? ["behaviorScenarioInputs", "behaviorScenarioInputsHash"]
      : []),
    "verificationBundle",
    "funding",
    ...(isRobinhoodProfileV41(selectedProfile) ? ["fundingPlan"] : []),
    "liquidityModel",
    "launchIntentHash",
    "agentAttestation",
  ], "V4 launch request");
  if (request.schemaVersion !== CREATE_REQUEST_SCHEMA_V4
    || request.chainId !== ROBINHOOD_CHAIN_ID
    || request.caip2 !== `eip155:${ROBINHOOD_CHAIN_ID}`) {
    throw new TypeError("V4 request must bind Robinhood Chain mainnet eip155:4663");
  }
  const chainDeployment = normalizeV4ChainDeployment(request.chainDeployment);
  const chainDeploymentDescriptorDigest = assertV4DeploymentDescriptorDigest(
    request.chainDeploymentDescriptorDigest,
    chainDeployment,
  );
  const profile = normalizeV4ProfileRef(request.profile);
  const externalContracts = normalizeV4ExternalContracts(request.externalContracts);
  const funding = normalizeV4FundingIntent(request.funding);
  const fundingPlan = isRobinhoodProfileV41(profile)
    ? normalizeRobinhoodFundingPlanV1(request.fundingPlan, funding) : null;
  const liquidityModel = normalizeV4LiquidityModel(request.liquidityModel);
  const permitWindow = validateDirectNativePermitWindow(request.permitWindow);
  const projectMetadata = validateProjectMetadata(request.projectMetadata, {
    requireComplete: true,
  });
  const projectMetadataHash = hashProjectMetadata(projectMetadata, {
    requireComplete: true,
  });
  if (request.projectMetadataHash !== projectMetadataHash) {
    throw new TypeError("projectMetadataHash does not match canonical projectMetadata");
  }
  const projectMetadataImageArtifact = validateProjectMetadataImageArtifactV4(
    request.projectMetadataImageArtifact,
    projectMetadata,
  );
  const chainContext = v4GraphChainContext(chainDeployment);
  const common = validateCommonRequest(request, {
    projectMetadataHash,
    expectedChainId: ROBINHOOD_CHAIN_ID,
    chainContext,
  });
  if (common.graph.graphBundle.targets.length < 3
    || common.graph.graphBundle.targets.length > 16) {
    throw new TypeError("V4 graphBundle must contain between 3 and 16 targets");
  }
  if (canonicalizeJson(request.graphBundle) !== canonicalizeJson(common.graph.graphBundle)) {
    throw new TypeError("V4 graphBundle must use the exact canonical target order and encoding");
  }
  assertV4FundingValueMatchesGraph(funding, common.graph.graphBundle);
  assertV4ExternalContractLocators(externalContracts, common.graph.graphBundle);
  if (projectMetadata.presentation.image !== null) {
    const image = projectMetadata.presentation.image;
    if (!common.manifest.entries.some((entry) => entry.kind === "file"
      && entry.contentSha256 === image.contentSha256
      && entry.byteLength === String(image.byteLength))) {
      throw new TypeError("projectMetadata presentation image bytes are absent from sourceBundleManifest");
    }
  }
  const behaviorScenarioInputs = behaviorScenarioPresent
    ? validateBehaviorScenarioInputs(
        request.behaviorScenarioInputs,
        common.graph.graphBundle.targets,
      )
    : null;
  const behaviorScenarioInputsHash = behaviorScenarioInputs === null
    ? null
    : hashBehaviorScenarioInputs(behaviorScenarioInputs);
  if (behaviorScenarioInputsHash !== null
    && request.behaviorScenarioInputsHash !== behaviorScenarioInputsHash) {
    throw new TypeError(
      "behaviorScenarioInputsHash does not match canonical behaviorScenarioInputs",
    );
  }
  const verification = validateVerificationBundle(
    request.verificationBundle,
    common.graph.graphBundle,
    common.graph.predictions,
    "v2",
    { maximumSources: MAX_STANDARD_JSON_SOURCES },
  );
  const sourceBuildCommitment = buildV4SourceBuildCommitment({
    sourceDescriptor: common.sourceDescriptor,
    sourceBundleManifest: common.manifest,
    externalContracts,
    projectMetadataImageArtifact,
    verificationBundleHash: verification.verificationBundleHash,
  });
  for (const targetId of liquidityModel.targetIds) {
    if (!common.graph.graphBundle.targets.some((target) => target.targetId === targetId)) {
      throw new TypeError(`liquidityModel references unknown graph target ${targetId}`);
    }
  }
  const launchIntentHash = buildV4LaunchIntentHash({
    schemaVersion: CREATE_REQUEST_SCHEMA_V4,
    chainId: request.chainId,
    caip2: request.caip2,
    chainDeploymentId: chainDeployment.chainDeploymentId,
    chainDeploymentDescriptorDigest,
    profile,
    launchWallet: common.launchWallet,
    nonce: request.nonce,
    permitWindow,
    sourceDescriptor: common.sourceDescriptor,
    sourceBundleManifest: common.manifest,
    externalContracts,
    graphBundleHash: common.graph.graphBundleHash,
    projectMetadataHash,
    projectMetadataImageArtifact,
    ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
    verificationBundleHash: verification.verificationBundleHash,
    funding,
    ...(fundingPlan === null ? {} : { fundingPlan }),
    liquidityModel,
  });
  if (request.launchIntentHash !== launchIntentHash) {
    throw new TypeError("launchIntentHash does not match the normalized V4 launch intent");
  }
  validateAttestationV2(request.agentAttestation, launchIntentHash);
  return {
    schemaVersion: request.schemaVersion,
    chainId: request.chainId,
    caip2: request.caip2,
    chainDeploymentId: chainDeployment.chainDeploymentId,
    chainDeploymentDescriptorDigest,
    profile,
    graphBundleHash: common.graph.graphBundleHash,
    unboundGraphBundleHash: common.graph.unboundGraphBundleHash,
    projectMetadataHash,
    ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
    verificationBundleHash: verification.verificationBundleHash,
    sourceBuildCommitment,
    launchIntentHash,
    exactSourceIncluded: true,
    predictions: common.graph.predictions,
  };
}

function directNativeQuoteCurrency(binding, predictions) {
  const token = predictions.find(
    ({ targetId }) => targetId === binding?.targetRoles?.tokenTargetId,
  )?.predictedAddress;
  if (typeof token !== "string") {
    throw new TypeError("direct-native token prediction is absent");
  }
  const currencies = [binding?.poolKey?.currency0, binding?.poolKey?.currency1];
  const normalizedToken = getAddress(token);
  const normalizedCurrencies = currencies.map((currency) => getAddress(currency));
  const tokenIndex = normalizedCurrencies.findIndex(
    (currency) => currency.toLowerCase() === normalizedToken.toLowerCase(),
  );
  if (tokenIndex === -1) {
    throw new TypeError("direct-native PoolKey does not bind predicted token");
  }
  return normalizedCurrencies[tokenIndex === 0 ? 1 : 0];
}

function validateCommonRequest(
  request,
  {
    projectMetadataHash,
    expectedChainId = MAINNET_CHAIN_ID,
    chainContext,
  } = {},
) {
  const launchWallet = getAddress(request.launchWallet);
  if (request.chainId !== expectedChainId) {
    throw new TypeError(`chainId must be string ${expectedChainId}`);
  }
  if (typeof request.nonce !== "string" || !NONZERO_HEX32.test(request.nonce)) {
    throw new TypeError("nonce must be nonzero lowercase bytes32");
  }
  const manifest = validateManifest(request.sourceBundleManifest);
  const sourceDescriptor = validateSourceDescriptor(request.sourceDescriptor, launchWallet);
  const manifestDigest = keccak256(`0x${Buffer.concat([
    Buffer.from("programmable.source-bundle.v2", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(manifest), "utf8"),
  ]).toString("hex")}`);
  if (manifestDigest !== sourceDescriptor.sourceBundleDigest) {
    throw new TypeError("sourceDescriptor.sourceBundleDigest does not match the manifest");
  }
  if (request.graphBundle?.schemaVersion !== GRAPH_BUNDLE_SCHEMA) {
    throw new TypeError(`graphBundle.schemaVersion must be ${GRAPH_BUNDLE_SCHEMA}`);
  }
  if (request.graphBundle.sourceBundleSha256 !== sourceDescriptor.bundleContentSha256) {
    throw new TypeError("graphBundle.sourceBundleSha256 does not match sourceDescriptor.bundleContentSha256");
  }
  const graph = normalizeAndPredictSubmittedGraph(
    request.graphBundle,
    launchWallet,
    request.nonce,
    {
      enforceV4PermissionDependencies: request.schemaVersion === CREATE_REQUEST_SCHEMA_V3
        || request.schemaVersion === CREATE_REQUEST_SCHEMA_V4,
      ...(projectMetadataHash === undefined ? {} : { projectMetadataHash }),
      ...(chainContext === undefined ? {} : { chainContext }),
    },
  );
  return {
    launchWallet,
    manifest,
    sourceDescriptor,
    graph,
  };
}

function validateManifest(value) {
  assertExactKeys(value, ["schemaVersion", "entries"], "sourceBundleManifest");
  if (value.schemaVersion !== SOURCE_MANIFEST_SCHEMA
    || !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > 200_000) {
    throw new TypeError("sourceBundleManifest is invalid");
  }
  const entries = value.entries.map((entry, index) => {
    const label = `sourceBundleManifest.entries[${index}]`;
    assertExactKeys(entry, [
      "path",
      "kind",
      "mode",
      "byteLength",
      "contentSha256",
      "symlinkTarget",
    ], label);
    const entryPath = canonicalRelativePath(entry.path, `${label}.path`);
    if (entry.kind !== "file" && entry.kind !== "symlink") throw new TypeError(`${label}.kind is invalid`);
    if (typeof entry.byteLength !== "string" || !DECIMAL.test(entry.byteLength)
      || BigInt(entry.byteLength) > (1n << 64n) - 1n) {
      throw new TypeError(`${label}.byteLength is invalid`);
    }
    if (typeof entry.contentSha256 !== "string" || !SHA256.test(entry.contentSha256)) {
      throw new TypeError(`${label}.contentSha256 is invalid`);
    }
    if (entry.kind === "file") {
      if ((entry.mode !== "100644" && entry.mode !== "100755") || entry.symlinkTarget !== null) {
        throw new TypeError(`${label} file mode or symlinkTarget is invalid`);
      }
    } else if (entry.mode !== "120000" || typeof entry.symlinkTarget !== "string") {
      throw new TypeError(`${label} symlink mode or target is invalid`);
    }
    return { ...entry, path: entryPath };
  });
  for (let index = 1; index < entries.length; index += 1) {
    if (compareUtf8(entries[index - 1].path, entries[index].path) >= 0) {
      throw new TypeError("source bundle entries must be uniquely UTF-8 sorted");
    }
  }
  return { schemaVersion: SOURCE_MANIFEST_SCHEMA, entries };
}

function validateSourceDescriptor(value, launchWallet) {
  assertExactKeys(value, [
    "schemaVersion",
    "kind",
    "controllerWallet",
    "sourceLineageNonce",
    "sourceBundleDigest",
    "bundleContentSha256",
    "publicOriginCommitment",
  ], "sourceDescriptor");
  if (value.schemaVersion !== SOURCE_DESCRIPTOR_SCHEMA || value.kind !== "deterministic-source-bundle") {
    throw new TypeError("sourceDescriptor schema or kind is invalid");
  }
  if (getAddress(value.controllerWallet) !== launchWallet) {
    throw new TypeError("sourceDescriptor.controllerWallet does not match launchWallet");
  }
  if (typeof value.sourceLineageNonce !== "string" || !DECIMAL.test(value.sourceLineageNonce)) {
    throw new TypeError("sourceDescriptor.sourceLineageNonce is invalid");
  }
  if (typeof value.sourceBundleDigest !== "string" || !HEX32.test(value.sourceBundleDigest)
    || typeof value.bundleContentSha256 !== "string" || !SHA256.test(value.bundleContentSha256)
    || typeof value.publicOriginCommitment !== "string" || !HEX32.test(value.publicOriginCommitment)) {
    throw new TypeError("sourceDescriptor contains an invalid digest");
  }
  return value;
}

function validateAttestationV1(value, graphBundleHash) {
  assertExactKeys(value, [
    "schemaVersion",
    "subjectGraphBundleHash",
    "agentId",
    "checkedAt",
    "checks",
  ], "agentAttestation");
  if (value.schemaVersion !== AGENT_ATTESTATION_SCHEMA_V1
    || value.subjectGraphBundleHash !== graphBundleHash) {
    throw new TypeError("agentAttestation is not bound to the normalized graph bundle");
  }
  validateAttestationMetadata(value);
}

function validateAttestationV2(value, launchIntentHash) {
  assertExactKeys(value, [
    "schemaVersion",
    "subjectLaunchIntentHash",
    "agentId",
    "checkedAt",
    "checks",
  ], "agentAttestation");
  if (value.schemaVersion !== AGENT_ATTESTATION_SCHEMA_V2
    || value.subjectLaunchIntentHash !== launchIntentHash) {
    throw new TypeError("agentAttestation is not bound to the normalized launch intent");
  }
  validateAttestationMetadata(value);
}

function validateAttestationMetadata(value) {
  canonicalIdentifier(value.agentId, "agentAttestation.agentId");
  if (typeof value.checkedAt !== "string" || !ISO_UTC.test(value.checkedAt)
    || new Date(value.checkedAt).toISOString() !== value.checkedAt) {
    throw new TypeError("agentAttestation.checkedAt is invalid");
  }
  if (!Array.isArray(value.checks) || value.checks.length === 0 || value.checks.length > 64) {
    throw new TypeError("agentAttestation.checks is invalid");
  }
  const ids = new Set();
  for (const [index, check] of value.checks.entries()) {
    assertExactKeys(check, ["checkId", "evidenceSha256"], `agentAttestation.checks[${index}]`);
    const checkId = canonicalIdentifier(check.checkId, `agentAttestation.checks[${index}].checkId`);
    if (ids.has(checkId)) throw new TypeError("agent attestation check IDs must be unique");
    ids.add(checkId);
    if (typeof check.evidenceSha256 !== "string" || !SHA256.test(check.evidenceSha256)) {
      throw new TypeError(`agentAttestation.checks[${index}].evidenceSha256 is invalid`);
    }
  }
}

function validateVerificationBundle(
  value,
  graphBundle,
  predictions,
  apiVersion,
  { maximumSources } = {},
) {
  assertExactKeys(value, ["schemaVersion", "compilationUnits", "components"], "verificationBundle");
  const expectedSchema = apiVersion === "v2"
    ? VERIFICATION_BUNDLE_SCHEMA_V2
    : VERIFICATION_BUNDLE_SCHEMA_V1;
  if (value.schemaVersion !== expectedSchema) {
    throw new TypeError(`verificationBundle.schemaVersion must be ${expectedSchema}`);
  }
  if (!Array.isArray(value.compilationUnits) || value.compilationUnits.length === 0
    || value.compilationUnits.length > 16) {
    throw new TypeError("verificationBundle.compilationUnits is invalid");
  }
  const units = new Map();
  let priorUnit = null;
  let totalStandardJsonBytes = 0;
  for (const [index, unit] of value.compilationUnits.entries()) {
    const label = `verificationBundle.compilationUnits[${index}]`;
    assertExactKeys(unit, [
      "compilationUnitId",
      "compilerVersion",
      "standardJsonInputBase64",
      "standardJsonInputSha256",
    ], label);
    const id = canonicalIdentifier(unit.compilationUnitId, `${label}.compilationUnitId`);
    if (priorUnit !== null && compareUtf8(priorUnit, id) >= 0) {
      throw new TypeError("verification compilation units must be uniquely UTF-8 sorted");
    }
    priorUnit = id;
    exactCompilerVersion(unit.compilerVersion, `${label}.compilerVersion`);
    const bytes = decodeCanonicalBase64(unit.standardJsonInputBase64, `${label}.standardJsonInputBase64`);
    if (bytes.byteLength > MAX_STANDARD_JSON_INPUT_BYTES) {
      throw new TypeError(
        `${label}.standardJsonInputBase64 exceeds the ${MAX_STANDARD_JSON_INPUT_BYTES}-byte decoded limit`,
      );
    }
    totalStandardJsonBytes += bytes.byteLength;
    if (totalStandardJsonBytes > MAX_TOTAL_STANDARD_JSON_INPUT_BYTES) {
      throw new TypeError(
        `verificationBundle Standard JSON exceeds the ${MAX_TOTAL_STANDARD_JSON_INPUT_BYTES}-byte aggregate decoded limit`,
      );
    }
    if (sha256Digest(bytes) !== unit.standardJsonInputSha256) {
      throw new TypeError(`${label}.standardJsonInputSha256 does not match exact decoded bytes`);
    }
    const source = decodeExactUtf8(bytes, `${label} Standard JSON`);
    const input = parseStrictJson(source, { maximumBytes: MAX_STANDARD_JSON_INPUT_BYTES });
    validateStandardJsonInput(input, id, { maximumSources });
    units.set(id, { unit, input });
  }
  if (!Array.isArray(value.components) || value.components.length === 0
    || value.components.length > 16 || value.components.length !== graphBundle.targets.length) {
    throw new TypeError("verificationBundle.components must exactly cover graph targets");
  }
  const predictionByTarget = new Map(predictions.map((prediction) => [prediction.targetId, prediction]));
  const identities = new Map(predictions.map(({ targetId, predictedAddress }) => [
    targetId,
    predictedAddress,
  ]));
  let priorTarget = null;
  const runtimeCodes = new Map();
  for (const [index, component] of value.components.entries()) {
    const label = `verificationBundle.components[${index}]`;
    const commonComponentKeys = [
      "targetId",
      "compilationUnitId",
      "sourcePath",
      "contractName",
      "constructorArguments",
    ];
    assertExactKeys(
      component,
      apiVersion === "v2" ? [...commonComponentKeys, "runtimeMaterialization"] : commonComponentKeys,
      label,
    );
    const targetId = canonicalIdentifier(component.targetId, `${label}.targetId`);
    if (priorTarget !== null && compareUtf8(priorTarget, targetId) >= 0) {
      throw new TypeError("verification components must be uniquely UTF-8 sorted");
    }
    priorTarget = targetId;
    const unit = units.get(component.compilationUnitId);
    if (!unit) throw new TypeError(`${label} references unknown compilation unit`);
    if (typeof component.sourcePath !== "string" || !Object.hasOwn(unit.input.sources, component.sourcePath)) {
      throw new TypeError(`${label}.sourcePath is absent from its Standard JSON input`);
    }
    canonicalIdentifier(component.contractName, `${label}.contractName`);
    if (typeof component.constructorArguments !== "string" || !HEX_DATA.test(component.constructorArguments)) {
      throw new TypeError(`${label}.constructorArguments must be lowercase even hex`);
    }
    const prediction = predictionByTarget.get(targetId);
    if (!prediction || prediction.resolvedConstructorArguments !== component.constructorArguments) {
      throw new TypeError(`${label}.constructorArguments do not match the resolved graph init code`);
    }
    if (apiVersion === "v2") {
      const runtimeCode = validateSubmittedRuntimeMaterialization(
        component.runtimeMaterialization,
        graphBundle.targets.find((target) => target.targetId === targetId),
        identities,
        label,
      );
      runtimeCodes.set(targetId, runtimeCode);
    }
  }
  const graphIds = graphBundle.targets.map(({ targetId }) => targetId).sort(compareUtf8);
  const componentIds = value.components.map(({ targetId }) => targetId);
  if (graphIds.some((targetId, index) => targetId !== componentIds[index])) {
    throw new TypeError("verification components do not exactly cover graph targets");
  }
  const normalized = {
    schemaVersion: expectedSchema,
    compilationUnits: value.compilationUnits,
    components: value.components,
  };
  const verificationBundleHash = sha256Digest(Buffer.concat([
    Buffer.from(expectedSchema, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(normalized), "utf8"),
  ]));
  return { verificationBundleHash, exactSourceIncluded: true, runtimeCodes };
}

function validateSubmittedRuntimeMaterialization(value, graphTarget, identities, label) {
  assertExactKeys(value, [
    "immutableReferences",
    "runtimeImmutables",
    "deployedRuntimeCodeBase64",
    "deployedRuntimeCodeHash",
  ], `${label}.runtimeMaterialization`);
  const runtimeBytes = decodeCanonicalBase64(
    value.deployedRuntimeCodeBase64,
    `${label}.runtimeMaterialization.deployedRuntimeCodeBase64`,
  );
  if (runtimeBytes.byteLength === 0) {
    throw new TypeError(`${label}.runtimeMaterialization deployed runtime must not be empty`);
  }
  const runtimeCode = `0x${runtimeBytes.toString("hex")}`;
  assertDeployableRuntimeCode(runtimeCode, `${label}.runtimeMaterialization deployed runtime`);
  const runtimeHash = keccak256(runtimeCode);
  if (typeof value.deployedRuntimeCodeHash !== "string"
    || !/^0x(?!0{64}$)[0-9a-f]{64}$/.test(value.deployedRuntimeCodeHash)
    || value.deployedRuntimeCodeHash !== runtimeHash
    || graphTarget?.expectedRuntimeCodeHash !== runtimeHash) {
    throw new TypeError(`${label}.runtimeMaterialization runtime hash does not match graph target`);
  }
  if (!Array.isArray(value.immutableReferences) || !Array.isArray(value.runtimeImmutables)) {
    throw new TypeError(`${label}.runtimeMaterialization immutable metadata must be arrays`);
  }
  const occupied = [];
  const referenceIds = [];
  for (const [index, reference] of value.immutableReferences.entries()) {
    const referenceLabel = `${label}.runtimeMaterialization.immutableReferences[${index}]`;
    assertExactKeys(reference, ["immutableId", "ranges"], referenceLabel);
    if (typeof reference.immutableId !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(reference.immutableId)
      || !Array.isArray(reference.ranges) || reference.ranges.length === 0) {
      throw new TypeError(`${referenceLabel} is invalid`);
    }
    if (referenceIds.length > 0
      && BigInt(referenceIds.at(-1)) >= BigInt(reference.immutableId)) {
      throw new TypeError(`${label}.runtimeMaterialization immutable ids must be uniquely sorted`);
    }
    referenceIds.push(reference.immutableId);
    for (const [rangeIndex, range] of reference.ranges.entries()) {
      assertExactKeys(range, ["start", "length"], `${referenceLabel}.ranges[${rangeIndex}]`);
      if (!Number.isSafeInteger(range.start) || range.start < 0 || range.length !== 32
        || range.start + range.length > runtimeBytes.byteLength) {
        throw new TypeError(`${referenceLabel}.ranges[${rangeIndex}] is not an in-bounds 32-byte range`);
      }
      occupied.push({ start: range.start, end: range.start + range.length });
    }
  }
  occupied.sort((left, right) => left.start - right.start);
  for (let index = 1; index < occupied.length; index += 1) {
    if (occupied[index].start < occupied[index - 1].end) {
      throw new TypeError(`${label}.runtimeMaterialization immutable ranges overlap`);
    }
  }
  const configuredIds = [];
  for (const [index, immutable] of value.runtimeImmutables.entries()) {
    const immutableLabel = `${label}.runtimeMaterialization.runtimeImmutables[${index}]`;
    const keys = Object.keys(immutable).sort(compareUtf8).join(",");
    if (keys !== "abiType,immutableId,literal" && keys !== "abiType,immutableId,target") {
      throw new TypeError(`${immutableLabel} has invalid fields`);
    }
    if (typeof immutable.immutableId !== "string"
      || !/^(?:0|[1-9][0-9]*)$/.test(immutable.immutableId)
      || typeof immutable.abiType !== "string") {
      throw new TypeError(`${immutableLabel} is invalid`);
    }
    configuredIds.push(immutable.immutableId);
  }
  if (referenceIds.length !== configuredIds.length
    || referenceIds.some((immutableId, index) => immutableId !== configuredIds[index])) {
    throw new TypeError(`${label}.runtimeMaterialization immutable metadata does not exactly cover compiler ids`);
  }
  const templateBytes = Buffer.from(runtimeBytes);
  const compilerReferences = Object.fromEntries(value.immutableReferences.map((reference) => {
    for (const range of reference.ranges) {
      templateBytes.fill(0, range.start, range.start + range.length);
    }
    return [reference.immutableId, reference.ranges];
  }));
  const plan = normalizeRuntimeMaterialization({
    runtimeCode: `0x${templateBytes.toString("hex")}`,
    immutableReferences: compilerReferences,
    runtimeImmutables: value.runtimeImmutables,
    label: `${label}.runtimeMaterialization`,
  });
  if (materializeRuntimeCode(plan, identities, `${label}.runtimeMaterialization`) !== runtimeCode) {
    throw new TypeError(
      `${label}.runtimeMaterialization immutable values do not reproduce the submitted runtime`,
    );
  }
  return runtimeCode;
}

function decodeCanonicalBase64(value, label) {
  if (typeof value !== "string" || value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new TypeError(`${label} is not canonical base64`);
  return bytes;
}
