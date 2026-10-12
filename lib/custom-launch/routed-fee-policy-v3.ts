import { CUSTOM_LAUNCH_ROUTED_FEE_DISCOVERY_V2 } from "./routed-fee-policy-v2";

/** Current routed fee; historical signed obligations and verified pool fees keep their original terms. */
export const ROUTED_FEE_POLICY_V3 = "programmable.routed-swap-fee.v3" as const;
export const ROUTED_FEE_BPS_V3 = 100 as const;
export const CUSTOM_LAUNCH_ROUTED_FEE_DISCOVERY_V3 = Object.freeze({
  ...CUSTOM_LAUNCH_ROUTED_FEE_DISCOVERY_V2,
  policyVersion: ROUTED_FEE_POLICY_V3,
  rateBps: ROUTED_FEE_BPS_V3,
  ratePercent: "1.00%",
});
