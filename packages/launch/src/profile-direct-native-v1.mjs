import { DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36, assertDirectNativeProgrammableTradeFeePolicyV36 } from "./profile-v36.mjs";
import { validateCanonicalSettlementFeeVaultV2Graph, validateCanonicalSettlementFeeVaultV2Build } from "./canonical-settlement-fee-vault-v2.mjs";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  toFunctionSelector,
} from "viem";

import { canonicalizeJson } from "./canonical-json.mjs";
import { canonicalIdentifier } from "./build.mjs";
import {
  validateCanonicalSettlementFeeVaultV1Build,
  validateCanonicalSettlementFeeVaultV1Graph,
} from "./canonical-settlement-fee-vault-v1.mjs";
import {
  DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN_V2,
  DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN_V3,
  DIRECT_NATIVE_LIQUIDITY_MODEL_ASSESSMENT_SCHEMA,
  DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
  DIRECT_NATIVE_PROFILE_BINDING_SCHEMA_V2,
  DIRECT_NATIVE_PROFILE_BINDING_SCHEMA_V3,
  DIRECT_NATIVE_PROFILE_HASH_DOMAIN_V2,
  DIRECT_NATIVE_PROFILE_HASH_DOMAIN_V3,
  DIRECT_NATIVE_PROFILE_ID,
  DIRECT_NATIVE_PROFILE_REVISION_V2,
  DIRECT_NATIVE_PROFILE_REVISION_V3,
  DIRECT_NATIVE_PROFILE_SCHEMA_V2,
  DIRECT_NATIVE_PROFILE_SCHEMA_V3,
  DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA_V2,
  DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA_V3,
  DIRECT_NATIVE_PROFILE_VERSION_V2,
  DIRECT_NATIVE_PROFILE_VERSION,
  DIRECT_NATIVE_PROFILE_VERSION_V3,
  DIRECT_NATIVE_PROFILE_VERSION_V35,
  DIRECT_NATIVE_PROFILE_VERSION_V36,
  DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY,
  DIRECT_NATIVE_PROFILE_VERSION_V3_LEGACY,
  DIRECT_NATIVE_PROFILE_VERSION_V3_METADATA_LEGACY,
  DIRECT_NATIVE_PROFILE_VERSION_V3_PRE_METADATA,
  DIRECT_NATIVE_PLATFORM_ADMISSION_POLICY_SCHEMA,
  FUNDING_AUTHORIZATION_DESCRIPTOR_SCHEMA,
  FUNDING_AUTHORIZATION_INPUT_SCHEMA,
  FUNDING_AUTHORIZATION_METHOD,
  FUNDING_WALLET_TRANSACTION_VALUE_METHOD,
  FUNDING_SIGNATURE_PATCH_SCHEMA,
  FUNDING_SIGNATURE_PATCH_SCHEMA_V2,
  FUNDING_INTENT_HASH_DOMAIN,
  FUNDING_NONCE_DOMAIN,
  GRAPH_FACTORY,
  GRAPH_FACTORY_RUNTIME_CODE_HASH,
  HOOK_INVENTORY_CUSTOM_ACCOUNTING_VECTORS,
  HOOK_PERMISSION_BITS,
  MAINNET_CHAIN_ID,
  MAINNET_USDC,
  MAINNET_USDC_RUNTIME_CODE_HASH,
  MAINNET_USDC_DOMAIN_NAME,
  MAINNET_USDC_DOMAIN_SEPARATOR,
  MAINNET_USDC_DOMAIN_VERSION,
  LAUNCH_SEEDED_CONCENTRATED_LIQUIDITY_VECTORS,
  PLATFORM_FEE_DENOMINATOR,
  PLATFORM_FEE_BINDING_SCHEMA,
  PLATFORM_FEE_CLAIM_AUTHORITY,
  PLATFORM_FEE_POLICY_SCHEMA,
  PLATFORM_FEE_PROOF_POLICY_SCHEMA,
  PLATFORM_FEE_RATE_PPM,
  POOL_MANAGER,
  POOL_MANAGER_RUNTIME_CODE_HASH,
  PERMIT_AUTHORITY,
  PERMIT_AUTHORITY_RUNTIME_CODE_HASH,
  RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
  ROUTER,
  ROUTER_24H,
  ROUTER_24H_RUNTIME_CODE_HASH,
  ROUTER_RUNTIME_CODE_HASH,
} from "./constants.mjs";
import { createCliDiagnosticError } from "./diagnostics.mjs";
import { assertExactKeys, sha256Digest } from "./io.mjs";

