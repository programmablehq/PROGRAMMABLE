import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { ProjectEntrypoint } from "./contract-project";
import { checkedLaunchProductionContext, type LaunchProductionContext } from "./launch-production";
import type { LaunchIntent } from "./launch-intent";
import { constructorChildPlanningRules, declareConstructorChildren, type ConstructorChild } from "./constructor-children";

export const DEPLOYMENT_INPUTS = ["controller", "name", "symbol", "quote", "funding"] as const;
export const PROTECTION_DEPLOYMENT_BINDINGS = ["swap-router", "swap-router-runtime-hash", "native-usd-feed", "native-usd-feed-runtime-hash", "sequencer-uptime-feed"] as const;
export const OPENING_DEPLOYMENT_BINDINGS = ["opening-tick", "opening-sqrt-price-x96"] as const;
export const DEPLOYMENT_BINDINGS = ["pool-manager", "launch-executor", "graph-factory", "permit-authority", "fee-recipient", "funding-token", ...PROTECTION_DEPLOYMENT_BINDINGS, ...OPENING_DEPLOYMENT_BINDINGS] as const;
export type DeploymentValue = string | boolean | DeploymentValue[]
  | { input: typeof DEPLOYMENT_INPUTS[number] } | { binding: typeof DEPLOYMENT_BINDINGS[number] } | { target: string };
export type DeploymentNativeValue = "0" | { input: "funding" };
export type GeneralDeploymentTarget = ProjectEntrypoint & {
  id: string; constructorArguments: DeploymentValue[];
  initializer: { function: string; arguments: DeploymentValue[] } | null;
  deploymentValue: DeploymentNativeValue; initializerValue: DeploymentNativeValue;
  hookPermissions: number | null;
};
type DeploymentBlueprintBody = {
  id: `sha256:${string}`; productionId: LaunchProductionContext["id"];
  targets: GeneralDeploymentTarget[];
  pool: { token: string; hook: string; initializer: string; platformFeeBinding: string; fee: number; tickSpacing: number };
  fees?: { buyPpm: number; sellPpm: number };
  liquidityModel?: "external-concentrated-liquidity" | "launch-seeded-concentrated-liquidity" | "hook-inventory-custom-accounting";
  openingPrice?: { supply: string; targetFdvUsd: string };
};
export type GeneralDeploymentBlueprint = DeploymentBlueprintBody & ({ version: 1 } | { version: 2; constructorChildren: ConstructorChild[] });
type ObjectValue = Record<string, unknown>;
const invalid = (): never => { throw new TypeError("Declare a complete deployment graph separately from the local test fixtures."); };
const object = (value: unknown, keys: string): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) return invalid();
  return value as ObjectValue;
};
const identifier = (value: unknown): string => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(value) ? value : invalid();
function nativeValue(value: unknown): DeploymentNativeValue {
  if (value === "0") return value;
  if (object(value, "input").input !== "funding") return invalid();
  return { input: "funding" };
}

/** No fixture identities are promoted to production. These values are declared
 * before source generation and resolved only against an owned preparation. */
