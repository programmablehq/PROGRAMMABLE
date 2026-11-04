import {toFunctionSignature, type AbiFunction} from "viem";

/** Only getters with no inputs, or one explicitly supplied wallet, can be
 * presented without asking the user to understand an ABI form. */
export function automaticProductRead(fn: AbiFunction): "none" | "wallet" | undefined {
  if (!["view", "pure"].includes(fn.stateMutability) || fn.outputs.length === 0) return;
  if (fn.inputs.length === 0) return "none";
  if (fn.inputs.length === 1 && fn.inputs[0].type === "address"
    && /^_?(account|wallet|holder|owner|user|beneficiary|recipient|who)_?$/i.test(fn.inputs[0].name ?? "")) return "wallet";
}

export function productActionFunction(abi: readonly unknown[], signature: string): AbiFunction | undefined {
  return abi.find((item): item is AbiFunction => Boolean(item && typeof item === "object"
    && "type" in item && item.type === "function" && toFunctionSignature(item as AbiFunction) === signature));
}