const HEX32 = /^0x[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const PLATFORM_ACCOUNTING_MODES = Object.freeze([
  "additive-platform-share",
  "inclusive-selected-total",
]);
const FUNDING_MODES = Object.freeze([
  "none",
  FUNDING_WALLET_TRANSACTION_VALUE_METHOD,
  FUNDING_AUTHORIZATION_METHOD,
]);
const CLAIM_MODES = Object.freeze([
  "immutable-payout-recipient",
  "claim-authority-selected-recipient",
]);
const PLATFORM_FEE_ASSESSMENT_PAIRS = Object.freeze([
  Object.freeze({
    assessmentBase: "executed-gross-declared-quote",
    feeCurrency: "declared-quote-currency",
  }),
  Object.freeze({
    assessmentBase: "settled-input-before-platform-fee",
    feeCurrency: "input-currency",
  }),
]);
const PLATFORM_FEE_POLICY_COMMON = Object.freeze({
  schemaVersion: PLATFORM_FEE_POLICY_SCHEMA,
  applicability: "successful-pool-swaps",
  rateDenominator: PLATFORM_FEE_DENOMINATOR,
  programmableFeeHundredthsOfBip: PLATFORM_FEE_RATE_PPM,
  roundingMode: "floor",
  claimAuthority: PLATFORM_FEE_CLAIM_AUTHORITY,
});
const PLATFORM_FEE_PROOF_POLICY = Object.freeze({
  schemaVersion: PLATFORM_FEE_PROOF_POLICY_SCHEMA,
  mode: "platform-issued-exact-graph-receipt-v1",
  receiptSchemaVersion: "programmable.platform-fee-conformance-receipt.v1",
  runnerId: "programmable.platform-fee-conformance",
  runnerVersion: "1.0.0",
  vectorSetVersion: "1.0.0",
  receiptAuthority: "platform-only",
  subject: "final-graph-commitment-and-runtime-set",
  activationStatus: "live",
});
const LEGACY_PLATFORM_ADMISSION_BLOCKING_FINDING_RULES = Object.freeze([
  Object.freeze({ code: "SOURCE_TARGET_ANALYSIS_INCOMPLETE", targetRoles: Object.freeze(["any"]) }),
  Object.freeze({ code: "V4_CALLBACK_AUTHENTICATION_REVIEW_REQUIRED", targetRoles: Object.freeze(["hook"]) }),
  Object.freeze({ code: "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING", targetRoles: Object.freeze(["hook"]) }),
  Object.freeze({ code: "SOURCE_MUTABLE_BLOCKLIST_SURFACE", targetRoles: Object.freeze(["token"]) }),
  Object.freeze({ code: "SOURCE_MUTABLE_TRANSFER_RESTRICTION", targetRoles: Object.freeze(["token"]) }),
  Object.freeze({ code: "SOURCE_PUBLIC_MINT_SURFACE", targetRoles: Object.freeze(["token"]) }),
  Object.freeze({ code: "SOURCE_MUTABLE_PAUSE_SURFACE", targetRoles: Object.freeze(["token"]) }),
  Object.freeze({ code: "SOURCE_MUTABLE_TAX_OR_FEE_SURFACE", targetRoles: Object.freeze(["token"]) }),
  Object.freeze({ code: "SOURCE_PROXY_OR_UPGRADE_SURFACE", targetRoles: Object.freeze(["token", "hook"]) }),
  Object.freeze({ code: "SOURCE_SELFDESTRUCT_SURFACE", targetRoles: Object.freeze(["token", "hook"]) }),
  Object.freeze({ code: "RUNTIME_CALLCODE", targetRoles: Object.freeze(["token", "hook"]) }),
  Object.freeze({ code: "RUNTIME_DELEGATECALL", targetRoles: Object.freeze(["token", "hook"]) }),
  Object.freeze({ code: "RUNTIME_SELFDESTRUCT", targetRoles: Object.freeze(["token", "hook"]) }),
]);
const PLATFORM_ADMISSION_BLOCKING_FINDING_RULES = Object.freeze([
  Object.freeze({ code: "RUNTIME_CALLCODE", targetRoles: Object.freeze(["any"]) }),
  Object.freeze({ code: "RUNTIME_SELFDESTRUCT", targetRoles: Object.freeze(["any"]) }),
  Object.freeze({ code: "SOURCE_SELFDESTRUCT_SURFACE", targetRoles: Object.freeze(["any"]) }),
  Object.freeze({ code: "V4_CALLBACK_AUTHENTICATION_MISSING", targetRoles: Object.freeze(["hook"]) }),
  Object.freeze({ code: "V4_CALLBACK_AUTHENTICATION_INVALID", targetRoles: Object.freeze(["hook"]) }),
  Object.freeze({ code: "V4_CALLBACK_POOL_MANAGER_MISMATCH", targetRoles: Object.freeze(["hook"]) }),
  Object.freeze({ code: "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING", targetRoles: Object.freeze(["hook"]) }),
]);
const PLATFORM_ADMISSION_POLICY = platformAdmissionPolicy(
  PLATFORM_ADMISSION_BLOCKING_FINDING_RULES,
);
const LEGACY_PLATFORM_ADMISSION_POLICY = platformAdmissionPolicy(
  LEGACY_PLATFORM_ADMISSION_BLOCKING_FINDING_RULES,
);
const PROJECT_METADATA_POLICY = Object.freeze({
  schemaVersion: "programmable.project-metadata-policy.v1",
  descriptionMinimumUtf8Bytes: 20,
  descriptionMaximumUtf8Bytes: 4_096,
  descriptionMinimumUnicodeLettersOrNumbers: 8,
  imageRequired: true,
  imageReceiptSourceManifestBindingRequired: true,
  imageMediaTypes: Object.freeze([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]),
  linksMaximumCount: 32,
  requiredLinkKinds: Object.freeze(["website", "x"]),
  exactlyOneRequiredLinkPerKind: true,
  websiteUriPolicy: "canonical-public-credential-free-https",
  xUriPattern: "^https://x\\.com/[A-Za-z0-9_]{1,64}$",
});

function platformAdmissionPolicy(blockingFindingRules) {
  return Object.freeze({
    schemaVersion: DIRECT_NATIVE_PLATFORM_ADMISSION_POLICY_SCHEMA,
    mode: "deterministic-exact-source-graph-static-baseline-v1",
    receiptSchemaVersion: "programmable.platform-admission-receipt.v1",
    engineId: "programmable.direct-native-static-admission",
    engineVersion: "1.0.0",
    exactSourceCompilerGraphBindingRequired: true,
    staticBaselineGateVersion: "1.0.0",
    blockingFindingRules,
    warningDisposition: "bound-and-visible",
    noBlockingFindingDisposition: "router-simulation-eligible",
    blockingFindingDisposition: "action-required",
    routerSimulationRequiredBeforeAuthorization: true,
    receiptAuthority: "platform-only",
    assurance: "launch-admission-only",
    safetyClaim: false,
    feeBehaviorClaim: false,
  });
}
const DIRECT_NATIVE_PROFILE_CONTRACTS = Object.freeze({
  [DIRECT_NATIVE_PROFILE_REVISION_V2]: Object.freeze({
    selectionSchema: DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA_V2,
    bindingSchema: DIRECT_NATIVE_PROFILE_BINDING_SCHEMA_V2,
    profileSchema: DIRECT_NATIVE_PROFILE_SCHEMA_V2,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION_V2,
    profileVersion: DIRECT_NATIVE_PROFILE_VERSION_V2,
    profileHashDomain: DIRECT_NATIVE_PROFILE_HASH_DOMAIN_V2,
    launchIntentHashDomain: DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN_V2,
  }),
  [DIRECT_NATIVE_PROFILE_REVISION_V3]: Object.freeze({
    selectionSchema: DIRECT_NATIVE_PROFILE_SELECTION_SCHEMA_V3,
    bindingSchema: DIRECT_NATIVE_PROFILE_BINDING_SCHEMA_V3,
    profileSchema: DIRECT_NATIVE_PROFILE_SCHEMA_V3,
    profileRevision: DIRECT_NATIVE_PROFILE_REVISION_V3,
    profileVersion: DIRECT_NATIVE_PROFILE_VERSION,
    profileHashDomain: DIRECT_NATIVE_PROFILE_HASH_DOMAIN_V3,
    launchIntentHashDomain: DIRECT_NATIVE_LAUNCH_INTENT_HASH_DOMAIN_V3,
  }),
});
const DEFAULT_EXTERNAL_LIQUIDITY_MODEL = Object.freeze({
  schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
  model: "external-concentrated-liquidity",
  declaredLaunchState: "liquidity_required",
});

export function validateDirectNativeProfileSelection(value) {
  const commonKeys = [
    "schemaVersion",
    "profileId",
    "profileRevision",
    "targetRoles",
    "fundingMode",
    "accountingMode",
    "assessmentBase",
    "feeCurrency",
    "claimMode",
    "applicantSelectedBuyHundredthsOfBip",
    "applicantSelectedSellHundredthsOfBip",
  ];
  const claimMode = canonicalClaimMode(value?.claimMode);
  const liquidityKeys = Object.hasOwn(value ?? {}, "liquidityModel")
    ? ["liquidityModel"]
    : [];
  assertExactKeys(value, claimMode === "immutable-payout-recipient"
    ? [...commonKeys, ...liquidityKeys, "payoutRecipient"]
    : [...commonKeys, ...liquidityKeys], "direct-native launchProfile");
  const profileContract = directNativeProfileContract(
    value,
    "selectionSchema",
    "direct-native launchProfile identity is not supported",
  );
  assertExactKeys(value.targetRoles, [
    "tokenTargetId",
    "hookTargetId",
    "initializerTargetId",
    "platformFeeBindingTargetId",
  ], "direct-native launchProfile.targetRoles");
  const targetRoles = Object.fromEntries(Object.entries(value.targetRoles).map(([key, targetId]) => [
    key,
    canonicalIdentifier(targetId, `direct-native launchProfile.targetRoles.${key}`),
  ]));
  if (new Set([
    targetRoles.tokenTargetId,
    targetRoles.hookTargetId,
    targetRoles.initializerTargetId,
  ]).size !== 3) {
    throw new TypeError("direct-native token, hook, and initializer target roles must be distinct");
  }
  const assessment = canonicalPlatformFeeAssessment(
    value.assessmentBase,
    value.feeCurrency,
  );
  return {
    schemaVersion: profileContract.selectionSchema,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: profileContract.profileRevision,
    targetRoles,
    fundingMode: canonicalFundingMode(value.fundingMode),
    accountingMode: canonicalAccountingMode(value.accountingMode),
    ...assessment,
    claimMode,
    liquidityModel: canonicalLiquidityModel(
      value.liquidityModel ?? DEFAULT_EXTERNAL_LIQUIDITY_MODEL,
    ),
    ...(claimMode === "immutable-payout-recipient"
      ? { payoutRecipient: canonicalImmutablePayoutRecipient(value.payoutRecipient) }
      : {}),
    applicantSelectedBuyHundredthsOfBip: canonicalApplicantSelectedFee(
      value.applicantSelectedBuyHundredthsOfBip,
      "direct-native launchProfile.applicantSelectedBuyHundredthsOfBip",
    ),
    applicantSelectedSellHundredthsOfBip: canonicalApplicantSelectedFee(
      value.applicantSelectedSellHundredthsOfBip,
      "direct-native launchProfile.applicantSelectedSellHundredthsOfBip",
    ),
  };
}

export function resolveDirectNativeProfile(selection, options = {}) {
  const normalized = validateDirectNativeProfileSelection(selection);
  const profileContract = directNativeProfileContract(
    normalized,
    "selectionSchema",
    "direct-native launchProfile identity is not supported",
  );
  const profileVersion = directNativeProfileVersion(
    profileContract,
    options.profileVersion,
  );
  const tradeFeePolicy = profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V36
    ? assertDirectNativeProgrammableTradeFeePolicyV36(options.programmableTradeFeePolicy ?? DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36) : null;
  const recipient = tradeFeePolicy?.defaultCollection.recipient ?? PLATFORM_FEE_CLAIM_AUTHORITY;
  if (normalized.claimMode === "immutable-payout-recipient" && normalized.payoutRecipient !== recipient) throw new TypeError("Payout recipient differs from the exact profile policy");
  const currentRouter = profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V36
    ? options.router ?? ROUTER_24H : ROUTER;
  if (![ROUTER, ROUTER_24H].includes(currentRouter)) throw new TypeError("Unknown Ethereum launch router");
  return {
    schemaVersion: profileContract.profileSchema,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: profileContract.profileRevision,
    profileVersion,
    productionLaunchAuthorized: true,
    chainId: MAINNET_CHAIN_ID,
    router: currentRouter,
    routerRuntimeCodeHash: currentRouter === ROUTER_24H ? ROUTER_24H_RUNTIME_CODE_HASH : ROUTER_RUNTIME_CODE_HASH,
    permitAuthority: PERMIT_AUTHORITY,
    permitAuthorityRuntimeCodeHash: PERMIT_AUTHORITY_RUNTIME_CODE_HASH,
    graphFactory: GRAPH_FACTORY,
    graphFactoryRuntimeCodeHash: GRAPH_FACTORY_RUNTIME_CODE_HASH,
    poolManager: POOL_MANAGER,
    poolManagerRuntimeCodeHash: POOL_MANAGER_RUNTIME_CODE_HASH,
    fundingToken: MAINNET_USDC,
    fundingTokenRuntimeCodeHash: MAINNET_USDC_RUNTIME_CODE_HASH,
    graphPolicy: {
      minimumTargets: [DIRECT_NATIVE_PROFILE_VERSION_V3, DIRECT_NATIVE_PROFILE_VERSION_V35].includes(profileVersion) ? 4 : 3,
      maximumTargets: 16,
      directTargetsOnly: true,
    },
    currencyPolicy: {
      native: true,
      erc20: true,
    },
    hookPermissionPolicy: {
      minimumMask: 0,
      maximumMask: 16_383,
      requireHookMinerAddressMaskMatch: true,
    },
    fundingPolicy: fundingPolicy(normalized.fundingMode),
    platformFeePolicy: platformFeePolicy(
      normalized.accountingMode,
      normalized.assessmentBase,
      normalized.feeCurrency,
      profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V36 ? tradeFeePolicy.ratePpm : profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V35 ? "3000" : PLATFORM_FEE_RATE_PPM,
      recipient,
    ),
    ...(profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V36
      ? { programmableTradeFeePolicy: tradeFeePolicy }
      : {}),
    ...([DIRECT_NATIVE_PROFILE_VERSION_V3, DIRECT_NATIVE_PROFILE_VERSION_V35, DIRECT_NATIVE_PROFILE_VERSION_V36,
      DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY].includes(profileVersion)
      ? { projectMetadataPolicy: PROJECT_METADATA_POLICY }
      : {}),
    ...(profileContract.profileRevision === DIRECT_NATIVE_PROFILE_REVISION_V2
      ? { platformFeeProofPolicy: PLATFORM_FEE_PROOF_POLICY }
      : { platformAdmissionPolicy: platformAdmissionPolicyForVersion(profileVersion) }),
  };
}

export function validateEmbeddedDirectNativeProfile(value) {
  if (value?.profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V36) {
    try { assertDirectNativeProgrammableTradeFeePolicyV36(value.programmableTradeFeePolicy); }
    catch { throw new TypeError("direct-native request does not contain the closed embedded launchProfile"); }
  }
  const profileContract = directNativeProfileContract(
    value,
    "profileSchema",
    "direct-native embedded launchProfile identity is not supported",
  );
  const expected = resolveDirectNativeProfile({
    schemaVersion: profileContract.selectionSchema,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: profileContract.profileRevision,
    targetRoles: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      initializerTargetId: "initializer",
      platformFeeBindingTargetId: "hook",
    },
    fundingMode: value?.fundingPolicy?.mode,
    accountingMode: value?.platformFeePolicy?.accountingMode,
    assessmentBase: value?.platformFeePolicy?.assessmentBase,
    feeCurrency: value?.platformFeePolicy?.feeCurrency,
    claimMode: "claim-authority-selected-recipient",
    applicantSelectedBuyHundredthsOfBip: "0",
    applicantSelectedSellHundredthsOfBip: "0",
  }, { profileVersion: value?.profileVersion, router: value?.router, programmableTradeFeePolicy: value?.programmableTradeFeePolicy });
  if (canonicalizeJson(value) !== canonicalizeJson(expected)) {
    throw new TypeError("direct-native request does not contain the closed embedded launchProfile");
  }
  return expected;
}

