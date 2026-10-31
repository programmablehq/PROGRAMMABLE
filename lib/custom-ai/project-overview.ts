import type { ContractProject } from "./contract-project";
import type { CompiledProject } from "./contract-project.server";
import type { GeneralProjectView } from "./project-view";

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

export function overviewFromView(requestId:string,view:GeneralProjectView):ProjectOverview {
  return {requestId,projectHash:view.projectHash,chainId:view.chainId,intentRevision:view.intentRevision,compiler:view.compiler,
    sourceFiles:view.sourceFiles,sourceBytes:view.sourceBytes,compilation:view.compiled?"compiled":"diagnostics",
    artifactHash:view.artifactHash,diagnostics:view.diagnostics};
}

/** Browser copies are advisory and may be stale or malformed. No cached value
 * grants verification, ownership, compilation work or a launch permit. */
export function cachedProjectOverview(value:unknown):ProjectOverview|undefined {
  if(!value||typeof value!=="object"||Array.isArray(value))return;
  const v=value as ProjectOverview,c=v.compiler;
  if(typeof v.requestId!=="string"||!/^[a-zA-Z0-9-]{16,64}$/.test(v.requestId)||typeof v.projectHash!=="string"||!/^sha256:[a-f0-9]{64}$/.test(v.projectHash)
    ||![1,4663,8453,999].includes(v.chainId)||typeof v.intentRevision!=="string"||!/^[a-f0-9]{64}$/.test(v.intentRevision)
    ||!Number.isInteger(v.sourceFiles)||v.sourceFiles<1||v.sourceFiles>48||!Number.isInteger(v.sourceBytes)||v.sourceBytes<1||v.sourceBytes>384_000
    ||!c||c.version!=="0.8.26+commit.8a97fa7a"||c.optimizerRuns!==1000||c.viaIR!==false||!["paris","cancun"].includes(c.evmVersion)
    ||!["pending","compiled","diagnostics"].includes(v.compilation)||v.artifactHash!==undefined&&!/^sha256:[a-f0-9]{64}$/.test(v.artifactHash)
    ||v.compilation!=="pending"&&!v.artifactHash||!Array.isArray(v.diagnostics)||v.diagnostics.length>24
    ||v.diagnostics.some(item=>!item||!["error","warning"].includes(item.severity)||typeof item.message!=="string"||item.message.length>800))return;
  return {requestId:v.requestId,projectHash:v.projectHash,chainId:v.chainId,intentRevision:v.intentRevision,sourceFiles:v.sourceFiles,sourceBytes:v.sourceBytes,
    compiler:{version:c.version,optimizerRuns:c.optimizerRuns,viaIR:c.viaIR,evmVersion:c.evmVersion},compilation:v.compilation,
    ...(v.artifactHash?{artifactHash:v.artifactHash}:{}),diagnostics:v.diagnostics.map(item=>({severity:item.severity,message:item.message}))};
}
