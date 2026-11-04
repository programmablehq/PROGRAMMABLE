import {canonicalBrowserJsonV2,fileSha256V2} from "@/lib/custom-launch/browser-authority-v2";
import {projectCompilerInput,type ContractProject} from "./contract-project";

export const SOURCE_AUDIT_POLICY_ID="programmable.protected-source-audit.v2" as const;
// Keep these IDs sorted and in sync with the backend audit-binding contract.
export const SOURCE_AUDIT_POLICY_REVIEWS={
  "buy-sell-and-claims":"Trace buys, sells, transfers and claims, including cumulative launch caps, exemptions, accounting, replay guards and rollback. Apply the supplied mandatory launch policy even if the saved requirements omit it.",
  "callback-authentication":"Trace every callback and authenticate its caller, pool, sender and beneficiary. Check reentrancy, direct calls and callback-data substitution against the actual state updates.",
  "controller-ownership":"Check initial and final controller ownership, privileged roles, transfers and renunciation across all deployed and constructor-created contracts. Identify unintended authority or a missing required ownership binding.",
  "external-dependencies":"Trace external calls and verify source-level address, interface and configuration bindings against the supplied production context. Identify substituted or unconnected dependencies; do not claim runtime verification.",
  "fee-routing":"Trace required platform fees and project fees from each charged operation to the configured recipients. Check exemptions, opening surcharges, withdrawals and alternate routes for bypasses or drains.",
  "initialization":"Trace deployment and initialization order, one-time guards, required bindings, initial liquidity and the first purchase. Check whether any public path can initialize or use the contracts with unauthorized configuration.",
  "protected-liquidity-and-upgrades":"Trace liquidity custody, withdrawal authority, upgrades, delegatecalls and configurable contract references. Identify any path that can remove required liquidity protection, redirect funds or replace code to bypass the supplied mandatory policy.",
} as const;
export const SOURCE_AUDIT_REVIEWED_POLICY_IDS=Object.freeze(Object.keys(SOURCE_AUDIT_POLICY_REVIEWS));

/** Hash the complete compiler input, never the compact model view or raw JSON
 * transport formatting. There are no domain bytes in this digest. */
export function sourceAuditCompilerInputHash(project:ContractProject):`sha256:${string}` {
  return fileSha256V2(new TextEncoder().encode(canonicalBrowserJsonV2(projectCompilerInput(project))));
}

export function hasSourceAuditPolicyCoverage(value:unknown):value is string[] {
  return Array.isArray(value)&&JSON.stringify(value)===JSON.stringify(SOURCE_AUDIT_REVIEWED_POLICY_IDS);
}