export function hashDirectNativeProfile(profile) {
  const profileContract = directNativeProfileContract(
    profile,
    "profileSchema",
    "direct-native embedded launchProfile identity is not supported",
  );
  directNativeProfileVersion(profileContract, profile?.profileVersion);
  return framedSha256(profileContract.profileHashDomain, profile);
}

export function buildDirectNativeProfileBinding(selection, context) {
  const normalized = validateDirectNativeProfileSelection(selection);
  const profile = context.profile ? validateEmbeddedDirectNativeProfile(context.profile) : null;
  const recipient = profile?.platformFeePolicy.claimAuthority ?? PLATFORM_FEE_CLAIM_AUTHORITY;
  if (normalized.claimMode === "immutable-payout-recipient" && normalized.payoutRecipient !== recipient) throw new TypeError("Payout recipient differs from the exact profile policy");
  const profileContract = directNativeProfileContract(
    normalized,
    "selectionSchema",
    "direct-native launchProfile identity is not supported",
  );
  const selectedVersion = profile?.profileVersion ?? context.profileVersion;
  const ratePpm = selectedVersion === DIRECT_NATIVE_PROFILE_VERSION_V36
    ? assertDirectNativeProgrammableTradeFeePolicyV36(profile?.programmableTradeFeePolicy ?? DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36).ratePpm
    : selectedVersion === DIRECT_NATIVE_PROFILE_VERSION_V35 ? "3000" : PLATFORM_FEE_RATE_PPM;
  const byId = new Map(context.graphBundle.targets.map((target) => [target.targetId, target]));
  const predictions = new Map(context.predictions.map((prediction) => [
    prediction.targetId,
    prediction.predictedAddress,
  ]));
  const { targetRoles } = normalized;
  requireTarget(byId, targetRoles.tokenTargetId, "token");
  const hook = requireTarget(byId, targetRoles.hookTargetId, "hook");
  requireTarget(byId, targetRoles.initializerTargetId, "initializer");
  requireTarget(byId, targetRoles.platformFeeBindingTargetId, "platform fee binding");
  const tokenAddress = requirePrediction(predictions, targetRoles.tokenTargetId);
  const hookAddress = requirePrediction(predictions, targetRoles.hookTargetId);
  const predictedInitializer = requirePrediction(predictions, targetRoles.initializerTargetId);
  const hookPermissionMask = permissionMask(hook.declaredHookPermissions);
  const [currency0, currency1] = sortedCurrencies(context.quoteCurrency, tokenAddress);
  const poolKey = {
    currency0,
    currency1,
    fee: context.graphBundle.pool.fee,
    tickSpacing: context.graphBundle.pool.tickSpacing,
    hooks: hookAddress,
  };
  return {
    schemaVersion: profileContract.bindingSchema,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: profileContract.profileRevision,
    targetRoles,
    fundingMode: normalized.fundingMode,
    routeNamespace: context.routeNamespace,
    routeNonce: context.routeNonce,
    hookPermissionMask,
    predictedInitializer,
    poolKey,
    expectedPoolId: poolId(poolKey),
    liquidityModel: normalized.liquidityModel,
    ...(normalized.fundingMode === FUNDING_AUTHORIZATION_METHOD
      ? {
          fundingSignaturePatch: validateFundingSignaturePatch(
            context.fundingSignaturePatch,
            targetRoles.initializerTargetId,
            context.graphBundle,
          ),
        }
      : {}),
    platformFeeBinding: {
      ...platformFeePolicy(
        normalized.accountingMode,
        normalized.assessmentBase,
        normalized.feeCurrency,
        ratePpm,
        recipient,
      ),
      schemaVersion: PLATFORM_FEE_BINDING_SCHEMA,
      targetId: targetRoles.platformFeeBindingTargetId,
      claimBinding: platformFeeClaimBinding(normalized, recipient),
      economics: {
        buy: platformFeeEconomics(
          normalized.applicantSelectedBuyHundredthsOfBip,
          normalized.accountingMode,
          ratePpm,
        ),
        sell: platformFeeEconomics(
          normalized.applicantSelectedSellHundredthsOfBip,
          normalized.accountingMode,
          ratePpm,
        ),
      },
    },
  };
}

export function validateDirectNativeProfileBinding(value, context) {
  const profileContract = directNativeProfileContract(
    value,
    "bindingSchema",
    "direct-native launchProfileSelection identity is not supported",
  );
  const expected = buildDirectNativeProfileBinding({
    schemaVersion: profileContract.selectionSchema,
    profileId: DIRECT_NATIVE_PROFILE_ID,
    profileRevision: profileContract.profileRevision,
    targetRoles: value?.targetRoles,
    fundingMode: value?.fundingMode,
    accountingMode: value?.platformFeeBinding?.accountingMode,
    assessmentBase: value?.platformFeeBinding?.assessmentBase,
    feeCurrency: value?.platformFeeBinding?.feeCurrency,
    claimMode: value?.platformFeeBinding?.claimBinding?.mode,
    liquidityModel: value?.liquidityModel,
    ...(value?.platformFeeBinding?.claimBinding?.mode === "immutable-payout-recipient"
      ? { payoutRecipient: value?.platformFeeBinding?.claimBinding?.payoutRecipient }
      : {}),
    applicantSelectedBuyHundredthsOfBip:
      value?.platformFeeBinding?.economics?.buy?.applicantSelectedHundredthsOfBip,
    applicantSelectedSellHundredthsOfBip:
      value?.platformFeeBinding?.economics?.sell?.applicantSelectedHundredthsOfBip,
  }, context);
  if (canonicalizeJson(value) !== canonicalizeJson(expected)) {
    throw new TypeError("direct-native launchProfileSelection does not match the graph and route");
  }
  return expected;
}

export function validateDirectNativeProfileGraph(profile, binding, graphBundle) {
  validateEmbeddedDirectNativeProfile(profile);
  if (profile.platformFeePolicy.claimAuthority !== binding.platformFeeBinding.claimAuthority
    || profile.platformFeePolicy.claimAuthority !== binding.platformFeeBinding.claimBinding.claimAuthority
    || profile.profileRevision !== binding.profileRevision
    || profile.fundingPolicy.mode !== binding.fundingMode
    || profile.platformFeePolicy.accountingMode
      !== binding.platformFeeBinding.accountingMode
    || profile.platformFeePolicy.assessmentBase
      !== binding.platformFeeBinding.assessmentBase
    || profile.platformFeePolicy.feeCurrency
      !== binding.platformFeeBinding.feeCurrency
    || profile.platformFeePolicy.programmableFeeHundredthsOfBip !== binding.platformFeeBinding.programmableFeeHundredthsOfBip) {
    throw new TypeError("direct-native embedded policy does not match its launch binding");
  }
  if (profile.profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V35
    && (binding.platformFeeBinding.claimBinding.mode !== "immutable-payout-recipient"
      || binding.platformFeeBinding.claimBinding.payoutRecipient !== PLATFORM_FEE_CLAIM_AUTHORITY)) {
    throw new TypeError("Profile 3.5 requires the immutable platform payout recipient");
  }
  const minimumTargets = [DIRECT_NATIVE_PROFILE_VERSION_V3, DIRECT_NATIVE_PROFILE_VERSION_V35].includes(profile.profileVersion) ? 4 : 3;
  if (!Array.isArray(graphBundle.targets)
    || graphBundle.targets.length < minimumTargets
    || graphBundle.targets.length > 16) {
    throw new TypeError(
      `direct-native graph must contain between ${minimumTargets} and 16 direct targets`,
    );
  }
  if (!Number.isSafeInteger(graphBundle.pool?.fee)
    || graphBundle.pool.fee < 0
    || (graphBundle.pool.fee > 999_999 && graphBundle.pool.fee !== 0x800000)) {
    throw new TypeError(
      "direct-native pool fee must be between 0 and 999999 or the dynamic-fee sentinel 0x800000",
    );
  }
  const byId = new Map(graphBundle.targets.map((target) => [target.targetId, target]));
  const roles = binding.targetRoles;
  const token = requireTarget(byId, roles.tokenTargetId, "token");
  const hook = requireTarget(byId, roles.hookTargetId, "hook");
  const initializer = requireTarget(byId, roles.initializerTargetId, "initializer");
  if (token.componentKind !== "token" || hook.componentKind !== "hook"
    || initializer.componentKind !== "other") {
    throw new TypeError("direct-native target roles do not match token, hook, and initializer kinds");
  }
  if (graphBundle.pool.tokenTargetId !== roles.tokenTargetId
    || graphBundle.pool.hookTargetId !== roles.hookTargetId) {
    throw new TypeError("direct-native target roles do not match the graph pool");
  }
  const declaredMask = permissionMask(hook.declaredHookPermissions);
  if (!Number.isSafeInteger(binding.hookPermissionMask)
    || binding.hookPermissionMask < 0
    || binding.hookPermissionMask > 16_383
    || binding.hookPermissionMask !== declaredMask) {
    throw new TypeError("direct-native hook permission mask must match the applicant hook declaration");
  }
  if (declaredMask === 0 && graphBundle.pool.fee !== 0x800000) {
    throw new TypeError(
      "direct-native zero-permission hooks require the dynamic-fee sentinel 0x800000",
    );
  }
  requireTarget(byId, roles.platformFeeBindingTargetId, "platform fee binding");
  if (binding.platformFeeBinding.targetId !== roles.platformFeeBindingTargetId) {
    throw new TypeError("direct-native platform fee policy must bind its selected direct target");
  }
  if ([DIRECT_NATIVE_PROFILE_VERSION_V3, DIRECT_NATIVE_PROFILE_VERSION_V35].includes(profile.profileVersion)) {
    if (new Set([
      roles.tokenTargetId,
      roles.hookTargetId,
      roles.initializerTargetId,
      roles.platformFeeBindingTargetId,
    ]).size !== 4) {
      throw new TypeError(
        "profile 3.4.0 requires a distinct canonical platform fee module target",
      );
    }
    (profile.profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V35
      ? validateCanonicalSettlementFeeVaultV2Graph : validateCanonicalSettlementFeeVaultV1Graph)(
      graphBundle,
      roles.platformFeeBindingTargetId,
    );
  }
  validateFundingGraph(binding.fundingMode, graphBundle);
  validateLiquidityModelGraph(binding.liquidityModel, roles, byId);
  return binding;
}

