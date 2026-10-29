import { HYPEREVM_CUSTOM_ROOTS_V1 } from "./hyperevm-release-v1";
import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  isAddress,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { BASE_CUSTOM_ROOTS_V1 } from "./base-release-v1";
import { CANONICAL_LAUNCH_STAMP_V1 } from "@/lib/tokens";

export const CUSTOM_LAUNCH_WALLET_TRANSACTION_SCHEMA_V1 =
  "programmable.custom-launch-wallet-transaction.v1" as const;
export const CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1 =
  "0xe5f6b8cd" as const;
export const CUSTOM_LAUNCH_MAINNET_ROUTER_V1 =
  CANONICAL_LAUNCH_STAMP_V1.routerAddress;

export const CUSTOM_LAUNCH_MAINNET_ROUTER_24H_V1 = "0xBE4bF6Ac8c6F012E1C8f25747A9fBccB2FDAC4C3" as const;
export function customLaunchChainForRouterV1(value: unknown): "1" | "8453" | "999" | undefined {
  if (sameAddress(value, HYPEREVM_CUSTOM_ROOTS_V1.router)) return "999";
  if (sameAddress(value, BASE_CUSTOM_ROOTS_V1.router)) return "8453";
  if (sameAddress(value, CUSTOM_LAUNCH_MAINNET_ROUTER_V1) || sameAddress(value, CUSTOM_LAUNCH_MAINNET_ROUTER_24H_V1)) return "1";
  return undefined;
}
export function isCustomLaunchRouterV1(value: unknown): boolean {
  return customLaunchChainForRouterV1(value) !== undefined;
}
export function customLaunchMaximumLifetimeSecondsV1(router: unknown): bigint {
  return (sameAddress(router, CUSTOM_LAUNCH_MAINNET_ROUTER_24H_V1) || sameAddress(router, BASE_CUSTOM_ROOTS_V1.router) || sameAddress(router, HYPEREVM_CUSTOM_ROOTS_V1.router)) ? 86_400n : 3_600n;
}

const UINT256_MAXIMUM = (1n << 256n) - 1n;
const MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS = 30n;
const WALLET_TRANSACTION_KEYS = Object.freeze([
  "schemaVersion",
  "chainId",
  "from",
  "to",
  "valueWei",
  "functionName",
  "selector",
  "calldata",
  "signatureState",
  "requiresControllerWalletSignature",
  "broadcastByService",
]);
const WALLET_ACTION_KEYS = Object.freeze([
  "chainId",
  "from",
  "to",
  "data",
  "value",
  "valueWei",
]);
const LAUNCH_AND_STAMP_PARAMETERS_V1 = parseAbiParameters(
  "(uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes",
);

export type CustomLaunchWalletActionV1 = Readonly<{
  chainId: "1" | "8453" | "999";
  from: Address;
  to: Address;
  data: Hex;
  value: Hex;
  valueWei: string;
}>;

export type CustomLaunchAuthorizationResultSchema =
  | "programmable.custom-launch-authorization-result.v1"
  | "programmable.custom-launch-authorization-result.v2";

export class CustomLaunchWalletHandoffErrorV1 extends Error {
  constructor() {
    super(
      "The prepared transaction failed the wallet safety checks. Refresh the request and try again.",
    );
    this.name = "CustomLaunchWalletHandoffErrorV1";
  }
}

export function prepareCustomLaunchWalletActionV1(
  output: unknown,
  connectedController: string,
): CustomLaunchWalletActionV1 {
  return prepareCustomLaunchWalletActionForAuthorizationSchema(
    output,
    connectedController,
    "programmable.custom-launch-authorization-result.v1",
  );
}

/**
 * Shared exact Router parser for the additive V1 and V2 authorization
 * envelopes. The transaction, permit, and calldata contracts remain V1; only
 * the top-level result schema is route-versioned.
 */
