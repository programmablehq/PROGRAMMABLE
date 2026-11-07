import type { ContractProject } from "./contract-project";
import type { GeneralProjectDraft } from "./general-builder.server";
import { cachedProjectOverview } from "./project-overview";
import { cachedScenarioOverview, scenarioOverview, type ScenarioOverview } from "./scenario-overview";
import {cachedProductImplementation,type ProductImplementation} from "./product/implementation";
import { checkedGeneralDeploymentBlueprint } from "./deployment-blueprint";

const COIN_PREREQUISITES = ["compilation", "source-review", "scenarios", "coin-deployment"] as const;
export type CoinPreparationEligibility = { eligible: boolean; missing: (typeof COIN_PREREQUISITES[number])[] };

/** Derived from the owned source on the server. A cached copy is presentation
 * metadata only; preparation revalidates the declaration and source checks. */
export function generalCoinPreparationEligibility(value: Pick<GeneralProjectDraft, "project" | "compilation" | "sourceAudit" | "scenarios">): CoinPreparationEligibility {
  const missing: CoinPreparationEligibility["missing"] = [];
  if (!value.compilation.compiled) missing.push("compilation");
  if (value.sourceAudit?.status !== "passed") missing.push("source-review");
  if (!value.scenarios?.passed) missing.push("scenarios");
  const { project } = value;
  try {
    if (!project.production || !project.deployment) throw new Error("Missing coin declaration");
    checkedGeneralDeploymentBlueprint(project.deployment, project.entrypoints, project.production, project.intent);
  } catch { missing.push("coin-deployment"); }
  return { eligible: missing.length === 0, missing };
}

function cachedCoinPreparation(value: unknown): CoinPreparationEligibility | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as CoinPreparationEligibility;
  if (Object.keys(v).sort().join(",") !== "eligible,missing" || typeof v.eligible !== "boolean"
    || !Array.isArray(v.missing) || v.missing.length > COIN_PREREQUISITES.length
    || v.missing.some(item => !COIN_PREREQUISITES.includes(item)) || new Set(v.missing).size !== v.missing.length
    || v.eligible !== (v.missing.length === 0)) return;
  return { eligible: v.eligible, missing: [...v.missing] };
}

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
  sourceReview?: "passed" | "changes_required";
  coinPreparation?: CoinPreparationEligibility;
  diagnostics: GeneralProjectDraft["compilation"]["diagnostics"];
  requirementCoverage: "proposed";
  verification: "not-run";
  launchReady: false;
  blueprintId?:`sha256:${string}`;
  productBlueprintId?:`sha256:${string}`;
  implementation?:ProductImplementation;
  scenarios?:ScenarioOverview;
};
export function generalProjectView(value: GeneralProjectDraft,implementation?:ProductImplementation): GeneralProjectView {
  return projectCompilationView(value,implementation);
}
export function projectCompilationView(value: Pick<GeneralProjectDraft,"project"|"compilation"|"sourceAudit"|"scenarios"|"summary"|"blueprintId">,implementation?:ProductImplementation): GeneralProjectView {
  const { project, compilation } = value;
  if(implementation&&(!project.productBlueprintId||!cachedProductImplementation(implementation,{projectHash:project.hash,artifactHash:compilation.artifactHash,intentRevision:project.intent.revision,productBlueprintId:project.productBlueprintId})))throw TypeError("Product implementation changed.");
  return { version: 1, projectHash: project.hash, artifactHash: compilation.artifactHash, chainId: project.chainId,
    intentRevision: project.intent.revision, summary: value.summary, compiler: project.compiler, entrypoints: project.entrypoints,
    sourceFiles: Object.keys(project.sources).length,
    sourceBytes: Object.values(project.sources).reduce((sum, source) => sum + new TextEncoder().encode(source.content).length, 0),
    compiled: compilation.compiled, diagnostics: compilation.diagnostics.slice(0, 24).map(item => ({ severity: item.severity, message: item.message.slice(0, 800) })),
    ...(value.sourceAudit?{sourceReview:value.sourceAudit.status}:{}), coinPreparation: generalCoinPreparationEligibility(value),
    requirementCoverage: "proposed", verification: "not-run", launchReady: false,
    ...(value.blueprintId?{blueprintId:value.blueprintId}:{}),...(project.productBlueprintId?{productBlueprintId:project.productBlueprintId}:{}),...(implementation?{implementation}:{}),...(value.scenarios?{scenarios:scenarioOverview(value.scenarios)}:{}) };
}

export function cachedGeneralProjectView(value:unknown):GeneralProjectView|undefined {
  if(!value||typeof value!=="object"||Array.isArray(value))return;
  const v=value as GeneralProjectView;
  if(v.version!==1||typeof v.compiled!=="boolean"||v.launchReady!==false||v.verification!=="not-run"||v.requirementCoverage!=="proposed"
    ||v.sourceReview!==undefined&&!["passed","changes_required"].includes(v.sourceReview)
    ||typeof v.summary!=="string"||!v.summary.trim()||v.summary.length>360||!Array.isArray(v.entrypoints)||!v.entrypoints.length||v.entrypoints.length>16
    ||v.entrypoints.some(item=>!item||typeof item.source!=="string"||item.source.length>180||typeof item.contract!=="string"||!/^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/.test(item.contract)||!["token","hook","liquidity","auxiliary"].includes(item.role)))return;
  const base=cachedProjectOverview({...v,requestId:"cached-project-view",compilation:v.compiled?"compiled":"diagnostics"});
  if(!base?.artifactHash)return;
  const scenarios=v.scenarios?cachedScenarioOverview(v.scenarios):undefined;
  const coinPreparation=v.coinPreparation===undefined?undefined:cachedCoinPreparation(v.coinPreparation);
  if(v.coinPreparation!==undefined&&!coinPreparation)return;
  const implementation=v.implementation&&v.productBlueprintId?cachedProductImplementation(v.implementation,{projectHash:base.projectHash,artifactHash:base.artifactHash,intentRevision:base.intentRevision,productBlueprintId:v.productBlueprintId}):undefined;
  if(v.implementation&&!implementation)return;
  if(v.scenarios&&!scenarios||v.blueprintId!==undefined&&!/^sha256:[a-f0-9]{64}$/.test(v.blueprintId)||v.productBlueprintId!==undefined&&!/^sha256:[a-f0-9]{64}$/.test(v.productBlueprintId))return;
  return {version:1,projectHash:base.projectHash,artifactHash:base.artifactHash,chainId:base.chainId,intentRevision:base.intentRevision,summary:v.summary,
    compiler:base.compiler,entrypoints:v.entrypoints.map(item=>({source:item.source,contract:item.contract,role:item.role})),sourceFiles:base.sourceFiles,sourceBytes:base.sourceBytes,
    compiled:v.compiled,diagnostics:base.diagnostics,requirementCoverage:"proposed",verification:"not-run",launchReady:false,
    ...(v.sourceReview?{sourceReview:v.sourceReview}:{}),
    ...(coinPreparation?{coinPreparation}:{}),
    ...(v.blueprintId?{blueprintId:v.blueprintId}:{}),...(v.productBlueprintId?{productBlueprintId:v.productBlueprintId}:{}),...(implementation?{implementation}:{}),...(scenarios?{scenarios}:{})};
}
