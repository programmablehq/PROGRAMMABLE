import { HYPEREVM_CUSTOM_ROOTS_V1 } from "./hyperevm-release-v1";
import { BASE_CUSTOM_ROOTS_V1 } from "./base-release-v1";
import {
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  hashTypedData,
  isAddress,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  serializeTypedData,
  sha256,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";

import {
  assertCustomLaunchWalletActionV1,
  isCustomLaunchRouterV1,
  customLaunchChainForRouterV1,
  customLaunchMaximumLifetimeSecondsV1,
  CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
  type CustomLaunchWalletActionV1,
} from "./wallet-handoff-v1";
import { customLaunchWalletTransactionPreimageHashV2 } from
  "./wallet-handoff-v2";

export const CUSTOM_LAUNCH_AUTHORIZATION_RESULT_SCHEMA_V3 =
  "programmable.custom-launch-authorization-result.v3" as const;
export const CUSTOM_LAUNCH_FUNDING_CHALLENGE_SCHEMA_V1 =
  "programmable.custom-launch-funding-challenge.v1" as const;
export const CUSTOM_LAUNCH_FUNDING_DESCRIPTOR_SCHEMA_V1 =
  "programmable.funding-authorization-descriptor.v1" as const;
export const CUSTOM_LAUNCH_FUNDING_SIGNATURE_SCHEMA_V1 =
  "programmable.custom-launch-funding-authorization-signature.v1" as const;
export const CUSTOM_LAUNCH_EXACT_WALLET_TRANSACTION_SCHEMA_V3 =
  "programmable.exact-wallet-transaction.v3" as const;
export const CUSTOM_LAUNCH_MAINNET_USDC_V3 = getAddress(
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
);

const CUSTOM_GRAPH_FACTORY_V1 = getAddress(
  "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
);
const UINT256_MAXIMUM = (1n << 256n) - 1n;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_ORDER =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const MAXIMUM_FUNDING_VALIDITY_SECONDS = 3_600n;
const MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS = 30n;
const V4_MAXIMUM_STATIC_FEE = 999_999n;
const V4_DYNAMIC_FEE_SENTINEL = 0x800000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const LOWERCASE_HEX_DATA = /^0x(?:[0-9a-f]{2})+$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FUNDING_SUBMISSION_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/u;
const CANONICAL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$/u;

const OUTPUT_KEYS = Object.freeze([
  "schemaVersion",
  "integrationState",
  "stage",
  "actionRequired",
  "fundingBoundary",
]);
const SIMULATING_OUTPUT_KEYS = Object.freeze([
  ...OUTPUT_KEYS,
  "launchProfileHash",
  "initializerTargetId",
  "fundingMode",
  "permitWindow",
  "artifact",
  "signedPermit",
  "observationWindow",
  "onchain",
  "walletTransaction",
  "transactionPreimageHash",
  "simulation",
]);
const AUTHORIZED_OUTPUT_KEYS = Object.freeze([
  ...OUTPUT_KEYS,
  "artifact",
  "signedPermit",
  "observationWindow",
  "onchain",
  "walletTransaction",
  "simulation",
]);
const BEHAVIOR_OUTPUT_KEYS = Object.freeze([
  "behaviorEvidence",
  "behaviorAssurance",
]);
const PLATFORM_ADMISSION_KEYS = Object.freeze([
  "schemaVersion",
  "disposition",
  "reportSha256",
  "warningFindingCodes",
  "routerSimulationRequiredBeforeAuthorization",
  "safetyClaim",
  "feeBehaviorClaim",
]);
const PLATFORM_ADMISSION_V3_KEYS = Object.freeze([
  ...PLATFORM_ADMISSION_KEYS,
  "needsEvidenceFindingCodes",
  "riskClassification",
  "behaviorEvidence",
  "productTruthAxes",
]);
const PLATFORM_FINDING_CODE = /^[A-Z][A-Z0-9_]{2,127}$/u;
const FUNDING_BOUNDARY_KEYS = Object.freeze([
  "approvalTransactionRequired",
  "permit2Used",
  "fundingSignatureProducedByService",
  "walletTransactionBroadcastByService",
]);
const FUNDING_CHALLENGE_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "method",
  "fundingIntentHash",
  "fundingAuthorization",
  "typedData",
  "typedDataDigest",
  "submission",
]);
const FUNDING_DESCRIPTOR_KEYS = Object.freeze([
  "schemaVersion",
  "method",
  "token",
  "from",
  "to",
  "value",
  "validAfter",
  "validBefore",
  "nonce",
]);
const TYPED_DATA_KEYS = Object.freeze([
  "domain",
  "primaryType",
  "types",
  "message",
]);
const DOMAIN_KEYS = Object.freeze([
  "name",
  "version",
  "chainId",
  "verifyingContract",
]);
const MESSAGE_KEYS = Object.freeze([
  "from",
  "to",
  "value",
  "validAfter",
  "validBefore",
  "nonce",
]);
const SUBMISSION_KEYS = Object.freeze([
  "method",
  "path",
  "schemaVersion",
]);
const ROUTER_ACTION_KEYS = Object.freeze([
  "kind",
  "transaction",
  "graphCommitment",
  "artifactHash",
  "transactionPreimageHash",
  "permitDigest",
  "initializerCalldataHash",
]);
const CURRENT_ROUTER_ACTION_KEYS = Object.freeze([
  ...ROUTER_ACTION_KEYS,
  "walletHandoffUrl",
  "expiresAt",
]);
const EXACT_TRANSACTION_KEYS = Object.freeze([
  "schemaVersion",
  "chainId",
  "from",
  "to",
  "valueWei",
  "calldata",
]);
const SIGNED_PERMIT_KEYS = Object.freeze([
  "schemaVersion",
  "artifactHash",
  "chainId",
  "router",
  "authoritySafe",
  "signerAddress",
  "permitDigest",
  "safeMessageDigest",
  "signature",
  "validAfter",
  "deadline",
]);
const OBSERVATION_WINDOW_KEYS = Object.freeze([
  "schemaVersion",
  "chainId",
  "router",
  "fromBlock",
  "toBlock",
]);
const ONCHAIN_EVIDENCE_KEYS = Object.freeze([
  "schemaVersion",
  "finalityState",
  "chainId",
  "router",
  "onchainLaunchId",
  "transactionHash",
  "blockNumber",
  "blockHash",
  "logIndex",
  "token",
  "hook",
  "poolManager",
  "poolId",
  "stampHash",
  "confirmationDepth",
  "requiredConfirmationDepth",
  "observedAtBlockNumber",
]);
const FINALIZED_CHECKPOINT_KEYS = Object.freeze([
  "schemaVersion",
  "blockNumber",
  "blockHash",
  "quorumSize",
  "observations",
]);
const FINALIZED_PROVIDER_OBSERVATION_KEYS = Object.freeze([
  "provider",
  "finalizedBlockNumber",
  "finalizedBlockHash",
  "commonBlockHash",
]);
const SIMULATION_KEYS = Object.freeze([
  "outcome",
  "transactionPreimageHash",
  "profileHash",
  "blockNumber",
  "blockHash",
  "blockTimestamp",
  "responseDigest",
  "gasEstimate",
]);
const BEHAVIOR_EVIDENCE_KEYS = Object.freeze([
  "schemaVersion",
  "subjectSha256",
  "requirements",
  "status",
  "execution",
  "vectors",
  "outstandingVectorIds",
  "claimAxes",
]);
const BEHAVIOR_ASSURANCE_KEYS = Object.freeze([
  "schemaVersion",
  "authorizationScope",
  "evidenceAuthority",
  "behaviorExecution",
  "mutableAuthorityConditional",
  "routability",
  "platformFeeConformance",
  "liquidityConformance",
  "safety",
]);
const PERMIT_WINDOW_KEYS = Object.freeze([
  "validAfter",
  "deadline",
]);

const RECEIVE_WITH_AUTHORIZATION_TYPES = Object.freeze([
  Object.freeze({ name: "from", type: "address" }),
  Object.freeze({ name: "to", type: "address" }),
  Object.freeze({ name: "value", type: "uint256" }),
  Object.freeze({ name: "validAfter", type: "uint256" }),
  Object.freeze({ name: "validBefore", type: "uint256" }),
  Object.freeze({ name: "nonce", type: "bytes32" }),
]);
const EIP712_DOMAIN_TYPES = Object.freeze([
  Object.freeze({ name: "name", type: "string" }),
  Object.freeze({ name: "version", type: "string" }),
  Object.freeze({ name: "chainId", type: "uint256" }),
  Object.freeze({ name: "verifyingContract", type: "address" }),
]);

