import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { ContractProject } from "./contract-project";
import type { GeneralCheckBlueprint } from "./check-blueprint";

export type SourceProgress = {
  version: 1; contextHash: `sha256:${string}`;
  files: Record<string, { content: string }>;
  reply: string; summary: string;
};

/** Progress has no compiled artifacts or launch authority. Only a complete
 * package can enter the existing compiler, source audit and behavior runner. */
export function sourceProgressContext(blueprint: GeneralCheckBlueprint, compiler: ContractProject["compiler"],
  dependencies: ContractProject["sources"], previous: ContractProject["sources"]) {
  return canonicalBrowserSha256V2("programmable.source-progress-context.v1", {
    blueprint: blueprint.id, compiler,
    dependencies: canonicalBrowserSha256V2("programmable.source-dependencies.v1", dependencies),
    previous: canonicalBrowserSha256V2("programmable.previous-sources.v1", previous),
  });
}

export function checkedSourceProgress(value: unknown, contextHash?: string, allowedPaths?: readonly string[]): SourceProgress {
  const v = value as SourceProgress;
  if (!v || Object.keys(v).sort().join() !== "contextHash,files,reply,summary,version" || v.version !== 1
    || !/^sha256:[a-f0-9]{64}$/.test(v.contextHash) || contextHash && v.contextHash !== contextHash
    || typeof v.reply !== "string" || v.reply.length > 3000 || typeof v.summary !== "string" || v.summary.length > 360
    || !v.files || typeof v.files !== "object" || Array.isArray(v.files)
    || Object.getPrototypeOf(v.files) !== Object.prototype && Object.getPrototypeOf(v.files) !== null
    || Object.keys(v.files).length > 16 || new TextEncoder().encode(JSON.stringify(v)).length > 600_000
    || Object.entries(v.files).some(([path,file]) => !/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-]+\.sol$/.test(path)
      || path.split('/').some(part=>part==='.'||part==='..') || allowedPaths && !allowedPaths.includes(path)
      || !file || Object.keys(file).join()!=="content" || typeof file.content!=="string" || !file.content.trim()
      || new TextEncoder().encode(file.content).length > 96_000)) throw new TypeError("Invalid saved source progress.");
  return structuredClone(v);
}
