import "server-only";
import { resolveDirectNativeProfile, validateEmbeddedDirectNativeProfile } from "@/packages/launch/src/profile-direct-native-v1.mjs";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { parseStrictJson } from "@/lib/server/projection-target/canonical-json";
import { builderChain, type BuilderChainId } from "./execution-routing";
import { createLaunchProductionContext, PROTECTED_COMPONENT_ROLES, type LaunchProductionContext, type ProductionBinding } from "./launch-production";
import { CustomAIError } from "./types";

const ORIGIN = "https://api.programmable.market", MAX_BYTES = 1_048_576;
const TTL = 300_000, NEGATIVE_TTL = 10_000, TIMEOUT = 5_000;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error();
  return value as ObjectValue;
};
const same = (a: unknown, b: unknown) => canonicalBrowserJsonV2(a) === canonicalBrowserJsonV2(b);
const unavailable = () => new CustomAIError("launch-context", "The launch network configuration could not be checked. Your saved design is kept.", 503);
type ProtectionStatus = { required: boolean; protections: NonNullable<LaunchProductionContext["protections"]>; openingTaxRecipient: `0x${string}` };
export function projectLaunchProtectionStatus(value: unknown): ProtectionStatus {
  try {
    const v = object(value);
    const expected = { schemaVersion: "programmable.launch-protection-status.v1", policyVersion: "programmable.launch-protection.v1",
      minimumFdvUsd: "15000", walletLimitBps: 200, buyerLimitBps: 200, protectionSeconds: 300, openingTotalFeePpm: 990000,
      openingFeeSeconds: 30, maximumAdditionalTaxExemptWallets: 6, moduleModeExempt: true, exemptWalletsRemainCapped: true,
      platformFeeBps: 30,
      openingExtraFeeEndsAtZero: true, buyerCapBasis: "cumulative-authenticated-buys", walletCapBasis: "cumulative-recipient-inflow",
      openingTaxRecipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da" };
    if (typeof v.required !== "boolean" || v.unsupportedLegacyLaunches !== (v.required ? "paused" : "unchanged")
      || Object.entries(expected).some(([key, expected]) => v[key] !== expected)
      || !Array.isArray(v.supportedChains) || !same([...v.supportedChains].sort(), ["1","4663","8453","999"])) throw Error();
    return { required: v.required, openingTaxRecipient: v.openingTaxRecipient as `0x${string}`, protections: {
      openingFeePpm: 990000, openingSeconds: 30, buyerLimitBps: 200, recipientLimitBps: 200,
      protectionSeconds: 300, maximumAdditionalTaxExemptWallets: 6, minimumFdvUsd: "15000" } };
  } catch { throw unavailable(); }
}
function protectionFields(chainId: BuilderChainId, status: ProtectionStatus | undefined, legacy: LaunchProductionContext["protections"]) {
  if (!status) return { version: 1 as const, protections: legacy };
  const required = status.required || chainId === 8453 || chainId === 999;
  if (legacy && !same(legacy, status.protections)) throw unavailable();
  return { version: 2 as const, protections: required ? status.protections : null,
    protectionPolicy: { policyVersion: "programmable.launch-protection.v1" as const, required, appliesTo: "custom-contract" as const,
      evidenceAuthority: "authenticated-original-source-and-graph-review" as const,
      componentRoles: required ? [...PROTECTED_COMPONENT_ROLES] : [], openingTaxRecipient: required ? status.openingTaxRecipient : null } };
}
function binding(address: unknown, runtimeCodeHash: unknown): ProductionBinding {
  if (typeof address !== "string" || !/^0x(?!0{40}$)[a-f0-9]{40}$/iu.test(address)
    || typeof runtimeCodeHash !== "string" || !/^0x(?!0{64}$)[a-f0-9]{64}$/u.test(runtimeCodeHash)) throw Error();
  return { address: address as `0x${string}`, runtimeCodeHash: runtimeCodeHash as `0x${string}` };
}
function policyFee(value: unknown, chainId: BuilderChainId): LaunchProductionContext["tradeFee"] {
  const p = object(value), d = object(p.defaultCollection);
  if (p.schemaVersion !== `programmable.${chainId === 8453 ? "base" : chainId === 999 ? "hyperevm" : "ethereum"}-programmable-trade-fee-policy.v1`
    || p.rateDenominator !== "1000000" || !/^(?:0|[1-9][0-9]{0,6})$/u.test(String(p.ratePpm))
    || Number(p.ratePpm) > 1_000_000 || Number(p.ratePpm) !== Number(p.rateBps) * 100
    || d.mode !== (chainId === 1 ? "programmable_routed" : "pool_enforced")) throw Error();
  return { policyVersion: String(p.policyVersion), ratePpm: Number(p.ratePpm),
    recipient: String(d.recipient) as `0x${string}`, collection: chainId === 1 ? "programmable-routed-native" : "pool-enforced-native" };
}

/** Typed projection of discovery data. Foreign prose, URLs, RPCs, historical
 * releases and instructions never enter the model context. This is not admission. */
export function projectLaunchProductionContext(value: unknown, chainId: BuilderChainId, protectionValue?: unknown): LaunchProductionContext {
  try {
    const chain = builderChain(chainId), cap = object(value);
    const protection = protectionValue === undefined ? undefined : projectLaunchProtectionStatus(protectionValue);
    if (cap.schemaVersion !== "programmable.custom-launch-capabilities.v1") throw Error();
    if (chainId === 4663) {
      const availability = object(cap.availability), bindings = object(availability.bindings), execution = object(bindings.execution), atomic = object(execution.atomic), fee = object(cap.currentTradeFeePolicy);
      if (cap.chainId !== "4663" || cap.launchContract !== "/v4/chains/4663/custom-launch-contract/manifest.json"
        || availability.manifestDigest !== cap.manifestDigest || atomic.executorKind !== "atomic_execute_and_stamp_v2" || atomic.selector !== "0x506aba45"
        || fee.appliesTo !== "programmable-routed-open-provenance-trades" || fee.basis !== "gross-output-credit"
        || fee.currency !== "swap-output-asset" || fee.collection !== "atomic-output-transfer-in-swap"
        || !Number.isSafeInteger(fee.rateBps) || Number(fee.rateBps) < 0 || Number(fee.rateBps) > 10000) throw Error();
      return createLaunchProductionContext({ ...protectionFields(chainId, protection, null), chainId, route: "plan-v1", profileVersion: "custom-launch-plan.v1",
        manifestDigest: cap.manifestDigest as `sha256:${string}`, graphProfile: null,
        poolManager: binding(atomic.poolManager, atomic.poolManagerRuntimeCodeHash), executor: binding(atomic.address, atomic.runtimeCodeHash),
        tradeFee: { policyVersion: String(fee.policyVersion), ratePpm: Number(fee.rateBps) * 100,
          recipient: String(fee.recipient) as `0x${string}`, collection: "programmable-routed-output" } });
    }
    if (object(cap.chain).id !== String(chainId) || cap.apiVersion !== (chainId === 1 ? "v3" : "v4")) throw Error();
    const routes = object(cap.routes);
    for (const key of ["create", "preflight"] as const) if (routes[key] !== chain[`${key}Path`]) throw Error();
    const declared = object(cap.profile);
    if (declared.profileVersion !== "3.6.0") throw Error();
    let profile: ObjectValue;
    if (chainId === 1) {
      const report = object(cap.programmableTradeFeePolicy), policy = object(report.policy);
      if (declared.profileId !== "programmable.direct-native-hook-graph.v1" || declared.profileRevision !== 3
        || object(cap.compiler).exactBuild !== "0.8.26+commit.8a97fa7a"
        || report.policyHash !== canonicalBrowserSha256V2(String(policy.schemaVersion), policy)) throw Error();
      // Same profile resolver as the canonical packer. Placeholder role IDs and
      // zero applicant rates only select policy shape; no user fees are chosen.
      profile = object(resolveDirectNativeProfile({ schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
        profileId: declared.profileId, profileRevision: 3,
        targetRoles: { tokenTargetId: "token", hookTargetId: "hook", initializerTargetId: "liquidity", platformFeeBindingTargetId: "hook" },
        fundingMode: "wallet-transaction-value", accountingMode: "inclusive-selected-total", assessmentBase: "executed-gross-declared-quote",
        feeCurrency: "declared-quote-currency", claimMode: "claim-authority-selected-recipient",
        applicantSelectedBuyHundredthsOfBip: "0", applicantSelectedSellHundredthsOfBip: "0" },
      { chainId: "1", profileVersion: "3.6.0", programmableTradeFeePolicy: policy }));
    } else {
      profile = object(validateEmbeddedDirectNativeProfile(declared));
      if (!same(profile, declared)) throw Error();
    }
    const policy = chainId === 1 ? null : object(cap.policy);
    if (policy && (policy.chainId !== String(chainId) || policy.nativeCurrency !== chain.currency
      || !same(object(policy.poolManager), binding(profile.poolManager, profile.poolManagerRuntimeCodeHash))
      || policy.platformFeeBps !== Number(object(profile.programmableTradeFeePolicy).rateBps)
      || policy.treasury !== object(object(profile.programmableTradeFeePolicy).defaultCollection).recipient
      || policy.exemptionScope !== "additional-opening-fee-only")) throw Error();
    const legacyProtections = policy ? { openingFeePpm: policy.initialBuyFeePpm as number, openingSeconds: policy.openingFeeSeconds as number,
      buyerLimitBps: policy.cumulativeBuyerLimitBps as number, recipientLimitBps: policy.cumulativeRecipientLimitBps as number,
      protectionSeconds: policy.protectionSeconds as number, maximumAdditionalTaxExemptWallets: policy.maximumAdditionalTaxExemptWallets as number,
      minimumFdvUsd: policy.minimumFdvUsd as string } : null;
    return createLaunchProductionContext({ ...protectionFields(chainId, protection, legacyProtections), chainId, route: "graph-v3", profileVersion: "3.6.0", manifestDigest: null,
      poolManager: binding(profile.poolManager, profile.poolManagerRuntimeCodeHash), executor: binding(profile.router, profile.routerRuntimeCodeHash),
      graphProfile: profile as LaunchProductionContext["graphProfile"], tradeFee: policyFee(profile.programmableTradeFeePolicy, chainId) });
  } catch { throw unavailable(); }
}

export function createLaunchProductionDiscovery(dependencies: { fetch: typeof fetch; now: () => number }) {
  const cache = new Map<BuilderChainId, { until: number; value?: LaunchProductionContext; pending?: Promise<LaunchProductionContext> }>();
  let policyCache: { until: number; value?: unknown; pending?: Promise<unknown> } | undefined;
  async function readJson(path: string, maximumBytes: number) {
    const response = await dependencies.fetch(`${ORIGIN}${path}`, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT), headers: { accept: "application/json" } });
    if (!response.ok || response.redirected || !/^application\/json(?:;|$)/iu.test(response.headers.get("content-type") ?? "")
      || Number(response.headers.get("content-length") ?? 0) > maximumBytes || !response.body) {
      await response.body?.cancel().catch(() => undefined); throw unavailable();
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const result = await reader.read(); if (result.done) break;
        size += result.value.length; if (size > maximumBytes) throw unavailable(); chunks.push(result.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
      return parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), { maximumBytes, maximumDepth: 64 });
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  async function readPolicy(fresh: boolean) {
    const hit = policyCache;
    if (hit?.pending) return hit.pending;
    if (hit && hit.until > dependencies.now()) {
      if (hit.value === undefined) throw unavailable();
      if (!fresh) return hit.value;
    }
    const pending = readJson("/v1/launch-protection", 16_384).then(value => {
      projectLaunchProtectionStatus(value);
      policyCache = { until: dependencies.now() + TTL, value }; return value;
    }, () => { throw unavailable(); }).catch(error => {
      policyCache = { until: dependencies.now() + NEGATIVE_TTL }; throw error;
    });
    policyCache = { until: 0, pending }; return pending;
  }
  async function load(chainId: BuilderChainId, fresh: boolean) {
    const [capabilities, policy] = await Promise.all([readJson(builderChain(chainId).capabilitiesPath, MAX_BYTES), readPolicy(fresh)]);
    return projectLaunchProductionContext(capabilities, chainId, policy);
  }
  return async function read(chainId: BuilderChainId, signal?: AbortSignal, options: { fresh?: boolean } = {}) {
    signal?.throwIfAborted(); builderChain(chainId);
    const hit = cache.get(chainId), now = dependencies.now();
    let pending = hit?.pending;
    if (!pending && hit && hit.until > now && !hit.value) throw unavailable();
    if (!pending && !options.fresh && hit && hit.until > now) {
      if (!hit.value) throw unavailable(); return structuredClone(hit.value);
    }
    if (!pending) {
      pending = load(chainId, options.fresh === true).then(value => {
        cache.set(chainId, { until: dependencies.now() + TTL, value }); return value;
      }, () => { cache.set(chainId, { until: dependencies.now() + NEGATIVE_TTL }); throw unavailable(); });
      cache.set(chainId, { until: 0, pending });
    }
    // One caller stopping must not abort discovery shared by other jobs. The
    // network operation has its own bounded deadline and never retries.
    if (!signal) return structuredClone(await pending);
    return new Promise<LaunchProductionContext>((resolve, reject) => {
      const stopped = () => { signal.removeEventListener("abort", stopped); reject(signal.reason); };
      signal.addEventListener("abort", stopped, { once: true });
      if (signal.aborted) stopped();
      pending!.then(value => { signal.removeEventListener("abort", stopped); if (!signal.aborted) resolve(structuredClone(value)); },
        error => { signal.removeEventListener("abort", stopped); if (!signal.aborted) reject(error); });
    });
  };
}
export const readLaunchProductionContext = createLaunchProductionDiscovery({ fetch: (...args) => fetch(...args), now: Date.now });