const LAUNCH_AND_STAMP_PARAMETERS_V1 = parseAbiParameters(
  "(uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes",
);
const CUSTOM_GRAPH_ROUTE_PARAMETER_V1 = parseAbiParameters(
  "(bytes32,bytes32,bytes32,bytes32,(bytes32,bytes32,uint256,uint256,bytes,bytes)[],(uint8,bytes32,address,bytes32)[],bytes32)",
);

const GRAPH_TARGET_COMMITMENT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)",
));
const GRAPH_COMMITMENT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)",
));
const GRAPH_TARGET_SALT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)",
));
const GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH = keccak256(stringToHex(
  "ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)",
));
const EXPECTED_GRAPH_OUTPUT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)",
));
const EXPECTED_GRAPH_RESULT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)",
));
const COMPONENT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)",
));
const POOL_KEY_TYPEHASH = keccak256(stringToHex(
  "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
));
const STAMP_REQUEST_TYPEHASH = keccak256(stringToHex(
  "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
));

export type CustomLaunchFundingTypedDataV3 = Readonly<{
  domain: Readonly<{
    name: "USD Coin";
    version: "2";
    chainId: 1;
    verifyingContract: Address;
  }>;
  primaryType: "ReceiveWithAuthorization";
  types: Readonly<{
    ReceiveWithAuthorization: typeof RECEIVE_WITH_AUTHORIZATION_TYPES;
  }>;
  message: Readonly<{
    from: Address;
    to: Address;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
  }>;
}>;

export type CustomLaunchFundingAuthorizationV3 = Readonly<{
  chainId: "1";
  launchId: string;
  fundingIntentHash: Hex;
  typedDataDigest: Hex;
  submissionPath: string;
  token: Address;
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  typedData: CustomLaunchFundingTypedDataV3;
}>;

export type CustomLaunchFundingAuthorizationSubmissionV3 = Readonly<{
  schemaVersion: typeof CUSTOM_LAUNCH_FUNDING_SIGNATURE_SCHEMA_V1;
  fundingIntentHash: Hex;
  typedDataDigest: Hex;
  signature: Hex;
}>;

export type CustomLaunchRouterReviewV3 = Readonly<{
  walletAction: CustomLaunchWalletActionV1;
  graphCommitment: Hex;
  artifactHash: `sha256:${string}`;
  transactionPreimageHash: `sha256:${string}`;
  permitDigest: Hex;
  initializerCalldataHash: Hex;
  selector: typeof CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1;
  calldataLengthBytes: number;
}>;

export class CustomLaunchWalletHandoffErrorV3 extends Error {
  constructor(message = "The V3 wallet request failed the safety checks. Refresh the launch and try again.") {
    super(message);
    this.name = "CustomLaunchWalletHandoffErrorV3";
  }
}

export function prepareCustomLaunchFundingAuthorizationV3(
  output: unknown,
  connectedController: string,
  launchId: string,
  expectedFundingIntentHash: string,
  nowUnixSeconds = BigInt(Math.floor(Date.now() / 1_000)),
): CustomLaunchFundingAuthorizationV3 {
  const controller = requiredAddress(connectedController);
  if (!UUID.test(launchId)) return invalid();
  const outputRecord = authorizationOutputRecord(output);
  assertFundingBoundaryV3(outputRecord.fundingBoundary);
  if (
    outputRecord.schemaVersion !== CUSTOM_LAUNCH_AUTHORIZATION_RESULT_SCHEMA_V3
    || outputRecord.integrationState !== "ready"
    || outputRecord.stage !== "funding-signature-required"
  ) return invalid();

  const challenge = exactRecord(
    outputRecord.actionRequired,
    FUNDING_CHALLENGE_KEYS,
  );
  const descriptor = exactRecord(
    challenge.fundingAuthorization,
    FUNDING_DESCRIPTOR_KEYS,
  );
  const typedData = exactRecord(challenge.typedData, TYPED_DATA_KEYS);
  const domain = exactRecord(typedData.domain, DOMAIN_KEYS);
  const types = exactRecord(typedData.types, ["ReceiveWithAuthorization"]);
  const message = exactRecord(typedData.message, MESSAGE_KEYS);
  const submission = exactRecord(challenge.submission, SUBMISSION_KEYS);

  const fundingIntentHash = exactLowerBytes32(challenge.fundingIntentHash);
  const typedDataDigest = exactLowerBytes32(challenge.typedDataDigest);
  const expectedIntent = exactLowerBytes32(expectedFundingIntentHash);
  const token = requiredAddress(descriptor.token);
  const from = requiredAddress(descriptor.from);
  const to = requiredAddress(descriptor.to);
  const value = canonicalUint256(descriptor.value);
  const validAfter = canonicalUint256(descriptor.validAfter);
  const validBefore = canonicalUint256(descriptor.validBefore);
  const nonce = exactNonzeroLowerBytes32(descriptor.nonce);
  const expectedSubmissionPath =
    `/v3/wallet-admin/custom-launches/${launchId}/funding-authorization`;

  if (
    challenge.schemaVersion !== CUSTOM_LAUNCH_FUNDING_CHALLENGE_SCHEMA_V1
    || challenge.kind !== "wallet-signature"
    || challenge.method !== "eip-3009-receive-with-authorization"
    || fundingIntentHash !== expectedIntent
    || descriptor.schemaVersion !== CUSTOM_LAUNCH_FUNDING_DESCRIPTOR_SCHEMA_V1
    || descriptor.method !== "eip-3009-receive-with-authorization"
    || !sameAddress(token, CUSTOM_LAUNCH_MAINNET_USDC_V3)
    || !sameAddress(from, controller)
    || sameAddress(to, "0x0000000000000000000000000000000000000000")
    || value.parsed === 0n
    || validAfter.parsed >= nowUnixSeconds
    || validBefore.parsed <=
      nowUnixSeconds + MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS
    || validBefore.parsed <= validAfter.parsed
    || validBefore.parsed - validAfter.parsed > MAXIMUM_FUNDING_VALIDITY_SECONDS
    || submission.method !== "POST"
    || submission.path !== expectedSubmissionPath
    || submission.schemaVersion !== CUSTOM_LAUNCH_FUNDING_SIGNATURE_SCHEMA_V1
    || typedData.primaryType !== "ReceiveWithAuthorization"
    || domain.name !== "USD Coin"
    || domain.version !== "2"
    || domain.chainId !== 1
    || !sameAddress(domain.verifyingContract, token)
    || !exactReceiveWithAuthorizationTypes(types.ReceiveWithAuthorization)
    || !sameAddress(message.from, from)
    || !sameAddress(message.to, to)
    || message.value !== value.source
    || message.validAfter !== validAfter.source
    || message.validBefore !== validBefore.source
    || message.nonce !== nonce
  ) return invalid();

  const normalizedTypedData = Object.freeze({
    domain: Object.freeze({
      name: "USD Coin" as const,
      version: "2" as const,
      chainId: 1 as const,
      verifyingContract: token,
    }),
    primaryType: "ReceiveWithAuthorization" as const,
    types: Object.freeze({
      ReceiveWithAuthorization: RECEIVE_WITH_AUTHORIZATION_TYPES,
    }),
    message: Object.freeze({
      from,
      to,
      value: value.source,
      validAfter: validAfter.source,
      validBefore: validBefore.source,
      nonce,
    }),
  });
  if (fundingTypedDataDigest(normalizedTypedData) !== typedDataDigest) {
    return invalid();
  }
  return Object.freeze({
    chainId: "1" as const,
    launchId,
    fundingIntentHash,
    typedDataDigest,
    submissionPath: expectedSubmissionPath,
    token,
    from,
    to,
    value: value.source,
    validAfter: validAfter.source,
    validBefore: validBefore.source,
    nonce,
    typedData: normalizedTypedData,
  });
}

