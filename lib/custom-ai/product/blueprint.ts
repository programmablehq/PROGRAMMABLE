import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { builderChain, type BuilderChainId } from "../execution-routing";
import type { LaunchIntent } from "../launch-intent";

export const PRODUCT_COMPONENT_KINDS = ["token", "hook", "vault", "adapter", "automation", "indexer", "interface"] as const;
export const PRODUCT_ACTORS = ["creator", "trader", "holders", "community", "protocol", "burn"] as const;
export const PRODUCT_TRIGGERS = ["swap", "transfer", "deposit", "claim", "time", "external-event", "vote", "manual"] as const;
export type ProductComponent = {
  id: string; kind: typeof PRODUCT_COMPONENT_KINDS[number]; name: string; purpose: string;
  requirementIds: string[]; dependsOn: string[];
};
export type ProductAsset = { id: string; kind: "native" | "launch-token" | "external-token"; name: string };
export type ProductFlow = {
  id: string; source: string; target: string; asset: string;
  trigger: typeof PRODUCT_TRIGGERS[number]; purpose: string; requirementIds: string[];
  allocationGroup: string | null; shareBps: number | null;
};
export type ProductService = {
  component: string; capability: string; trigger: "time" | "external-event" | "onchain-event";
  failurePolicy: "retain-funds" | "pause-action" | "bounded-retry" | "undecided";
  requirementIds: string[];
};
export type ProductInterfaceAction = {
  id: string; target: string; kind: "claim" | "deposit" | "withdraw" | "vote" | "inspect";
  requirementIds: string[];
};
export type ProductPlan = {
  components: ProductComponent[]; assets: ProductAsset[]; flows: ProductFlow[];
  services: ProductService[]; interfaceActions: ProductInterfaceAction[];
};
export type ProductIssue = {
  code: "unassigned-requirement" | "incomplete-allocation" | "excess-allocation" | "unresolved-share" | "failure-policy";
  ids: string[]; detail: string; basisPoints?: number;
};
export type ProductBlueprint = ProductPlan & {
  version: 1; id: `sha256:${string}`; intentId: string; intentRevision: string; chainId: BuilderChainId;
  state: "defined" | "needs-decisions"; issues: ProductIssue[];
  execution: "not-certified";
};

const textSchema = { type: "string", minLength: 1, maxLength: 600 };
const idSchema = { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" };
const idsSchema = { type: "array", maxItems: 64, uniqueItems: true, items: idSchema };
const records = (properties: Record<string, unknown>, maxItems = 64) => ({
  type: "array", maxItems, items: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});
export const productPlanSchema = {
  type: "object", properties: {
    components: records({ id: idSchema, kind: { enum: PRODUCT_COMPONENT_KINDS }, name: textSchema, purpose: textSchema, requirementIds: idsSchema, dependsOn: idsSchema }),
    assets: records({ id: idSchema, kind: { enum: ["native", "launch-token", "external-token"] }, name: textSchema }, 32),
    flows: records({ id: idSchema, source: idSchema, target: idSchema, asset: idSchema, trigger: { enum: PRODUCT_TRIGGERS }, purpose: textSchema,
      requirementIds: idsSchema, allocationGroup: { anyOf: [idSchema, { type: "null" }] }, shareBps: { type: ["integer", "null"], minimum: 0, maximum: 10000 } }, 128),
    services: records({ component: idSchema, capability: idSchema, trigger: { enum: ["time", "external-event", "onchain-event"] },
      failurePolicy: { enum: ["retain-funds", "pause-action", "bounded-retry", "undecided"] }, requirementIds: idsSchema }, 32),
    interfaceActions: records({ id: idSchema, target: idSchema, kind: { enum: ["claim", "deposit", "withdraw", "vote", "inspect"] }, requirementIds: idsSchema }, 64),
  }, required: ["components", "assets", "flows", "services", "interfaceActions"], additionalProperties: false,
};

const fail = (): never => { throw new TypeError("The product plan must preserve its saved rules and complete component references."); };
function object(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) return fail();
  return value as Record<string, unknown>;
}
const id = (value: unknown): string => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value) ? value : fail();
const text = (value: unknown): string => typeof value === "string" && value.trim() && value.length <= 600 ? value.trim() : fail();
function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  return typeof value === "string" && choices.includes(value as T) ? value as T : fail();
}
function list<T>(value: unknown, maximum: number, read: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > maximum) return fail();
  return value.map(read);
}
function unique<T>(items: T[], key: (item: T) => string): T[] {
  if (new Set(items.map(key)).size !== items.length) return fail();
  return items.sort((a, b) => key(a).localeCompare(key(b)));
}