export function createGeneralDeploymentBlueprint(value: unknown, entries: ProjectEntrypoint[], production: LaunchProductionContext,
  intent: LaunchIntent): GeneralDeploymentBlueprint {
  production = checkedLaunchProductionContext(production, production.chainId);
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const fields = Object.keys(value);
  const hasFees = fields.includes("fees"), hasLiquidity = fields.includes("liquidityModel"), hasChildren = fields.includes("constructorChildren"), hasOpening = fields.includes("openingPrice");
  if (hasFees !== hasLiquidity) return invalid();
  const raw = object(value, (hasFees ? "targets,pool,fees,liquidityModel" : "targets,pool") + (hasChildren ? ",constructorChildren" : "") + (hasOpening ? ",openingPrice" : ""));
  let openingPrice: GeneralDeploymentBlueprint["openingPrice"];
  if (hasOpening) {
    const opening = object(raw.openingPrice, "supply,targetFdvUsd");
    const positive = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,38}$/u.test(v) && BigInt(v) < (1n << 127n);
    if (!positive(opening.supply) || !positive(opening.targetFdvUsd) || production.version !== 3 || !production.protectionBindings
      || !production.protections || !production.protectionPolicy?.required || !hasFees
      || raw.liquidityModel !== "launch-seeded-concentrated-liquidity"
      || BigInt(opening.targetFdvUsd) < BigInt(production.protections.minimumFdvUsd)) return invalid();
    openingPrice = { supply: opening.supply, targetFdvUsd: opening.targetFdvUsd };
  }
  if (!Array.isArray(raw.targets) || raw.targets.length < 3 || raw.targets.length > 16 || !hasChildren && raw.targets.length !== entries.length
    || new TextEncoder().encode(JSON.stringify(value)).length > 64_000) return invalid();
  const all = new Set(raw.targets.map(target => identifier(object(target,
    "id,source,contract,constructorArguments,initializer,deploymentValue,initializerValue,hookPermissions").id)));
  if (all.size !== raw.targets.length) return invalid();
  const seen = new Set<string>(), used = new Set<string>(), openingUsed = new Set<string>(); let fundingUses = 0, nodes = 0;
  const values = (input: unknown, available: Set<string>, depth = 0): DeploymentValue[] => {
    if (!Array.isArray(input) || input.length > 128 || depth > 8) return invalid();
    return input.map(item => {
      if (++nodes > 2048) return invalid();
      if (Array.isArray(item)) return values(item, available, depth + 1);
      if (typeof item === "boolean") return item;
      if (typeof item === "string") {
        if (new TextEncoder().encode(item).length > 4096 || /[\u0000-\u001f\u007f]/u.test(item)) return invalid();
        // Literal external addresses need explicit design provenance. Known
        // platform roots use binding refs; wallet/form inputs use input refs.
        const protocolRecipient=[production.tradeFee.recipient,production.protectionPolicy?.openingTaxRecipient]
          .some(recipient=>recipient?.toLowerCase()===item.toLowerCase());
        if (/^0x[0-9a-f]{40}$/iu.test(item) && !/^0x0{40}$/iu.test(item) && !protocolRecipient
          && !intent.requirements.some(rule => rule.text.toLowerCase().includes(item.toLowerCase()))) return invalid();
        return item;
      }
      if (!item || typeof item !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(item)) || Object.keys(item).length !== 1) return invalid();
      const ref = item as ObjectValue;
      if (Object.hasOwn(ref, "input") && DEPLOYMENT_INPUTS.includes(ref.input as typeof DEPLOYMENT_INPUTS[number])) return { input: ref.input } as DeploymentValue;
      if (Object.hasOwn(ref, "binding") && DEPLOYMENT_BINDINGS.includes(ref.binding as typeof DEPLOYMENT_BINDINGS[number])) {
        if ((OPENING_DEPLOYMENT_BINDINGS as readonly unknown[]).includes(ref.binding)) {
          if (!openingPrice) return invalid();
          openingUsed.add(String(ref.binding));
        }
        if (production.chainId === 4663 && ["graph-factory", "permit-authority", "funding-token"].includes(String(ref.binding))) return invalid();
        if ((PROTECTION_DEPLOYMENT_BINDINGS as readonly unknown[]).includes(ref.binding)
          && (production.version!==3||!production.protectionBindings||ref.binding==="sequencer-uptime-feed"&&!production.protectionBindings.sequencerUptimeFeed)) return invalid();
        return { binding: ref.binding } as DeploymentValue;
      }
      if (Object.hasOwn(ref, "target") && available.has(identifier(ref.target))) return { target: ref.target } as DeploymentValue;
      return invalid();
    });
  };
  const targets: GeneralDeploymentTarget[] = raw.targets.map(item => {
    const t = object(item, "id,source,contract,constructorArguments,initializer,deploymentValue,initializerValue,hookPermissions"), id = identifier(t.id);
    const entry = entries.find(entry => entry.source === t.source && entry.contract === t.contract);
    const identity = `${String(t.source)}:${String(t.contract)}`;
    if (!entry || used.has(identity)) return invalid(); used.add(identity);
    const constructorArguments = values(t.constructorArguments, seen);
    // Forward references in initializers are allowed by the canonical graph;
    // constructor dependency cycles are not.
    let initializer: GeneralDeploymentTarget["initializer"] = null;
    if (t.initializer !== null) {
      const init = object(t.initializer, "function,arguments");
      if (typeof init.function !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/u.test(init.function)) return invalid();
      initializer = { function: init.function, arguments: values(init.arguments, all) };
    }
    const deploymentValue = nativeValue(t.deploymentValue), initializerValue = nativeValue(t.initializerValue);
    fundingUses += Number(deploymentValue !== "0") + Number(initializerValue !== "0");
    if (initializer === null && initializerValue !== "0" || fundingUses > 1) return invalid();
    if (entry.role === "hook") {
      const mask = t.hookPermissions;
      if (!Number.isSafeInteger(mask) || Number(mask) < 0 || Number(mask) > 16383
        || (Number(mask) & 8) && !(Number(mask) & 128) || (Number(mask) & 4) && !(Number(mask) & 64)
        || (Number(mask) & 2) && !(Number(mask) & 1024) || (Number(mask) & 1) && !(Number(mask) & 256)) return invalid();
    } else if (t.hookPermissions !== null) return invalid();
    seen.add(id);
    return { ...entry, id, constructorArguments, initializer, deploymentValue, initializerValue, hookPermissions: t.hookPermissions as number | null };
  });
  const constructorChildren = hasChildren ? declareConstructorChildren(raw.constructorChildren, entries, targets.map(target => target.id), values) : undefined;
  for (const child of constructorChildren ?? []) used.add(`${child.source}:${child.contract}`);
  if (used.size !== entries.length) return invalid();
  const p = object(raw.pool, "token,hook,initializer,platformFeeBinding,fee,tickSpacing");
  const pool = { token: identifier(p.token), hook: identifier(p.hook), initializer: identifier(p.initializer),
    platformFeeBinding: identifier(p.platformFeeBinding), fee: Number(p.fee), tickSpacing: Number(p.tickSpacing) };
  const target = (id: string) => targets.find(target => target.id === id);
  if (targets.filter(target => target.role === "token").length !== 1 || targets.filter(target => target.role === "hook").length !== 1
    || target(pool.token)?.role !== "token" || target(pool.hook)?.role !== "hook" || target(pool.initializer)?.role !== "liquidity"
    || !target(pool.platformFeeBinding) || !target(pool.initializer)?.initializer
    || !Number.isSafeInteger(p.fee) || pool.fee < 0 || pool.fee > 1_000_000 && pool.fee !== 0x800000
    || !Number.isSafeInteger(p.tickSpacing) || pool.tickSpacing < 1 || pool.tickSpacing > 32767) return invalid();
  if (openingPrice && (!openingUsed.size || pool.fee !== 0 || pool.tickSpacing !== 60)) return invalid();
  let fees: GeneralDeploymentBlueprint["fees"], liquidityModel: GeneralDeploymentBlueprint["liquidityModel"];
  if (hasFees) {
    const selected = object(raw.fees, "buyPpm,sellPpm");
    if (![selected.buyPpm, selected.sellPpm].every(rate => Number.isSafeInteger(rate) && Number(rate) >= 0 && Number(rate) <= 100_000)
      || !["external-concentrated-liquidity", "launch-seeded-concentrated-liquidity", "hook-inventory-custom-accounting"].includes(String(raw.liquidityModel))) return invalid();
    fees = { buyPpm: Number(selected.buyPpm), sellPpm: Number(selected.sellPpm) };
    liquidityModel = raw.liquidityModel as GeneralDeploymentBlueprint["liquidityModel"];
    if (liquidityModel === "hook-inventory-custom-accounting" && !(Number(target(pool.hook)?.hookPermissions) & 12)) return invalid();
  }
  const body = { ...(constructorChildren ? { version: 2 as const, constructorChildren } : { version: 1 as const }), productionId: production.id, targets, pool, ...(fees ? { fees, liquidityModel } : {}), ...(openingPrice ? { openingPrice } : {}) };
  return structuredClone({ ...body, id: canonicalBrowserSha256V2(`programmable.custom-ai-deployment-blueprint.v${body.version}`, body) });
}