export function assertCustomLaunchFundingAuthorizationV3(
  input: CustomLaunchFundingAuthorizationV3,
  connectedController: string,
  nowUnixSeconds = BigInt(Math.floor(Date.now() / 1_000)),
): CustomLaunchFundingAuthorizationV3 {
  const controller = requiredAddress(connectedController);
  const token = requiredAddress(input.token);
  const from = requiredAddress(input.from);
  const to = requiredAddress(input.to);
  if (
    input.chainId !== "1"
    || !UUID.test(input.launchId)
    || !sameAddress(from, controller)
    || !sameAddress(token, CUSTOM_LAUNCH_MAINNET_USDC_V3)
    || sameAddress(to, "0x0000000000000000000000000000000000000000")
    || input.submissionPath !==
      `/v3/wallet-admin/custom-launches/${input.launchId}/funding-authorization`
    || exactLowerBytes32(input.fundingIntentHash) !== input.fundingIntentHash
    || exactLowerBytes32(input.typedDataDigest) !== input.typedDataDigest
    || exactNonzeroLowerBytes32(input.nonce) !== input.nonce
  ) return invalid();
  const value = canonicalUint256(input.value);
  const validAfter = canonicalUint256(input.validAfter);
  const validBefore = canonicalUint256(input.validBefore);
  const typedData = exactRecord(input.typedData, TYPED_DATA_KEYS);
  const domain = exactRecord(typedData.domain, DOMAIN_KEYS);
  const types = exactRecord(typedData.types, ["ReceiveWithAuthorization"]);
  const message = exactRecord(typedData.message, MESSAGE_KEYS);
  const normalizedTypedData = Object.freeze({
    domain: Object.freeze({
      name: "USD Coin" as const,
      version: "2" as const,
      chainId: 1 as const,
      verifyingContract: token,
    }),
    primaryType: "ReceiveWithAuthorization" as const,
    types: Object.freeze({
      ReceiveWithAuthorization: RECEIVE_WITH_AUTHORIZATION_TYPES,
    }),
    message: Object.freeze({
      from,
      to,
      value: value.source,
      validAfter: validAfter.source,
      validBefore: validBefore.source,
      nonce: input.nonce,
    }),
  });
  if (
    value.parsed === 0n
    || validAfter.parsed >= nowUnixSeconds
    || validBefore.parsed <=
      nowUnixSeconds + MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS
    || validBefore.parsed - validAfter.parsed > MAXIMUM_FUNDING_VALIDITY_SECONDS
    || typedData.primaryType !== "ReceiveWithAuthorization"
    || domain.name !== "USD Coin"
    || domain.version !== "2"
    || domain.chainId !== 1
    || !sameAddress(domain.verifyingContract, token)
    || !exactReceiveWithAuthorizationTypes(types.ReceiveWithAuthorization)
    || !sameAddress(message.from, from)
    || !sameAddress(message.to, to)
    || message.value !== value.source
    || message.validAfter !== validAfter.source
    || message.validBefore !== validBefore.source
    || message.nonce !== input.nonce
    || fundingTypedDataDigest(normalizedTypedData) !== input.typedDataDigest
  ) return invalid();
  return input;
}

export function serializeCustomLaunchFundingTypedDataV3(
  input: CustomLaunchFundingAuthorizationV3,
): string {
  const checked = assertCustomLaunchFundingAuthorizationV3(
    input,
    input.from,
    canonicalUint256(input.validAfter).parsed + 1n,
  );
  const serialized = serializeTypedData({
    ...typedDataForViem(checked.typedData),
    domain: {
      ...checked.typedData.domain,
      chainId: 1n,
    },
    types: {
      EIP712Domain: EIP712_DOMAIN_TYPES,
      ReceiveWithAuthorization: RECEIVE_WITH_AUTHORIZATION_TYPES,
    },
  });
  const payload = JSON.parse(serialized) as {
    domain: { chainId: number | string };
  };
  payload.domain.chainId = 1;
  return JSON.stringify(payload);
}

export async function verifyCustomLaunchFundingSignatureV3(
  input: CustomLaunchFundingAuthorizationV3,
  signature: unknown,
): Promise<Hex> {
  const canonical = canonicalFundingSignature(signature);
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      ...typedDataForViem(input.typedData),
      signature: canonical,
    });
  } catch {
    return invalid();
  }
  if (!sameAddress(recovered, input.from)) return invalid();
  return canonical;
}

export function createCustomLaunchFundingSubmissionV3(
  input: CustomLaunchFundingAuthorizationV3,
  signature: Hex,
): CustomLaunchFundingAuthorizationSubmissionV3 {
  return Object.freeze({
    schemaVersion: CUSTOM_LAUNCH_FUNDING_SIGNATURE_SCHEMA_V1,
    fundingIntentHash: input.fundingIntentHash,
    typedDataDigest: input.typedDataDigest,
    signature: canonicalFundingSignature(signature),
  });
}

export function assertCustomLaunchFundingIdempotencyKeyV3(value: string) {
  if (!FUNDING_SUBMISSION_IDEMPOTENCY_KEY.test(value)) return invalid();
  return value;
}

export function prepareCustomLaunchRouterReviewV3(
  output: unknown,
  connectedController: string,
): CustomLaunchRouterReviewV3 {
  const outputRecord = authorizationOutputRecord(output);
  assertFundingBoundaryV3(outputRecord.fundingBoundary);
  if (
    outputRecord.schemaVersion !== CUSTOM_LAUNCH_AUTHORIZATION_RESULT_SCHEMA_V3
    || outputRecord.integrationState !== "ready"
    || outputRecord.stage !== "router-transaction-required"
  ) return invalid();
  const actionCandidate = record(outputRecord.actionRequired);
  const hasCurrentHandoff = Object.hasOwn(actionCandidate, "walletHandoffUrl")
    || Object.hasOwn(actionCandidate, "expiresAt");
  const required = exactRecord(
    actionCandidate,
    hasCurrentHandoff ? CURRENT_ROUTER_ACTION_KEYS : ROUTER_ACTION_KEYS,
  );
  const transaction = exactRecord(
    required.transaction,
    EXACT_TRANSACTION_KEYS,
  );
  const graphCommitment = exactNonzeroLowerBytes32(required.graphCommitment);
  const artifactHash = exactSha256(required.artifactHash);
  const transactionPreimageHash = exactSha256(
    required.transactionPreimageHash,
  );
  const permitDigest = exactNonzeroLowerBytes32(required.permitDigest);
  const initializerCalldataHash = exactNonzeroLowerBytes32(
    required.initializerCalldataHash,
  );
  const valueWei = canonicalUint256(transaction.valueWei);
  const data = exactLowerHexData(transaction.calldata);
  const chainId = customLaunchChainForRouterV1(transaction.to);
  if (hasCurrentHandoff) assertCurrentRouterHandoffV3(required, chainId);
  if (
    required.kind !== "send-router-transaction"
    || transaction.schemaVersion !== CUSTOM_LAUNCH_EXACT_WALLET_TRANSACTION_SCHEMA_V3
    || !chainId || transaction.chainId !== chainId
  ) return invalid();
  const action = assertCustomLaunchWalletActionV1(Object.freeze({
    chainId,
    from: requiredAddress(transaction.from),
    to: requiredAddress(transaction.to),
    data,
    value: toHex(valueWei.parsed),
    valueWei: valueWei.source,
  }), connectedController);
  if (
    !isCustomLaunchRouterV1(action.to)
    || customLaunchWalletTransactionPreimageHashV2(action)
      !== transactionPreimageHash
  ) return invalid();
  assertAuthorizedEvidenceV3(outputRecord, required, transaction, action);
  assertExactCustomGraphRouterCalldataV3(
    action,
    graphCommitment,
    permitDigest,
    initializerCalldataHash,
  );
  return Object.freeze({
    walletAction: action,
    graphCommitment,
    artifactHash,
    transactionPreimageHash,
    permitDigest,
    initializerCalldataHash,
    selector: CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1,
    calldataLengthBytes: (action.data.length - 2) / 2,
  });
}

export function prepareCustomLaunchWalletActionV3(
  output: unknown,
  connectedController: string,
): CustomLaunchWalletActionV1 {
  return prepareCustomLaunchRouterReviewV3(output, connectedController)
    .walletAction;
}

