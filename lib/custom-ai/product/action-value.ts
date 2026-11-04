import type {ProductRuntime} from "./runtime";

type Value = string | boolean | Value[] | {[key: string]: Value};
export type ProductValue = {
  state: "value-observed"; actionId: string; callId: string; sourceBinding: string;
  chainId: number; caller: string; target: string; signature: string;
  block: ProductRuntime["block"]; snapshotAt: string; observedAt: string;
  outputs: {name: string; type: string; value: Value}[]; authorized: false;
};

export function readProductValue(raw: unknown, runtime: ProductRuntime, actionId: string): ProductValue {
  const value = raw as ProductValue, action = runtime.actions.find(item => item.id === actionId);
  const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
  let nodes = 0;
  const valid = (item: unknown, depth = 0): boolean => {
    if (++nodes > 256 || depth > 8) return false;
    if (typeof item === "boolean") return true;
    if (typeof item === "string") return item.length <= 4096;
    if (Array.isArray(item)) return item.every(child => valid(child, depth + 1));
    return Boolean(item && typeof item === "object" && Object.values(item).every(child => valid(child, depth + 1)));
  };
  if (!value || !action || !["pure", "view"].includes(action.mutability) || value.state !== "value-observed"
    || value.actionId !== actionId || value.sourceBinding !== runtime.sourceBinding || value.chainId !== runtime.chainId
    || value.signature !== action.signature || !same(value.target, action.address)
    || !/^0x[0-9a-f]{40}$/i.test(value.caller) || !/^sha256:[0-9a-f]{64}$/.test(value.callId)
    || value.block?.number !== runtime.block.number || value.block?.hash !== runtime.block.hash
    || value.snapshotAt !== runtime.checkedAt || !Number.isFinite(Date.parse(value.observedAt)) || value.authorized !== false
    || !Array.isArray(value.outputs) || value.outputs.length > 64 || JSON.stringify(value).length > 32768
    || value.outputs.some(output => !output || typeof output.name !== "string" || output.name.length > 256
      || typeof output.type !== "string" || output.type.length > 256 || !valid(output.value)))
    throw Error("This value does not match your saved contract. Refresh contracts and try again.");
  return value;
}