/** The model proposes architecture. This parser binds it to the owned intent;
 * it never grants code, network, credential, spending or deployment authority. */
export function createProductBlueprint(value: unknown, intent: LaunchIntent, chainId: BuilderChainId): ProductBlueprint {
  builderChain(chainId);
  if (!intent.requirements.length || !/^[a-f0-9]{64}$/.test(intent.revision) || JSON.stringify(value).length > 96_000) return fail();
  const allowed = new Set(intent.requirements.map(rule => rule.id));
  const refs = (value: unknown, required = true) => {
    const result = unique(list(value, 64, id), item => item);
    if ((required && !result.length) || result.some(item => !allowed.has(item))) return fail();
    return result;
  };
  const raw = object(value, "components,assets,flows,services,interfaceActions");
  const components = unique(list(raw.components, 64, item => {
    const v = object(item, "id,kind,name,purpose,requirementIds,dependsOn");
    return { id: id(v.id), kind: oneOf(v.kind, PRODUCT_COMPONENT_KINDS), name: text(v.name), purpose: text(v.purpose),
      requirementIds: refs(v.requirementIds), dependsOn: unique(list(v.dependsOn, 64, id), key => key) };
  }), item => item.id);
  if (!components.length || components.some(component => (PRODUCT_ACTORS as readonly string[]).includes(component.id))) return fail();
  const componentIds = new Set(components.map(component => component.id));
  if (components.some(component => component.dependsOn.some(dependency => !componentIds.has(dependency) || dependency === component.id))) return fail();
  const endpoint = (value: unknown) => { const key = id(value); return componentIds.has(key) || (PRODUCT_ACTORS as readonly string[]).includes(key) ? key : fail(); };
  const assets = unique(list(raw.assets, 32, item => {
    const v = object(item, "id,kind,name");
    return { id: id(v.id), kind: oneOf(v.kind, ["native", "launch-token", "external-token"] as const), name: text(v.name) };
  }), item => item.id);
  const assetIds = new Set(assets.map(asset => asset.id));
  const flows = unique(list(raw.flows, 128, item => {
    const v = object(item, "id,source,target,asset,trigger,purpose,requirementIds,allocationGroup,shareBps");
    const asset = id(v.asset); if (!assetIds.has(asset)) return fail();
    const allocationGroup = v.allocationGroup === null ? null : id(v.allocationGroup);
    const shareBps = v.shareBps === null ? null : Number.isInteger(v.shareBps) && Number(v.shareBps) >= 0 && Number(v.shareBps) <= 10000 ? Number(v.shareBps) : fail();
    if (shareBps !== null && allocationGroup === null) return fail();
    return { id: id(v.id), source: endpoint(v.source), target: endpoint(v.target), asset, trigger: oneOf(v.trigger, PRODUCT_TRIGGERS),
      purpose: text(v.purpose), requirementIds: refs(v.requirementIds), allocationGroup, shareBps };
  }), item => item.id);
  const services = unique(list(raw.services, 32, item => {
    const v = object(item, "component,capability,trigger,failurePolicy,requirementIds"), component = id(v.component);
    if (!components.some(item => item.id === component && ["adapter", "automation", "indexer"].includes(item.kind))) return fail();
    return { component, capability: id(v.capability), trigger: oneOf(v.trigger, ["time", "external-event", "onchain-event"] as const),
      failurePolicy: oneOf(v.failurePolicy, ["retain-funds", "pause-action", "bounded-retry", "undecided"] as const), requirementIds: refs(v.requirementIds) };
  }), item => `${item.component}:${item.capability}`);
  const interfaceActions = unique(list(raw.interfaceActions, 64, item => {
    const v = object(item, "id,target,kind,requirementIds"), target = id(v.target); if (!componentIds.has(target)) return fail();
    return { id: id(v.id), target, kind: oneOf(v.kind, ["claim", "deposit", "withdraw", "vote", "inspect"] as const), requirementIds: refs(v.requirementIds) };
  }), item => item.id);
  const issues: ProductIssue[] = [];
  const covered = new Set([...components, ...flows, ...services, ...interfaceActions].flatMap(item => item.requirementIds));
  const missing = [...allowed].filter(key => !covered.has(key));
  if (missing.length) issues.push({ code: "unassigned-requirement", ids: missing, detail: "Keep these saved rules assigned to the product implementation." });
  const groups = new Map<string, ProductFlow[]>();
  for (const flow of flows) if (flow.allocationGroup) {
    const key = `${flow.source}:${flow.asset}:${flow.allocationGroup}`;
    groups.set(key, [...(groups.get(key) ?? []), flow]);
  }
  for (const group of groups.values()) {
    const ids = group.map(flow => flow.id), sum = group.reduce((total, flow) => total + (flow.shareBps ?? 0), 0);
    if (sum > 10000) issues.push({ code: "excess-allocation", ids, basisPoints: sum - 10000, detail: `These flows allocate ${sum} bps from the same funds; at most 10000 are available.` });
    else if (group.some(flow => flow.shareBps === null)) issues.push({ code: "unresolved-share", ids, detail: "The share of these funds still needs an explicit decision." });
    else if (sum < 10000) issues.push({ code: "incomplete-allocation", ids, basisPoints: 10000 - sum, detail: `${10000 - sum} bps of these funds remain unassigned. Preserve that choice; do not normalize or allocate it silently.` });
  }
  for (const service of services) if (service.failurePolicy === "undecided") issues.push({ code: "failure-policy", ids: [service.component], detail: "Set what this action does when its input or execution is unavailable." });
  const body = { version: 1 as const, intentId: intent.id, intentRevision: intent.revision, chainId,
    components, assets, flows, services, interfaceActions, state: issues.length ? "needs-decisions" as const : "defined" as const,
    issues, execution: "not-certified" as const };
  return { ...body, id: canonicalBrowserSha256V2("programmable.product-blueprint.v1", body) };
}