function assertExactCustomGraphRouterCalldataV3(
  action: CustomLaunchWalletActionV1,
  expectedGraphCommitment: Hex,
  expectedPermitDigest: Hex,
  expectedInitializerCalldataHash: Hex,
) {
  const chainId = BigInt(action.chainId);
  const graphFactory = action.chainId === "999" ? HYPEREVM_CUSTOM_ROOTS_V1.graphFactory : action.chainId === "8453" ? BASE_CUSTOM_ROOTS_V1.graphFactory : CUSTOM_GRAPH_FACTORY_V1;
  const calldata = exactLowerHexData(action.data);
  if (calldata.slice(0, 10) !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1) {
    return invalid();
  }
  let decoded: readonly unknown[];
  try {
    decoded = decodeAbiParameters(
      LAUNCH_AND_STAMP_PARAMETERS_V1,
      `0x${calldata.slice(10)}`,
    );
    const canonical = `${CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1}${
      encodeAbiParameters(LAUNCH_AND_STAMP_PARAMETERS_V1, decoded as never)
        .slice(2)
    }`;
    if (canonical !== calldata) return invalid();
  } catch {
    return invalid();
  }
  const permit = tuple(decoded[0], 11);
  const stamp = tuple(decoded[1], 6);
  const routePayload = exactLowerHexData(decoded[2]);
  const permitSignature = exactLowerHexData(decoded[3]);
  if ((permitSignature.length - 2) / 2 !== 65) return invalid();

  const permitChainId = requiredBigInt(permit[0]);
  const permitRouter = requiredAddress(permit[1]);
  const permitWallet = requiredAddress(permit[2]);
  const permitKind = requiredBigInt(permit[3]);
  const permitRouteHash = exactLowerBytes32(permit[4]);
  const permitExpectedResultHash = exactLowerBytes32(permit[5]);
  const permitStampHash = exactLowerBytes32(permit[6]);
  const permitNonce = exactNonzeroLowerBytes32(permit[7]);
  const validAfter = requiredBigInt(permit[8]);
  const deadline = requiredBigInt(permit[9]);
  const permitValue = requiredBigInt(permit[10]);
  const permitDigest = hashTypedData({
    domain: {
      name: "ProgrammableLaunchStampRouter",
      version: "1",
      chainId: Number(chainId),
      verifyingContract: action.to,
    },
    primaryType: "ProgrammableLaunchPermitV1",
    types: {
      ProgrammableLaunchPermitV1: [
        { name: "chainId", type: "uint256" },
        { name: "router", type: "address" },
        { name: "launchWallet", type: "address" },
        { name: "kind", type: "uint8" },
        { name: "routePayloadHash", type: "bytes32" },
        { name: "expectedResultHash", type: "bytes32" },
        { name: "stampRequestHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
        { name: "validAfter", type: "uint64" },
        { name: "deadline", type: "uint64" },
        { name: "value", type: "uint256" },
      ],
    },
    message: {
      chainId: permitChainId,
      router: permitRouter,
      launchWallet: permitWallet,
      kind: Number(permitKind),
      routePayloadHash: permitRouteHash,
      expectedResultHash: permitExpectedResultHash,
      stampRequestHash: permitStampHash,
      nonce: permitNonce,
      validAfter,
      deadline,
      value: permitValue,
    },
  });
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (
    permitChainId !== chainId
    || !sameAddress(permitRouter, action.to)
    || deadline <= validAfter || deadline - validAfter > customLaunchMaximumLifetimeSecondsV1(action.to)
    || !sameAddress(permitWallet, action.from)
    || permitKind !== 1n
    || permitRouteHash !== keccak256(routePayload)
    || validAfter > now
    || deadline <= now + MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS
    || permitValue !== BigInt(action.valueWei)
    || permitNonce === ZERO_BYTES32
    || permitDigest !== expectedPermitDigest
  ) return invalid();

  let routeDecoded: readonly unknown[];
  try {
    const decodedRoute = decodeAbiParameters(
      CUSTOM_GRAPH_ROUTE_PARAMETER_V1,
      routePayload,
    );
    const canonicalRoute = encodeAbiParameters(
      CUSTOM_GRAPH_ROUTE_PARAMETER_V1,
      decodedRoute as never,
    );
    if (canonicalRoute !== routePayload) return invalid();
    routeDecoded = tuple(decodedRoute[0], 7);
  } catch {
    return invalid();
  }
  const routeNamespace = exactNonzeroLowerBytes32(routeDecoded[0]);
  const routeNonce = exactNonzeroLowerBytes32(routeDecoded[1]);
  const topologyHash = exactNonzeroLowerBytes32(routeDecoded[2]);
  const graphCommitment = exactNonzeroLowerBytes32(routeDecoded[3]);
  const targets = tupleArray(routeDecoded[4], 3, 16, 6);
  const expectedOutputs = tupleArray(routeDecoded[5], 3, 16, 4);
  const expectedGraphDeploymentHash = exactNonzeroLowerBytes32(routeDecoded[6]);
  if (
    graphCommitment !== expectedGraphCommitment
    || expectedOutputs.length !== targets.length
  ) return invalid();

  let totalValue = 0n;
  const targetCommitments: Hex[] = [];
  const preparedTargets: Array<Readonly<{
    targetIdHash: Hex;
    applicantSalt: Hex;
    deploymentValue: bigint;
    initializerValue: bigint;
    initCodeHash: Hex;
    initializerCalldataHash: Hex;
    predictedAddress: Address;
    effectiveSalt: Hex;
    expectedRuntimeCodeHash: Hex;
  }>> = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    const output = expectedOutputs[index]!;
    const targetIdHash = exactNonzeroLowerBytes32(target[0]);
    const applicantSalt = exactLowerBytes32(target[1]);
    const deploymentValue = requiredBigInt(target[2]);
    const initializerValue = requiredBigInt(target[3]);
    const initCode = exactLowerHexData(target[4]);
    const initializerCalldata = optionalLowerHexData(target[5]);
    const initCodeHash = keccak256(initCode);
    const initializerCalldataHash = keccak256(initializerCalldata);
    const effectiveSalt = abiHash(
      "bytes32,uint256,address,bytes32,bytes32,bytes32,bytes32,address",
      [
        GRAPH_TARGET_SALT_TYPEHASH,
        chainId,
        graphFactory,
        routeNamespace,
        routeNonce,
        targetIdHash,
        applicantSalt,
        action.to,
      ],
    );
    const predictedAddress = getCreate2Address({
      from: graphFactory,
      salt: effectiveSalt,
      bytecodeHash: initCodeHash,
    });
    const outputIndex = requiredBigInt(output[0]);
    const outputTargetIdHash = exactNonzeroLowerBytes32(output[1]);
    const outputAddress = requiredAddress(output[2]);
    const expectedRuntimeCodeHash = exactNonzeroLowerBytes32(output[3]);
    if (
      outputIndex !== BigInt(index)
      || outputTargetIdHash !== targetIdHash
      || !sameAddress(outputAddress, predictedAddress)
    ) return invalid();
    totalValue = checkedAdd(totalValue, deploymentValue);
    totalValue = checkedAdd(totalValue, initializerValue);
    targetCommitments.push(abiHash(
      "bytes32,uint256,bytes32,bytes32,uint256,uint256,bytes32,bytes32",
      [
        GRAPH_TARGET_COMMITMENT_TYPEHASH,
        BigInt(index),
        targetIdHash,
        applicantSalt,
        deploymentValue,
        initializerValue,
        initCodeHash,
        initializerCalldataHash,
      ],
    ));
    preparedTargets.push(Object.freeze({
      targetIdHash,
      applicantSalt,
      deploymentValue,
      initializerValue,
      initCodeHash,
      initializerCalldataHash,
      predictedAddress,
      effectiveSalt,
      expectedRuntimeCodeHash,
    }));
  }
  const targetCommitmentsHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32[]"),
    [targetCommitments],
  ));
  const computedGraphCommitment = abiHash(
    "bytes32,uint256,address,bytes32,bytes32,bytes32,address,uint256,bytes32",
    [
      GRAPH_COMMITMENT_TYPEHASH,
      chainId,
      graphFactory,
      routeNamespace,
      routeNonce,
      topologyHash,
      action.to,
      totalValue,
      targetCommitmentsHash,
    ],
  );
  if (
    computedGraphCommitment !== graphCommitment
    || totalValue !== permitValue
    || !preparedTargets.some((target) =>
      target.initializerCalldataHash === expectedInitializerCalldataHash)
  ) return invalid();

  let graphDeploymentHash = graphCommitment;
  const outputHashes: Hex[] = [];
  for (let index = 0; index < preparedTargets.length; index += 1) {
    const target = preparedTargets[index]!;
    graphDeploymentHash = abiHash(
      "bytes32,bytes32,uint256,bytes32,address,bytes32,bytes32,bytes32,bytes32,uint256,uint256",
      [
        GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH,
        graphDeploymentHash,
        BigInt(index),
        target.targetIdHash,
        target.predictedAddress,
        target.effectiveSalt,
        target.initCodeHash,
        target.initializerCalldataHash,
        target.expectedRuntimeCodeHash,
        target.deploymentValue,
        target.initializerValue,
      ],
    );
    outputHashes.push(abiHash(
      "bytes32,uint8,bytes32,address,bytes32",
      [
        EXPECTED_GRAPH_OUTPUT_TYPEHASH,
        index,
        target.targetIdHash,
        target.predictedAddress,
        target.expectedRuntimeCodeHash,
      ],
    ));
  }
  if (graphDeploymentHash !== expectedGraphDeploymentHash) return invalid();
  const expectedResultHash = abiHash(
    "bytes32,bytes32,bytes32",
    [
      EXPECTED_GRAPH_RESULT_TYPEHASH,
      packedHash(outputHashes),
      graphDeploymentHash,
    ],
  );
  if (expectedResultHash !== permitExpectedResultHash) return invalid();

  const launchId = exactNonzeroLowerBytes32(stamp[0]);
  const token = requiredAddress(stamp[1]);
  const tokenRuntimeCodeHash = exactNonzeroLowerBytes32(stamp[2]);
  const poolKey = tuple(stamp[3], 5);
  const hookRuntimeCodeHash = exactNonzeroLowerBytes32(stamp[4]);
  const components = tupleArray(stamp[5], targets.length, targets.length, 5);
  const currency0 = requiredAddress(poolKey[0]);
  const currency1 = requiredAddress(poolKey[1]);
  const fee = requiredBigInt(poolKey[2]);
  const tickSpacing = requiredBigInt(poolKey[3]);
  const hooks = requiredAddress(poolKey[4]);
  if (
    BigInt(currency0.toLowerCase()) >= BigInt(currency1.toLowerCase())
    || fee < 0n
    || (fee > V4_MAXIMUM_STATIC_FEE && fee !== V4_DYNAMIC_FEE_SENTINEL)
    || tickSpacing < 1n
    || tickSpacing > 32_767n
    || (!sameAddress(currency0, token) && !sameAddress(currency1, token))
    || sameAddress(hooks, ZERO_ADDRESS)
  ) return invalid();

  const seenResultIndices = new Set<number>();
  const componentHashes: Hex[] = [];
  let priorAccount = -1n;
  let tokenCount = 0;
  let hookCount = 0;
  for (const component of components) {
    const resultIndex = Number(requiredBigInt(component[0]));
    const account = requiredAddress(component[1]);
    const runtimeCodeHash = exactNonzeroLowerBytes32(component[2]);
    const kind = Number(requiredBigInt(component[3]));
    const scope = Number(requiredBigInt(component[4]));
    const accountNumeric = BigInt(account.toLowerCase());
    const target = preparedTargets[resultIndex];
    if (
      !target
      || seenResultIndices.has(resultIndex)
      || accountNumeric <= priorAccount
      || !sameAddress(account, target.predictedAddress)
      || runtimeCodeHash !== target.expectedRuntimeCodeHash
      || ![0, 1, 2].includes(kind)
      || scope !== 1
    ) return invalid();
    seenResultIndices.add(resultIndex);
    priorAccount = accountNumeric;
    if (kind === 1) {
      tokenCount += 1;
      if (!sameAddress(account, token) || runtimeCodeHash !== tokenRuntimeCodeHash) {
        return invalid();
      }
    }
    if (kind === 2) {
      hookCount += 1;
      if (!sameAddress(account, hooks) || runtimeCodeHash !== hookRuntimeCodeHash) {
        return invalid();
      }
    }
    componentHashes.push(abiHash(
      "bytes32,uint8,address,bytes32,uint8,uint8",
      [COMPONENT_TYPEHASH, resultIndex, account, runtimeCodeHash, kind, scope],
    ));
  }
  if (
    seenResultIndices.size !== targets.length
    || tokenCount !== 1
    || hookCount !== 1
  ) return invalid();
  const poolKeyHash = abiHash(
    "bytes32,address,address,uint24,int24,address",
    [POOL_KEY_TYPEHASH, currency0, currency1, fee, tickSpacing, hooks],
  );
  const stampHash = abiHash(
    "bytes32,bytes32,address,bytes32,bytes32,bytes32,bytes32",
    [
      STAMP_REQUEST_TYPEHASH,
      launchId,
      token,
      tokenRuntimeCodeHash,
      poolKeyHash,
      hookRuntimeCodeHash,
      packedHash(componentHashes),
    ],
  );
  if (stampHash !== permitStampHash) return invalid();
}

