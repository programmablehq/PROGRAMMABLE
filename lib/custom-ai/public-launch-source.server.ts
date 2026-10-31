import "server-only";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput, GENERAL_PROJECT_COMPILER } from "./contract-project";
import type { checkedGeneralLaunchSource } from "./general-launch-source.server";
import { CustomAIError } from "./types";

export type OwnedGeneralLaunchSource = ReturnType<typeof checkedGeneralLaunchSource>;
const unavailable = (): never => { throw new CustomAIError("launch-source-export", "Recheck this saved source before preparing its public launch package.", 422); };
const publicDomain = "programmable.custom-ai-public-source.v1";
const digest = /^sha256:[a-f0-9]{64}$/u;

/** Deliberate public export only. Never spread a chat, intent, blueprint or job
 * into this record: they can contain private messages and source provenance. */
export function createGeneralPublicSource(source: OwnedGeneralLaunchSource) {
  const { project, compilation, scenarios, blueprint } = source;
  const compilerInput = projectCompilerInput(project), { artifactHash, ...artifact } = compilation;
  if (!compilation.compiled || compilation.projectHash !== project.hash || compilation.launchReady !== false
    || artifactHash !== canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", artifact)
    || !scenarios.passed || scenarios.projectHash !== project.hash || scenarios.artifactHash !== artifactHash
    || scenarios.failures.length || scenarios.launchReady !== false) return unavailable();
  const artifacts = compilation.contracts.map((contract, index) => {
    if (!contract.compilerMetadata) return unavailable();
    let metadata: Record<string, unknown>;
    try { metadata = JSON.parse(contract.compilerMetadata); } catch { return unavailable(); }
    const compiler = metadata.compiler as { version?: string }, settings = metadata.settings as { compilationTarget?: Record<string, string> };
    if (compiler?.version !== GENERAL_PROJECT_COMPILER || !settings?.compilationTarget
      || Object.entries(settings.compilationTarget).length !== 1 || settings.compilationTarget[contract.source] !== contract.contract) return unavailable();
    return { path: `artifacts/target-${index}.json`, source: contract.source, contract: contract.contract, role: contract.role,
      artifact: { abi: contract.abi, metadata: contract.compilerMetadata,
        bytecode: { object: contract.creationBytecode.slice(2), linkReferences: {} },
        deployedBytecode: { object: contract.runtimeBytecode.slice(2), linkReferences: {}, immutableReferences: contract.immutableReferences } } };
  });
  const content = { schemaVersion: publicDomain, projectHash: project.hash, artifactHash,
    compilerInput, artifacts,
    evidence: {
      compilation: { version: 1, compiler: compilation.compiler, projectHash: project.hash, artifactHash, compiled: true, launchReady: false },
      behavior: { version: scenarios.version, scope: scenarios.scope, projectHash: project.hash, artifactHash,
        planHash: scenarios.planHash, reportHash: scenarios.hash, cases: scenarios.cases, gasUsed: scenarios.gasUsed, passed: true, launchReady: false },
      declaration: { version: 1, blueprintId: blueprint.id, productionId: project.production?.id ?? null,
        deploymentId: project.deployment?.id ?? null, assurance: "local-declaration-only", launchReady: false },
    } };
  if (Buffer.byteLength(JSON.stringify(content)) > 4_000_000) return unavailable();
  return structuredClone({ id: canonicalBrowserSha256V2(publicDomain, content), content });
}
export type GeneralPublicSource = ReturnType<typeof createGeneralPublicSource>;

export function checkedGeneralPublicSource(value: GeneralPublicSource, id: string) {
  if (!digest.test(id) || !value || value.id !== id || value.content?.schemaVersion !== publicDomain
    || Object.keys(value).sort().join() !== "content,id" || Buffer.byteLength(JSON.stringify(value)) > 4_001_000
    || canonicalBrowserSha256V2(publicDomain, value.content) !== id) return unavailable();
  return structuredClone(value);
}

export function generalSourcePublicUri(id: string) {
  if (!digest.test(id)) return unavailable();
  return `https://programmable.market/api/custom-ai/source/${id.slice(7)}`;
}