export function prepareCustomLaunchWalletActionForAuthorizationSchema(
  output: unknown,
  connectedController: string,
  expectedResultSchema: CustomLaunchAuthorizationResultSchema,
): CustomLaunchWalletActionV1 {
  const controller = requiredAddress(connectedController);
  const result = record(output);
  if (result.schemaVersion !== expectedResultSchema) {
    return invalid();
  }

  const artifact = record(result.artifact);
  const permit = record(artifact.permit);
  const unsignedTransaction = record(artifact.unsignedRouterTransaction);
  const signedPermit = record(result.signedPermit);
  const observationWindow = record(result.observationWindow);
  const transaction = exactRecord(result.walletTransaction, WALLET_TRANSACTION_KEYS);

  if (
    transaction.schemaVersion !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SCHEMA_V1
    || transaction.chainId !== "1"
    || transaction.functionName !== "launchAndStampV1"
    || transaction.selector !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1
    || transaction.signatureState !== "permit-authority-signature-attached"
    || transaction.requiresControllerWalletSignature !== true
    || transaction.broadcastByService !== false
    || permit.chainId !== "1"
    || permit.kind !== 1
    || unsignedTransaction.chainId !== "1"
    || unsignedTransaction.functionName !== "launchAndStampV1"
    || unsignedTransaction.selector !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1
    || unsignedTransaction.signatureState !== "permit-authority-signature-required"
    || signedPermit.schemaVersion !== "programmable.signed-prepared-launch-permit.v1"
    || signedPermit.chainId !== "1"
    || observationWindow.schemaVersion !== "programmable.custom-launch-observation-window.v1"
    || observationWindow.chainId !== "1"
  ) return invalid();

  const from = requiredAddress(transaction.from);
  const to = requiredAddress(transaction.to);
  if (
    !sameAddress(from, controller)
    || customLaunchChainForRouterV1(to) !== "1"
    || !sameAddress(permit.router, to)
    || !sameAddress(permit.launchWallet, controller)
    || !sameAddress(unsignedTransaction.from, controller)
    || !sameAddress(unsignedTransaction.to, to)
    || !sameAddress(signedPermit.router, to)
    || !sameAddress(observationWindow.router, to)
  ) return invalid();

  const valueWei = canonicalUint256(transaction.valueWei);
  const validAfter = canonicalUint256(permit.validAfter);
  const deadline = canonicalUint256(permit.deadline);
  const nowUnixSeconds = BigInt(Math.floor(Date.now() / 1_000));
  const routePayloadHash = exactBytes32(permit.routePayloadHash);
  const expectedResultHash = exactBytes32(permit.expectedResultHash);
  const stampRequestHash = exactBytes32(permit.stampRequestHash);
  const nonce = exactNonzeroBytes32(permit.nonce);
  const permitDigest = exactBytes32(artifact.permitDigest);
  const signedPermitDigest = exactBytes32(signedPermit.permitDigest);
  const attachedSignature = exactHexData(signedPermit.signature, false);
  if (
    permit.valueWei !== valueWei.source
    || unsignedTransaction.valueWei !== valueWei.source
    || signedPermit.validAfter !== validAfter.source
    || signedPermit.deadline !== deadline.source
    || validAfter.parsed > nowUnixSeconds
    || deadline.parsed <=
      nowUnixSeconds + MINIMUM_WALLET_SUBMISSION_WINDOW_SECONDS
    || !sameHex(signedPermitDigest, permitDigest)
    || !sameSha256(signedPermit.artifactHash, artifact.artifactHash)
  ) return invalid();

  const call = decodeCanonicalCalldata(transaction.calldata);
  const unsignedCall = decodeCanonicalCalldata(
    unsignedTransaction.calldataWithEmptySignature,
  );
  const decodedPermit: unknown = call.decoded[0];

  if (
    !Array.isArray(decodedPermit)
    || !numericEquals(decodedPermit[0], 1n)
    || !sameAddress(decodedPermit[1], to)
    || !sameAddress(decodedPermit[2], controller)
    || !numericEquals(decodedPermit[3], 1n)
    || !sameHex(decodedPermit[4], routePayloadHash)
    || !sameHex(decodedPermit[5], expectedResultHash)
    || !sameHex(decodedPermit[6], stampRequestHash)
    || !sameHex(decodedPermit[7], nonce)
    || !numericEquals(decodedPermit[8], validAfter.parsed)
    || !numericEquals(decodedPermit[9], deadline.parsed)
    || !numericEquals(decodedPermit[10], valueWei.parsed)
    || unsignedCall.decoded[3] !== "0x"
    || !sameAbiValue(call.decoded[0], unsignedCall.decoded[0])
    || !sameAbiValue(call.decoded[1], unsignedCall.decoded[1])
    || !sameAbiValue(call.decoded[2], unsignedCall.decoded[2])
    || !sameHex(call.decoded[3], attachedSignature)
  ) return invalid();

  return assertCustomLaunchWalletActionV1(Object.freeze({
    chainId: "1" as const,
    from,
    to,
    data: call.calldata,
    value: toHex(valueWei.parsed),
    valueWei: valueWei.source,
  }), controller);
}