function fundingTypedDataDigest(
  typedData: CustomLaunchFundingTypedDataV3,
): Hex {
  try {
    return hashTypedData(typedDataForViem(typedData));
  } catch {
    return invalid();
  }
}

function typedDataForViem(typedData: CustomLaunchFundingTypedDataV3) {
  return {
    domain: typedData.domain,
    primaryType: typedData.primaryType,
    types: typedData.types,
    message: {
      from: typedData.message.from,
      to: typedData.message.to,
      value: BigInt(typedData.message.value),
      validAfter: BigInt(typedData.message.validAfter),
      validBefore: BigInt(typedData.message.validBefore),
      nonce: typedData.message.nonce,
    },
  } as const;
}

function exactReceiveWithAuthorizationTypes(value: unknown) {
  if (!Array.isArray(value) || value.length !== RECEIVE_WITH_AUTHORIZATION_TYPES.length) {
    return false;
  }
  return value.every((candidate, index) => {
    if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") {
      return false;
    }
    const record = candidate as Record<string, unknown>;
    const expected = RECEIVE_WITH_AUTHORIZATION_TYPES[index]!;
    return Object.keys(record).length === 2
      && record.name === expected.name
      && record.type === expected.type;
  });
}

function canonicalFundingSignature(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{130}$/u.test(value)) {
    return invalid();
  }
  const r = BigInt(`0x${value.slice(2, 66)}`);
  const s = BigInt(`0x${value.slice(66, 130)}`);
  const v = Number.parseInt(value.slice(130, 132), 16);
  if (
    r === 0n
    || r >= SECP256K1_ORDER
    || s === 0n
    || s > SECP256K1_HALF_ORDER
    || (v !== 27 && v !== 28)
  ) return invalid();
  return value as Hex;
}

function assertFundingBoundaryV3(value: unknown) {
  const boundary = exactRecord(value, FUNDING_BOUNDARY_KEYS);
  if (
    boundary.approvalTransactionRequired !== false
    || boundary.permit2Used !== false
    || boundary.fundingSignatureProducedByService !== false
    || boundary.walletTransactionBroadcastByService !== false
  ) return invalid();
}

function authorizationOutputRecord(value: unknown) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return invalid();
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const stageKeys = candidate.stage === "simulating"
    ? SIMULATING_OUTPUT_KEYS
    : candidate.stage === "router-transaction-required"
      ? AUTHORIZED_OUTPUT_KEYS
      : OUTPUT_KEYS;
  const hasBehaviorEvidence = Object.hasOwn(candidate, "behaviorEvidence");
  const hasBehaviorAssurance = Object.hasOwn(candidate, "behaviorAssurance");
  if (hasBehaviorEvidence !== hasBehaviorAssurance) return invalid();
  const expectedKeys = [
    ...stageKeys,
    ...(hasBehaviorEvidence ? BEHAVIOR_OUTPUT_KEYS : []),
    ...(Object.hasOwn(candidate, "platformAdmission")
      ? ["platformAdmission"]
      : []),
  ];
  const output = exactRecord(candidate, expectedKeys);
  if (Object.hasOwn(output, "platformAdmission")) {
    assertPlatformAdmissionStatusV1(output.platformAdmission);
  }
  if (hasBehaviorEvidence) {
    const evidence = assertBehaviorEvidenceSummaryV3(output.behaviorEvidence);
    assertBehaviorAssuranceV3(output.behaviorAssurance, evidence);
  }
  if (output.stage === "simulating") assertSimulatingOutputV3(output);
  return output;
}