export function validateDirectNativeProfileBuilds(
  profile,
  binding,
  graphBundle,
  verificationBundle,
) {
  const components = new Map(
    verificationBundle.components.map((component) => [component.targetId, component]),
  );
  const targets = new Map(graphBundle.targets.map((target) => [target.targetId, target]));
  const subjectTargetIds = new Set([
    binding.targetRoles.hookTargetId,
    binding.targetRoles.platformFeeBindingTargetId,
  ]);
  for (const targetId of subjectTargetIds) {
    const target = targets.get(targetId);
    const component = components.get(targetId);
    if (!target || !component?.runtimeMaterialization
      || component.runtimeMaterialization.deployedRuntimeCodeHash
        !== target.expectedRuntimeCodeHash) {
      throw new TypeError(
        `PROFILE_BUILD_MISMATCH: ${targetId} is not bound to its exact materialized runtime`,
      );
    }
  }
  if ([DIRECT_NATIVE_PROFILE_VERSION_V3, DIRECT_NATIVE_PROFILE_VERSION_V35].includes(profile.profileVersion)) {
    (profile.profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V35
      ? validateCanonicalSettlementFeeVaultV2Build : validateCanonicalSettlementFeeVaultV1Build)(
      graphBundle,
      verificationBundle,
      binding.targetRoles.platformFeeBindingTargetId,
    );
  }
  return { subjectTargetIds: [...subjectTargetIds] };
}

export function validateFundingAuthorizationInput(value, { nowSeconds } = {}) {
  assertExactKeys(value, [
    "schemaVersion",
    "method",
    "value",
    "validAfter",
    "validBefore",
  ], "fundingAuthorization input");
  if (value.schemaVersion !== FUNDING_AUTHORIZATION_INPUT_SCHEMA
    || value.method !== FUNDING_AUTHORIZATION_METHOD) {
    throw new TypeError("fundingAuthorization input method is not supported");
  }
  const normalized = {
    schemaVersion: FUNDING_AUTHORIZATION_INPUT_SCHEMA,
    method: FUNDING_AUTHORIZATION_METHOD,
    value: canonicalUint(value.value, "fundingAuthorization.value", false),
    validAfter: canonicalUint64(value.validAfter, "fundingAuthorization.validAfter"),
    validBefore: canonicalUint64(value.validBefore, "fundingAuthorization.validBefore", false),
  };
  validateAuthorizationWindow(normalized, nowSeconds);
  return normalized;
}

export function validateDirectNativePermitWindow(value, { nowSeconds } = {}) {
  assertExactKeys(value, ["validAfter", "deadline"], "permitWindow");
  const normalized = {
    validAfter: canonicalUint64(value.validAfter, "permitWindow.validAfter"),
    deadline: canonicalUint64(value.deadline, "permitWindow.deadline", false),
  };
  validateAuthorizationWindow({
    validAfter: normalized.validAfter,
    validBefore: normalized.deadline,
  }, nowSeconds, 86_400n);
  return normalized;
}

export function buildFundingSignaturePatch(input, graphBundle, initializerArtifact) {
  if (isFundingAuthorizationPatchV2Input(input)) {
    return buildFundingAuthorizationPatchV2(input, graphBundle, initializerArtifact);
  }
  const patch = deriveFundingSignaturePatch(input, graphBundle);
  validateFundingSignaturePatchAbi(patch, graphBundle, initializerArtifact);
  return patch;
}

function buildFundingAuthorizationPatchV2(input, graphBundle, initializerArtifact) {
  try {
    return deriveFundingAuthorizationPatchV2(input, graphBundle, initializerArtifact);
  } catch (error) {
    if (error?.code === "FUNDING_AUTHORIZATION_PATCH_PATH_INVALID") throw error;
    throw createCliDiagnosticError({
      code: "FUNDING_AUTHORIZATION_PATCH_PATH_INVALID",
      stage: "signature-patch",
      targetId: typeof input?.targetId === "string" ? input.targetId : undefined,
      targetRole: "initializer",
      sourcePath: initializerArtifact?.sourcePath,
      summary: "The EIP-3009 v2 authorization paths must resolve to four distinct zero-valued static ABI leaves in the exact initializer function.",
      expected: {
        pathFormat: "nonempty array of zero-based ABI component indices",
        leafTypes: {
          nonceArgumentPath: "bytes32",
          rArgumentPath: "bytes32",
          sArgumentPath: "bytes32",
          vArgumentPath: "uint8",
        },
        parentTypes: "top-level input, static tuple, or fixed-size static array",
        unsignedLeafValue: "zero",
      },
      observed: {
        paths: {
          nonceArgumentPath: input?.nonceArgumentPath ?? null,
          rArgumentPath: input?.rArgumentPath ?? null,
          sArgumentPath: input?.sArgumentPath ?? null,
          vArgumentPath: input?.vArgumentPath ?? null,
        },
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function deriveFundingAuthorizationPatchV2(input, graphBundle, initializerArtifact) {
  assertExactKeys(input, [
    "targetId",
    "nonceArgumentPath",
    "rArgumentPath",
    "sArgumentPath",
    "vArgumentPath",
  ], "fundingSignaturePatch v2 input");
  const targetId = canonicalIdentifier(input.targetId, "fundingSignaturePatch.targetId");
  const target = graphBundle.targets.find((candidate) => candidate.targetId === targetId);
  if (!target) throw new TypeError("fundingSignaturePatch target is absent from graph");
  const calldata = Buffer.from(target.initializerCalldata.slice(2), "hex");
  const patch = {
    schemaVersion: FUNDING_SIGNATURE_PATCH_SCHEMA_V2,
    targetId,
    unsignedInitializerCalldataSha256: sha256Digest(calldata),
    initializerCalldataLengthBytes: calldata.byteLength,
    authorizationEncoding: "eip3009-nonce-r-s-v-abi-leaves",
    nonceArgumentPath: canonicalAbiArgumentPath(input.nonceArgumentPath, "nonceArgumentPath"),
    rArgumentPath: canonicalAbiArgumentPath(input.rArgumentPath, "rArgumentPath"),
    sArgumentPath: canonicalAbiArgumentPath(input.sArgumentPath, "sArgumentPath"),
    vArgumentPath: canonicalAbiArgumentPath(input.vArgumentPath, "vArgumentPath"),
  };
  if (new Set([
    patch.nonceArgumentPath,
    patch.rArgumentPath,
    patch.sArgumentPath,
    patch.vArgumentPath,
  ].map((argumentPath) => argumentPath.join("/"))).size !== 4) {
    throw new TypeError("fundingSignaturePatch v2 argument paths must be distinct");
  }
  validateFundingAuthorizationPatchV2Abi(patch, graphBundle, initializerArtifact);
  return patch;
}

function isFundingAuthorizationPatchV2Input(input) {
  return input !== null
    && typeof input === "object"
    && !Array.isArray(input)
    && [
      "nonceArgumentPath",
      "rArgumentPath",
      "sArgumentPath",
      "vArgumentPath",
    ].some((key) => Object.hasOwn(input, key));
}

function deriveFundingSignaturePatch(input, graphBundle) {
  assertExactKeys(input, [
    "targetId",
    "rOffsetBytes",
    "sOffsetBytes",
    "vOffsetBytes",
  ], "fundingSignaturePatch input");
  const targetId = canonicalIdentifier(input.targetId, "fundingSignaturePatch.targetId");
  const target = graphBundle.targets.find((candidate) => candidate.targetId === targetId);
  if (!target) throw new TypeError("fundingSignaturePatch target is absent from graph");
  const calldata = Buffer.from(target.initializerCalldata.slice(2), "hex");
  const offsets = {
    rOffsetBytes: canonicalPatchOffset(input.rOffsetBytes, calldata, "r"),
    sOffsetBytes: canonicalPatchOffset(input.sOffsetBytes, calldata, "s"),
    vOffsetBytes: canonicalPatchOffset(input.vOffsetBytes, calldata, "v"),
  };
  if (new Set(Object.values(offsets)).size !== 3) {
    throw new TypeError("fundingSignaturePatch offsets must be distinct");
  }
  return {
    schemaVersion: FUNDING_SIGNATURE_PATCH_SCHEMA,
    targetId,
    unsignedInitializerCalldataSha256: sha256Digest(calldata),
    initializerCalldataLengthBytes: calldata.byteLength,
    signatureEncoding: "eip3009-r-s-v-abi-words",
    ...offsets,
  };
}

export function buildFundingAuthorization(input, context) {
  const normalized = validateFundingAuthorizationInput(input, context);
  const from = getAddress(context.launchWallet);
  const to = getAddress(context.predictedInitializer);
  const fundingIntentHash = keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32,uint256,address,address,address,bytes32,bytes32,bytes32,address,address,uint256,uint256,uint256",
    ),
    [
      keccak256(stringToHex(FUNDING_INTENT_HASH_DOMAIN)),
      BigInt(MAINNET_CHAIN_ID),
      MAINNET_USDC,
      context.router ?? ROUTER,
      GRAPH_FACTORY,
      context.routeNamespace,
      context.routeNonce,
      sha256ToHex32(context.launchIntentHash, "launchIntentHash"),
      from,
      to,
      BigInt(normalized.value),
      BigInt(normalized.validAfter),
      BigInt(normalized.validBefore),
    ],
  ));
  const nonce = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,bytes32"),
    [keccak256(stringToHex(FUNDING_NONCE_DOMAIN)), fundingIntentHash],
  ));
  const fundingAuthorization = {
    schemaVersion: FUNDING_AUTHORIZATION_DESCRIPTOR_SCHEMA,
    method: FUNDING_AUTHORIZATION_METHOD,
    token: MAINNET_USDC,
    from,
    to,
    value: normalized.value,
    validAfter: normalized.validAfter,
    validBefore: normalized.validBefore,
    nonce,
  };
  return { fundingIntentHash, fundingAuthorization };
}

