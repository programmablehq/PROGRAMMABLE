import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { ContractProject } from "./contract-project";
import type { GeneralCheckBlueprint } from "./check-blueprint";

export type SourceProgress = {
  version: 1; contextHash: `sha256:${string}`;
  files: Record<string, { content: string }>;
  reply: string; summary: string;
  partial?: { path: string; content: string; parts: number };
};

/** Progress has no compiled artifacts or launch authority. Only a complete
 * package can enter the existing compiler, source audit and behavior runner. */
export function sourceProgressContext(blueprint: GeneralCheckBlueprint, compiler: ContractProject["compiler"],
  dependencies: ContractProject["sources"], previous: ContractProject["sources"]) {
  return canonicalBrowserSha256V2("programmable.source-progress-context.v1", {
    blueprint: blueprint.id, compiler, implementationView: "component-source-v1",
    dependencies: canonicalBrowserSha256V2("programmable.source-dependencies.v1", dependencies),
    previous: canonicalBrowserSha256V2("programmable.previous-sources.v1", previous),
  });
}

export function checkedSourceProgress(value: unknown, contextHash?: string, allowedPaths?: readonly string[]): SourceProgress {
  const v = value as SourceProgress;
  const validPath=(path:unknown):path is string=>typeof path==="string"&&/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-]+\.sol$/.test(path)
    &&!path.split('/').some(part=>part==='.'||part==='..')&&(!allowedPaths||allowedPaths.includes(path));
  if (!v || Object.keys(v).some(key=>!["contextHash","files","partial","reply","summary","version"].includes(key)) || v.version !== 1
    || !/^sha256:[a-f0-9]{64}$/.test(v.contextHash) || contextHash && v.contextHash !== contextHash
    || typeof v.reply !== "string" || v.reply.length > 3000 || typeof v.summary !== "string" || v.summary.length > 360
    || !v.files || typeof v.files !== "object" || Array.isArray(v.files)
    || Object.getPrototypeOf(v.files) !== Object.prototype && Object.getPrototypeOf(v.files) !== null
    || Object.keys(v.files).length > 16 || new TextEncoder().encode(JSON.stringify(v)).length > 600_000
    || Object.entries(v.files).some(([path,file]) => !validPath(path)
      || !file || Object.keys(file).join()!=="content" || typeof file.content!=="string" || !file.content.trim()
      || new TextEncoder().encode(file.content).length > 96_000)
    || v.partial!==undefined&&(!v.partial||Object.keys(v.partial).sort().join()!=="content,parts,path"
      ||!validPath(v.partial.path)||Object.hasOwn(v.files,v.partial.path)||typeof v.partial.content!=="string"||!v.partial.content.trim()
      ||new TextEncoder().encode(v.partial.content).length>96_000||!Number.isSafeInteger(v.partial.parts)||v.partial.parts<1||v.partial.parts>24))
    throw new TypeError("Invalid saved source progress.");
  return structuredClone(v);
}

/** A saved prefix is private build work, never an executable source file.
 * Its bytes can only be appended or promoted unchanged into a complete file. */
export function sourceProgressExtends(previous:SourceProgress,next:SourceProgress):boolean {
  if(previous.contextHash!==next.contextHash||Object.entries(previous.files).some(([path,file])=>next.files[path]?.content!==file.content))return false;
  const part=previous.partial;
  if(!part)return true;
  if(next.files[part.path])return next.files[part.path].content.startsWith(part.content);
  return next.partial?.path===part.path&&next.partial.parts>part.parts&&next.partial.content.startsWith(part.content);
}