export function checkedGeneralDeploymentBlueprint(value: GeneralDeploymentBlueprint, entries: ProjectEntrypoint[], production: LaunchProductionContext, intent: LaunchIntent) {
  if (!value || ![1, 2].includes(value.version) || value.productionId !== production.id) return invalid();
  const result = createGeneralDeploymentBlueprint(deploymentBlueprintInput(value), entries, production, intent);
  const { id, ...body } = value;
  if (result.id !== id || result.version !== value.version || id !== canonicalBrowserSha256V2(`programmable.custom-ai-deployment-blueprint.v${value.version}`, body)) return invalid();
  return result;
}

export function deploymentBlueprintInput(value: GeneralDeploymentBlueprint) {
  return { targets: value.targets.map(target => ({ id: target.id, source: target.source, contract: target.contract,
    constructorArguments: target.constructorArguments, initializer: target.initializer, deploymentValue: target.deploymentValue,
    initializerValue: target.initializerValue, hookPermissions: target.hookPermissions })), pool: value.pool,
    ...(value.fees ? { fees: value.fees, liquidityModel: value.liquidityModel } : {}),
    ...(value.openingPrice ? { openingPrice: value.openingPrice } : {}),
    ...(value.version === 2 ? { constructorChildren: value.constructorChildren.map(child => ({ id: child.id, source: child.source, contract: child.contract,
      parent: child.parent, creation: child.creation, nonce: child.nonce, constructorArguments: child.constructorArguments, value: child.value })) } : {}) };
}

