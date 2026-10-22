import type { Hex } from "viem";

/** Ignore only compiler-declared immutable slots, never arbitrary byte ranges. */
export function matchesRuntime(actual: Hex, artifact: { runtimeTemplate: Hex;
  immutableReferences: Record<string, readonly { start: number; length: number }[]> }) {
  if (!/^0x(?:[a-f0-9]{2})+$/i.test(actual) || actual.length !== artifact.runtimeTemplate.length) return false;
  const left = actual.toLowerCase().split(""), right = artifact.runtimeTemplate.toLowerCase().split("");
  for (const refs of Object.values(artifact.immutableReferences)) for (const { start, length } of refs) {
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length !== 32
      || (start + length) * 2 + 2 > left.length) return false;
    left.fill("0", start * 2 + 2, (start + length) * 2 + 2);
    right.fill("0", start * 2 + 2, (start + length) * 2 + 2);
  }
  return left.join("") === right.join("");
}
