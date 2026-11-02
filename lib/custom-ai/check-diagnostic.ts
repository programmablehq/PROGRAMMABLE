import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { ContractProject } from "./contract-project";
import type { BuilderChainId } from "./execution-routing";
import type { LaunchIntent } from "./launch-intent";
import type { LaunchProductionContext } from "./launch-production";

export type CheckContext = { intent: LaunchIntent; chainId: BuilderChainId; evmVersion: "paris" | "cancun";
  production?: LaunchProductionContext; previousCompiler?: ContractProject["compiler"];interfaceHash?:string };
export type CheckFailure = { stage: "interface" | "scenarios"; message: string; declaration: string | null };
export type CheckDiagnostic = { version: 1; contextHash: `sha256:${string}`; failures: CheckFailure[] };
export const checkContextHash = (input: CheckContext) => canonicalBrowserSha256V2("programmable.check-declaration-context.v1", {
  intent: input.intent, chainId: input.chainId, evmVersion: input.evmVersion,
  production: input.production ?? null, previousCompiler: input.previousCompiler ?? null,interfaceHash:input.interfaceHash??null,
});

/** Private owner data only; never serialize this through the public job result.
 * A failed complete declaration can be corrected on an explicit later build,
 * but cannot confer a successful blueprint or follow a changed design. */
export function checkedCheckDiagnostic(value: unknown): CheckDiagnostic {
  const v = value as CheckDiagnostic;
  if (!v || Object.keys(v).sort().join() !== "contextHash,failures,version" || v.version !== 1
    || !/^sha256:[a-f0-9]{64}$/.test(v.contextHash) || !Array.isArray(v.failures) || v.failures.length < 1 || v.failures.length > 2
    || v.failures.some(f => !f || Object.keys(f).sort().join() !== "declaration,message,stage"
      || !["interface", "scenarios"].includes(f.stage) || typeof f.message !== "string" || f.message.length > 2000
      || f.declaration !== null && (typeof f.declaration !== "string" || new TextEncoder().encode(f.declaration).length > 96_000))) {
    throw new TypeError("Invalid private declaration diagnostic.");
  }
  return structuredClone(v);
}

export function reusableCheckFailure(value: unknown, input: CheckContext): CheckFailure | undefined {
  try {
    const saved = checkedCheckDiagnostic(value);
    return saved.contextHash === checkContextHash(input) ? saved.failures.findLast(f => f.declaration !== null) : undefined;
  } catch { return undefined; }
}