function assertSimulatingOutputV3(
  output: Readonly<Record<string, unknown>>,
) {
  if (output.actionRequired !== null
    || exactSha256(output.launchProfileHash) !== output.launchProfileHash
    || typeof output.initializerTargetId !== "string"
    || !CANONICAL_IDENTIFIER.test(output.initializerTargetId)
    || ![
      "none",
      "wallet-transaction-value",
      "eip-3009-receive-with-authorization",
    ].includes(String(output.fundingMode))
    || output.onchain !== null
    || output.simulation !== null) {
    return invalid();
  }
  const permitWindow = exactRecord(output.permitWindow, PERMIT_WINDOW_KEYS);
  const validAfter = canonicalUint256(permitWindow.validAfter).parsed;
  const deadline = canonicalUint256(permitWindow.deadline).parsed;
  if (deadline <= validAfter || deadline - validAfter > 86_400n) {
    return invalid();
  }
  const transaction = assertExactWalletTransactionV3(output.walletTransaction);
  const action = exactWalletActionV3(transaction);
  const transactionPreimageHash = exactSha256(output.transactionPreimageHash);
  if (customLaunchWalletTransactionPreimageHashV2(action) !== transactionPreimageHash) {
    return invalid();
  }
  assertPreparedArtifactBindingsV3(output.artifact, Object.freeze({
    artifactHash: undefined,
    graphCommitment: undefined,
    permitDigest: undefined,
    initializerCalldataHash: undefined,
    transaction,
  }));
  assertSignedPermitV3(output.signedPermit, Object.freeze({
    artifactHash: undefined,
    permitDigest: undefined,
    router: transaction.to,
  }));
  assertObservationWindowV3(output.observationWindow, transaction.to);
}

function assertAuthorizedEvidenceV3(
  output: Readonly<Record<string, unknown>>,
  actionRequired: Readonly<Record<string, unknown>>,
  transaction: Readonly<Record<string, unknown>>,
  action: CustomLaunchWalletActionV1,
) {
  const topLevelTransaction = assertExactWalletTransactionV3(
    output.walletTransaction,
  );
  assertSameExactWalletTransactionV3(transaction, topLevelTransaction);
  const artifactHash = exactSha256(actionRequired.artifactHash);
  const graphCommitment = exactNonzeroLowerBytes32(
    actionRequired.graphCommitment,
  );
  const permitDigest = exactNonzeroLowerBytes32(actionRequired.permitDigest);
  const initializerCalldataHash = exactNonzeroLowerBytes32(
    actionRequired.initializerCalldataHash,
  );
  assertPreparedArtifactBindingsV3(output.artifact, Object.freeze({
    artifactHash,
    graphCommitment,
    permitDigest,
    initializerCalldataHash,
    transaction,
  }));
  assertSignedPermitV3(output.signedPermit, Object.freeze({
    artifactHash,
    permitDigest,
    router: transaction.to,
  }));
  assertObservationWindowV3(output.observationWindow, transaction.to);
  if (output.onchain !== null) {
    assertOnchainEvidenceV3(output.onchain, transaction.to);
  }
  const simulation = assertSimulationEvidenceV3(
    output.simulation,
    customLaunchWalletTransactionPreimageHashV2(action),
  );
  const hasTopLevelBehavior = Object.hasOwn(output, "behaviorEvidence");
  const hasSimulationBehavior = Object.hasOwn(simulation, "behaviorEvidence");
  if (hasTopLevelBehavior !== hasSimulationBehavior) return invalid();
  if (hasTopLevelBehavior
    && JSON.stringify(output.behaviorEvidence)
      !== JSON.stringify(simulation.behaviorEvidence)) return invalid();
}

function assertCurrentRouterHandoffV3(
  action: Readonly<Record<string, unknown>>,
  chainId: "1" | "8453" | "999" | undefined,
) {
  if (typeof action.walletHandoffUrl !== "string"
    || typeof action.expiresAt !== "string") return invalid();
  let url: URL;
  try {
    url = new URL(action.walletHandoffUrl);
  } catch {
    return invalid();
  }
  const launchIds = url.searchParams.getAll("launchId");
  if (url.origin !== "https://programmable.market"
    || url.pathname !== "/developers/api-keys"
    || url.hash !== ""
    || launchIds.length !== 1
    || !UUID.test(launchIds[0] ?? "")
    || (chainId && chainId !== "1" ? url.searchParams.getAll("chainId").join() !== chainId : url.searchParams.has("chainId"))
    || [...url.searchParams.keys()].some((key) => key !== "launchId" && !(chainId && chainId !== "1" && key === "chainId"))
    || url.toString() !== action.walletHandoffUrl) return invalid();
  const expiresAtMs = Date.parse(action.expiresAt);
  if (!Number.isFinite(expiresAtMs)
    || new Date(expiresAtMs).toISOString() !== action.expiresAt) return invalid();
}

function assertExactWalletTransactionV3(
  value: unknown,
): Readonly<Record<string, unknown>> {
  const transaction = exactRecord(value, EXACT_TRANSACTION_KEYS);
  const chainId = customLaunchChainForRouterV1(transaction.to);
  if (transaction.schemaVersion !== CUSTOM_LAUNCH_EXACT_WALLET_TRANSACTION_SCHEMA_V3
    || !chainId || transaction.chainId !== chainId) return invalid();
  requiredAddress(transaction.from);
  requiredAddress(transaction.to);
  canonicalUint256(transaction.valueWei);
  exactLowerHexData(transaction.calldata);
  return transaction;
}

function exactWalletActionV3(
  transaction: Readonly<Record<string, unknown>>,
): CustomLaunchWalletActionV1 {
  const valueWei = canonicalUint256(transaction.valueWei);
  const chainId = customLaunchChainForRouterV1(transaction.to);
  if (!chainId || transaction.chainId !== chainId) return invalid();
  return Object.freeze({
    chainId,
    from: requiredAddress(transaction.from),
    to: requiredAddress(transaction.to),
    data: exactLowerHexData(transaction.calldata),
    value: toHex(valueWei.parsed),
    valueWei: valueWei.source,
  });
}

function assertSameExactWalletTransactionV3(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
) {
  if (left.schemaVersion !== right.schemaVersion
    || left.chainId !== right.chainId
    || !sameAddress(left.from, right.from)
    || !sameAddress(left.to, right.to)
    || left.valueWei !== right.valueWei
    || left.calldata !== right.calldata) return invalid();
}

function assertPreparedArtifactBindingsV3(
  value: unknown,
  expected: Readonly<{
    artifactHash: `sha256:${string}` | undefined;
    graphCommitment: Hex | undefined;
    permitDigest: Hex | undefined;
    initializerCalldataHash: Hex | undefined;
    transaction: Readonly<Record<string, unknown>>;
  }>,
) {
  const artifact = record(value);
  const route = record(artifact.route);
  const unsigned = record(artifact.unsignedRouterTransaction);
  const artifactHash = exactSha256(artifact.artifactHash);
  const permitDigest = exactNonzeroLowerBytes32(artifact.permitDigest);
  const graphCommitment = exactNonzeroLowerBytes32(route.graphCommitment);
  if (artifact.schemaVersion !== "programmable.prepared-custom-graph-launch.v1"
    || (expected.artifactHash !== undefined && artifactHash !== expected.artifactHash)
    || (expected.permitDigest !== undefined && permitDigest !== expected.permitDigest)
    || (expected.graphCommitment !== undefined && graphCommitment !== expected.graphCommitment)
    || unsigned.chainId !== expected.transaction.chainId
    || !sameAddress(unsigned.from, expected.transaction.from)
    || !sameAddress(unsigned.to, expected.transaction.to)
    || unsigned.valueWei !== expected.transaction.valueWei) return invalid();
  if (expected.initializerCalldataHash !== undefined) {
    if (!Array.isArray(route.targets) || !route.targets.some((target) => {
      if (target === null || Array.isArray(target) || typeof target !== "object") {
        return false;
      }
      return (target as Readonly<Record<string, unknown>>).initializerCalldataHash
        === expected.initializerCalldataHash;
    })) return invalid();
  }
}

