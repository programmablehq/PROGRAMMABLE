import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import type { LaunchStampProvenanceV1 } from "@/lib/tokens";

export const ETHEREUM_ROUTING_FEE_POLICY_V1 = {
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
} as const;
/** Treasury migration is an additional signed policy; historical V1 bindings stay exact. */
export const ETHEREUM_ROUTING_FEE_POLICY_V2 = {
  ...ETHEREUM_ROUTING_FEE_POLICY_V1,
  policyVersion: "programmable.ethereum-routed-native-fee.v2",
  defaultCollection: {
    ...ETHEREUM_ROUTING_FEE_POLICY_V1.defaultCollection,
    recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
  },
  native30Waiver: {
    ...ETHEREUM_ROUTING_FEE_POLICY_V1.native30Waiver,
    recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    hook: "EthereumNative30HookV3",
    vault: "EthereumNativeFeeVaultV3",
  },
} as const;
/** Additive 100-bps policy. Historical 30-bps launch bindings remain exact. */
export const ETHEREUM_ROUTING_FEE_POLICY_V3 = Object.freeze({
  ...ETHEREUM_ROUTING_FEE_POLICY_V2,
  policyVersion: "programmable.ethereum-routed-native-fee.v3" as const,
  ratePpm: "10000" as const,
  rateBps: 100 as const,
  defaultCollection: Object.freeze({ ...ETHEREUM_ROUTING_FEE_POLICY_V2.defaultCollection, routedRateBps: 100 as const }),
  native30Waiver: null,
});

export type EthereumRoutingFeePolicy = typeof ETHEREUM_ROUTING_FEE_POLICY_V1 | typeof ETHEREUM_ROUTING_FEE_POLICY_V2 | typeof ETHEREUM_ROUTING_FEE_POLICY_V3;
export const ETHEREUM_ROUTING_FEE_POLICY_HASH_V2 = canonicalBrowserSha256V2(ETHEREUM_ROUTING_FEE_POLICY_V2.schemaVersion, ETHEREUM_ROUTING_FEE_POLICY_V2);
export function isEthereumRoutingFeePolicy(policy: unknown, policyHash: unknown): policy is EthereumRoutingFeePolicy {
  return [ETHEREUM_ROUTING_FEE_POLICY_V1, ETHEREUM_ROUTING_FEE_POLICY_V2, ETHEREUM_ROUTING_FEE_POLICY_V3].some(expected =>
    policyHash === canonicalBrowserSha256V2(expected.schemaVersion, expected)
    && canonicalBrowserJsonV2(policy) === canonicalBrowserJsonV2(expected));
}
export const ETHEREUM_ROUTING_FEE_POLICY_HASH_V1 = canonicalBrowserSha256V2(ETHEREUM_ROUTING_FEE_POLICY_V1.schemaVersion, ETHEREUM_ROUTING_FEE_POLICY_V1);
export const ETHEREUM_ROUTING_FEE_BOUNDARY_V1 = { chainId: "1", blockNumber: "26142122", blockHash: "0x823e99cec0bb5b6011afc44891a1fd897b7efcbd83658cb9bc176dc35f5f86a3" } as const;

export type EthereumRoutingFeePolicyBindingV1 = Readonly<{
  schemaVersion: "programmable.ethereum-launch-routing-fee-policy-binding.v1";
  launchProfileVersion: "3.6.0";
  launchProfileHash: `sha256:${string}`;
  policyHash: `sha256:${string}`;
  policy: EthereumRoutingFeePolicy;
  enforcementBoundary: typeof ETHEREUM_ROUTING_FEE_BOUNDARY_V1;
  stampBinding: Readonly<{ launchId: `0x${string}`; stampHash: `0x${string}`;
    permitDigest: `0x${string}`; routePayloadHash: `0x${string}` }>;
  bindingHash: `sha256:${string}`;
}>;
export type EthereumFeeClassificationV1 = Readonly<{
  launchId: string;
  stampHash: string;
  profileVersion: string;
  routingFeePolicy: EthereumRoutingFeePolicyBindingV1 | null;
}>;
const historicalProfiles = new Set(["2.0.0", "3.0.0", "3.1.0", "3.2.0", "3.3.0", "3.4.0", "3.5.0"]);
const hash = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const hex = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const invalid = (): never => { throw new TypeError("The Ethereum launch fee policy could not be verified."); };

export function parseEthereumRoutingFeePolicyV1(value: unknown): EthereumRoutingFeePolicyBindingV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const binding = value as EthereumRoutingFeePolicyBindingV1;
  if (Object.keys(binding).sort().join() !== ["schemaVersion", "launchProfileVersion", "launchProfileHash", "policyHash", "policy", "enforcementBoundary", "stampBinding", "bindingHash"].sort().join()
    || binding.schemaVersion !== "programmable.ethereum-launch-routing-fee-policy-binding.v1"
    || binding.launchProfileVersion !== "3.6.0" || !hash(binding.launchProfileHash)
    || !isEthereumRoutingFeePolicy(binding.policy, binding.policyHash)
    || canonicalBrowserJsonV2(binding.enforcementBoundary) !== canonicalBrowserJsonV2(ETHEREUM_ROUTING_FEE_BOUNDARY_V1)
    || !binding.stampBinding || Object.keys(binding.stampBinding).sort().join() !== "launchId,permitDigest,routePayloadHash,stampHash"
    || !Object.values(binding.stampBinding).every(hex)) return invalid();
  const { bindingHash, ...body } = binding;
  if (!hash(bindingHash) || bindingHash !== canonicalBrowserSha256V2(binding.schemaVersion, body)) return invalid();
  return binding;
}

/** Only the server's canonical finalized feed supplies this classification.
 * Client validation binds it to the independently verified launch stamp. */
export function validateEthereumFeeClassificationV1(value: EthereumFeeClassificationV1, stamp: LaunchStampProvenanceV1) {
  if (!value || !same(value.launchId, stamp.launchId) || !same(value.stampHash, stamp.stampHash)) return invalid();
  if (historicalProfiles.has(value.profileVersion)) {
    if (value.routingFeePolicy !== null) return invalid();
    return value;
  }
  if (value.profileVersion !== "3.6.0") return invalid();
  const binding = parseEthereumRoutingFeePolicyV1(value.routingFeePolicy);
  for (const key of ["launchId", "stampHash", "permitDigest", "routePayloadHash"] as const) {
    if (!same(binding.stampBinding[key], stamp[key])) return invalid();
  }
  if (BigInt(stamp.blockNumber) <= BigInt(ETHEREUM_ROUTING_FEE_BOUNDARY_V1.blockNumber)) return invalid();
  return value;
}

/** Exact-runtime proofs must match this launch's signed rate and recipient.
 * A historical 30bps pool never waives the current 100bps policy. */
export function ethereumPoolFeeMatchesPolicy(policy: EthereumRoutingFeePolicy,
  proof: { rateBps: number; recipient: string; recipeId: string }): boolean {
  return proof.rateBps === policy.rateBps
    && (policy.rateBps === 100 ? proof.recipeId === "native100_fee_kernel_v1"
      && same(proof.recipient, policy.defaultCollection.recipient)
      : same(proof.recipient, policy.native30Waiver.recipient));
}