export function assertCustomLaunchWalletActionV1(
  input: unknown,
  connectedController: string,
): CustomLaunchWalletActionV1 {
  const controller = requiredAddress(connectedController);
  const action = exactRecord(input, WALLET_ACTION_KEYS);
  const from = requiredAddress(action.from);
  const to = requiredAddress(action.to);
  const valueWei = canonicalUint256(action.valueWei);
  const chainId = customLaunchChainForRouterV1(to);
  const call = decodeCanonicalCalldata(action.data);
  const decodedPermit: unknown = call.decoded[0];
  if (
    !chainId || action.chainId !== chainId
    || !sameAddress(from, controller)
    || !isCustomLaunchRouterV1(to)
    || typeof action.value !== "string"
    || action.value !== toHex(valueWei.parsed)
    || !Array.isArray(decodedPermit)
    || !numericEquals(decodedPermit[0], BigInt(chainId))
    || !sameAddress(decodedPermit[1], to)
    || !sameAddress(decodedPermit[2], controller)
    || !numericEquals(decodedPermit[3], 1n)
    || !numericEquals(decodedPermit[10], valueWei.parsed)
    || call.decoded[3] === "0x"
  ) return invalid();
  return Object.freeze({
    chainId,
    from,
    to,
    data: call.calldata,
    value: action.value as Hex,
    valueWei: valueWei.source,
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
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
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return invalid();
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAXIMUM) return invalid();
  return Object.freeze({ source: value, parsed });
}

function exactBytes32(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    return invalid();
  }
  return value as Hex;
}

function exactNonzeroBytes32(value: unknown): Hex {
  const result = exactBytes32(value);
  if (BigInt(result) === 0n) return invalid();
  return result;
}

function exactHexData(value: unknown, allowEmpty: boolean): Hex {
  if (
    typeof value !== "string"
    || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)
    || (!allowEmpty && value === "0x")
  ) return invalid();
  return value as Hex;
}

function exactCalldata(value: unknown): Hex {
  if (
    typeof value !== "string"
    || value.length < 10
    || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(value)
  ) return invalid();
  return value as Hex;
}

function decodeCanonicalCalldata(value: unknown) {
  const calldata = exactCalldata(value);
  if (
    calldata.slice(0, 10).toLowerCase()
      !== CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1
  ) return invalid();
  try {
    const decoded = decodeAbiParameters(
      LAUNCH_AND_STAMP_PARAMETERS_V1,
      `0x${calldata.slice(10)}`,
    );
    const canonical = `${CUSTOM_LAUNCH_WALLET_TRANSACTION_SELECTOR_V1}${
      encodeAbiParameters(LAUNCH_AND_STAMP_PARAMETERS_V1, decoded).slice(2)
    }`;
    if (canonical.toLowerCase() !== calldata.toLowerCase()) return invalid();
    return Object.freeze({ calldata, decoded });
  } catch {
    return invalid();
  }
}

function sameHex(left: unknown, right: unknown) {
  return typeof left === "string"
    && typeof right === "string"
    && /^0x[0-9a-fA-F]*$/u.test(left)
    && /^0x[0-9a-fA-F]*$/u.test(right)
    && left.toLowerCase() === right.toLowerCase();
}

function sameSha256(left: unknown, right: unknown) {
  return typeof left === "string"
    && typeof right === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(left)
    && left === right;
}

function sameAbiValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameAbiValue(value, right[index]));
  }
  if (
    typeof left === "string"
    && typeof right === "string"
    && left.startsWith("0x")
    && right.startsWith("0x")
  ) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function numericEquals(value: unknown, expected: bigint) {
  return (typeof value === "bigint" && value === expected)
    || (typeof value === "number"
      && Number.isSafeInteger(value)
      && BigInt(value) === expected);
}

function invalid(): never {
  throw new CustomLaunchWalletHandoffErrorV1();
}
