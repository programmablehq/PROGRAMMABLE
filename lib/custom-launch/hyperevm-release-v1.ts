import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { ETHEREUM_ROUTING_FEE_POLICY_V2 } from "./ethereum-routing-fee-policy-v1";

/** Deployed HyperEvm roots; never resolve these from an applicant's transaction. */
export const HYPEREVM_CUSTOM_ROOTS_V1 = Object.freeze({
  chainId: 999,
  router: "0x65AF2809dd2d7E1974c34730E97Ce3ac95F46FDB",
  graphFactory: "0xEf972d7A9e7e064Ba0842c4537d7cc697c5d2eF4",
  permitAuthority: "0xe7Ca55aD80b07bf83A8f6E71Bdd66bF5D482b81b",
  permitSigner: "0xf6fB74aFfB7e2cFfaa6e950Ce590cA903f220c0E",
  poolManager: "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F",
  universalRouter: "0xeD270A1Bcdc63cf1356D695e7f40961d4819d6bF",
  deploymentBlock: "49851979",
  deploymentBlockHash: "0x07ea8b3308abf3e60a7b21f0a18db13e17d576df15dec5d71ac4b0edf37112cd",
  platformTreasury: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
} as const);

export const HYPEREVM_TRADE_FEE_POLICY_V1 = Object.freeze({
  ...ETHEREUM_ROUTING_FEE_POLICY_V2,
  schemaVersion: "programmable.hyperevm-programmable-trade-fee-policy.v1",
  policyVersion: "programmable.hyperevm-native-fee.v1",
  scope: "hyperevm-custom-launch-trades",
  defaultCollection: {
    ...ETHEREUM_ROUTING_FEE_POLICY_V2.defaultCollection,
    currency: "native-HYPE", mode: "pool_enforced", routedRateBps: 0, rounding: "ceil-per-trade",
    collection: "atomic-pool-fee-accrual",
  },
  native30Waiver: null,
} as const);

export interface HyperEvmRoutingFeePolicyBindingV1 {
  schemaVersion: "programmable.hyperevm-launch-routing-fee-policy-binding.v1";
  launchProfileVersion: "3.6.0";
  launchProfileHash: `sha256:${string}`;
  policyHash: `sha256:${string}`;
  policy: typeof HYPEREVM_TRADE_FEE_POLICY_V1;
  enforcementBoundary: { chainId: "999"; blockNumber: string; blockHash: `0x${string}`; releaseId: `sha256:${string}` };
  stampBinding: { launchId: `0x${string}`; stampHash: `0x${string}`; permitDigest: `0x${string}`; routePayloadHash: `0x${string}` };
  bindingHash: `sha256:${string}`;
}
export function parseHyperEvmRoutingFeePolicyV1(value: unknown): HyperEvmRoutingFeePolicyBindingV1 {
  const fail = (): never => { throw new Error("Invalid HyperEvm fee policy binding"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const v = value as HyperEvmRoutingFeePolicyBindingV1;
  const hash = (s: unknown) => typeof s === "string" && /^sha256:[0-9a-f]{64}$/.test(s);
  if (Object.keys(v).sort().join() !== "bindingHash,enforcementBoundary,launchProfileHash,launchProfileVersion,policy,policyHash,schemaVersion,stampBinding"
    || v.schemaVersion !== "programmable.hyperevm-launch-routing-fee-policy-binding.v1" || v.launchProfileVersion !== "3.6.0"
    || !hash(v.launchProfileHash) || !hash(v.policyHash)
    || canonicalBrowserJsonV2(v.policy) !== canonicalBrowserJsonV2(HYPEREVM_TRADE_FEE_POLICY_V1)
    || v.policyHash !== canonicalBrowserSha256V2(HYPEREVM_TRADE_FEE_POLICY_V1.schemaVersion, HYPEREVM_TRADE_FEE_POLICY_V1)
    || !v.enforcementBoundary || Object.keys(v.enforcementBoundary).sort().join() !== "blockHash,blockNumber,chainId,releaseId"
    || v.enforcementBoundary.chainId !== "999" || v.enforcementBoundary.blockNumber !== HYPEREVM_CUSTOM_ROOTS_V1.deploymentBlock
    || v.enforcementBoundary.blockHash !== HYPEREVM_CUSTOM_ROOTS_V1.deploymentBlockHash || !hash(v.enforcementBoundary.releaseId)
    || !v.stampBinding || Object.keys(v.stampBinding).sort().join() !== "launchId,permitDigest,routePayloadHash,stampHash"
    || !Object.values(v.stampBinding).every(s => /^0x[0-9a-f]{64}$/.test(s))) return fail();
  const { bindingHash, ...body } = v;
  if (bindingHash !== canonicalBrowserSha256V2(v.schemaVersion, body)) return fail();
  return v;
}
