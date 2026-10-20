import BASE_PROFILE_V1 from "./base-profile-v1.json" with {type: "json"};
import { canonicalizeJson } from "./canonical-json.mjs";
import { sha256Digest } from "./io.mjs";

// Collection policy only. Mode selection requires server runtime and trade proof.
export const DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36 = deepFreeze({
  "schemaVersion": "programmable.ethereum-programmable-trade-fee-policy.v1",
  "policyVersion": "programmable.ethereum-routed-native-fee.v1",
  "scope": "programmable-routed-ethereum-trades",
  "ratePpm": "3000",
  "rateDenominator": "1000000",
  "rateBps": 30,
  "modeSelection": "server-exact-runtime-and-trade-proof",
  "defaultCollection": {
    "mode": "programmable_routed",
    "routedRateBps": 30,
    "basis": "gross-native-by-side",
    "buyBasis": "funded-native-input",
    "sellBasis": "gross-native-output-credit",
    "currency": "native-ETH",
    "rounding": "floor-once-per-swap",
    "recipient": "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    "collection": "atomic-native-transfer-in-swap"
  },
  "native30Waiver": {
    "mode": "pool_enforced_native30",
    "routedRateBps": 0,
    "basis": "authenticated-gross-native",
    "currency": "native-ETH",
    "rounding": "ceil-per-trade",
    "recipient": "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    "hook": "EthereumNative30HookV2",
    "vault": "EthereumNativeFeeVaultV2",
    "proof": "exact-runtime-and-trade-accrual",
    "applicantAssertionsAccepted": false
  },
  "launchAdmissionEstablishesFeeCollection": false,
  "externalTradeFeeGuaranteed": false,
  "historicalSignedFeeObligations": "preserved"
});

export const DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_TREASURY_V2 = deepFreeze({
  ...DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36,
  policyVersion: "programmable.ethereum-routed-native-fee.v2",
  defaultCollection: { ...DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36.defaultCollection,
    recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da" },
  native30Waiver: { ...DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36.native30Waiver,
    recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    hook: "EthereumNative30HookV3", vault: "EthereumNativeFeeVaultV3" },
});

export const DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_FEE100_V3 = deepFreeze({
  ...DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_TREASURY_V2,
  policyVersion: "programmable.ethereum-routed-native-fee.v3", ratePpm: "10000", rateBps: 100,
  defaultCollection: { ...DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_TREASURY_V2.defaultCollection, routedRateBps: 100 },
  native30Waiver: null,
});

export function assertDirectNativeProgrammableTradeFeePolicyV36(value) {
  if (![BASE_PROFILE_V1.programmableTradeFeePolicy, DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36, DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_TREASURY_V2, DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36_FEE100_V3].some(policy => canonicalizeJson(value) === canonicalizeJson(policy))) {
    throw new TypeError("PROFILE_36_PROGRAMMABLE_TRADE_FEE_POLICY_MISMATCH");
  }
  return value;
}

export function directNativeProgrammableTradeFeePolicyHashV36(policy = DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36) {
  assertDirectNativeProgrammableTradeFeePolicyV36(policy);
  return sha256Digest(Buffer.concat([
    Buffer.from(policy.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(policy), "utf8"),
  ]));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