export function validateFundingAuthorization(value, fundingIntentHash, context) {
  assertExactKeys(value, [
    "schemaVersion",
    "method",
    "token",
    "from",
    "to",
    "value",
    "validAfter",
    "validBefore",
    "nonce",
  ], "fundingAuthorization");
  const rebuilt = buildFundingAuthorization({
    schemaVersion: FUNDING_AUTHORIZATION_INPUT_SCHEMA,
    method: FUNDING_AUTHORIZATION_METHOD,
    value: value.value,
    validAfter: value.validAfter,
    validBefore: value.validBefore,
  }, context);
  if (fundingIntentHash !== rebuilt.fundingIntentHash
    || canonicalizeJson(value) !== canonicalizeJson(rebuilt.fundingAuthorization)) {
    throw new TypeError("fundingAuthorization does not match the pre-signature funding intent");
  }
  return rebuilt;
}

export function buildDirectNativeLaunchIntentHash(value) {
  const profileContract = directNativeProfileContract(
    value?.launchProfileSelection,
    "bindingSchema",
    "direct-native launchProfileSelection identity is not supported",
  );
  return framedSha256(profileContract.launchIntentHashDomain, value);
}

function framedSha256(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function requireTarget(byId, targetId, label) {
  const target = byId.get(targetId);
  if (!target) throw new TypeError(`direct-native ${label} target is absent from graph`);
  return target;
}

function requirePrediction(predictions, targetId) {
  const predicted = predictions.get(targetId);
  if (typeof predicted !== "string") {
    throw new TypeError(`direct-native graph has no prediction for ${targetId}`);
  }
  return getAddress(predicted);
}

function permissionMask(permissions) {
  if (!Array.isArray(permissions)) return -1;
  return permissions.reduce((mask, permission) => {
    const bit = HOOK_PERMISSION_BITS[permission];
    return bit === undefined ? -1 : mask | (1 << bit);
  }, 0);
}

function sortedCurrencies(left, right) {
  const addresses = [getAddress(left), getAddress(right)].sort(
    (a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
  );
  if (addresses[0].toLowerCase() === addresses[1].toLowerCase()) {
    throw new TypeError("direct-native pool currencies must be distinct");
  }
  return addresses;
}

function poolId(poolKey) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("address,address,uint24,int24,address"),
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  ));
}

function validateFundingSignaturePatch(value, initializerTargetId, graphBundle) {
  if (value?.schemaVersion === FUNDING_SIGNATURE_PATCH_SCHEMA_V2) {
    return validateFundingAuthorizationPatchV2(value, initializerTargetId, graphBundle);
  }
  assertExactKeys(value, [
    "schemaVersion",
    "targetId",
    "unsignedInitializerCalldataSha256",
    "initializerCalldataLengthBytes",
    "signatureEncoding",
    "rOffsetBytes",
    "sOffsetBytes",
    "vOffsetBytes",
  ], "fundingSignaturePatch");
  if (value.schemaVersion !== FUNDING_SIGNATURE_PATCH_SCHEMA
    || value.targetId !== initializerTargetId
    || value.signatureEncoding !== "eip3009-r-s-v-abi-words") {
    throw new TypeError("fundingSignaturePatch identity does not match the initializer role");
  }
  const expected = deriveFundingSignaturePatch({
    targetId: value.targetId,
    rOffsetBytes: value.rOffsetBytes,
    sOffsetBytes: value.sOffsetBytes,
    vOffsetBytes: value.vOffsetBytes,
  }, graphBundle);
  if (canonicalizeJson(value) !== canonicalizeJson(expected)) {
    throw new TypeError("fundingSignaturePatch does not match unsigned initializer calldata");
  }
  return expected;
}

function validateFundingAuthorizationPatchV2(value, initializerTargetId, graphBundle) {
  assertExactKeys(value, [
    "schemaVersion",
    "targetId",
    "unsignedInitializerCalldataSha256",
    "initializerCalldataLengthBytes",
    "authorizationEncoding",
    "nonceArgumentPath",
    "rArgumentPath",
    "sArgumentPath",
    "vArgumentPath",
  ], "fundingSignaturePatch v2");
  if (value.targetId !== initializerTargetId
    || value.authorizationEncoding !== "eip3009-nonce-r-s-v-abi-leaves") {
    throw new TypeError("fundingSignaturePatch v2 identity does not match the initializer role");
  }
  const target = graphBundle.targets.find(({ targetId }) => targetId === value.targetId);
  if (!target) throw new TypeError("fundingSignaturePatch v2 target is absent from graph");
  const calldata = Buffer.from(target.initializerCalldata.slice(2), "hex");
  const expected = {
    schemaVersion: FUNDING_SIGNATURE_PATCH_SCHEMA_V2,
    targetId: value.targetId,
    unsignedInitializerCalldataSha256: sha256Digest(calldata),
    initializerCalldataLengthBytes: calldata.byteLength,
    authorizationEncoding: "eip3009-nonce-r-s-v-abi-leaves",
    nonceArgumentPath: canonicalAbiArgumentPath(value.nonceArgumentPath, "nonceArgumentPath"),
    rArgumentPath: canonicalAbiArgumentPath(value.rArgumentPath, "rArgumentPath"),
    sArgumentPath: canonicalAbiArgumentPath(value.sArgumentPath, "sArgumentPath"),
    vArgumentPath: canonicalAbiArgumentPath(value.vArgumentPath, "vArgumentPath"),
  };
  if (new Set([
    expected.nonceArgumentPath,
    expected.rArgumentPath,
    expected.sArgumentPath,
    expected.vArgumentPath,
  ].map((argumentPath) => argumentPath.join("/"))).size !== 4) {
    throw new TypeError("fundingSignaturePatch v2 argument paths must be distinct");
  }
  if (canonicalizeJson(value) !== canonicalizeJson(expected)) {
    throw new TypeError("fundingSignaturePatch v2 does not match unsigned initializer calldata");
  }
  return expected;
}