function assertSignedPermitV3(
  value: unknown,
  expected: Readonly<{
    artifactHash: `sha256:${string}` | undefined;
    permitDigest: Hex | undefined;
    router: unknown;
  }>,
) {
  const isBase = ["8453","999"].includes(customLaunchChainForRouterV1(expected.router) ?? "");
  const evmRoots=customLaunchChainForRouterV1(expected.router) === "999" ? HYPEREVM_CUSTOM_ROOTS_V1 : BASE_CUSTOM_ROOTS_V1;
  const permit = exactRecord(value, isBase
    ? [...SIGNED_PERMIT_KEYS, "releaseId"] : SIGNED_PERMIT_KEYS);
  if (isBase) exactSha256(permit.releaseId);
  const validAfter = canonicalUint256(permit.validAfter).parsed;
  const deadline = canonicalUint256(permit.deadline).parsed;
  if (permit.schemaVersion !== "programmable.signed-prepared-launch-permit.v1"
    || !customLaunchChainForRouterV1(expected.router) || permit.chainId !== customLaunchChainForRouterV1(expected.router)
    || (["8453","999"].includes(String(permit.chainId)) && (!sameAddress(permit.authoritySafe, evmRoots.permitAuthority) || !sameAddress(permit.signerAddress, evmRoots.permitSigner)))
    || (expected.artifactHash !== undefined
      && exactSha256(permit.artifactHash) !== expected.artifactHash)
    || (expected.permitDigest !== undefined
      && exactNonzeroLowerBytes32(permit.permitDigest) !== expected.permitDigest)
    || !sameAddress(permit.router, expected.router)
    || !isAddress(String(permit.authoritySafe))
    || !isAddress(String(permit.signerAddress))
    || exactLowerBytes32(permit.safeMessageDigest) !== permit.safeMessageDigest
    || exactLowerHexData(permit.signature) !== permit.signature
    || deadline <= validAfter
    || deadline - validAfter > customLaunchMaximumLifetimeSecondsV1(permit.router)) return invalid();
  exactSha256(permit.artifactHash);
  exactNonzeroLowerBytes32(permit.permitDigest);
}

function assertObservationWindowV3(value: unknown, router: unknown) {
  const observation = exactRecord(value, OBSERVATION_WINDOW_KEYS);
  const fromBlock = canonicalUint256(observation.fromBlock).parsed;
  const toBlock = canonicalUint256(observation.toBlock).parsed;
  if (observation.schemaVersion !== "programmable.custom-launch-observation-window.v1"
    || !customLaunchChainForRouterV1(router) || observation.chainId !== customLaunchChainForRouterV1(router)
    || !sameAddress(observation.router, router)
    || toBlock < fromBlock) return invalid();
}

function assertOnchainEvidenceV3(value: unknown, router: unknown) {
  const candidate = record(value);
  const evidence = exactRecord(candidate, Object.hasOwn(
    candidate,
    "finalizedCheckpoint",
  ) ? [...ONCHAIN_EVIDENCE_KEYS, "finalizedCheckpoint"] : ONCHAIN_EVIDENCE_KEYS);
  const confirmationDepth = canonicalUint256(evidence.confirmationDepth).parsed;
  const observedAt = canonicalUint256(evidence.observedAtBlockNumber).parsed;
  const blockNumber = canonicalUint256(evidence.blockNumber).parsed;
  if (evidence.schemaVersion !== "programmable.custom-launch-onchain-evidence.v1"
    || !["submitted", "finalized"].includes(String(evidence.finalityState))
    || !customLaunchChainForRouterV1(router) || evidence.chainId !== customLaunchChainForRouterV1(router)
    || !sameAddress(evidence.router, router)
    || exactLowerBytes32(evidence.onchainLaunchId) !== evidence.onchainLaunchId
    || exactLowerBytes32(evidence.transactionHash) !== evidence.transactionHash
    || blockNumber === 0n
    || exactLowerBytes32(evidence.blockHash) !== evidence.blockHash
    || typeof evidence.logIndex !== "number"
    || !Number.isSafeInteger(evidence.logIndex)
    || evidence.logIndex < 0
    || !isAddress(String(evidence.token))
    || !isAddress(String(evidence.hook))
    || !isAddress(String(evidence.poolManager))
    || exactLowerBytes32(evidence.poolId) !== evidence.poolId
    || exactLowerBytes32(evidence.stampHash) !== evidence.stampHash
    || evidence.requiredConfirmationDepth !== "64"
    || observedAt < blockNumber
    || (evidence.finalityState === "finalized" && confirmationDepth < 64n)) {
    return invalid();
  }
  if (Object.hasOwn(evidence, "finalizedCheckpoint")) {
    assertFinalizedCheckpointV3(evidence.finalizedCheckpoint, Object.freeze({
      chainId: customLaunchChainForRouterV1(router)!,
      launchBlockNumber: blockNumber,
      observedAtBlockNumber: observedAt,
      launchFinalityState: evidence.finalityState,
    }));
  }
}

function assertFinalizedCheckpointV3(
  value: unknown,
  context: Readonly<{
    chainId: "1" | "8453" | "999";
    launchBlockNumber: bigint;
    observedAtBlockNumber: bigint;
    launchFinalityState: unknown;
  }>,
) {
  const checkpoint = exactRecord(value, FINALIZED_CHECKPOINT_KEYS);
  const blockNumber = canonicalUint256(checkpoint.blockNumber).parsed;
  const blockHash = exactLowerBytes32(checkpoint.blockHash);
  if (checkpoint.schemaVersion
      !== (context.chainId === "999" ? "programmable.hyperevm-launch-finalized-checkpoint-quorum.v1" : context.chainId === "8453" ? "programmable.base-launch-finalized-checkpoint-quorum.v1" : "programmable.ethereum-finalized-checkpoint-quorum.v1")
    || checkpoint.quorumSize !== 2
    || blockNumber > context.observedAtBlockNumber
    || (context.launchFinalityState === "finalized"
      && blockNumber < context.launchBlockNumber)
    || !Array.isArray(checkpoint.observations)
    || checkpoint.observations.length !== 2) return invalid();
  const observations = checkpoint.observations.map((value, index) => {
    const observation = exactRecord(
      value,
      FINALIZED_PROVIDER_OBSERVATION_KEYS,
    );
    const finalizedBlockNumber = canonicalUint256(
      observation.finalizedBlockNumber,
    ).parsed;
    const finalizedBlockHash = exactLowerBytes32(
      observation.finalizedBlockHash,
    );
    if (observation.provider !== (index === 0 ? "primary" : "secondary")
      || finalizedBlockNumber < blockNumber
      || exactLowerBytes32(observation.commonBlockHash) !== blockHash) {
      return invalid();
    }
    return Object.freeze({ finalizedBlockNumber, finalizedBlockHash });
  });
  const minimumProviderBlock = observations[0]!.finalizedBlockNumber
      < observations[1]!.finalizedBlockNumber
    ? observations[0]!
    : observations[1]!;
  if (blockNumber !== minimumProviderBlock.finalizedBlockNumber
    || observations.some((observation) =>
      observation.finalizedBlockNumber === blockNumber
      && observation.finalizedBlockHash !== blockHash)) return invalid();
}

function assertSimulationEvidenceV3(
  value: unknown,
  expectedTransactionPreimageHash: `sha256:${string}`,
) {
  const candidate = record(value);
  const hasBehaviorEvidence = Object.hasOwn(candidate, "behaviorEvidence");
  const simulation = exactRecord(
    candidate,
    hasBehaviorEvidence ? [...SIMULATION_KEYS, "behaviorEvidence"] : SIMULATION_KEYS,
  );
  if (simulation.outcome !== "passed"
    || exactSha256(simulation.transactionPreimageHash)
      !== expectedTransactionPreimageHash
    || exactSha256(simulation.profileHash) !== simulation.profileHash
    || canonicalUint256(simulation.blockNumber).parsed === 0n
    || exactLowerBytes32(simulation.blockHash) !== simulation.blockHash
    || canonicalUint256(simulation.blockTimestamp).parsed === 0n
    || exactSha256(simulation.responseDigest) !== simulation.responseDigest
    || canonicalUint256(simulation.gasEstimate).parsed === 0n) return invalid();
  if (hasBehaviorEvidence) {
    assertBehaviorEvidenceSummaryV3(simulation.behaviorEvidence);
  }
  return simulation;
}

