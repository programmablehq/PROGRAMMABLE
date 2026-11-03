import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { builderChain, type BuilderChainId } from "./execution-routing";
import { intentHasOpenParts, type LaunchIntent } from "./launch-intent";
import { checkedLaunchProductionContext, type LaunchProductionContext } from "./launch-production";
import { checkedGeneralDeploymentBlueprint, type GeneralDeploymentBlueprint } from "./deployment-blueprint";
import { GENERAL_PROJECT_COMPILER, approvedProjectCompiler, createProjectCompiler, projectCompilerProfile, VIAIR_200_REMAPPINGS, type ProjectCompiler } from "./compiler-profile";

export { GENERAL_PROJECT_COMPILER };
// The count includes the complete transitive library closure. Keep the byte
// and entrypoint ceilings while allowing normal protocol libraries to fit.
export const GENERAL_PROJECT_LIMITS = { files: 128, sourceBytes: 384_000, fileBytes: 96_000, entrypoints: 16 } as const;
export type ProjectEntrypoint = { source: string; contract: string; role: "token" | "hook" | "liquidity" | "auxiliary" };
export type ContractProject = {
  version: 1;
  hash: `sha256:${string}`;
  chainId: BuilderChainId;
  intent: LaunchIntent;
  compiler: ProjectCompiler;
  sources: Record<string, { content: string }>;
  entrypoints: ProjectEntrypoint[];
  production?: LaunchProductionContext;
  deployment?: GeneralDeploymentBlueprint;
};
const fail = (): never => { throw new TypeError("Use a complete source package with the pinned compiler and supported settings."); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail();
};
export function projectSourcePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 180 || !/^[A-Za-z0-9_@-]+(?:\/[A-Za-z0-9_.@-]+)*\.sol$/.test(value)
    || value.split("/").some(part => part === "." || part === ".." || part.startsWith("."))) return fail();
  return value;
}

/** Only inline Standard JSON sources enter the compiler. There is no remote
 * dependency resolution, model-selected command or host import callback. */
export function createContractProject(value: unknown, intent: LaunchIntent, chainId: BuilderChainId, production?: LaunchProductionContext, deployment?: GeneralDeploymentBlueprint): ContractProject {
  builderChain(chainId);
  if (!intent || !/^[a-f0-9]{64}$/.test(intent.revision) || intentHasOpenParts(intent)
    || !intent.requirements.length || intent.requirements.length > 64) throw new TypeError("Resolve the complete saved design before compiling its contract.");
  const input = object(value); exact(input, ["compiler", "sources", "entrypoints"]);
  const compiler = object(input.compiler); exact(compiler, ["version", "optimizerRuns", "viaIR", "evmVersion"]);
  if (!approvedProjectCompiler(compiler)) fail();
  const rawSources = object(input.sources), names = Object.keys(rawSources).sort();
  if (!names.length || names.length > GENERAL_PROJECT_LIMITS.files) fail();
  const sources: ContractProject["sources"] = Object.create(null);
  let bytes = 0;
  for (const name of names) {
    projectSourcePath(name);
    const source = object(rawSources[name]); exact(source, ["content"]);
    if (typeof source.content !== "string" || !source.content.trim() || source.content.includes("\0")) fail();
    const size = new TextEncoder().encode(source.content as string).length;
    if (size > GENERAL_PROJECT_LIMITS.fileBytes || (bytes += size) > GENERAL_PROJECT_LIMITS.sourceBytes) fail();
    sources[name] = { content: source.content as string };
  }
  if (!Array.isArray(input.entrypoints) || !input.entrypoints.length || input.entrypoints.length > GENERAL_PROJECT_LIMITS.entrypoints) fail();
  const entrypoints = (input.entrypoints as unknown[]).map(raw => {
    const entry = object(raw); exact(entry, ["source", "contract", "role"]);
    const source = projectSourcePath(entry.source);
    if (!Object.hasOwn(sources, source) || typeof entry.contract !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(entry.contract)
      || !["token", "hook", "liquidity", "auxiliary"].includes(String(entry.role))) return fail();
    return { source, contract: entry.contract, role: entry.role as ProjectEntrypoint["role"] };
  }).sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : a.contract < b.contract ? -1 : a.contract > b.contract ? 1 : 0);
  if (new Set(entrypoints.map(entry => `${entry.source}:${entry.contract}`)).size !== entrypoints.length) fail();
  if (deployment && !production) fail();
  const body: Omit<ContractProject, "hash"> = { version: 1 as const, chainId, intent,
    compiler: createProjectCompiler(projectCompilerProfile(compiler), compiler.evmVersion), sources, entrypoints,
    ...(production ? { production: checkedLaunchProductionContext(production, chainId) } : {}),
    ...(deployment ? { deployment: checkedGeneralDeploymentBlueprint(deployment, entrypoints, production!, intent) } : {}) };
  const hash = canonicalBrowserSha256V2("programmable.custom-ai-project.v1", body);
  // Copy the complete intent so later mutation of an interpreter object cannot
  // change the source package behind its recorded hash.
  return structuredClone({ ...body, hash });
}

export function projectCompilerInput(project: ContractProject) {
  const checked = createContractProject({ compiler: project.compiler, sources: project.sources, entrypoints: project.entrypoints }, project.intent, project.chainId, project.production, project.deployment);
  if (checked.hash !== project.hash) throw new TypeError("The contract project changed after it was saved.");
  return { language: "Solidity", sources: checked.sources, settings: { optimizer: { enabled: true, runs: checked.compiler.optimizerRuns },
    viaIR: checked.compiler.viaIR, evmVersion: checked.compiler.evmVersion, metadata: { bytecodeHash: "none", appendCBOR: false },
    ...(checked.compiler.viaIR ? { remappings: [...VIAIR_200_REMAPPINGS] } : {}),
    outputSelection: { "*": { "*": ["abi", "metadata", "evm.bytecode", "evm.deployedBytecode", "storageLayout"] } } } };
}