function validateFundingSignaturePatchAbi(patch, graphBundle, initializerArtifact) {
  if (initializerArtifact === null
    || typeof initializerArtifact !== "object"
    || initializerArtifact.targetId !== patch.targetId
    || !Array.isArray(initializerArtifact.abi)
    || initializerArtifact.initializer === null
    || typeof initializerArtifact.initializer !== "object"
    || Array.isArray(initializerArtifact.initializer)
    || typeof initializerArtifact.initializer.function !== "string") {
    throw new TypeError(
      "fundingSignaturePatch requires the exact initializer target artifact and function",
    );
  }
  const selector = graphBundle.targets.find(
    ({ targetId }) => targetId === patch.targetId,
  )?.initializerCalldata?.slice(0, 10);
  const candidates = initializerArtifact.abi.filter((entry) => {
    if (entry?.type !== "function") return false;
    try {
      return toFunctionSelector(entry) === selector;
    } catch {
      return false;
    }
  });
  if (candidates.length !== 1) {
    throw new TypeError(
      "fundingSignaturePatch initializer selector must resolve to exactly one artifact ABI entry",
    );
  }
  const selected = candidates[0];
  if (selected.name !== initializerArtifact.initializer.function) {
    throw new TypeError(
      "fundingSignaturePatch initializer selector does not match the configured artifact function",
    );
  }
  const target = graphBundle.targets.find(({ targetId }) => targetId === patch.targetId);
  if (!target) throw new TypeError("fundingSignaturePatch initializer target is absent from graph");
  const calldata = target.initializerCalldata;
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: [selected], data: calldata });
  } catch {
    throw new TypeError(
      "fundingSignaturePatch initializer calldata does not match the exact artifact ABI selector",
    );
  }
  if (decoded.functionName !== selected.name) {
    throw new TypeError("fundingSignaturePatch initializer selector does not match its configured function");
  }
  const decodedArguments = decoded.args ?? [];
  let canonicalCalldata;
  try {
    canonicalCalldata = encodeFunctionData({
      abi: [selected],
      functionName: selected.name,
      args: decodedArguments,
    }).toLowerCase();
  } catch {
    throw new TypeError("fundingSignaturePatch initializer calldata cannot be canonically re-encoded");
  }
  if (canonicalCalldata !== calldata) {
    throw new TypeError(
      "fundingSignaturePatch initializer calldata is not the exact canonical full ABI encoding",
    );
  }
  const legacySlots = [
    { label: "r", offset: patch.rOffsetBytes, expectedType: "bytes32" },
    { label: "s", offset: patch.sOffsetBytes, expectedType: "bytes32" },
    { label: "v", offset: patch.vOffsetBytes, expectedType: "uint8" },
  ].map((slot) => ({
    ...slot,
    observed: describeAbiWordLocation(selected.inputs ?? [], slot.offset),
  }));
  const incompatibleSlots = legacySlots.filter(({ expectedType, observed }) =>
    observed.location !== "top-level-argument"
      || observed.abiType !== expectedType);
  if (incompatibleSlots.length !== 0) {
    throw createCliDiagnosticError({
      code: "FUNDING_SIGNATURE_PATCH_NOT_TOP_LEVEL",
      stage: "signature-patch",
      targetId: patch.targetId,
      targetRole: "initializer",
      sourcePath: initializerArtifact.sourcePath,
      summary: "Legacy EIP-3009 offsets do not identify top-level bytes32 r/s and top-level uint8 v ABI scalar arguments; use the v2 nonce+r+s+v argument-path descriptor.",
      expected: {
        legacyV1: {
          r: { location: "top-level-argument", abiType: "bytes32" },
          s: { location: "top-level-argument", abiType: "bytes32" },
          v: { location: "top-level-argument", abiType: "uint8" },
        },
        preferredV2ConfigFields: [
          "targetId",
          "nonceArgumentPath",
          "rArgumentPath",
          "sArgumentPath",
          "vArgumentPath",
        ],
      },
      observed: {
        initializerFunction: selected.name,
        incompatibleSlots,
      },
    });
  }
  assertPatchWordAbiType({
    calldata,
    abiEntry: selected,
    decodedArguments,
    offset: patch.rOffsetBytes,
    expectedType: "bytes32",
    replacementWord: Buffer.from("11".repeat(32), "hex"),
    label: "r",
  });
  assertPatchWordAbiType({
    calldata,
    abiEntry: selected,
    decodedArguments,
    offset: patch.sOffsetBytes,
    expectedType: "bytes32",
    replacementWord: Buffer.from("22".repeat(32), "hex"),
    label: "s",
  });
  assertPatchWordAbiType({
    calldata,
    abiEntry: selected,
    decodedArguments,
    offset: patch.vOffsetBytes,
    expectedType: "uint8",
    replacementWord: Buffer.concat([Buffer.alloc(31), Buffer.from([27])]),
    label: "v",
  });
  assertCombinedFundingSignaturePatchAbi({
    calldata,
    abiEntry: selected,
    replacements: [
      [patch.rOffsetBytes, Buffer.from("11".repeat(32), "hex")],
      [patch.sOffsetBytes, Buffer.from("22".repeat(32), "hex")],
      [patch.vOffsetBytes, Buffer.concat([Buffer.alloc(31), Buffer.from([27])])],
    ],
  });
}

function validateFundingAuthorizationPatchV2Abi(patch, graphBundle, initializerArtifact) {
  if (initializerArtifact === null
    || typeof initializerArtifact !== "object"
    || initializerArtifact.targetId !== patch.targetId
    || !Array.isArray(initializerArtifact.abi)
    || initializerArtifact.initializer === null
    || typeof initializerArtifact.initializer !== "object"
    || Array.isArray(initializerArtifact.initializer)
    || typeof initializerArtifact.initializer.function !== "string") {
    throw new TypeError(
      "fundingSignaturePatch v2 requires the exact initializer target artifact and function",
    );
  }
  const target = graphBundle.targets.find(({ targetId }) => targetId === patch.targetId);
  if (!target) throw new TypeError("fundingSignaturePatch v2 initializer target is absent from graph");
  const selector = target.initializerCalldata.slice(0, 10);
  const candidates = initializerArtifact.abi.filter((entry) => {
    if (entry?.type !== "function") return false;
    try {
      return toFunctionSelector(entry) === selector;
    } catch {
      return false;
    }
  });
  if (candidates.length !== 1) {
    throw new TypeError(
      "fundingSignaturePatch v2 initializer selector must resolve to exactly one artifact ABI entry",
    );
  }
  const selected = candidates[0];
  if (selected.name !== initializerArtifact.initializer.function) {
    throw new TypeError(
      "fundingSignaturePatch v2 initializer selector does not match the configured artifact function",
    );
  }
  const calldata = target.initializerCalldata;
  assertCanonicalInitializerCalldata(calldata, selected, "fundingSignaturePatch v2");
  const leaves = [
    {
      label: "nonce",
      path: patch.nonceArgumentPath,
      expectedType: "bytes32",
      replacementWord: Buffer.from("33".repeat(32), "hex"),
    },
    {
      label: "r",
      path: patch.rArgumentPath,
      expectedType: "bytes32",
      replacementWord: Buffer.from("11".repeat(32), "hex"),
    },
    {
      label: "s",
      path: patch.sArgumentPath,
      expectedType: "bytes32",
      replacementWord: Buffer.from("22".repeat(32), "hex"),
    },
    {
      label: "v",
      path: patch.vArgumentPath,
      expectedType: "uint8",
      replacementWord: Buffer.concat([Buffer.alloc(31), Buffer.from([27])]),
    },
  ].map((leaf) => ({
    ...leaf,
    offset: abiStaticLeafOffset(
      selected.inputs ?? [],
      leaf.path,
      leaf.expectedType,
      `fundingSignaturePatch v2 ${leaf.label}ArgumentPath`,
    ),
  }));
  if (new Set(leaves.map(({ offset }) => offset)).size !== leaves.length) {
    throw new TypeError("fundingSignaturePatch v2 argument paths resolve to overlapping ABI words");
  }
  assertFundingAuthorizationPatchLocatorDisjointness(
    leaves,
    target.initializerAddressLocators ?? [],
  );
  for (const leaf of leaves) {
    canonicalPatchOffset(
      leaf.offset,
      Buffer.from(calldata.slice(2), "hex"),
      `v2 ${leaf.label}`,
    );
    assertCanonicalAbiWordPatch({
      calldata,
      abiEntry: selected,
      offset: leaf.offset,
      replacementWord: leaf.replacementWord,
      label: `fundingSignaturePatch v2 ${leaf.label}`,
    });
  }
  assertCombinedFundingSignaturePatchAbi({
    calldata,
    abiEntry: selected,
    replacements: leaves.map(({ offset, replacementWord }) => [offset, replacementWord]),
  });
}

function assertFundingAuthorizationPatchLocatorDisjointness(leaves, locators) {
  for (const locator of locators) {
    const locatorLength = locator.encoding === "abi-address-word"
      ? 32
      : locator.encoding === "packed-address-20"
        ? 20
        : null;
    if (locatorLength === null
      || !Number.isSafeInteger(locator.byteOffset)
      || locator.byteOffset < 0) {
      throw new TypeError("fundingSignaturePatch v2 target has an invalid initializer address locator");
    }
    const locatorEnd = locator.byteOffset + locatorLength;
    for (const leaf of leaves) {
      const leafEnd = leaf.offset + 32;
      if (leaf.offset < locatorEnd && locator.byteOffset < leafEnd) {
        throw new TypeError(
          `fundingSignaturePatch v2 ${leaf.label} ABI leaf overlaps an ${locator.encoding} initializer address locator`,
        );
      }
    }
  }
}

function assertCanonicalInitializerCalldata(calldata, abiEntry, label) {
  let decoded;
  let reencoded;
  try {
    decoded = decodeFunctionData({ abi: [abiEntry], data: calldata });
    reencoded = encodeFunctionData({
      abi: [abiEntry],
      functionName: abiEntry.name,
      args: decoded.args ?? [],
    }).toLowerCase();
  } catch {
    throw new TypeError(`${label} initializer calldata does not match the compiled ABI`);
  }
  if (decoded.functionName !== abiEntry.name || reencoded !== calldata) {
    throw new TypeError(`${label} initializer calldata is not exact canonical ABI encoding`);
  }
}

function assertCanonicalAbiWordPatch({ calldata, abiEntry, offset, replacementWord, label }) {
  const bytes = Buffer.from(calldata.slice(2), "hex");
  replacementWord.copy(bytes, offset);
  const patchedCalldata = `0x${bytes.toString("hex")}`;
  let decoded;
  let reencoded;
  try {
    decoded = decodeFunctionData({ abi: [abiEntry], data: patchedCalldata });
    reencoded = encodeFunctionData({
      abi: [abiEntry],
      functionName: abiEntry.name,
      args: decoded.args ?? [],
    }).toLowerCase();
  } catch {
    throw new TypeError(`${label} is not a decodable canonical static ABI leaf`);
  }
  if (reencoded !== patchedCalldata) {
    throw new TypeError(`${label} is not a canonical static ABI leaf`);
  }
}

function assertPatchWordAbiType({
  calldata,
  abiEntry,
  decodedArguments,
  offset,
  expectedType,
  replacementWord,
  label,
}) {
  const inputs = abiEntry.inputs ?? [];
  const inputIndex = topLevelInputIndexAtOffset(inputs, offset, expectedType);
  if (inputIndex === -1) {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset must identify a top-level ${expectedType} ABI word`,
    );
  }
  const bytes = Buffer.from(calldata.slice(2), "hex");
  replacementWord.copy(bytes, offset);
  const patchedCalldata = `0x${bytes.toString("hex")}`;
  let patched;
  try {
    patched = decodeFunctionData({ abi: [abiEntry], data: patchedCalldata });
  } catch {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset is not a decodable ${expectedType} ABI word`,
    );
  }
  let canonicalPatched;
  try {
    canonicalPatched = encodeFunctionData({
      abi: [abiEntry],
      functionName: abiEntry.name,
      args: patched.args ?? [],
    }).toLowerCase();
  } catch {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset is not a canonical ${expectedType} ABI word`,
    );
  }
  if (canonicalPatched !== patchedCalldata) {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset is not a canonical ${expectedType} ABI word`,
    );
  }
  const patchedArguments = patched.args ?? [];
  if (!Array.isArray(decodedArguments)
    || !Array.isArray(patchedArguments)
    || decodedArguments.length !== inputs.length
    || patchedArguments.length !== inputs.length) {
    throw new TypeError("fundingSignaturePatch decoded initializer arguments are invalid");
  }
  const changedIndices = inputs.flatMap((_, index) =>
    abiValuesDeepEqual(decodedArguments[index], patchedArguments[index]) ? [] : [index]);
  if (changedIndices.length !== 1 || changedIndices[0] !== inputIndex) {
    throw new TypeError(
      `fundingSignaturePatch ${label} offset must identify one top-level ${expectedType} ABI word`,
    );
  }
}