export function checkedProductBlueprint(value: ProductBlueprint, intent: LaunchIntent, chainId: BuilderChainId): ProductBlueprint {
  if (value.version !== 1 || value.intentId !== intent.id || value.intentRevision !== intent.revision || value.chainId !== chainId || value.execution !== "not-certified") return fail();
  const rebuilt = createProductBlueprint({ components: value.components, assets: value.assets, flows: value.flows, services: value.services, interfaceActions: value.interfaceActions }, intent, chainId);
  if (rebuilt.id !== value.id || rebuilt.state !== value.state || JSON.stringify(rebuilt.issues) !== JSON.stringify(value.issues)) return fail();
  return rebuilt;
}

/** Browser caches are display data, never an implementation or launch permit. */
export function restoredProductBlueprint(value: unknown, intent: LaunchIntent | undefined, chainId: BuilderChainId): ProductBlueprint | undefined {
  if (!intent || !value) return undefined;
  try { return checkedProductBlueprint(value as ProductBlueprint, intent, chainId); } catch { return undefined; }
}

export const PRODUCT_PLANNING_RULES = `Keep a single productPlan for a new or revised design. Its components describe the token, hook, helper contracts, adapters, automation, index and interface actually needed by the saved rules. Link each component, flow, service and interface action to canonical requirement IDs. Preserve every rule; architectural suggestions never silently become user decisions.
Flows name their source, target, asset and trigger. Actor endpoints are creator, trader, holders, community, protocol and burn; other endpoints must be declared components. An allocationGroup divides one specific source of funds in one asset. Shares are basis points of that budget, not a swap fee or a percentage of token price. Use null for undecided shares, and keep an unassigned remainder explicit. Do not normalize an incomplete split or count the same funds twice.
Services identify needed capabilities and failure behavior. They are requirements, not proof that a feed, keeper, protocol adapter or credential exists. No URLs, keys or invented deployment addresses belong in this plan. A defined plan does not certify execution, tests, funding, deployment or launch readiness.
For questions and brainstorming preserve the current productPlan; return null rather than replacing it with the example. For a genuine design change produce the complete new plan with the revised requirement IDs. Keep the conversation short and about the user's behavior and choices; the structure is internal.`;
