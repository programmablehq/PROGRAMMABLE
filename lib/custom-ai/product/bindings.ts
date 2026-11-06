import { parseAbi, toFunctionSignature } from "viem";
import type { GeneralCheckScenarios } from "../behavior-checks";
import type { ProjectEntrypoint } from "../contract-project";
import type { ProductBlueprint } from "./blueprint";

export type ProductBindings = {
  version: 1;
  components: { component: string; contract: string }[];
  actions: { action: string; contract: string; signature: string }[];
};
const isContract = (kind: string) => ["token", "hook", "vault"].includes(kind);
const canBindContract = (kind: string) => isContract(kind) || kind === "adapter";
const id = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const object = (value: unknown, keys: string[]): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.keys(value).sort().join() === keys.sort().join());
const fail = (reason: string): never => { throw new TypeError(`Invalid product binding: ${reason}. Bind the saved product to its declared contract functions.`); };

export function productBindingsSchema(product: ProductBlueprint, contracts: string[]) {
  const requiredComponents = product.components.filter(component => isContract(component.kind)).map(component => component.id);
  const components = product.components.filter(component => canBindContract(component.kind)).map(component => component.id);
  const actions = product.interfaceActions.filter(action => components.includes(action.target)).map(action => action.id);
  const requiredActions = product.interfaceActions.filter(action => requiredComponents.includes(action.target));
  const identifier = { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$", maxLength: 64 };
  const list = (names: string[], minimum:number, properties: Record<string, unknown>) => ({ type: "array", minItems: minimum, maxItems: names.length,
    items: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } });
  return { type: "object", properties: {
    version: { type: "integer", enum: [1] },
    components: list(components, requiredComponents.length, { component: components.length ? { type: "string", enum: components } : identifier, contract: { type: "string", enum: contracts } }),
    actions: list(actions, requiredActions.length, { action: actions.length ? { type: "string", enum: actions } : identifier, contract: { type: "string", enum: contracts }, signature: { type: "string", maxLength: 800 } }),
  }, required: ["version", "components", "actions"], additionalProperties: false };
}

/** A function binding describes the source interface. It grants no wallet or service authority. */
export function checkedProductBindings(value: unknown, scenarios: GeneralCheckScenarios, entrypoints: ProjectEntrypoint[], product?: ProductBlueprint): ProductBindings {
  if (!object(value, ["version", "components", "actions"]) || value.version !== 1 || !Array.isArray(value.components) || value.components.length > 64
    || !Array.isArray(value.actions) || value.actions.length > 64 || new TextEncoder().encode(JSON.stringify(value)).length > 32_000) return fail("shape");
  const fixtures = new Map([...scenarios.contracts, ...(scenarios.constructorChildren ?? [])].map(contract => [contract.id, contract]));
  const components = value.components.map(item => {
    if (!object(item, ["component", "contract"]) || !id(item.component) || !id(item.contract) || !fixtures.has(item.contract)) return fail("component reference");
    return { component: item.component, contract: item.contract };
  });
  const actions = value.actions.map(item => {
    if (!object(item, ["action", "contract", "signature"]) || !id(item.action) || !id(item.contract) || typeof item.signature !== "string" || item.signature.length > 800) return fail("action reference");
    let signature = item.signature.trim();
    if (signature.startsWith("function ")) {
      try {
        const [declared] = parseAbi([signature]);
        if (!declared || declared.type !== "function") return fail("action signature");
        signature = toFunctionSignature(declared);
      } catch { return fail("action signature"); }
    }
    const fixture = fixtures.get(item.contract);
    const fn = fixture && parseAbi(fixture.functions).find(fn => fn.type === "function" && toFunctionSignature(fn) === signature);
    if (!fn || fn.type !== "function") return fail(`action ${item.action} is absent from its declared interface`);
    return { action: item.action, contract: item.contract, signature };
  });
  if (new Set(components.map(item => item.component)).size !== components.length || new Set(actions.map(item => item.action)).size !== actions.length) return fail("duplicate identity");
  if (product) {
    const expected = product.components.filter(component => isContract(component.kind));
    if (expected.some(component => !components.some(binding => binding.component === component.id))
      ||components.some(binding=>!product.components.some(component=>component.id===binding.component&&canBindContract(component.kind)))) return fail("complete contract components required");
    for (const component of expected) {
      const bound = components.find(binding => binding.component === component.id)!;
      const fixture = fixtures.get(bound.contract)!;
      const role = entrypoints.find(entry => entry.source === fixture.source && entry.contract === fixture.contract)?.role;
      if ((component.kind === "token" || component.kind === "hook") && role !== component.kind) return fail(`component ${component.id} role`);
    }
    const contractActions = product.interfaceActions.filter(action => components.some(binding => binding.component === action.target));
    if (contractActions.length !== actions.length || contractActions.some(action => !actions.some(binding => binding.action === action.id))) return fail("complete contract actions required");
    for (const action of contractActions) {
      const bound = actions.find(binding => binding.action === action.id)!;
      if (components.find(component => component.component === action.target)?.contract !== bound.contract) return fail(`action ${action.id} target`);
      const fn = parseAbi(fixtures.get(bound.contract)!.functions).find(fn => fn.type === "function" && toFunctionSignature(fn) === bound.signature);
      if (!fn || fn.type !== "function" || (action.kind === "inspect") !== ["view", "pure"].includes(fn.stateMutability)) return fail(`action ${action.id} mutability`);
      if (!scenarios.steps.some(step => step.contract === bound.contract && step.signature === bound.signature && step.expect.status === "success"
        && action.requirementIds.every(requirement => step.requirementIds.includes(requirement)))) return fail(`action ${action.id} needs its declared successful example and rule links`);
    }
  }
  return { version: 1, components, actions };
}

export const PRODUCT_BINDING_RULES = `When the saved productBlueprint is present, productBindings links each token, hook and vault component to one fixed graph contract id. Also bind adapter components that have an onchain contract; offchain readers stay unbound. Several product components may share a contract. Map every contract-targeted interface action to its component's same contract and one exact public function signature, such as liquidity() or balanceOf(address), without the function prefix, return values or mutability keywords. Inspect actions are view/pure; claim, deposit, withdraw and vote actions change state. Include a successful example of each bound action with that action's requirement IDs. These bindings are source interfaces, not live addresses, approvals or service deployment. External services and interface-only components do not acquire contract bindings.`;
