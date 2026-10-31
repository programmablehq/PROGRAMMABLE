import type { ContractProject } from "./contract-project";
import type { GeneralProjectDraft } from "./general-builder.server";

/** Public-to-the-owning-browser projection. Complete source and bytecode stay
 * in the owned checkpoint and are read explicitly for inspection or a build. */
export type GeneralProjectView = {
  version: 1;
  projectHash: ContractProject["hash"];
  artifactHash: `sha256:${string}`;
  chainId: ContractProject["chainId"];
  intentRevision: string;
  summary: string;
  compiler: ContractProject["compiler"];
  entrypoints: ContractProject["entrypoints"];
  sourceFiles: number;
  sourceBytes: number;
  compiled: boolean;
  diagnostics: GeneralProjectDraft["compilation"]["diagnostics"];
  requirementCoverage: "proposed";
  verification: "not-run";
  launchReady: false;
};
export function generalProjectView(value: GeneralProjectDraft): GeneralProjectView {
  const { project, compilation } = value;
  return { version: 1, projectHash: project.hash, artifactHash: compilation.artifactHash, chainId: project.chainId,
    intentRevision: project.intent.revision, summary: value.summary, compiler: project.compiler, entrypoints: project.entrypoints,
    sourceFiles: Object.keys(project.sources).length,
    sourceBytes: Object.values(project.sources).reduce((sum, source) => sum + new TextEncoder().encode(source.content).length, 0),
    compiled: compilation.compiled, diagnostics: compilation.diagnostics.slice(0, 24).map(item => ({ severity: item.severity, message: item.message.slice(0, 800) })),
    requirementCoverage: "proposed", verification: "not-run", launchReady: false };
}