export const generalDeploymentPlanningRules = `Declare deployment inside generalChecks separately from local examples: targets, pool, fees, liquidityModel, and constructorChildren only for constructor-created auxiliary instances.
targets is an ordered array of direct roots with {id,source,contract,constructorArguments,initializer,deploymentValue,initializerValue,hookPermissions}. Without constructorChildren there is exactly one target per source entrypoint. With children every entrypoint must be used by a root or declared child. The role comes from the source entrypoint. Constructor target refs point only to earlier direct roots. initializer is null or {function:unambiguousPublicFunctionName,arguments:[...]}; its target refs may point forward to other roots. Values are strings, booleans, nested arrays, {target:id}, {input:'controller'|'name'|'symbol'|'quote'|'funding'}, or {binding:'pool-manager'|'launch-executor'|'graph-factory'|'permit-authority'|'fee-recipient'|'funding-token'}. Literal external addresses require explicit saved design provenance. Never use fixture, account, pool, v4-router or test-trader refs in a production deployment.
V3 exposes {binding:'swap-router'|'swap-router-runtime-hash'|'native-usd-feed'|'native-usd-feed-runtime-hash'|'sequencer-uptime-feed'}. Hash bindings are bytes32. Sequencer is available only if configured. Swap router and launch-executor differ. Pins alone do not prove current code, price or feed state.
For protected native seeded launches declare openingPrice:{supply:raw18DecimalInteger,targetFdvUsd:integerString}, at least the profile minimum. Use {binding:'opening-tick'} for initialize and {binding:'opening-sqrt-price-x96'} in the hook; never guess prices. Preparation derives them from one fresh observation and reads the actual token totalSupply(), decimals()=18 and hook initialSqrtPriceX96().
Native deploymentValue/initializerValue is either '0' or {input:'funding'}. The saved wallet funding amount may be consumed once in the entire graph, never multiplied. initializerValue must be '0' when initializer is null. hookPermissions is the exact integer bit mask for a hook, otherwise null.
pool has exactly {token,hook,initializer,platformFeeBinding,fee,tickSpacing}. It selects one token, one hook, a real source liquidity initializer with a declared initializer call, and the source component binding the platform fee. The initializer must implement the actual PoolManager settlement/funding path, never call the synthetic v4-router. A recipe is a declaration; actual ABI, source/runtime, canonical packing and backend admission still follow. For Robinhood do not invent graph-factory, permit-authority or funding-token roots that its Plan context does not expose.
fees has {buyPpm,sellPpm}, integer applicant-selected source rates in the canonical profile's 0..100000 ppm range. Derive them from the complete agreed design and selected policy; do not silently choose zero or claim variable fees are constant. The selected chain's platform/opening fee rules still apply independently. Preserve or clarify a concrete conflict. liquidityModel is launch-seeded-concentrated-liquidity for a coin whose declared source seeds liquidity, external-concentrated-liquidity only when external liquidity is explicitly intended, or hook-inventory-custom-accounting for an agreed inventory/delta mechanism. The inventory model needs a declared swap-return-delta permission. These are declarations, never execution evidence.
${constructorChildPlanningRules}`;