function topLevelInputIndexAtOffset(inputs, offset, expectedType) {
  let cursor = 4;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (offset === cursor && input.type === expectedType) return index;
    const words = staticAbiWords(input);
    cursor += 32 * (words ?? 1);
  }
  return -1;
}

function describeAbiWordLocation(inputs, offset) {
  let cursor = 4;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const words = staticAbiWords(input);
    const byteLength = 32 * (words ?? 1);
    if (offset === cursor) {
      return {
        location: "top-level-argument",
        inputIndex: index,
        abiType: input.type,
      };
    }
    if (words !== null && offset > cursor && offset < cursor + byteLength) {
      return {
        location: "nested-static-word",
        parentInputIndex: index,
        parentAbiType: input.type,
        relativeOffsetBytes: offset - cursor,
      };
    }
    cursor += byteLength;
  }
  return { location: "not-an-abi-argument-head" };
}

function canonicalAbiArgumentPath(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16
    || value.some((entry) => !Number.isSafeInteger(entry) || entry < 0 || entry > 255)) {
    throw new TypeError(`${label} must be a nonempty array of zero-based ABI indices`);
  }
  return [...value];
}

function abiStaticLeafOffset(inputs, argumentPath, expectedType, label) {
  const path = canonicalAbiArgumentPath(argumentPath, label);
  const topLevelIndex = path[0];
  if (topLevelIndex >= inputs.length) {
    throw new TypeError(`${label} top-level input index is out of bounds`);
  }
  let offset = 4;
  for (let index = 0; index < topLevelIndex; index += 1) {
    offset += 32 * (staticAbiWords(inputs[index]) ?? 1);
  }
  let parameter = inputs[topLevelIndex];
  for (const componentIndex of path.slice(1)) {
    if (staticAbiWords(parameter) === null) {
      throw new TypeError(`${label} descends through a dynamic ABI parent`);
    }
    const fixedArray = /^(.*)\[([0-9]+)\]$/u.exec(parameter.type);
    if (fixedArray !== null) {
      const arrayLength = Number(fixedArray[2]);
      if (componentIndex >= arrayLength) {
        throw new TypeError(`${label} fixed-array index is out of bounds`);
      }
      const element = { ...parameter, type: fixedArray[1] };
      const elementWords = staticAbiWords(element);
      if (elementWords === null) {
        throw new TypeError(`${label} descends through a dynamic fixed-array element`);
      }
      offset += componentIndex * elementWords * 32;
      parameter = element;
      continue;
    }
    if (parameter.type !== "tuple") {
      throw new TypeError(`${label} continues past a scalar ABI leaf`);
    }
    const components = parameter.components ?? [];
    if (componentIndex >= components.length) {
      throw new TypeError(`${label} tuple component index is out of bounds`);
    }
    for (let index = 0; index < componentIndex; index += 1) {
      const words = staticAbiWords(components[index]);
      if (words === null) throw new TypeError(`${label} descends through a dynamic tuple`);
      offset += words * 32;
    }
    parameter = components[componentIndex];
  }
  if (parameter.type !== expectedType) {
    throw new TypeError(`${label} resolves to ${parameter.type}, expected ${expectedType}`);
  }
  if (staticAbiWords(parameter) !== 1) {
    throw new TypeError(`${label} must resolve to one static ABI word`);
  }
  return offset;
}

function staticAbiWords(parameter) {
  const array = /^(.*)\[([0-9]*)\]$/.exec(parameter.type);
  if (array !== null) {
    if (array[2] === "") return null;
    const elementWords = staticAbiWords({ ...parameter, type: array[1] });
    return elementWords === null ? null : elementWords * Number(array[2]);
  }
  if (parameter.type === "tuple") {
    let total = 0;
    for (const component of parameter.components ?? []) {
      const words = staticAbiWords(component);
      if (words === null) return null;
      total += words;
    }
    return total;
  }
  if (parameter.type === "bytes" || parameter.type === "string") return null;
  return 1;
}

function assertCombinedFundingSignaturePatchAbi({ calldata, abiEntry, replacements }) {
  const bytes = Buffer.from(calldata.slice(2), "hex");
  for (const [offset, replacement] of replacements) replacement.copy(bytes, offset);
  const patchedCalldata = `0x${bytes.toString("hex")}`;
  let decoded;
  let reencoded;
  try {
    decoded = decodeFunctionData({ abi: [abiEntry], data: patchedCalldata });
    reencoded = encodeFunctionData({
      abi: [abiEntry],
      functionName: abiEntry.name,
      args: decoded.args ?? [],
    }).toLowerCase();
  } catch {
    throw new TypeError(
      "fundingSignaturePatch combined nonce/r/s/v patch is not exact canonical initializer ABI calldata",
    );
  }
  if (reencoded !== patchedCalldata) {
    throw new TypeError(
      "fundingSignaturePatch combined nonce/r/s/v patch is not exact canonical initializer ABI calldata",
    );
  }
}

function abiValuesDeepEqual(left, right) {
  if (typeof left === "string" && typeof right === "string") {
    return left.toLowerCase() === right.toLowerCase();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => abiValuesDeepEqual(value, right[index]));
  }
  if ((left !== null && typeof left === "object")
    || (right !== null && typeof right === "object")) {
    if (left === null || right === null
      || typeof left !== "object" || typeof right !== "object") return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index]
        && abiValuesDeepEqual(left[key], right[key]));
  }
  return left === right;
}

function canonicalPatchOffset(value, calldata, label) {
  if (!Number.isSafeInteger(value) || value < 4 || (value - 4) % 32 !== 0
    || value + 32 > calldata.byteLength) {
    throw new TypeError(`fundingSignaturePatch ${label} offset is not an in-bounds ABI word`);
  }
  if (calldata.subarray(value, value + 32).some((byte) => byte !== 0)) {
    throw new TypeError(`fundingSignaturePatch ${label} word must be all zero before signing`);
  }
  return value;
}

function validateAuthorizationWindow(value, nowSeconds, maximumSeconds = 3_600n) {
  const validAfter = BigInt(value.validAfter);
  const validBefore = BigInt(value.validBefore);
  if (validBefore <= validAfter) {
    throw new TypeError("authorization window requires deadline after validAfter");
  }
  if (validBefore - validAfter > maximumSeconds) {
    throw new TypeError(`authorization window must not exceed ${maximumSeconds} seconds`);
  }
  if (nowSeconds !== undefined) {
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      throw new TypeError("authorization window clock is invalid");
    }
    const now = BigInt(nowSeconds);
    if (!(validAfter <= now && now <= validBefore)) {
      throw new TypeError("authorization window requires validAfter <= now <= deadline");
    }
  }
}

function canonicalUint(value, label, allowZero = true) {
  if (typeof value !== "string" || !DECIMAL.test(value) || BigInt(value) >= 1n << 256n
    || (!allowZero && value === "0")) {
    throw new TypeError(`${label} must be a canonical ${allowZero ? "" : "nonzero "}uint256 string`);
  }
  return value;
}

function canonicalUint64(value, label, allowZero = true) {
  const normalized = canonicalUint(value, label, allowZero);
  if (BigInt(normalized) >= 1n << 64n) {
    throw new TypeError(`${label} must fit uint64`);
  }
  return normalized;
}

function canonicalApplicantSelectedFee(value, label) {
  const normalized = canonicalUint(value, label);
  if (BigInt(normalized) > 100_000n) {
    throw new TypeError(`${label} must be between 0 and 100000`);
  }
  return normalized;
}

function canonicalAccountingMode(value) {
  if (!PLATFORM_ACCOUNTING_MODES.includes(value)) {
    throw new TypeError(
      "direct-native launchProfile.accountingMode must be additive-platform-share or inclusive-selected-total",
    );
  }
  return value;
}

function canonicalFundingMode(value) {
  if (!FUNDING_MODES.includes(value)) {
    throw new TypeError(
      `direct-native launchProfile.fundingMode must be none, ${FUNDING_WALLET_TRANSACTION_VALUE_METHOD}, or ${FUNDING_AUTHORIZATION_METHOD}`,
    );
  }
  return value;
}

function canonicalClaimMode(value) {
  if (!CLAIM_MODES.includes(value)) {
    throw new TypeError(
      "direct-native launchProfile.claimMode must be immutable-payout-recipient or claim-authority-selected-recipient",
    );
  }
  return value;
}

function canonicalImmutablePayoutRecipient(value) {
  const payoutRecipient = getAddress(value);
  if (![PLATFORM_FEE_CLAIM_AUTHORITY, "0xD88539d3c4C460136a733A3Fd60cf6BF269079da"].includes(payoutRecipient)) {
    throw new TypeError(
      "direct-native immutable payout recipient must be the platform claim authority",
    );
  }
  return payoutRecipient;
}

function canonicalPlatformFeeAssessment(assessmentBase, feeCurrency) {
  const pair = PLATFORM_FEE_ASSESSMENT_PAIRS.find((candidate) =>
    candidate.assessmentBase === assessmentBase && candidate.feeCurrency === feeCurrency);
  if (pair === undefined) {
    throw new TypeError(
      "direct-native platform fee assessmentBase and feeCurrency are not a supported closed pair",
    );
  }
  return pair;
}

