import type { ContractProject } from "./contract-project";
import type { CompiledProject } from "./contract-project.server";

/** Small owned receipt for restoring a failed build without reading its source
 * or bytecode into every chat restore and status response. */
export type ProjectOverview = {
  requestId: string;
  projectHash: ContractProject["hash"];
  chainId: ContractProject["chainId"];
  intentRevision: string;
  compiler: ContractProject["compiler"];
  sourceFiles: number;
  sourceBytes: number;
  compilation: "pending" | "compiled" | "diagnostics";
  artifactHash?: CompiledProject["artifactHash"];
  diagnostics: CompiledProject["diagnostics"];
};

export function projectOverview(requestId: string, project: ContractProject, compilation?: CompiledProject): ProjectOverview {
  return { requestId, projectHash: project.hash, chainId: project.chainId, intentRevision: project.intent.revision,
    compiler: project.compiler, sourceFiles: Object.keys(project.sources).length,
    sourceBytes: Object.values(project.sources).reduce((total, source) => total + new TextEncoder().encode(source.content).length, 0),
    compilation: compilation ? compilation.compiled ? "compiled" : "diagnostics" : "pending",
    ...(compilation ? { artifactHash: compilation.artifactHash } : {}),
    diagnostics: compilation?.diagnostics.slice(0, 24).map(item => ({ severity: item.severity, message: item.message.slice(0, 800) })) ?? [] };
}
