import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { ETHEREUM_ROUTING_FEE_POLICY_V2 } from "./ethereum-routing-fee-policy-v1";
/** Deployed Elysium roots; never resolve these from an applicant's transaction. */
export const ELYSIUM_CUSTOM_ROOTS_V1 = Object.freeze({
  chainId: 99901,
  router: "0xEf972d7A9e7e064Ba0842c4537d7cc697c5d2eF4",
  graphFactory: "0xB91488FEDC1d02eb365B7B5F2aCdA1A801bF692e",
  permitAuthority: "0x8B134A7F24C8a97B999dcce9D10Eb2966c260209",
  permitSigner: "0x86DaDa25e0D3013a582Ed549e053DeE17148f8C5",
  poolManager: "0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1",
  universalRouter: "0xA13f7611115752DEB2B13813BDDE16A5073e4b45",
  deploymentBlock: "3584732",
  deploymentBlockHash: "0x7abdac4d5084485a211dc716a9103133a4fb7a3676c00af7b1a816cf9446b42f",
  platformTreasury: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
} as const);
export const ELYSIUM_TRADE_FEE_POLICY_V1 = Object.freeze({
  ...ETHEREUM_ROUTING_FEE_POLICY_V2,
  schemaVersion: "programmable.elysium-programmable-trade-fee-policy.v1",
  policyVersion: "programmable.elysium-native-fee.v1",
  scope: "elysium-custom-launch-trades",
  defaultCollection: {
    ...ETHEREUM_ROUTING_FEE_POLICY_V2.defaultCollection,
    currency: "native-HYPE", mode: "pool_enforced", routedRateBps: 0, rounding: "ceil-per-trade",
    collection: "atomic-pool-fee-accrual",
  },
  native30Waiver: null,
} as const);
export interface ElysiumRoutingFeePolicyBindingV1 {
  schemaVersion: "programmable.elysium-launch-routing-fee-policy-binding.v1";
  launchProfileVersion: "3.6.0";
  launchProfileHash: `sha256:${string}`;
  policyHash: `sha256:${string}`;
  policy: typeof ELYSIUM_TRADE_FEE_POLICY_V1;
  enforcementBoundary: {
    chainId: "99901";
    blockNumber: string;
    blockHash: `0x${string}`;
    releaseId: `sha256:${string}`;
  };
  stampBinding: {
    launchId: `0x${string}`;
    stampHash: `0x${string}`;
    permitDigest: `0x${string}`;
    routePayloadHash: `0x${string}`;
  };
  bindingHash: `sha256:${string}`;
}
export function parseElysiumRoutingFeePolicyV1(value: unknown): ElysiumRoutingFeePolicyBindingV1 {
  const fail = (): never => { throw new Error("Invalid Elysium fee policy binding"); };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const v = value as ElysiumRoutingFeePolicyBindingV1;
  const hash = (s: unknown) => typeof s === "string" && /^sha256:[0-9a-f]{64}$/.test(s);
  if (Object.keys(v).sort().join() !== "bindingHash,enforcementBoundary,launchProfileHash,launchProfileVersion,policy,policyHash,schemaVersion,stampBinding"
    || v.schemaVersion !== "programmable.elysium-launch-routing-fee-policy-binding.v1" || v.launchProfileVersion !== "3.6.0"
    || !hash(v.launchProfileHash) || !hash(v.policyHash)
    || canonicalBrowserJsonV2(v.policy) !== canonicalBrowserJsonV2(ELYSIUM_TRADE_FEE_POLICY_V1)
    || v.policyHash !== canonicalBrowserSha256V2(ELYSIUM_TRADE_FEE_POLICY_V1.schemaVersion, ELYSIUM_TRADE_FEE_POLICY_V1)
    || !v.enforcementBoundary || Object.keys(v.enforcementBoundary).sort().join() !== "blockHash,blockNumber,chainId,releaseId"
    || v.enforcementBoundary.chainId !== "99901" || v.enforcementBoundary.blockNumber !== ELYSIUM_CUSTOM_ROOTS_V1.deploymentBlock
    || v.enforcementBoundary.blockHash !== ELYSIUM_CUSTOM_ROOTS_V1.deploymentBlockHash || !hash(v.enforcementBoundary.releaseId)
    || !v.stampBinding || Object.keys(v.stampBinding).sort().join() !== "launchId,permitDigest,routePayloadHash,stampHash"
    || !Object.values(v.stampBinding).every(s => /^0x[0-9a-f]{64}$/.test(s)))
    return fail();
  const { bindingHash, ...body } = v;
  if (bindingHash !== canonicalBrowserSha256V2(v.schemaVersion, body))
    return fail();
  return v;
}
