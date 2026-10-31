import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { builderChain, type BuilderChainId } from "./execution-routing";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ProductionBinding = { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
export const PROTECTED_COMPONENT_ROLES = ["feeVault", "hook", "initializer", "module", "openingTaxVault", "token"] as const;
export type ProductionProtectionPolicy = {
  policyVersion: "programmable.launch-protection.v1"; required: boolean; appliesTo: "custom-contract";
  evidenceAuthority: "authenticated-original-source-and-graph-review";
  componentRoles: (typeof PROTECTED_COMPONENT_ROLES[number])[];
  openingTaxRecipient: `0x${string}` | null;
};
/** Saved generation context, not a permit or proof that a dependency is live.
 * Only the server discovery projector constructs new context from observations. */
export type LaunchProductionContext = {
  version: 1 | 2; id: `sha256:${string}`; chainId: BuilderChainId;
  route: "graph-v3" | "plan-v1"; profileVersion: string;
  poolManager: ProductionBinding; executor: ProductionBinding;
  graphProfile: { [key: string]: Json } | null;
  manifestDigest: `sha256:${string}` | null;
  tradeFee: { policyVersion: string; ratePpm: number; recipient: `0x${string}`;
    collection: "programmable-routed-native" | "programmable-routed-output" | "pool-enforced-native" };
  protections: { openingFeePpm: number; openingSeconds: number; buyerLimitBps: number;
    recipientLimitBps: number; protectionSeconds: number; maximumAdditionalTaxExemptWallets: number;
    minimumFdvUsd: string } | null;
  /** V1 remains readable at its original hash. New discovery always returns V2
   * with the separate current global review-policy observation. */
  protectionPolicy?: ProductionProtectionPolicy;
};
type ContextBody = Omit<LaunchProductionContext, "id">;
const address = /^0x(?!0{40}$)[a-f0-9]{40}$/iu, code = /^0x(?!0{64}$)[a-f0-9]{64}$/u;
const digest = /^sha256:(?!0{64}$)[a-f0-9]{64}$/u;
const invalid = (): never => { throw new TypeError("Use the saved launch context for the selected network."); };
const integer = (value: unknown, maximum: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
const exact = (value: object, keys: string) => value && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Object.keys(value).sort().join(",") === keys.split(",").sort().join(",");

export function createLaunchProductionContext(body: ContextBody): LaunchProductionContext {
  builderChain(body.chainId);
  if (!exact(body,`version,chainId,route,profileVersion,poolManager,executor,graphProfile,manifestDigest,tradeFee,protections${body.version===2?",protectionPolicy":""}`)
    || ![1,2].includes(body.version) || body.route !== (body.chainId === 4663 ? "plan-v1" : "graph-v3")
    || body.profileVersion !== (body.chainId === 4663 ? "custom-launch-plan.v1" : "3.6.0")
    || ![body.poolManager, body.executor].every(binding => binding && exact(binding,"address,runtimeCodeHash") && address.test(binding.address) && code.test(binding.runtimeCodeHash))
    || !body.tradeFee || !exact(body.tradeFee,"policyVersion,ratePpm,recipient,collection") || !/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(body.tradeFee.policyVersion)
    || !integer(body.tradeFee.ratePpm, 1_000_000) || !address.test(body.tradeFee.recipient)
    || body.tradeFee.collection !== (body.chainId === 4663 ? "programmable-routed-output" : body.chainId === 1 ? "programmable-routed-native" : "pool-enforced-native")
    || (body.chainId === 4663 ? !digest.test(body.manifestDigest ?? "") || body.graphProfile !== null : body.manifestDigest !== null || !body.graphProfile)
    || body.version === 1 && ((body.chainId === 8453 || body.chainId === 999) !== Boolean(body.protections))) return invalid();
  if (body.version === 2) {
    const policy = body.protectionPolicy;
    if (!policy || !exact(policy,"policyVersion,required,appliesTo,evidenceAuthority,componentRoles,openingTaxRecipient")
      || policy.policyVersion !== "programmable.launch-protection.v1" || typeof policy.required !== "boolean"
      || policy.appliesTo !== "custom-contract" || policy.evidenceAuthority !== "authenticated-original-source-and-graph-review"
      || policy.required !== Boolean(body.protections) || (body.chainId === 8453 || body.chainId === 999) && !policy.required
      || JSON.stringify(policy.componentRoles) !== JSON.stringify(policy.required ? PROTECTED_COMPONENT_ROLES : [])
      || (policy.required ? typeof policy.openingTaxRecipient !== "string" || !address.test(policy.openingTaxRecipient) : policy.openingTaxRecipient !== null)) return invalid();
  }
  if (body.protections) {
    const p = body.protections;
    if (!exact(p,"openingFeePpm,openingSeconds,buyerLimitBps,recipientLimitBps,protectionSeconds,maximumAdditionalTaxExemptWallets,minimumFdvUsd")
      || !integer(p.openingFeePpm, 1_000_000) || !integer(p.openingSeconds, 86400) || !integer(p.buyerLimitBps, 10000)
      || !integer(p.recipientLimitBps, 10000) || !integer(p.protectionSeconds, 86400)
      || !integer(p.maximumAdditionalTaxExemptWallets, 100) || !/^(?:0|[1-9][0-9]{0,30})$/u.test(p.minimumFdvUsd)) return invalid();
  }
  if (new TextEncoder().encode(JSON.stringify(body)).length > 32_000) return invalid();
  return structuredClone({ ...body, id: canonicalBrowserSha256V2(`programmable.custom-ai-production-context.v${body.version}`, body) });
}

/** Integrity of an owned snapshot only. Callers must freshly compare discovery
 * again before submission; recomputing an ID cannot authorize a launch. */
export function checkedLaunchProductionContext(value: LaunchProductionContext, chainId: BuilderChainId) {
  if (!value || value.chainId !== chainId) return invalid();
  const { id, ...body } = value, checked = createLaunchProductionContext(body);
  if (id !== checked.id) return invalid();
  return checked;
}