function canonicalLiquidityModel(value) {
  if (value?.model === "external-concentrated-liquidity") {
    assertExactKeys(value, [
      "schemaVersion",
      "model",
      "declaredLaunchState",
    ], "direct-native launchProfile.liquidityModel");
    if (value.schemaVersion !== DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA
      || value.declaredLaunchState !== "liquidity_required") {
      throw new TypeError(
        "external concentrated liquidity must declare liquidity_required",
      );
    }
    return {
      schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
      model: "external-concentrated-liquidity",
      declaredLaunchState: "liquidity_required",
    };
  }
  if (value?.model === "launch-seeded-concentrated-liquidity") {
    assertExactKeys(value, [
      "schemaVersion",
      "model",
      "declaredLaunchState",
      "liquidityTargetId",
      "assessment",
    ], "direct-native launchProfile.liquidityModel");
    if (value.schemaVersion !== DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA
      || value.declaredLaunchState !== "assessment_required") {
      throw new TypeError(
        "launch-seeded concentrated liquidity must declare assessment_required",
      );
    }
    return {
      schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
      model: "launch-seeded-concentrated-liquidity",
      declaredLaunchState: "assessment_required",
      liquidityTargetId: canonicalIdentifier(
        value.liquidityTargetId,
        "direct-native launchProfile.liquidityModel.liquidityTargetId",
      ),
      assessment: canonicalLiquidityAssessment(
        value.assessment,
        LAUNCH_SEEDED_CONCENTRATED_LIQUIDITY_VECTORS,
      ),
    };
  }
  if (value?.model === "hook-inventory-custom-accounting") {
    assertExactKeys(value, [
      "schemaVersion",
      "model",
      "declaredLaunchState",
      "inventoryTargetId",
      "assessment",
    ], "direct-native launchProfile.liquidityModel");
    if (value.schemaVersion !== DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA
      || value.declaredLaunchState !== "assessment_required") {
      throw new TypeError(
        "hook-inventory custom accounting must declare assessment_required",
      );
    }
    return {
      schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_INTENT_SCHEMA,
      model: "hook-inventory-custom-accounting",
      declaredLaunchState: "assessment_required",
      inventoryTargetId: canonicalIdentifier(
        value.inventoryTargetId,
        "direct-native launchProfile.liquidityModel.inventoryTargetId",
      ),
      assessment: canonicalLiquidityAssessment(
        value.assessment,
        HOOK_INVENTORY_CUSTOM_ACCOUNTING_VECTORS,
      ),
    };
  }
  throw new TypeError(
    "direct-native liquidityModel must be external-concentrated-liquidity, launch-seeded-concentrated-liquidity, or hook-inventory-custom-accounting",
  );
}

function canonicalLiquidityAssessment(value, expectedVectors) {
  assertExactKeys(value, [
    "schemaVersion",
    "status",
    "requestClaimsExecution",
    "requiredVectorIds",
  ], "direct-native launchProfile.liquidityModel.assessment");
  if (value.schemaVersion !== DIRECT_NATIVE_LIQUIDITY_MODEL_ASSESSMENT_SCHEMA
    || value.status !== "required"
    || value.requestClaimsExecution !== false
    || !Array.isArray(value.requiredVectorIds)
    || canonicalizeJson(value.requiredVectorIds) !== canonicalizeJson(expectedVectors)) {
    throw new TypeError(
      "direct-native liquidity assessment must declare the exact required vectors without claiming execution",
    );
  }
  return {
    schemaVersion: DIRECT_NATIVE_LIQUIDITY_MODEL_ASSESSMENT_SCHEMA,
    status: "required",
    requestClaimsExecution: false,
    requiredVectorIds: [...expectedVectors],
  };
}

function platformFeePolicy(accountingMode, assessmentBase, feeCurrency, ratePpm = PLATFORM_FEE_RATE_PPM, recipient = PLATFORM_FEE_CLAIM_AUTHORITY) {
  return {
    ...PLATFORM_FEE_POLICY_COMMON,
    claimAuthority: recipient,
    programmableFeeHundredthsOfBip: ratePpm,
    accountingMode: canonicalAccountingMode(accountingMode),
    ...canonicalPlatformFeeAssessment(assessmentBase, feeCurrency),
  };
}

function fundingPolicy(mode) {
  if (mode === "none") {
    return {
      mode: "none",
      launchFundingRequired: false,
      signatureRequired: false,
    };
  }
  if (mode === FUNDING_WALLET_TRANSACTION_VALUE_METHOD) {
    return {
      mode: FUNDING_WALLET_TRANSACTION_VALUE_METHOD,
      launchFundingRequired: true,
      signatureRequired: false,
      valueSource: "exact-router-transaction-msg-value",
    };
  }
  return {
    mode: FUNDING_AUTHORIZATION_METHOD,
    launchFundingRequired: true,
    signatureRequired: true,
    primaryType: "ReceiveWithAuthorization",
    typeHash: RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
    domainName: MAINNET_USDC_DOMAIN_NAME,
    domainVersion: MAINNET_USDC_DOMAIN_VERSION,
    maximumValiditySeconds: "3600",
  };
}

function platformFeeClaimBinding(selection, recipient = PLATFORM_FEE_CLAIM_AUTHORITY) {
  if (selection.claimMode === "immutable-payout-recipient") {
    return {
      mode: "immutable-payout-recipient",
      claimAuthority: recipient,
      payoutRecipient: selection.payoutRecipient,
    };
  }
  return {
    mode: "claim-authority-selected-recipient",
    claimAuthority: recipient,
    destinationConstraint: "nonzero-address",
  };
}

function platformFeeEconomics(applicantSelectedHundredthsOfBip, accountingMode, ratePpm = PLATFORM_FEE_RATE_PPM) {
  const selected = BigInt(applicantSelectedHundredthsOfBip);
  const platform = BigInt(ratePpm);
  if (accountingMode === "additive-platform-share") {
    return {
      applicantSelectedHundredthsOfBip,
      projectHundredthsOfBip: selected.toString(),
      effectiveTotalHundredthsOfBip: (selected + platform).toString(),
    };
  }
  const total = selected > platform ? selected : platform;
  return {
    applicantSelectedHundredthsOfBip,
    projectHundredthsOfBip: (total - platform).toString(),
    effectiveTotalHundredthsOfBip: total.toString(),
  };
}

function validateFundingGraph(fundingMode, graphBundle) {
  const hasNativeValue = graphBundle.targets.some((target) =>
    target.deploymentValueWei !== "0" || target.initializerValueWei !== "0");
  if (fundingMode === FUNDING_WALLET_TRANSACTION_VALUE_METHOD) {
    if (!hasNativeValue) {
      throw new TypeError(
        "direct-native fundingMode wallet-transaction-value requires a nonzero exact Router transaction value",
      );
    }
    return;
  }
  if (hasNativeValue) {
    throw new TypeError(
      fundingMode === "none"
        ? "direct-native fundingMode none requires zero deployment and initializer value for every target"
        : "direct-native EIP-3009 funding requires zero native deployment and initializer value for every target",
    );
  }
}

function validateLiquidityModelGraph(liquidityModel, roles, byId) {
  if (liquidityModel.model === "external-concentrated-liquidity") return;
  if (liquidityModel.model === "launch-seeded-concentrated-liquidity") {
    requireTarget(byId, liquidityModel.liquidityTargetId, "liquidity seed");
    return;
  }
  const inventory = requireTarget(byId, liquidityModel.inventoryTargetId, "hook inventory");
  if (liquidityModel.inventoryTargetId !== roles.hookTargetId
    || inventory.componentKind !== "hook"
    || !Array.isArray(inventory.declaredHookPermissions)
    || (!inventory.declaredHookPermissions.includes("beforeSwapReturnDelta")
      && !inventory.declaredHookPermissions.includes("afterSwapReturnDelta"))) {
    throw new TypeError(
      "hook-inventory custom accounting must bind the graph hook and declare a swap return-delta permission",
    );
  }
}

function sha256ToHex32(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return `0x${value.slice("sha256:".length)}`;
}

export const DIRECT_NATIVE_PROFILE_PUBLIC_CONSTANTS = Object.freeze({
  minimumPermissionMask: 0,
  maximumPermissionMask: 16_383,
  platformAccountingModes: PLATFORM_ACCOUNTING_MODES,
  platformFeeAssessmentPairs: PLATFORM_FEE_ASSESSMENT_PAIRS,
  platformFeeProofPolicy: PLATFORM_FEE_PROOF_POLICY,
  platformAdmissionPolicy: PLATFORM_ADMISSION_POLICY,
  projectMetadataPolicy: PROJECT_METADATA_POLICY,
});

function directNativeProfileContract(value, schemaField, message) {
  if (value?.profileId !== DIRECT_NATIVE_PROFILE_ID) throw new TypeError(message);
  const candidate = DIRECT_NATIVE_PROFILE_CONTRACTS[value?.profileRevision];
  if (candidate === undefined || value?.schemaVersion !== candidate[schemaField]) {
    throw new TypeError(message);
  }
  return candidate;
}

function directNativeProfileVersion(profileContract, requestedVersion) {
  const profileVersion = requestedVersion ?? profileContract.profileVersion;
  if (profileContract.profileRevision === DIRECT_NATIVE_PROFILE_REVISION_V2) {
    if (profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V2) {
      throw new TypeError("direct-native embedded launchProfile version is not supported");
    }
    return profileVersion;
  }
  if (profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V3
    && profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V35
    && profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V36
    && profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY
    && profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V3_METADATA_LEGACY
    && profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V3_PRE_METADATA
    && profileVersion !== DIRECT_NATIVE_PROFILE_VERSION_V3_LEGACY) {
    throw new TypeError("direct-native embedded launchProfile version is not supported");
  }
  return profileVersion;
}

function platformAdmissionPolicyForVersion(profileVersion) {
  return profileVersion === DIRECT_NATIVE_PROFILE_VERSION_V3_LEGACY
    ? LEGACY_PLATFORM_ADMISSION_POLICY
    : PLATFORM_ADMISSION_POLICY;
}

for (const digest of [MAINNET_USDC_DOMAIN_SEPARATOR, RECEIVE_WITH_AUTHORIZATION_TYPEHASH]) {
  if (!HEX32.test(digest)) throw new TypeError("direct-native funding digest is invalid");
}
