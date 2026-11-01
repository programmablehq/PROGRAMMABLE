import type { ProjectEntrypoint } from "./contract-project";
import type { DeploymentValue } from "./deployment-blueprint";

export type ConstructorChild = ProjectEntrypoint & {
  id: string; parent: string; creation: "create"; nonce: string;
  constructorArguments: DeploymentValue[]; value: string | { input: "funding" };
};
const fail = (): never => { throw new TypeError("Declare the exact constructor-created contracts, their parent and creation order before source generation."); };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(value);
/** Closed V2 declaration. These are expected source instances, never a
 * successful runtime observation or permission to execute an unknown CREATE. */
export function declareConstructorChildren(value: unknown, entries: ProjectEntrypoint[], roots: readonly string[],
  parseValues: (value: unknown, available: Set<string>) => DeploymentValue[]): ConstructorChild[] {
  if (!Array.isArray(value) || !value.length || value.length + roots.length > 16) return fail();
  const seen = new Set(roots), nextNonce = new Map<string, bigint>();
  return value.map(input => {
    if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
      || Object.keys(input).sort().join() !== "constructorArguments,contract,creation,id,nonce,parent,source,value") return fail();
    const child = input as Record<string, unknown>;
    const entry = entries.find(entry => entry.source === child.source && entry.contract === child.contract);
    if (!entry || entry.role !== "auxiliary" || !identifier(child.id) || seen.has(child.id) || !identifier(child.parent) || !seen.has(child.parent)
      || child.creation !== "create" || typeof child.nonce !== "string" || !/^[1-9][0-9]?$/u.test(child.nonce)
      || BigInt(child.nonce) !== (nextNonce.get(child.parent) ?? 1n)) return fail();
    const constructorArguments = parseValues(child.constructorArguments, new Set(seen));
    let amount: ConstructorChild["value"];
    if (typeof child.value === "string" && /^(?:0|[1-9][0-9]{0,77})$/u.test(child.value) && BigInt(child.value) < 2n ** 256n) amount = child.value;
    else if (child.value && typeof child.value === "object" && !Array.isArray(child.value)
      && Object.keys(child.value).join() === "input" && "input" in child.value && child.value.input === "funding") amount = { input: "funding" };
    else return fail();
    seen.add(child.id); nextNonce.set(child.parent, BigInt(child.nonce) + 1n);
    return { ...entry, id: child.id, parent: child.parent, creation: "create", nonce: child.nonce, constructorArguments, value: amount };
  });
}
export const constructorChildPlanningRules = `When a source constructor creates auxiliary contracts, also declare constructorChildren before generating source. Each item is exactly {id,source,contract,parent,creation:'create',nonce,constructorArguments,value}. IDs are unique across roots and children. List children after their parent, with that parent's consecutive CREATE nonces starting at '1'. References in their constructorArguments may select roots or previously declared children. One auxiliary source artifact may produce several separately declared instances. value is an explicit decimal wei string or {input:'funding'} forwarded from already declared root funding, never an extra transaction. Undeclared creation, CREATE2 children, unknown external state and unexplained value transfers cannot be treated as successful observations. Declared children require independent exact constructor/runtime checks and do not establish launch protection or admission.`;
