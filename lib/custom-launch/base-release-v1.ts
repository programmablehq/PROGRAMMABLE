import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { ETHEREUM_ROUTING_FEE_POLICY_V2 } from "./ethereum-routing-fee-policy-v1";

/** Deployed Base roots; never resolve these from an applicant's transaction. */
export const BASE_CUSTOM_ROOTS_V1 = Object.freeze({
  chainId: 8453,
  router: "0xEf972d7A9e7e064Ba0842c4537d7cc697c5d2eF4",
  graphFactory: "0xB91488FEDC1d02eb365B7B5F2aCdA1A801bF692e",
  permitAuthority: "0x872478Df54f15f9d0faa3936b174cDaFe70d1B97",
  permitSigner: "0xd9Ea9F05dA392Fbc3b9F7A5e258B20EB9f9834A6",
  poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
  universalRouter: "0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40",
  deploymentBlock: "52866196",
  deploymentBlockHash: "0x77c7a70a0a1d538879c9247ba16efc716f1d2226b2c56d385daa6ddcd30d33b9",
  platformTreasury: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
} as const);

export const BASE_TRADE_FEE_POLICY_V1 = Object.freeze({
  ...ETHEREUM_ROUTING_FEE_POLICY_V2,
  schemaVersion: "programmable.base-programmable-trade-fee-policy.v1",
  policyVersion: "programmable.base-native-fee.v1",
  scope: "base-custom-launch-trades",
  defaultCollection: {
    ...ETHEREUM_ROUTING_FEE_POLICY_V2.defaultCollection,
    mode: "pool_enforced", routedRateBps: 0, rounding: "ceil-per-trade",
    collection: "atomic-pool-fee-accrual",
  },
  native30Waiver: null,
} as const);

export interface BaseRoutingFeePolicyBindingV1 {
  schemaVersion: "programmable.base-launch-routing-fee-policy-binding.v1";
  launchProfileVersion: "3.6.0";
  launchProfileHash: `sha256:${string}`;
  policyHash: `sha256:${string}`;
  policy: typeof BASE_TRADE_FEE_POLICY_V1;
  enforcementBoundary: { chainId: "8453"; blockNumber: string; blockHash: `0x${string}`; releaseId: `sha256:${string}` };
  stampBinding: { launchId: `0x${string}`; stampHash: `0x${string}`; permitDigest: `0x${string}`; routePayloadHash: `0x${string}` };
  bindingHash: `sha256:${string}`;
}
export function parseBaseRoutingFeePolicyV1(value: unknown): BaseRoutingFeePolicyBindingV1 {
  const fail = (): never => { throw new Error("Invalid Base fee policy binding"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const v = value as BaseRoutingFeePolicyBindingV1;
  const hash = (s: unknown) => typeof s === "string" && /^sha256:[0-9a-f]{64}$/.test(s);
  if (Object.keys(v).sort().join() !== "bindingHash,enforcementBoundary,launchProfileHash,launchProfileVersion,policy,policyHash,schemaVersion,stampBinding"
    || v.schemaVersion !== "programmable.base-launch-routing-fee-policy-binding.v1" || v.launchProfileVersion !== "3.6.0"
    || !hash(v.launchProfileHash) || !hash(v.policyHash)
    || canonicalBrowserJsonV2(v.policy) !== canonicalBrowserJsonV2(BASE_TRADE_FEE_POLICY_V1)
    || v.policyHash !== canonicalBrowserSha256V2(BASE_TRADE_FEE_POLICY_V1.schemaVersion, BASE_TRADE_FEE_POLICY_V1)
    || !v.enforcementBoundary || Object.keys(v.enforcementBoundary).sort().join() !== "blockHash,blockNumber,chainId,releaseId"
    || v.enforcementBoundary.chainId !== "8453" || v.enforcementBoundary.blockNumber !== BASE_CUSTOM_ROOTS_V1.deploymentBlock
    || v.enforcementBoundary.blockHash !== BASE_CUSTOM_ROOTS_V1.deploymentBlockHash || !hash(v.enforcementBoundary.releaseId)
    || !v.stampBinding || Object.keys(v.stampBinding).sort().join() !== "launchId,permitDigest,routePayloadHash,stampHash"
    || !Object.values(v.stampBinding).every(s => /^0x[0-9a-f]{64}$/.test(s))) return fail();
  const { bindingHash, ...body } = v;
  if (bindingHash !== canonicalBrowserSha256V2(v.schemaVersion, body)) return fail();
  return v;
}