function assertPlatformAdmissionStatusV1(value: unknown) {
  const candidate = record(value);
  const isCurrent = Object.hasOwn(candidate, "riskClassification")
    || Object.hasOwn(candidate, "behaviorEvidence")
    || Object.hasOwn(candidate, "productTruthAxes")
    || Object.hasOwn(candidate, "needsEvidenceFindingCodes");
  const status = exactRecord(
    candidate,
    isCurrent ? PLATFORM_ADMISSION_V3_KEYS : PLATFORM_ADMISSION_KEYS,
  );
  if (!Array.isArray(status.warningFindingCodes)
    || status.warningFindingCodes.some((code) =>
      typeof code !== "string" || !PLATFORM_FINDING_CODE.test(code))
    || new Set(status.warningFindingCodes).size !== status.warningFindingCodes.length
    || status.schemaVersion !== "programmable.platform-admission-status.v1"
    || status.disposition !== "no_blocking_static_finding"
    || exactSha256(status.reportSha256) !== status.reportSha256
    || status.routerSimulationRequiredBeforeAuthorization !== true
    || status.safetyClaim !== false
    || status.feeBehaviorClaim !== false) {
    return invalid();
  }
  if (isCurrent) assertCurrentPlatformAdmissionV3(status);
}

function assertCurrentPlatformAdmissionV3(
  status: Readonly<Record<string, unknown>>,
) {
  if (!Array.isArray(status.needsEvidenceFindingCodes)
    || status.needsEvidenceFindingCodes.some((code) =>
      typeof code !== "string" || !PLATFORM_FINDING_CODE.test(code))
    || new Set(status.needsEvidenceFindingCodes).size
      !== status.needsEvidenceFindingCodes.length
    || JSON.stringify(status.warningFindingCodes)
      !== JSON.stringify(status.needsEvidenceFindingCodes)) return invalid();
  const risk = record(status.riskClassification);
  const eligibility = record(risk.launchEligibility);
  if (risk.schemaVersion !== "programmable.platform-admission-risk-classification.v3"
    || risk.classifierVersion !== "1.1.0"
    || risk.evidenceAuthority !== "deterministic-static-classification"
    || risk.disposition !== "needs_evidence"
    || risk.evidenceTierStatus !== "required"
    || risk.approvalAuthority !== false
    || risk.safetyClaim !== false
    || risk.feeBehaviorClaim !== false
    || eligibility.deployable !== true
    || eligibility.routable !== false
    || eligibility.featured !== false
    || eligibility.basis !== "static-admission-only") return invalid();
  const behavior = assertBehaviorEvidenceSummaryV3(status.behaviorEvidence);
  if (behavior.status !== "not_executed") return invalid();
  const truth = record(status.productTruthAxes);
  if (record(truth.deployment).status !== "eligible"
    || record(truth.trading).status !== "not_verified"
    || record(truth.platform_fee_evidence).status !== "not_verified") {
    return invalid();
  }
}

function assertBehaviorEvidenceSummaryV3(value: unknown) {
  const summary = exactRecord(value, BEHAVIOR_EVIDENCE_KEYS);
  const requirements = record(summary.requirements);
  if (summary.schemaVersion !== "programmable.custom-launch-behavior-summary.v1"
    || exactSha256(summary.subjectSha256) !== summary.subjectSha256
    || requirements.schemaVersion
      !== "programmable.custom-launch-behavior-requirements.v1"
    || !["1.1.0", "1.2.0", "1.3.0"].includes(String(requirements.vectorSetVersion))
    || !Number.isInteger(requirements.hookPermissionMask)
    || Number(requirements.hookPermissionMask) < 0
    || Number(requirements.hookPermissionMask) > 16_383
    || exactSha256(requirements.requirementsSha256)
      !== requirements.requirementsSha256
    || !["required", "not_executed", "verified", "failed"]
      .includes(String(summary.status))
    || !Array.isArray(summary.vectors)
    || summary.vectors.length < 16
    || summary.vectors.length > 20
    || !Array.isArray(summary.outstandingVectorIds)
    || new Set(summary.outstandingVectorIds).size
      !== summary.outstandingVectorIds.length
    || summary.outstandingVectorIds.some((id) =>
      typeof id !== "string" || !CANONICAL_IDENTIFIER.test(id))
    || summary.status === "failed") return invalid();
  if (summary.execution !== null) {
    const execution = record(summary.execution);
    if (execution.schemaVersion
        !== "programmable.custom-launch-behavior-execution.v1"
      || execution.evidenceAuthority !== "platform-runtime-executor"
      || exactSha256(execution.subjectSha256) !== summary.subjectSha256
      || exactSha256(execution.requirementsSha256)
        !== requirements.requirementsSha256) return invalid();
  }
  return summary;
}

function assertBehaviorAssuranceV3(
  value: unknown,
  evidence: Readonly<Record<string, unknown>>,
) {
  const assurance = exactRecord(value, BEHAVIOR_ASSURANCE_KEYS);
  if (assurance.schemaVersion
      !== "programmable.custom-launch-behavior-assurance.v1"
    || assurance.authorizationScope !== "exact-launch-provenance-only"
    || typeof assurance.mutableAuthorityConditional !== "boolean"
    || !["platform-runtime-executor", "none"]
      .includes(String(assurance.evidenceAuthority))
    || !["executed", "not_executed"]
      .includes(String(assurance.behaviorExecution))) return invalid();
  const executed = evidence.execution !== null;
  if (assurance.behaviorExecution !== (executed ? "executed" : "not_executed")
    || assurance.evidenceAuthority
      !== (executed ? "platform-runtime-executor" : "none")) return invalid();
  for (const key of [
    "routability",
    "platformFeeConformance",
    "liquidityConformance",
  ] as const) {
    const axis = exactRecord(assurance[key], ["status", "basis"]);
    if (!["not_verified", "verified", "conditional"]
      .includes(String(axis.status))) return invalid();
  }
  const safety = exactRecord(assurance.safety, ["status", "basis"]);
  if (safety.status !== "not_verified"
    || safety.basis !== "no-universal-safety-claim") return invalid();
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  const result = record(value);
  const keys = Object.keys(result);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => !expectedKeys.includes(key))
  ) return invalid();
  return result;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function tuple(value: unknown, length: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) return invalid();
  return value;
}

function tupleArray(
  value: unknown,
  minimum: number,
  maximum: number,
  tupleLength: number,
): readonly (readonly unknown[])[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    return invalid();
  }
  return value.map((candidate) => tuple(candidate, tupleLength));
}

function requiredAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) return invalid();
  return getAddress(value);
}

function sameAddress(left: unknown, right: unknown) {
  return typeof left === "string"
    && typeof right === "string"
    && isAddress(left)
    && isAddress(right)
    && left.toLowerCase() === right.toLowerCase();
}

function canonicalUint256(value: unknown) {
  if (typeof value !== "string" || !CANONICAL_UINT.test(value)) return invalid();
  const parsed = BigInt(value);
  if (parsed > UINT256_MAXIMUM) return invalid();
  return Object.freeze({ source: value, parsed });
}

function requiredBigInt(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  return invalid();
}

function exactLowerBytes32(value: unknown): Hex {
  if (typeof value !== "string" || !BYTES32.test(value)) return invalid();
  return value as Hex;
}

function exactNonzeroLowerBytes32(value: unknown): Hex {
  const result = exactLowerBytes32(value);
  if (result === ZERO_BYTES32) return invalid();
  return result;
}

function exactLowerHexData(value: unknown): Hex {
  if (typeof value !== "string" || !LOWERCASE_HEX_DATA.test(value)) {
    return invalid();
  }
  return value as Hex;
}

function optionalLowerHexData(value: unknown): Hex {
  if (value === "0x") return value;
  return exactLowerHexData(value);
}

function exactSha256(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !SHA256_DIGEST.test(value)) return invalid();
  return value as `sha256:${string}`;
}

function checkedAdd(left: bigint, right: bigint) {
  const result = left + right;
  if (left < 0n || right < 0n || result > UINT256_MAXIMUM) return invalid();
  return result;
}

function abiHash(types: string, values: readonly unknown[]): Hex {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(types),
    values as never,
  ));
}

function packedHash(values: readonly Hex[]): Hex {
  return keccak256(values.length === 0 ? "0x" : concatHex(values));
}

function invalid(): never {
  throw new CustomLaunchWalletHandoffErrorV3();
}

// Keeps the browser and backend on the same SHA-256 primitive without ever
// exposing signature bytes in a review model.
export function customLaunchFundingReviewFingerprintV3(
  input: CustomLaunchFundingAuthorizationV3,
): `sha256:${string}` {
  return `sha256:${sha256(stringToHex([
    input.launchId,
    input.fundingIntentHash,
    input.typedDataDigest,
  ].join("\0"))).slice(2)}`;
}
